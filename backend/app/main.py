import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware

from . import config, db
from .nutrients import SEED_NUTRIENTS
from .routers import diary, foods, profile, recipes, stats, system

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    await db.migrate()
    await db.pool.executemany(
        "INSERT INTO nutrient (id, name, unit, nutrient_nbr, rank) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
        SEED_NUTRIENTS,
    )
    if config.USDA_AUTO_IMPORT:
        system.start_import()
    yield
    await db.close()


app = FastAPI(title="Calorie Counter API", version="1.0.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1024)

for module in (foods, recipes, diary, profile, stats, system):
    app.include_router(module.router)
