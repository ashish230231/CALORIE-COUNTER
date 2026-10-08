from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query

from .. import db
from ..nutrients import HIDDEN, compute_targets, display_name, group_for
from .profile import load_profile_and_weight

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("")
async def stats(start: date = Query(...), end: date = Query(...)):
    if end < start or (end - start).days > 3660:
        raise HTTPException(422, "Invalid date range")
    async with db.pool.acquire() as con:
        days = await con.fetch(
            """SELECT e.entry_date AS date, count(*) AS entries,
                      sum(f.kcal * e.grams / 100) AS kcal, sum(f.protein * e.grams / 100) AS protein,
                      sum(f.fat * e.grams / 100) AS fat, sum(f.carbs * e.grams / 100) AS carbs,
                      sum(f.fiber * e.grams / 100) AS fiber, sum(f.sugars * e.grams / 100) AS sugars,
                      sum(f.sodium * e.grams / 100) AS sodium
               FROM diary_entry e JOIN food f ON f.id = e.food_id
               WHERE e.entry_date BETWEEN $1 AND $2
               GROUP BY e.entry_date ORDER BY e.entry_date""",
            start, end,
        )
        weights = await con.fetch(
            "SELECT log_date AS date, weight_kg FROM weight_log WHERE log_date BETWEEN $1 AND $2 ORDER BY log_date",
            start, end,
        )
        nutrient_totals = {r["nutrient_id"]: r for r in await con.fetch(
            """SELECT fn.nutrient_id, sum(fn.amount * e.grams / 100) AS amount,
                      sum(e.grams) FILTER (WHERE f.source_id <> 'quick-add') AS covered
               FROM diary_entry e
               JOIN food f ON f.id = e.food_id
               JOIN food_nutrient fn ON fn.food_id = e.food_id
               WHERE e.entry_date BETWEEN $1 AND $2
               GROUP BY fn.nutrient_id""",
            start, end,
        )}
        food_grams = await con.fetchval(
            """SELECT coalesce(sum(e.grams), 0) FROM diary_entry e JOIN food f ON f.id = e.food_id
               WHERE e.entry_date BETWEEN $1 AND $2 AND f.source_id <> 'quick-add'""",
            start, end,
        )
        nutrient_meta = await con.fetch("SELECT id, name, unit, rank FROM nutrient")
        top_foods = await con.fetch(
            """SELECT f.id, f.description, count(*) AS times, sum(e.grams) AS grams,
                      sum(f.kcal * e.grams / 100) AS kcal, sum(f.protein * e.grams / 100) AS protein
               FROM diary_entry e JOIN food f ON f.id = e.food_id
               WHERE e.entry_date BETWEEN $1 AND $2
               GROUP BY f.id ORDER BY kcal DESC NULLS LAST LIMIT 10""",
            start, end,
        )
        logged_dates = {r["date"] for r in await con.fetch(
            "SELECT DISTINCT entry_date AS date FROM diary_entry WHERE entry_date <= $1 AND entry_date > $1 - 400",
            end,
        )}
        profile, weight = await load_profile_and_weight(con, end)
    targets = compute_targets(profile, weight, end)

    n_days = len(days)
    avg = {k: (sum((d[k] or 0) for d in days) / n_days if n_days else None)
           for k in ("kcal", "protein", "fat", "carbs", "fiber", "sugars", "sodium")}

    nutrients = []
    for r in nutrient_meta:
        target = targets["micros"].get(str(r["id"]))
        if not target or r["id"] in HIDDEN:
            continue
        total = nutrient_totals.get(r["id"])
        daily = total["amount"] / n_days if total and n_days else 0
        nutrients.append({
            "id": r["id"], "name": display_name(r["id"], r["name"]), "unit": r["unit"],
            "group": group_for(r["id"], r["rank"]), "avg": daily, "target": target,
            "pct": daily / target["value"] * 100 if target["value"] else None,
            # share of logged food weight with a measured value; low coverage => the average is a lower bound
            "coverage": min(1.0, (total["covered"] or 0) / food_grams) if total and food_grams else 0,
        })
    nutrients.sort(key=lambda n: n["pct"] if n["pct"] is not None else 0)

    streak, cursor = 0, end
    while cursor in logged_dates:
        streak += 1
        cursor -= timedelta(days=1)

    return {
        "start": start, "end": end,
        "days": [dict(d) for d in days],
        "weights": [dict(w) for w in weights],
        "averages": avg,
        "logged_days": n_days,
        "nutrients": nutrients,
        "top_foods": [dict(t) for t in top_foods],
        "targets": targets,
        "streak": streak,
    }
