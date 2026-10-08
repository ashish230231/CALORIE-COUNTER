import re

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .. import config, db
from ..foodstore import (
    USER_SOURCES, ensure_energy, food_detail, insert_food, is_referenced, new_source_id, retire,
)
from ..nutrients import LABEL_NUTRIENTS, display_name, group_for

router = APIRouter(prefix="/api", tags=["foods"])

SOURCES = {"foundation", "sr_legacy", "survey", "custom", "recipe", "barcode"}

# Candidates come from the full-text index (prefix matches, stemming) or the trigram index (typos).
# The score favours: the plain food over dishes containing it (head match), the user's own and
# frequently logged foods, lab-analysed data, and short generic names; it demotes branded SR entries,
# baby food and foods whose energy is unknown. Ranking is two-stage: a cheap score trims candidates
# to a shortlist before the (comparatively expensive) trigram similarity is computed. Portions are
# fetched only for the final page.
SEARCH_SQL = """
WITH q AS (SELECT to_tsquery('english', $2) AS tsq, strip(to_tsvector('english', $1)) AS head),
usage AS (SELECT food_id, count(*) AS uses FROM diary_entry GROUP BY food_id),
fts AS MATERIALIZED (SELECT f.id FROM food f, q WHERE f.search_vector @@ q.tsq),
candidates AS (
    SELECT id FROM fts
    UNION  -- typo tolerance, only needed when full-text search finds little
    SELECT f.id FROM food f WHERE (SELECT count(*) FROM fts) < 40 AND $1 <% f.description
),
shortlist AS (
    SELECT f.id, f.description, coalesce(u.uses, 0) AS uses,
           ( ts_rank_cd(f.search_vector, q.tsq, 1)
           + CASE WHEN f.head = q.head THEN 1.0 ELSE 0 END
           + CASE f.source WHEN 'custom' THEN 0.4 WHEN 'recipe' THEN 0.4 WHEN 'barcode' THEN 0.3
                           WHEN 'foundation' THEN 0.15 WHEN 'sr_legacy' THEN 0.1 ELSE 0 END
           + CASE WHEN f.description LIKE '%, NFS' THEN 0.15 ELSE 0 END
           + 0.3 * least(ln(1 + coalesce(u.uses, 0)), 3)
           - least(length(f.description), 150) / 250.0
           - CASE WHEN f.description ~ '^[A-Z][A-Z''&.-]{2,}[ ,]' THEN 0.4 ELSE 0 END
           - CASE WHEN f.description ILIKE 'babyfood%' OR f.category = 'Baby Foods' THEN 0.6 ELSE 0 END
           - CASE WHEN f.kcal IS NULL THEN 0.5 ELSE 0 END
           ) AS base
    FROM candidates c JOIN food f ON f.id = c.id CROSS JOIN q
    LEFT JOIN usage u ON u.food_id = f.id
    WHERE NOT f.archived AND f.source_id <> 'quick-add'
      AND ($4::text[] IS NULL OR f.source = ANY($4::text[]))
    ORDER BY base DESC
    LIMIT 200 + $5 + $6
),
ranked AS (
    SELECT id, uses,
           base + word_similarity($1, description)
                + 0.8 * word_similarity($1, split_part(description, ',', 1))
                + CASE WHEN description ILIKE $3 THEN 0.3 ELSE 0 END AS score
    FROM shortlist
    ORDER BY score DESC, id
    LIMIT $5 OFFSET $6
)
SELECT f.id, f.source, f.description, f.brand, f.category, f.kcal, f.protein, f.fat, f.carbs, f.kcal_source,
       r.uses, r.score,
       (SELECT json_build_object('label', p.label, 'grams', p.gram_weight)
          FROM food_portion p WHERE p.food_id = f.id ORDER BY p.seq, p.id LIMIT 1) AS portion
FROM ranked r JOIN food f ON f.id = r.id
ORDER BY r.score DESC, f.id
"""


def _tsquery(text: str) -> str:
    tokens = re.findall(r"[a-z0-9]+", text.lower())
    return " & ".join(f"{t}:*" for t in tokens)


def _like_prefix(text: str) -> str:
    return re.sub(r"([\\%_])", r"\\\1", text) + "%"


