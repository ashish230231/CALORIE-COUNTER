"""Imports USDA FoodData Central datasets (Foundation, SR Legacy, FNDDS Survey) into Postgres.

Zips are read from USDA_DATA_DIR if present (offline installs) or downloaded there once.
Imports are idempotent upserts keyed on (source, fdc_id), so diary history keeps pointing at
the same food rows when a newer dataset release is imported.
"""

from __future__ import annotations

import asyncio
import csv
import io
import logging
import time
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from . import config, db
from .nutrients import (
    ALCOHOL, CARBS, ENERGY, FAT, FIBER, PROTEIN, SAT_FAT, SODIUM, SUGARS, normalise_unit,
)

log = logging.getLogger(__name__)

DATA_TYPES = {"foundation": "foundation_food", "sr_legacy": "sr_legacy_food", "survey": "survey_fndds_food"}
IMPORT_LOCK = 7262002

# canonical nutrient <- alternative nutrients measured by a different method, in preference order
ALIASES = {FAT: (1085,), CARBS: (1050,), SUGARS: (1063,)}
WATER, ASH = 1051, 1007
ENERGY_SOURCES = ((ENERGY, "reported"), (2048, "atwater_specific"), (2047, "atwater_general"))


@dataclass
class Progress:
    dataset: str
    version: str
    status: str = "pending"  # pending | downloading | parsing | loading | done | error | skipped
    progress: float = 0.0
    message: str = ""
    foods: int = 0


@dataclass
class Parsed:
    nutrients: list[tuple] = field(default_factory=list)
    foods: list[tuple] = field(default_factory=list)
    food_nutrients: list[tuple] = field(default_factory=list)
    portions: list[tuple] = field(default_factory=list)


state: dict[str, Progress] = {}
_run_lock = asyncio.Lock()


def version_of(filename: str) -> str:
    return filename.rsplit("_csv_", 1)[-1].removesuffix(".zip")


def is_running() -> bool:
    return _run_lock.locked()


# ------------------------------------------------------------------------------------------ download

async def ensure_zip(dataset: str, filename: str, p: Progress) -> Path:
    for folder in (config.USDA_OFFLINE_DIR, config.USDA_DATA_DIR):
        candidate = folder / filename
        if candidate.is_file() and zipfile.is_zipfile(candidate):
            return candidate
    config.USDA_DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = config.USDA_DATA_DIR / filename

    p.status, p.message = "downloading", f"Downloading {filename}"
    url = f"{config.USDA_BASE_URL}/{filename}"
    tmp = path.with_suffix(".part")
    async with httpx.AsyncClient(timeout=httpx.Timeout(30, read=120), follow_redirects=True) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            total = int(resp.headers.get("content-length") or 0)
            done = 0
            with tmp.open("wb") as fh:
                async for chunk in resp.aiter_bytes(1 << 16):
                    fh.write(chunk)
                    done += len(chunk)
                    if total:
                        p.progress = 0.5 * done / total
    if not zipfile.is_zipfile(tmp):
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"{url} did not return a zip file")
    tmp.replace(path)
    return path


# ------------------------------------------------------------------------------------------ parsing

def _fmt_amount(raw: str) -> str:
    try:
        v = float(raw)
    except ValueError:
        return ""
    return f"{v:g}"


def _portion_label(row: dict, units: dict[str, str]) -> str:
    amount = _fmt_amount(row.get("amount") or "")
    unit_id = row.get("measure_unit_id") or ""
    unit = "" if unit_id in ("", "9999") else units.get(unit_id, "")
    unit = "" if unit == "undetermined" else unit
    modifier = (row.get("modifier") or "").strip()
    if modifier.isdigit():  # FNDDS stores numeric portion codes in `modifier`
        modifier = ""
    desc = (row.get("portion_description") or "").strip()
    if desc and desc[0].isdigit():
        return desc  # already a complete label, e.g. "1 cup"
    parts = [amount, unit, modifier, desc]
    seen: list[str] = []
    for part in parts:
        if part and part not in seen:
            seen.append(part)
    return " ".join(seen).strip()


def _canonicalise(n: dict[int, float]) -> str | None:
    """Fold method-specific variants into canonical nutrients and pick the best energy value."""
    for canonical, alternatives in ALIASES.items():
        if canonical not in n:
            for alt in alternatives:
                if alt in n:
                    n[canonical] = n[alt]
                    break
    for nid, source in ENERGY_SOURCES:
        if nid in n:
            n[ENERGY] = n[nid]
            return source
    return _estimate_energy(n)


