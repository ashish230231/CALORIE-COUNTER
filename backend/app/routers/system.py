import asyncio
from datetime import date, datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from .. import config, db, importer
from ..foodstore import USER_SOURCES, insert_food
from .profile import PROFILE_FIELDS, ProfileIn

router = APIRouter(prefix="/api", tags=["system"])

BACKUP_FORMAT = "calorie-counter-backup"
_background: set[asyncio.Task] = set()


def start_import(force: bool = False) -> bool:
    if importer.is_running():
        return False
    task = asyncio.create_task(importer.run_all(force=force))
    _background.add(task)
    task.add_done_callback(_background.discard)
    return True


@router.get("/health")
async def health():
    await db.pool.fetchval("SELECT 1")
    return {"ok": True}


@router.get("/system/status")
async def status():
    rows = {r["dataset"]: r for r in await db.pool.fetch("SELECT * FROM dataset_import")}
    counts = {r["source"]: r["n"] for r in await db.pool.fetch(
        "SELECT source, count(*) AS n FROM food WHERE NOT archived AND source_id <> 'quick-add' GROUP BY source"
    )}
    datasets = []
    for key, filename in config.USDA_DATASETS.items():
        live = importer.state.get(key)
        stored = rows.get(key)
        datasets.append({
            "dataset": key,
            "file": filename,
            "version": importer.version_of(filename),
            "status": live.status if live else (stored["status"] if stored else "pending"),
            "progress": live.progress if live else (1.0 if stored else 0.0),
            "message": live.message if live else (stored["message"] if stored else ""),
            "foods": stored["food_count"] if stored else 0,
            "imported_version": stored["version"] if stored else None,
            "imported_at": stored["imported_at"] if stored else None,
        })
    return {
        "importing": importer.is_running(),
        "datasets": datasets,
        "counts": counts,
        "diary_entries": await db.pool.fetchval("SELECT count(*) FROM diary_entry"),
        "auto_import": config.USDA_AUTO_IMPORT,
        "openfoodfacts": config.OPENFOODFACTS_ENABLED,
    }


@router.post("/system/import", status_code=202)
async def trigger_import(force: bool = False):
    return {"started": start_import(force=force)}


# ------------------------------------------------------------------------------------ backup

def _key(source: str, source_id: str) -> str:
    return f"{source}:{source_id}"


