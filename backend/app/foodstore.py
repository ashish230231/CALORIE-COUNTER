"""Shared persistence helpers for foods owned by the user (custom foods, recipes, scanned products)."""

from __future__ import annotations

import uuid

import asyncpg

from .nutrients import (
    ALCOHOL, CARBS, ENERGY, FAT, FIBER, HIDDEN, PROTEIN, SAT_FAT, SODIUM, SUGARS, display_name, group_for, sort_key,
)

USER_SOURCES = ("custom", "recipe", "barcode")


def new_source_id() -> str:
    return uuid.uuid4().hex


def ensure_energy(per100: dict[int, float], default_source: str) -> str | None:
    if per100.get(ENERGY) is not None:
        return default_source
    if PROTEIN in per100 or FAT in per100 or CARBS in per100:
        per100[ENERGY] = (4 * per100.get(PROTEIN, 0) + 9 * per100.get(FAT, 0) + 4 * per100.get(CARBS, 0)
                          + 7 * per100.get(ALCOHOL, 0))
        return "computed"
    return None


async def insert_food(
    con: asyncpg.Connection,
    *,
    source: str,
    source_id: str,
    description: str,
    brand: str | None,
    category: str | None,
    per100: dict[int, float],
    kcal_source: str | None,
    portions: list[tuple[str, float]],
    archived: bool = False,
) -> int:
    known = {r["id"] for r in await con.fetch("SELECT id FROM nutrient WHERE id = ANY($1::int[])", list(per100))}
    per100 = {k: v for k, v in per100.items() if k in known and v is not None}
    food_id = await con.fetchval(
        """INSERT INTO food (source, source_id, description, brand, category, kcal, protein, fat, carbs, fiber,
                             sugars, sat_fat, sodium, kcal_source, archived)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id""",
        source, source_id, description, brand, category,
        per100.get(ENERGY), per100.get(PROTEIN), per100.get(FAT), per100.get(CARBS), per100.get(FIBER),
        per100.get(SUGARS), per100.get(SAT_FAT), per100.get(SODIUM), kcal_source, archived,
    )
    await con.executemany(
        "INSERT INTO food_nutrient (food_id, nutrient_id, amount) VALUES ($1, $2, $3)",
        [(food_id, nid, amount) for nid, amount in per100.items()],
    )
    await con.executemany(
        "INSERT INTO food_portion (food_id, seq, label, gram_weight) VALUES ($1, $2, $3, $4)",
        [(food_id, i, label, grams) for i, (label, grams) in enumerate(portions) if grams > 0],
    )
    return food_id


async def is_referenced(con: asyncpg.Connection, food_id: int) -> bool:
    return await con.fetchval(
        """SELECT EXISTS (SELECT 1 FROM diary_entry WHERE food_id = $1)
               OR EXISTS (SELECT 1 FROM recipe_ingredient WHERE food_id = $1)""",
        food_id,
    )


async def retire(con: asyncpg.Connection, old_id: int, new_id: int) -> None:
    """Keep the old version for diary history; point it at its replacement."""
    await con.execute("UPDATE food SET archived = true, replaced_by = $2, updated_at = now() WHERE id = $1", old_id, new_id)
    await con.execute("UPDATE food SET replaced_by = $2 WHERE replaced_by = $1", old_id, new_id)


def present_nutrients(rows: list[asyncpg.Record]) -> list[dict]:
    visible = sorted((r for r in rows if r["id"] not in HIDDEN), key=lambda r: sort_key(r["id"], r["rank"]))
    return [{
        "id": r["id"],
        "name": display_name(r["id"], r["name"]),
        "unit": r["unit"],
        "group": group_for(r["id"], r["rank"]),
        "amount": r["amount"],
    } for r in visible]


FOOD_COLUMNS = """f.id, f.source, f.source_id, f.description, f.brand, f.category, f.kcal, f.protein, f.fat, f.carbs,
                  f.fiber, f.sugars, f.sat_fat, f.sodium, f.kcal_source, f.archived, f.replaced_by"""


async def food_detail(con: asyncpg.Connection, food_id: int) -> dict | None:
    food = await con.fetchrow(f"SELECT {FOOD_COLUMNS} FROM food f WHERE f.id = $1", food_id)
    if not food:
        return None
    portions = await con.fetch(
        "SELECT label, gram_weight AS grams FROM food_portion WHERE food_id = $1 ORDER BY seq, id", food_id
    )
    nutrients = await con.fetch(
        """SELECT n.id, n.name, n.unit, n.rank, fn.amount FROM food_nutrient fn JOIN nutrient n ON n.id = fn.nutrient_id
           WHERE fn.food_id = $1 ORDER BY n.rank NULLS LAST, n.id""",
        food_id,
    )
    result = dict(food)
    result["portions"] = [dict(p) for p in portions]
    result["nutrients"] = present_nutrients(nutrients)
    result["recipe"] = None
    if food["source"] == "recipe":
        recipe = await con.fetchrow("SELECT servings, cooked_grams, notes FROM recipe WHERE food_id = $1", food_id)
        ingredients = await con.fetch(
            """SELECT ri.food_id, f.description, f.source, ri.grams, ri.quantity, ri.unit_label,
                      f.kcal * ri.grams / 100 AS kcal
               FROM recipe_ingredient ri JOIN food f ON f.id = ri.food_id
               WHERE ri.recipe_food_id = $1 ORDER BY ri.position""",
            food_id,
        )
        result["recipe"] = {**dict(recipe), "ingredients": [dict(i) for i in ingredients]} if recipe else None
    return result