def _estimate_energy(n: dict[int, float]) -> str | None:
    """Some Foundation foods publish proximates without an energy value. Estimate it the way USDA does
    (Atwater general factors 4/9/4/7), deriving carbohydrate by difference when needed. Foods too
    incomplete for a trustworthy estimate stay unknown rather than getting a misleading number."""
    water, protein, fat, ash, alcohol = (n.get(k) for k in (WATER, PROTEIN, FAT, ASH, ALCOHOL))
    if CARBS not in n and None not in (water, protein, ash):
        n[CARBS] = max(0.0, 100 - water - protein - (fat or 0) - ash - (alcohol or 0))
    if CARBS in n or (fat or 0) >= 50:  # carbohydrate known, or a fat-dominant food such as oil or butter
        n[ENERGY] = 4 * (protein or 0) + 9 * (fat or 0) + 4 * n.get(CARBS, 0) + 7 * (alcohol or 0)
        return "estimated"
    return None


def parse_zip(dataset: str, path: Path) -> Parsed:
    data_type = DATA_TYPES[dataset]
    out = Parsed()
    with zipfile.ZipFile(path) as z:
        members = {Path(n).name: n for n in z.namelist() if n.endswith(".csv")}

        def rows(name: str):
            if name not in members:
                return iter(())
            return csv.DictReader(io.TextIOWrapper(z.open(members[name]), encoding="utf-8", newline=""))

        nutrient_ids: set[int] = set()
        by_number: dict[str, int] = {}
        for r in rows("nutrient.csv"):
            nid = int(r["id"])
            rank = float(r["rank"]) if r.get("rank") else None
            out.nutrients.append((nid, r["name"].strip(), normalise_unit(r["unit_name"]), r["nutrient_nbr"] or None, rank))
            nutrient_ids.add(nid)
            if r["nutrient_nbr"]:
                by_number[r["nutrient_nbr"]] = nid

        units = {r["id"]: r["name"] for r in rows("measure_unit.csv")}
        categories = {r["id"]: r["description"] for r in rows("food_category.csv")}
        categories.update({r["wweia_food_category"]: r["wweia_food_category_description"]
                           for r in rows("wweia_food_category.csv")})

        foods: dict[str, tuple[str, str | None]] = {}
        for r in rows("food.csv"):
            if r["data_type"] == data_type:
                foods[r["fdc_id"]] = (r["description"].strip(), categories.get(r["food_category_id"]))

        values: dict[str, dict[int, float]] = {fdc: {} for fdc in foods}
        uses_numbers = dataset == "survey"  # FNDDS food_nutrient.nutrient_id holds the legacy nutrient number
        for r in rows("food_nutrient.csv"):
            per_food = values.get(r["fdc_id"])
            if per_food is None or r["amount"] in ("", None):
                continue
            nid = by_number.get(r["nutrient_id"]) if uses_numbers else int(r["nutrient_id"])
            if nid is None or nid not in nutrient_ids:
                continue
            per_food[nid] = float(r["amount"])

        for fdc, (desc, category) in foods.items():
            n = values[fdc]
            kcal_source = _canonicalise(n)
            out.foods.append((
                fdc, desc, category,
                n.get(ENERGY), n.get(PROTEIN), n.get(FAT), n.get(CARBS), n.get(FIBER), n.get(SUGARS),
                n.get(SAT_FAT), n.get(SODIUM), kcal_source,
            ))
            out.food_nutrients.extend((fdc, nid, amount) for nid, amount in n.items())

        for r in rows("food_portion.csv"):
            if r["fdc_id"] not in foods:
                continue
            try:
                grams = float(r["gram_weight"] or 0)
            except ValueError:
                continue
            if grams <= 0:
                continue
            label = _portion_label(r, units) or f"{grams:g} g"
            seq = int(float(r["seq_num"])) if r.get("seq_num") else 0
            if label == "Quantity not specified":  # FNDDS fallback amount; never a good default portion
                seq = 9999
            out.portions.append((r["fdc_id"], seq, label, grams))
    return out


# ------------------------------------------------------------------------------------------ loading

