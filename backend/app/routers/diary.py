from datetime import date
from datetime import date as Date
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..nutrients import ENERGY, HIDDEN, KEY_MICROS, compute_targets, display_name, group_for, sort_key
from .profile import load_profile_and_weight

router = APIRouter(prefix="/api/diary", tags=["diary"])

QUICK_ADD = "quick-add"


def _coverage(row, total_grams: float, quick_grams: float) -> float:
    if not row:
        return 0.0
    if not total_grams:
        return 1.0 if quick_grams else 0.0
    return min(1.0, max(0.0, row["covered"] - quick_grams) / total_grams)

Meal = Literal["breakfast", "lunch", "dinner", "snacks"]
HEADLINE = ("kcal", "protein", "fat", "carbs", "fiber", "sugars", "sat_fat", "sodium")


class EntryIn(BaseModel):
    date: Date
    meal: Meal
    food_id: int
    grams: float = Field(gt=0, le=100000)
    quantity: float = Field(gt=0, le=100000)
    unit_label: str = Field(min_length=1, max_length=80)


class EntryPatch(BaseModel):
    date: Date | None = None
    meal: Meal | None = None
    grams: float | None = Field(None, gt=0, le=100000)
    quantity: float | None = Field(None, gt=0, le=100000)
    unit_label: str | None = Field(None, min_length=1, max_length=80)


class QuickAddIn(BaseModel):
    date: Date
    meal: Meal
    kcal: float = Field(gt=0, le=20000)


class CopyIn(BaseModel):
    from_date: Date
    to_date: Date
    meal: Meal | None = None


@router.get("/{day}")
async def get_day(day: date):
    async with db.pool.acquire() as con:
        entries = await con.fetch(
            """SELECT e.id, e.meal, e.grams, e.quantity, e.unit_label, e.created_at,
                      f.id AS food_id, f.description, f.brand, f.source, f.source_id, f.kcal_source,
                      f.kcal * e.grams / 100 AS kcal, f.protein * e.grams / 100 AS protein,
                      f.fat * e.grams / 100 AS fat, f.carbs * e.grams / 100 AS carbs,
                      f.fiber * e.grams / 100 AS fiber, f.sugars * e.grams / 100 AS sugars,
                      f.sat_fat * e.grams / 100 AS sat_fat, f.sodium * e.grams / 100 AS sodium
               FROM diary_entry e JOIN food f ON f.id = e.food_id
               WHERE e.entry_date = $1 ORDER BY e.created_at, e.id""",
            day,
        )
        nutrient_rows = await con.fetch(
            """SELECT fn.nutrient_id, sum(fn.amount * e.grams / 100) AS amount, sum(e.grams) AS covered
               FROM diary_entry e JOIN food_nutrient fn ON fn.food_id = e.food_id
               WHERE e.entry_date = $1 GROUP BY fn.nutrient_id""",
            day,
        )
        profile, weight = await load_profile_and_weight(con, day)
        targets = compute_targets(profile, weight, day)
        target_ids = [int(k) for k in targets["micros"]]
        consumed = {r["nutrient_id"]: r for r in nutrient_rows}
        meta = await con.fetch(
            "SELECT id, name, unit, rank FROM nutrient WHERE id = ANY($1::int[])",
            list(set(consumed) | set(target_ids)),
        )
        water = await con.fetchval("SELECT ml FROM water_log WHERE log_date = $1", day)
        weight_today = await con.fetchval("SELECT weight_kg FROM weight_log WHERE log_date = $1", day)

    # Quick-add calories are not real food weight, so they don't dilute nutrient coverage.
    total_grams = sum(e["grams"] for e in entries if e["source_id"] != QUICK_ADD)
    quick_grams = sum(e["grams"] for e in entries if e["source_id"] == QUICK_ADD)
    totals = {k: sum((e[k] or 0) for e in entries) for k in HEADLINE}
    nutrients = []
    for m in meta:
        if m["id"] in HIDDEN:
            continue
        row = consumed.get(m["id"])
        target = targets["micros"].get(str(m["id"]))
        nutrients.append({
            "id": m["id"],
            "name": display_name(m["id"], m["name"]),
            "unit": m["unit"],
            "group": group_for(m["id"], m["rank"]),
            "rank": m["rank"],
            "amount": row["amount"] if row else 0,
            # Share of the day's food (by weight) that has a measured value for this nutrient.
            # USDA leaves unanalysed nutrients blank rather than zero, so < 1 means "at least this much".
            "coverage": _coverage(row, total_grams, quick_grams if m["id"] == ENERGY else 0),
            "target": target,
            "key": m["id"] in KEY_MICROS,
        })
    nutrients.sort(key=lambda n: sort_key(n["id"], n["rank"]))
    return {
        "date": day,
        "entries": [dict(e) for e in entries],
        "totals": totals,
        "nutrients": nutrients,
        "targets": targets,
        "water_ml": water or 0,
        "weight_kg": weight_today,
    }


@router.post("", status_code=201)
async def add_entry(body: EntryIn):
    async with db.pool.acquire() as con:
        if not await con.fetchval("SELECT EXISTS (SELECT 1 FROM food WHERE id = $1)", body.food_id):
            raise HTTPException(404, "Food not found")
        entry_id = await con.fetchval(
            """INSERT INTO diary_entry (entry_date, meal, food_id, grams, quantity, unit_label)
               VALUES ($1, $2, $3, $4, $5, $6) RETURNING id""",
            body.date, body.meal, body.food_id, body.grams, body.quantity, body.unit_label,
        )
    return {"id": entry_id}


@router.post("/quick", status_code=201)
async def quick_add(body: QuickAddIn):
    """Log raw calories; the built-in quick-add food carries 1 kcal per gram."""
    entry_id = await db.pool.fetchval(
        """INSERT INTO diary_entry (entry_date, meal, food_id, grams, quantity, unit_label)
           SELECT $1, $2, id, $3, $3, 'kcal' FROM food WHERE source = 'custom' AND source_id = $4
           RETURNING id""",
        body.date, body.meal, body.kcal, QUICK_ADD,
    )
    return {"id": entry_id}


@router.patch("/{entry_id}")
async def update_entry(entry_id: int, body: EntryPatch):
    fields = body.model_dump(exclude_none=True)
    if not fields:
        return {"id": entry_id}
    column = {"date": "entry_date"}
    sets = ", ".join(f"{column.get(k, k)} = ${i + 2}" for i, k in enumerate(fields))
    updated = await db.pool.fetchval(
        f"UPDATE diary_entry SET {sets} WHERE id = $1 RETURNING id", entry_id, *fields.values()
    )
    if not updated:
        raise HTTPException(404, "Entry not found")
    return {"id": entry_id}


@router.delete("/{entry_id}", status_code=204)
async def delete_entry(entry_id: int):
    await db.pool.execute("DELETE FROM diary_entry WHERE id = $1", entry_id)


@router.post("/copy")
async def copy_entries(body: CopyIn):
    result = await db.pool.execute(
        """INSERT INTO diary_entry (entry_date, meal, food_id, grams, quantity, unit_label)
           SELECT $2, meal, food_id, grams, quantity, unit_label FROM diary_entry
           WHERE entry_date = $1 AND ($3::text IS NULL OR meal = $3) ORDER BY created_at, id""",
        body.from_date, body.to_date, body.meal,
    )
    return {"copied": int(result.split()[-1])}
