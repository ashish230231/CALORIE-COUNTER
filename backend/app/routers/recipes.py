from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..foodstore import ensure_energy, food_detail, insert_food, is_referenced, new_source_id, retire

router = APIRouter(prefix="/api/recipes", tags=["recipes"])


class IngredientIn(BaseModel):
    food_id: int
    grams: float = Field(gt=0, le=100000)
    quantity: float = Field(gt=0)
    unit_label: str = Field(min_length=1, max_length=80)


class RecipeIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    servings: float = Field(gt=0, le=1000)
    cooked_grams: float | None = Field(None, gt=0, le=100000, description="weigh the finished dish for precision")
    notes: str | None = Field(None, max_length=5000)
    ingredients: list[IngredientIn] = Field(min_length=1, max_length=200)


async def _save(con, body: RecipeIn, source_id: str) -> int:
    ids = [i.food_id for i in body.ingredients]
    grams = [i.grams for i in body.ingredients]
    found = await con.fetchval("SELECT count(DISTINCT id) FROM food WHERE id = ANY($1::bigint[])", ids)
    if found != len(set(ids)):
        raise HTTPException(422, "One or more ingredients no longer exist")
    totals = await con.fetch(
        """SELECT fn.nutrient_id, sum(fn.amount * i.grams / 100) AS amount
           FROM unnest($1::bigint[], $2::float8[]) AS i(food_id, grams)
           JOIN food_nutrient fn ON fn.food_id = i.food_id
           GROUP BY fn.nutrient_id""",
        ids, grams,
    )
    raw_weight = sum(grams)
    final_weight = body.cooked_grams or raw_weight
    # Nutrients are conserved through cooking; water loss/gain only changes the weight they're spread over.
    per100 = {r["nutrient_id"]: r["amount"] * 100 / final_weight for r in totals}
    kcal_source = ensure_energy(per100, "computed")
    serving = final_weight / body.servings
    portions = [(f"1 serving (1/{body.servings:g} of recipe)", serving), ("whole recipe", final_weight)]
    food_id = await insert_food(
        con, source="recipe", source_id=source_id, description=body.name.strip(), brand=None,
        category="Recipe", per100=per100, kcal_source=kcal_source, portions=portions,
    )
    await con.execute(
        "INSERT INTO recipe (food_id, servings, cooked_grams, notes) VALUES ($1, $2, $3, $4)",
        food_id, body.servings, body.cooked_grams, body.notes,
    )
    await con.executemany(
        """INSERT INTO recipe_ingredient (recipe_food_id, position, food_id, grams, quantity, unit_label)
           VALUES ($1, $2, $3, $4, $5, $6)""",
        [(food_id, pos, i.food_id, i.grams, i.quantity, i.unit_label) for pos, i in enumerate(body.ingredients)],
    )
    return food_id


@router.post("", status_code=201)
async def create_recipe(body: RecipeIn):
    async with db.pool.acquire() as con, con.transaction():
        food_id = await _save(con, body, new_source_id())
        return await food_detail(con, food_id)


@router.put("/{food_id}")
async def update_recipe(food_id: int, body: RecipeIn):
    async with db.pool.acquire() as con, con.transaction():
        old = await con.fetchrow("SELECT source FROM food WHERE id = $1 FOR UPDATE", food_id)
        if not old or old["source"] != "recipe":
            raise HTTPException(404, "Recipe not found")
        if any(i.food_id == food_id for i in body.ingredients):
            raise HTTPException(422, "A recipe cannot contain itself")
        new_id = await _save(con, body, new_source_id())
        await retire(con, food_id, new_id)
        if not await is_referenced(con, food_id):
            await con.execute("DELETE FROM food WHERE id = $1", food_id)
        return await food_detail(con, new_id)