async def load(dataset: str, version: str, parsed: Parsed) -> int:
    async with db.pool.acquire() as con, con.transaction():
        await con.execute("SELECT pg_advisory_xact_lock($1)", IMPORT_LOCK)
        await con.executemany(
            """INSERT INTO nutrient (id, name, unit, nutrient_nbr, rank) VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, unit = EXCLUDED.unit,
                   nutrient_nbr = EXCLUDED.nutrient_nbr, rank = EXCLUDED.rank""",
            parsed.nutrients,
        )

        await con.execute(
            """CREATE TEMP TABLE tmp_food (source_id text, description text, category text, kcal float8,
                   protein float8, fat float8, carbs float8, fiber float8, sugars float8, sat_fat float8,
                   sodium float8, kcal_source text) ON COMMIT DROP;
               CREATE TEMP TABLE tmp_fn (source_id text, nutrient_id int, amount float8) ON COMMIT DROP;
               CREATE TEMP TABLE tmp_portion (source_id text, seq int, label text, gram_weight float8) ON COMMIT DROP;"""
        )
        await con.copy_records_to_table("tmp_food", records=parsed.foods)
        await con.copy_records_to_table("tmp_fn", records=parsed.food_nutrients)
        await con.copy_records_to_table("tmp_portion", records=parsed.portions)

        await con.execute(
            """INSERT INTO food (source, source_id, description, category, kcal, protein, fat, carbs, fiber,
                                 sugars, sat_fat, sodium, kcal_source)
               SELECT $1, source_id, description, category, kcal, protein, fat, carbs, fiber, sugars, sat_fat,
                      sodium, kcal_source FROM tmp_food
               ON CONFLICT (source, source_id) DO UPDATE SET
                   description = EXCLUDED.description, category = EXCLUDED.category, kcal = EXCLUDED.kcal,
                   protein = EXCLUDED.protein, fat = EXCLUDED.fat, carbs = EXCLUDED.carbs,
                   fiber = EXCLUDED.fiber, sugars = EXCLUDED.sugars, sat_fat = EXCLUDED.sat_fat,
                   sodium = EXCLUDED.sodium, kcal_source = EXCLUDED.kcal_source, archived = false,
                   updated_at = now()""",
            dataset,
        )
        # Foods dropped from a newer release stay (diary rows may reference them) but leave search.
        await con.execute(
            """UPDATE food SET archived = true
               WHERE source = $1 AND NOT EXISTS (SELECT 1 FROM tmp_food t WHERE t.source_id = food.source_id)""",
            dataset,
        )
        await con.execute("CREATE TEMP TABLE tmp_ids (id bigint, source_id text) ON COMMIT DROP")
        await con.execute("INSERT INTO tmp_ids SELECT id, source_id FROM food WHERE source = $1", dataset)
        await con.execute("CREATE INDEX ON tmp_ids (source_id)")
        await con.execute(
            """DELETE FROM food_nutrient fn USING tmp_ids i WHERE fn.food_id = i.id;
               INSERT INTO food_nutrient (food_id, nutrient_id, amount)
                   SELECT i.id, t.nutrient_id, t.amount FROM tmp_fn t JOIN tmp_ids i USING (source_id);
               DELETE FROM food_portion p USING tmp_ids i WHERE p.food_id = i.id;
               INSERT INTO food_portion (food_id, seq, label, gram_weight)
                   SELECT i.id, t.seq, t.label, t.gram_weight FROM tmp_portion t JOIN tmp_ids i USING (source_id);"""
        )
        await con.execute(
            """INSERT INTO dataset_import (dataset, version, status, food_count, message, imported_at)
               VALUES ($1, $2, 'done', $3, NULL, now())
               ON CONFLICT (dataset) DO UPDATE SET version = EXCLUDED.version, status = 'done',
                   food_count = EXCLUDED.food_count, message = NULL, imported_at = now()""",
            dataset, version, len(parsed.foods),
        )
    async with db.pool.acquire() as con:
        await con.execute("ANALYZE food; ANALYZE food_nutrient; ANALYZE food_portion;")
    return len(parsed.foods)


async def import_dataset(dataset: str, filename: str, force: bool = False) -> None:
    version = version_of(filename)
    p = state[dataset] = Progress(dataset, version)
    existing = await db.pool.fetchrow("SELECT version, status, food_count FROM dataset_import WHERE dataset = $1", dataset)
    if not force and existing and existing["status"] == "done" and existing["version"] == version:
        p.status, p.progress, p.foods = "done", 1.0, existing["food_count"] or 0
        return
    started = time.monotonic()
    try:
        path = await ensure_zip(dataset, filename, p)
        p.status, p.progress, p.message = "parsing", 0.5, "Reading nutrient tables"
        parsed = await asyncio.to_thread(parse_zip, dataset, path)
        p.status, p.progress, p.message = "loading", 0.75, f"Loading {len(parsed.foods):,} foods"
        p.foods = await load(dataset, version, parsed)
        p.status, p.progress = "done", 1.0
        p.message = f"Imported {p.foods:,} foods in {time.monotonic() - started:.1f}s"
        log.info("%s %s: %s", dataset, version, p.message)
    except Exception as exc:  # surfaced to the UI; the app keeps working with whatever is loaded
        log.exception("import of %s failed", dataset)
        p.status = "error"
        p.message = (
            f"{exc}. If this machine is offline, download {filename} from "
            f"{config.USDA_BASE_URL}/ into the data/usda folder next to docker-compose.yml and retry."
        )


async def run_all(force: bool = False) -> None:
    async with _run_lock:
        for dataset, filename in config.USDA_DATASETS.items():
            state.setdefault(dataset, Progress(dataset, version_of(filename)))
        for dataset, filename in config.USDA_DATASETS.items():
            await import_dataset(dataset, filename, force=force)
