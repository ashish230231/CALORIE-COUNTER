import asyncio
import json
import logging
from pathlib import Path

import asyncpg

from . import config

log = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).parent / "migrations"
MIGRATION_LOCK = 7262001

pool: asyncpg.Pool


async def _init_connection(con: asyncpg.Connection) -> None:
    for typ in ("json", "jsonb"):
        await con.set_type_codec(typ, encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def connect() -> None:
    global pool
    for attempt in range(60):
        try:
            pool = await asyncpg.create_pool(
                config.DATABASE_URL,
                min_size=1,
                max_size=10,
                init=_init_connection,
                # Lets `query <% description` use the trigram index with a typo-tolerant threshold.
                server_settings={"pg_trgm.word_similarity_threshold": "0.5"},
            )
            return
        except (OSError, asyncpg.PostgresError) as exc:
            log.info("waiting for database (%s): %s", attempt + 1, exc)
            await asyncio.sleep(1)
    raise RuntimeError("database did not become available")


async def migrate() -> None:
    async with pool.acquire() as con:
        await con.execute("SELECT pg_advisory_lock($1)", MIGRATION_LOCK)
        try:
            await con.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                " version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
            )
            applied = {r["version"] for r in await con.fetch("SELECT version FROM schema_migrations")}
            for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
                if path.stem in applied:
                    continue
                log.info("applying migration %s", path.name)
                async with con.transaction():
                    await con.execute(path.read_text(encoding="utf-8"))
                    await con.execute("INSERT INTO schema_migrations (version) VALUES ($1)", path.stem)
        finally:
            await con.execute("SELECT pg_advisory_unlock($1)", MIGRATION_LOCK)


async def close() -> None:
    await pool.close()