@router.get("/foods/search")
async def search(
    q: str = Query(..., min_length=1, max_length=120),
    sources: str | None = Query(None, description="comma separated sources"),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    q = q.strip()
    src = [s for s in (sources or "").split(",") if s in SOURCES] or None
    rows = await db.pool.fetch(SEARCH_SQL, q, _tsquery(q), _like_prefix(q), src, limit, offset)
    return [dict(r) for r in rows]


@router.get("/foods/recent")
async def recent(limit: int = Query(30, ge=1, le=100)):
    rows = await db.pool.fetch(
        """SELECT f.id, f.source, f.description, f.brand, f.kcal, f.protein, f.fat, f.carbs,
                  last.grams, last.quantity, last.unit_label, last.meal, last.created_at AS last_used, cnt.uses
           FROM (SELECT DISTINCT ON (food_id) food_id, grams, quantity, unit_label, meal, created_at
                 FROM diary_entry ORDER BY food_id, created_at DESC) last
           JOIN (SELECT food_id, count(*) AS uses FROM diary_entry GROUP BY food_id) cnt ON cnt.food_id = last.food_id
           JOIN food f ON f.id = last.food_id
           WHERE NOT f.archived AND f.source_id <> 'quick-add'
           ORDER BY last.created_at DESC LIMIT $1""",
        limit,
    )
    return [dict(r) for r in rows]


@router.get("/foods/mine")
async def my_foods():
    rows = await db.pool.fetch(
        """SELECT f.id, f.source, f.description, f.brand, f.category, f.kcal, f.protein, f.fat, f.carbs, f.updated_at,
                  (SELECT json_build_object('label', p.label, 'grams', p.gram_weight)
                     FROM food_portion p WHERE p.food_id = f.id ORDER BY p.seq, p.id LIMIT 1) AS portion
           FROM food f
           WHERE f.source = ANY($1::text[]) AND NOT f.archived AND f.source_id <> 'quick-add'
           ORDER BY f.updated_at DESC""",
        list(USER_SOURCES),
    )
    return [dict(r) for r in rows]


@router.get("/foods/{food_id}")
async def get_food(food_id: int):
    async with db.pool.acquire() as con:
        food = await food_detail(con, food_id)
    if not food:
        raise HTTPException(404, "Food not found")
    return food


@router.get("/nutrients")
async def nutrient_catalog():
    rows = await db.pool.fetch("SELECT id, name, unit, rank FROM nutrient ORDER BY rank NULLS LAST, id")
    label = set(LABEL_NUTRIENTS)
    return [
        {"id": r["id"], "name": display_name(r["id"], r["name"]), "unit": r["unit"],
         "group": group_for(r["id"], r["rank"]), "label": r["id"] in label,
         "label_order": LABEL_NUTRIENTS.index(r["id"]) if r["id"] in label else None}
        for r in rows
    ]


# ------------------------------------------------------------------------------------ custom foods

class PortionIn(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    grams: float = Field(gt=0, le=100000)


class CustomFoodIn(BaseModel):
    description: str = Field(min_length=1, max_length=200)
    brand: str | None = Field(None, max_length=120)
    category: str | None = Field(None, max_length=120)
    basis_grams: float = Field(gt=0, le=100000, description="nutrient amounts are given for this many grams")
    serving_label: str | None = Field(None, max_length=80)
    nutrients: dict[int, float]
    portions: list[PortionIn] = []


def _per100(body: CustomFoodIn) -> dict[int, float]:
    for nid, amount in body.nutrients.items():
        if amount < 0:
            raise HTTPException(422, f"Nutrient {nid} cannot be negative")
    return {nid: amount * 100 / body.basis_grams for nid, amount in body.nutrients.items()}


def _custom_portions(body: CustomFoodIn) -> list[tuple[str, float]]:
    portions = [(body.serving_label or "1 serving", body.basis_grams)]
    portions += [(p.label, p.grams) for p in body.portions]
    return portions


@router.post("/foods", status_code=201)
async def create_food(body: CustomFoodIn):
    per100 = _per100(body)
    kcal_source = ensure_energy(per100, "label")
    async with db.pool.acquire() as con, con.transaction():
        food_id = await insert_food(
            con, source="custom", source_id=new_source_id(), description=body.description.strip(),
            brand=body.brand, category=body.category, per100=per100, kcal_source=kcal_source,
            portions=_custom_portions(body),
        )
        return await food_detail(con, food_id)


@router.put("/foods/{food_id}")
async def update_food(food_id: int, body: CustomFoodIn):
    per100 = _per100(body)
    kcal_source = ensure_energy(per100, "label")
    async with db.pool.acquire() as con, con.transaction():
        old = await con.fetchrow("SELECT source, source_id, archived FROM food WHERE id = $1 FOR UPDATE", food_id)
        if not old or old["source"] not in ("custom", "barcode") or old["source_id"] == "quick-add":
            raise HTTPException(404, "Editable food not found")
        # Past diary entries keep the values they were logged with: edits create a new version.
        if old["source"] == "barcode":  # the new version inherits the barcode, the old row gets a unique key
            await _release_barcode(con, food_id)
        new_id = await insert_food(
            con, source=old["source"],
            source_id=old["source_id"] if old["source"] == "barcode" else new_source_id(),
            description=body.description.strip(), brand=body.brand, category=body.category, per100=per100,
            kcal_source=kcal_source, portions=_custom_portions(body),
        )
        await retire(con, food_id, new_id)
        if not await is_referenced(con, food_id):
            await con.execute("DELETE FROM food WHERE id = $1", food_id)
        return await food_detail(con, new_id)


@router.delete("/foods/{food_id}", status_code=204)
async def delete_food(food_id: int):
    async with db.pool.acquire() as con, con.transaction():
        old = await con.fetchrow("SELECT source, source_id FROM food WHERE id = $1", food_id)
        if not old or old["source"] not in USER_SOURCES or old["source_id"] == "quick-add":
            raise HTTPException(404, "Only your own foods can be deleted")
        if await is_referenced(con, food_id):
            if old["source"] == "barcode":
                await _release_barcode(con, food_id)
            await con.execute("UPDATE food SET archived = true, updated_at = now() WHERE id = $1", food_id)
        else:
            await con.execute("UPDATE food SET replaced_by = NULL WHERE replaced_by = $1", food_id)
            await con.execute("DELETE FROM food WHERE id = $1", food_id)


async def _release_barcode(con, food_id: int) -> None:
    await con.execute("UPDATE food SET source_id = source_id || ':' || id WHERE id = $1", food_id)


# ------------------------------------------------------------------------------------ barcode

# Open Food Facts stores mass-based nutriments in grams per 100 g; factor converts to our unit.
OFF_MAP = {
    "energy-kcal_100g": (1008, 1), "proteins_100g": (1003, 1), "fat_100g": (1004, 1),
    "carbohydrates_100g": (1005, 1), "sugars_100g": (2000, 1), "added-sugars_100g": (1235, 1),
    "fiber_100g": (1079, 1), "saturated-fat_100g": (1258, 1), "trans-fat_100g": (1257, 1),
    "monounsaturated-fat_100g": (1292, 1), "polyunsaturated-fat_100g": (1293, 1),
    "cholesterol_100g": (1253, 1e3), "sodium_100g": (1093, 1e3), "potassium_100g": (1092, 1e3),
    "calcium_100g": (1087, 1e3), "iron_100g": (1089, 1e3), "magnesium_100g": (1090, 1e3),
    "phosphorus_100g": (1091, 1e3), "zinc_100g": (1095, 1e3), "vitamin-c_100g": (1162, 1e3),
    "vitamin-a_100g": (1106, 1e6), "vitamin-d_100g": (1114, 1e6), "vitamin-e_100g": (1109, 1e3),
    "vitamin-k_100g": (1185, 1e6), "vitamin-b1_100g": (1165, 1e3), "vitamin-b2_100g": (1166, 1e3),
    "vitamin-pp_100g": (1167, 1e3), "vitamin-b6_100g": (1175, 1e3), "vitamin-b12_100g": (1178, 1e6),
    "vitamin-b9_100g": (1177, 1e6), "caffeine_100g": (1057, 1e3), "alcohol_100g": None,
}


def _off_nutrients(nutriments: dict) -> dict[int, float]:
    out: dict[int, float] = {}
    for key, target in OFF_MAP.items():
        if target is None or key not in nutriments:
            continue
        try:
            out[target[0]] = float(nutriments[key]) * target[1]
        except (TypeError, ValueError):
            continue
    if 1008 not in out and "energy_100g" in nutriments:  # kJ
        try:
            out[1008] = float(nutriments["energy_100g"]) / 4.184
        except (TypeError, ValueError):
            pass
    if 1093 not in out and "salt_100g" in nutriments:
        try:
            out[1093] = float(nutriments["salt_100g"]) / 2.5 * 1e3
        except (TypeError, ValueError):
            pass
    return out


@router.get("/foods/barcode/{code}")
async def barcode(code: str):
    if not re.fullmatch(r"\d{6,14}", code):
        raise HTTPException(422, "Barcodes are 6-14 digits")
    async with db.pool.acquire() as con:
        local = await con.fetchval(
            "SELECT id FROM food WHERE source = 'barcode' AND source_id = $1 AND NOT archived", code
        )
        if local:
            return await food_detail(con, local)
    if not config.OPENFOODFACTS_ENABLED:
        raise HTTPException(404, "Product not in your database (online lookup is disabled)")
    try:
        async with httpx.AsyncClient(timeout=10, headers={"User-Agent": "SelfHostedCalorieCounter/1.0"}) as client:
            resp = await client.get(
                f"{config.OPENFOODFACTS_URL}/api/v2/product/{code}.json",
                params={"fields": "product_name,brands,categories,nutriments,serving_size,serving_quantity"},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Open Food Facts is unreachable: {exc}") from exc
    data = resp.json() if resp.status_code == 200 else {}
    product = data.get("product") if data.get("status") == 1 else None
    if not product:
        raise HTTPException(404, "Product not found on Open Food Facts - you can add it as a custom food")
    per100 = _off_nutrients(product.get("nutriments") or {})
    if not per100:
        raise HTTPException(404, "Product found but it has no nutrition data - add it as a custom food")
    kcal_source = ensure_energy(per100, "label")
    portions: list[tuple[str, float]] = []
    try:
        serving_g = float(product.get("serving_quantity") or 0)
    except (TypeError, ValueError):
        serving_g = 0
    if serving_g > 0:
        portions.append((f"1 serving ({product.get('serving_size') or f'{serving_g:g} g'})", serving_g))
    name = (product.get("product_name") or "").strip() or f"Product {code}"
    brand = (product.get("brands") or "").split(",")[0].strip() or None
    category = (product.get("categories") or "").split(",")[0].strip() or None
    async with db.pool.acquire() as con, con.transaction():
        food_id = await insert_food(
            con, source="barcode", source_id=code, description=name, brand=brand, category=category,
            per100=per100, kcal_source=kcal_source, portions=portions,
        )
        return await food_detail(con, food_id)
