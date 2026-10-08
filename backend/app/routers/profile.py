from datetime import date
from typing import Literal

import asyncpg
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, model_validator

from .. import db
from ..nutrients import compute_targets

router = APIRouter(prefix="/api", tags=["profile"])

PROFILE_FIELDS = (
    "name", "sex", "birth_date", "height_cm", "activity_level", "goal", "goal_rate_kg_per_week",
    "calorie_target_override", "protein_pct", "carbs_pct", "fat_pct", "water_target_ml", "unit_system",
)


class ProfileIn(BaseModel):
    name: str | None = Field(None, max_length=80)
    sex: Literal["male", "female"] | None = None
    birth_date: date | None = None
    height_cm: float | None = Field(None, gt=50, lt=280)
    activity_level: Literal["sedentary", "light", "moderate", "active", "very_active"] = "light"
    goal: Literal["lose", "maintain", "gain"] = "maintain"
    goal_rate_kg_per_week: float = Field(0.5, ge=0, le=1.5)
    calorie_target_override: float | None = Field(None, gt=500, lt=10000)
    protein_pct: float = Field(25, ge=5, le=70)
    carbs_pct: float = Field(50, ge=0, le=80)
    fat_pct: float = Field(25, ge=10, le=80)
    water_target_ml: float = Field(2500, ge=0, le=10000)
    unit_system: Literal["metric", "imperial"] = "metric"

    @model_validator(mode="after")
    def macros_sum_to_100(self):
        if abs(self.protein_pct + self.carbs_pct + self.fat_pct - 100) > 0.5:
            raise ValueError("Protein, carbs and fat percentages must add up to 100")
        if self.birth_date and not (date(1900, 1, 1) < self.birth_date < date.today()):
            raise ValueError("Birth date looks wrong")
        return self


async def load_profile_and_weight(con: asyncpg.Connection, as_of: date) -> tuple[dict, float | None]:
    profile = dict(await con.fetchrow("SELECT * FROM profile WHERE id = 1"))
    weight = await con.fetchval(
        "SELECT weight_kg FROM weight_log WHERE log_date <= $1 ORDER BY log_date DESC LIMIT 1", as_of
    )
    if weight is None:  # fall back to the earliest weigh-in after this date
        weight = await con.fetchval("SELECT weight_kg FROM weight_log ORDER BY log_date LIMIT 1")
    return profile, weight


async def _profile_response(con: asyncpg.Connection) -> dict:
    today = date.today()
    profile, weight = await load_profile_and_weight(con, today)
    profile.pop("id", None)
    return {"profile": profile, "weight_kg": weight, "targets": compute_targets(profile, weight, today)}


@router.get("/profile")
async def get_profile():
    async with db.pool.acquire() as con:
        return await _profile_response(con)


@router.put("/profile")
async def put_profile(body: ProfileIn):
    values = body.model_dump()
    sets = ", ".join(f"{k} = ${i + 1}" for i, k in enumerate(PROFILE_FIELDS))
    async with db.pool.acquire() as con:
        await con.execute(
            f"UPDATE profile SET {sets}, updated_at = now() WHERE id = 1", *(values[k] for k in PROFILE_FIELDS)
        )
        return await _profile_response(con)


# ------------------------------------------------------------------------------------ weight & water

class WeightIn(BaseModel):
    weight_kg: float = Field(gt=20, lt=500)


class WaterIn(BaseModel):
    ml: float = Field(ge=0, le=20000)


@router.get("/weights")
async def list_weights(start: date | None = Query(None), end: date | None = Query(None)):
    rows = await db.pool.fetch(
        """SELECT log_date AS date, weight_kg FROM weight_log
           WHERE ($1::date IS NULL OR log_date >= $1) AND ($2::date IS NULL OR log_date <= $2)
           ORDER BY log_date""",
        start, end,
    )
    return [dict(r) for r in rows]


@router.put("/weights/{day}")
async def put_weight(day: date, body: WeightIn):
    await db.pool.execute(
        """INSERT INTO weight_log (log_date, weight_kg) VALUES ($1, $2)
           ON CONFLICT (log_date) DO UPDATE SET weight_kg = EXCLUDED.weight_kg""",
        day, body.weight_kg,
    )
    return {"date": day, "weight_kg": body.weight_kg}


@router.delete("/weights/{day}", status_code=204)
async def delete_weight(day: date):
    result = await db.pool.execute("DELETE FROM weight_log WHERE log_date = $1", day)
    if result.endswith(" 0"):
        raise HTTPException(404, "No weight logged for that day")


@router.put("/water/{day}")
async def put_water(day: date, body: WaterIn):
    await db.pool.execute(
        """INSERT INTO water_log (log_date, ml) VALUES ($1, $2)
           ON CONFLICT (log_date) DO UPDATE SET ml = EXCLUDED.ml""",
        day, body.ml,
    )
    return {"date": day, "ml": body.ml}