@router.get("/system/export")
async def export_data():
    async with db.pool.acquire() as con:
        profile = dict(await con.fetchrow(f"SELECT {', '.join(PROFILE_FIELDS)} FROM profile WHERE id = 1"))
        foods = await con.fetch(
            """SELECT f.id, f.source, f.source_id, f.description, f.brand, f.category, f.kcal_source, f.archived,
                      r.source AS replaced_source, r.source_id AS replaced_source_id
               FROM food f LEFT JOIN food r ON r.id = f.replaced_by
               WHERE f.source = ANY($1::text[]) AND f.source_id <> 'quick-add' ORDER BY f.id""",
            list(USER_SOURCES),
        )
        ids = [f["id"] for f in foods]
        nutrients: dict[int, dict[str, float]] = {}
        for r in await con.fetch(
            "SELECT food_id, nutrient_id, amount FROM food_nutrient WHERE food_id = ANY($1::bigint[])", ids
        ):
            nutrients.setdefault(r["food_id"], {})[str(r["nutrient_id"])] = r["amount"]
        portions: dict[int, list] = {}
        for r in await con.fetch(
            "SELECT food_id, label, gram_weight FROM food_portion WHERE food_id = ANY($1::bigint[]) ORDER BY seq, id",
            ids,
        ):
            portions.setdefault(r["food_id"], []).append([r["label"], r["gram_weight"]])
        recipes = {r["food_id"]: dict(r) for r in await con.fetch("SELECT * FROM recipe")}
        ingredients: dict[int, list] = {}
        for r in await con.fetch(
            """SELECT ri.recipe_food_id, f.source, f.source_id, ri.grams, ri.quantity, ri.unit_label
               FROM recipe_ingredient ri JOIN food f ON f.id = ri.food_id ORDER BY ri.recipe_food_id, ri.position"""
        ):
            ingredients.setdefault(r["recipe_food_id"], []).append({
                "food": _key(r["source"], r["source_id"]), "grams": r["grams"],
                "quantity": r["quantity"], "unit_label": r["unit_label"],
            })
        diary = await con.fetch(
            """SELECT e.entry_date, e.meal, f.source, f.source_id, e.grams, e.quantity, e.unit_label, e.created_at
               FROM diary_entry e JOIN food f ON f.id = e.food_id ORDER BY e.entry_date, e.created_at, e.id"""
        )
        weights = await con.fetch("SELECT log_date, weight_kg FROM weight_log ORDER BY log_date")
        water = await con.fetch("SELECT log_date, ml FROM water_log ORDER BY log_date")

    def recipe_of(food_id: int):
        r = recipes.get(food_id)
        if not r:
            return None
        return {"servings": r["servings"], "cooked_grams": r["cooked_grams"], "notes": r["notes"],
                "ingredients": ingredients.get(food_id, [])}

    payload = {
        "format": BACKUP_FORMAT,
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "profile": {k: (v.isoformat() if isinstance(v, date) else v) for k, v in profile.items()},
        "foods": [{
            "key": _key(f["source"], f["source_id"]), "source": f["source"], "source_id": f["source_id"],
            "description": f["description"], "brand": f["brand"], "category": f["category"],
            "kcal_source": f["kcal_source"], "archived": f["archived"],
            "replaced_by": _key(f["replaced_source"], f["replaced_source_id"]) if f["replaced_source"] else None,
            "nutrients": nutrients.get(f["id"], {}), "portions": portions.get(f["id"], []),
            "recipe": recipe_of(f["id"]),
        } for f in foods],
        "diary": [{
            "date": e["entry_date"].isoformat(), "meal": e["meal"], "food": _key(e["source"], e["source_id"]),
            "grams": e["grams"], "quantity": e["quantity"], "unit_label": e["unit_label"],
            "created_at": e["created_at"].isoformat(),
        } for e in diary],
        "weights": [{"date": w["log_date"].isoformat(), "weight_kg": w["weight_kg"]} for w in weights],
        "water": [{"date": w["log_date"].isoformat(), "ml": w["ml"]} for w in water],
    }
    filename = f"calorie-counter-backup-{date.today().isoformat()}.json"
    return JSONResponse(payload, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.post("/system/restore")
async def restore(request: Request):
    data = await request.json()
    if not isinstance(data, dict) or data.get("format") != BACKUP_FORMAT:
        raise HTTPException(422, "This file is not a Calorie Counter backup")
    if data.get("version") != 1:
        raise HTTPException(422, f"Unsupported backup version {data.get('version')}")
    summary = {"foods": 0, "diary": 0, "weights": 0, "water": 0, "skipped_diary": 0, "skipped_ingredients": 0}

    async with db.pool.acquire() as con, con.transaction():
        if data.get("profile"):
            profile = ProfileIn.model_validate(data["profile"]).model_dump()
            sets = ", ".join(f"{k} = ${i + 1}" for i, k in enumerate(PROFILE_FIELDS))
            await con.execute(f"UPDATE profile SET {sets} WHERE id = 1", *(profile[k] for k in PROFILE_FIELDS))

        resolved: dict[str, int] = {}

        async def resolve(key: str) -> int | None:
            if key not in resolved:
                source, _, source_id = key.partition(":")
                found = await con.fetchval(
                    "SELECT id FROM food WHERE source = $1 AND source_id = $2", source, source_id
                )
                if found is None:
                    return None
                resolved[key] = found
            return resolved[key]

        new_recipes = []
        for f in data.get("foods", []):
            if f.get("source") not in USER_SOURCES or await resolve(f["key"]) is not None:
                continue  # already present locally
            food_id = await insert_food(
                con, source=f["source"], source_id=f["source_id"], description=f["description"],
                brand=f.get("brand"), category=f.get("category"),
                per100={int(k): float(v) for k, v in (f.get("nutrients") or {}).items()},
                kcal_source=f.get("kcal_source"), portions=[(p[0], float(p[1])) for p in f.get("portions", [])],
                archived=bool(f.get("archived")),
            )
            resolved[f["key"]] = food_id
            summary["foods"] += 1
            if f.get("recipe"):
                new_recipes.append((food_id, f["recipe"]))

        for f in data.get("foods", []):
            if f.get("replaced_by"):
                old, new = await resolve(f["key"]), await resolve(f["replaced_by"])
                if old and new:
                    await con.execute("UPDATE food SET replaced_by = $2 WHERE id = $1 AND replaced_by IS NULL", old, new)

        for food_id, r in new_recipes:
            await con.execute(
                "INSERT INTO recipe (food_id, servings, cooked_grams, notes) VALUES ($1, $2, $3, $4)",
                food_id, float(r["servings"]), r.get("cooked_grams"), r.get("notes"),
            )
            for pos, ing in enumerate(r.get("ingredients", [])):
                ing_id = await resolve(ing["food"])
                if ing_id is None:
                    summary["skipped_ingredients"] += 1
                    continue
                await con.execute(
                    """INSERT INTO recipe_ingredient (recipe_food_id, position, food_id, grams, quantity, unit_label)
                       VALUES ($1, $2, $3, $4, $5, $6)""",
                    food_id, pos, ing_id, float(ing["grams"]), float(ing["quantity"]), ing["unit_label"],
                )

        for e in data.get("diary", []):
            food_id = await resolve(e["food"])
            if food_id is None:
                summary["skipped_diary"] += 1
                continue
            created = datetime.fromisoformat(e["created_at"])
            inserted = await con.fetchval(
                """INSERT INTO diary_entry (entry_date, meal, food_id, grams, quantity, unit_label, created_at)
                   SELECT $1, $2, $3, $4, $5, $6, $7
                   WHERE NOT EXISTS (SELECT 1 FROM diary_entry WHERE entry_date = $1 AND meal = $2 AND food_id = $3
                                     AND grams = $4 AND created_at = $7)
                   RETURNING id""",
                date.fromisoformat(e["date"]), e["meal"], food_id, float(e["grams"]), float(e["quantity"]),
                e["unit_label"], created,
            )
            summary["diary"] += 1 if inserted else 0

        for w in data.get("weights", []):
            await con.execute(
                """INSERT INTO weight_log (log_date, weight_kg) VALUES ($1, $2)
                   ON CONFLICT (log_date) DO UPDATE SET weight_kg = EXCLUDED.weight_kg""",
                date.fromisoformat(w["date"]), float(w["weight_kg"]),
            )
            summary["weights"] += 1
        for w in data.get("water", []):
            await con.execute(
                """INSERT INTO water_log (log_date, ml) VALUES ($1, $2)
                   ON CONFLICT (log_date) DO UPDATE SET ml = EXCLUDED.ml""",
                date.fromisoformat(w["date"]), float(w["ml"]),
            )
            summary["water"] += 1
    return summary
