import os
from pathlib import Path

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://calorie:calorie@db:5432/calorie")

USDA_DATA_DIR = Path(os.environ.get("USDA_DATA_DIR", "/data/usda"))  # download cache (named volume)
USDA_OFFLINE_DIR = Path(os.environ.get("USDA_OFFLINE_DIR", "/data/usda-offline"))  # optional, user-provided zips
USDA_BASE_URL = os.environ.get("USDA_BASE_URL", "https://fdc.nal.usda.gov/fdc-datasets").rstrip("/")
USDA_AUTO_IMPORT = os.environ.get("USDA_AUTO_IMPORT", "true").lower() == "true"

# dataset key -> zip file name published by USDA FoodData Central.
# Foundation: lab-analysed, highest precision. SR Legacy: broad reference set. Survey (FNDDS): foods as eaten.
USDA_DATASETS: dict[str, str] = {
    "foundation": os.environ.get("USDA_FOUNDATION_FILE", "FoodData_Central_foundation_food_csv_2026-04-30.zip"),
    "sr_legacy": os.environ.get("USDA_SR_LEGACY_FILE", "FoodData_Central_sr_legacy_food_csv_2018-04.zip"),
    "survey": os.environ.get("USDA_SURVEY_FILE", "FoodData_Central_survey_food_csv_2024-10-31.zip"),
}

OPENFOODFACTS_ENABLED = os.environ.get("OPENFOODFACTS_ENABLED", "true").lower() == "true"
OPENFOODFACTS_URL = os.environ.get("OPENFOODFACTS_URL", "https://world.openfoodfacts.org").rstrip("/")
