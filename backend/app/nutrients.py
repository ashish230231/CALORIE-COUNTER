"""Nutrient presentation metadata and personalised daily targets.

Targets follow the US National Academies Dietary Reference Intakes (RDA, or AI where no RDA
exists) for adults, as summarised by the NIH Office of Dietary Supplements. Without a complete
profile we fall back to the FDA Daily Values used on nutrition labels.
"""

from __future__ import annotations

import re
from datetime import date

ENERGY = 1008
PROTEIN = 1003
FAT = 1004
CARBS = 1005
FIBER = 1079
SUGARS = 2000
ADDED_SUGARS = 1235
SAT_FAT = 1258
TRANS_FAT = 1257
CHOLESTEROL = 1253
SODIUM = 1093
ALCOHOL = 1018

# Aliases are folded into their canonical nutrient at import time, so they're hidden in panels
# to avoid showing the same quantity twice. IU variants duplicate the metric (µg) values.
HIDDEN = {2047, 2048, 1062, 1085, 1050, 1063, 1104, 1110}

DISPLAY_NAMES = {
    1008: "Calories",
    1003: "Protein",
    1004: "Total fat",
    1005: "Carbohydrates",
    1079: "Fiber",
    2000: "Sugars",
    1235: "Added sugars",
    1258: "Saturated fat",
    1292: "Monounsaturated fat",
    1293: "Polyunsaturated fat",
    1257: "Trans fat",
    1018: "Alcohol",
    1106: "Vitamin A (RAE)",
    1162: "Vitamin C",
    1114: "Vitamin D",
    1109: "Vitamin E",
    1185: "Vitamin K1",
    1165: "Thiamin (B1)",
    1166: "Riboflavin (B2)",
    1167: "Niacin (B3)",
    1170: "Pantothenic acid (B5)",
    1175: "Vitamin B6",
    1176: "Biotin (B7)",
    1177: "Folate, total",
    1190: "Folate (DFE)",
    1178: "Vitamin B12",
    1180: "Choline",
    1404: "Omega-3 ALA",
    1278: "Omega-3 EPA",
    1272: "Omega-3 DHA",
    1280: "Omega-3 DPA",
    1316: "Omega-6 linoleic acid",
}

# Headline nutrients shown first on the dashboard, in this order.
KEY_MICROS = [
    1079, 2000, 1235, 1258, 1257, 1253, 1093, 1092, 1087, 1089, 1090, 1095, 1091, 1098, 1101, 1103, 1100,
    1106, 1162, 1114, 1109, 1185, 1165, 1166, 1167, 1170, 1175, 1176, 1190, 1178, 1180,
]

# Core catalogue (id, USDA name, unit, nutrient number, rank) so custom and barcode foods work
# before - or without - a USDA import. The importer later upserts the full catalogue.
SEED_NUTRIENTS = [
    (1008, "Energy", "kcal", "208", 300), (1003, "Protein", "g", "203", 600),
    (1004, "Total lipid (fat)", "g", "204", 800), (1005, "Carbohydrate, by difference", "g", "205", 1110),
    (1079, "Fiber, total dietary", "g", "291", 1200), (2000, "Total Sugars", "g", "269", 1510),
    (1235, "Sugars, added", "g", "539", 1540), (1051, "Water", "g", "255", 100),
    (1018, "Alcohol, ethyl", "g", "221", 18200), (1057, "Caffeine", "mg", "262", 18300),
    (1258, "Fatty acids, total saturated", "g", "606", 9700),
    (1292, "Fatty acids, total monounsaturated", "g", "645", 11400),
    (1293, "Fatty acids, total polyunsaturated", "g", "646", 12900),
    (1257, "Fatty acids, total trans", "g", "605", 15400), (1253, "Cholesterol", "mg", "601", 15700),
    (1087, "Calcium, Ca", "mg", "301", 5300), (1089, "Iron, Fe", "mg", "303", 5400),
    (1090, "Magnesium, Mg", "mg", "304", 5500), (1091, "Phosphorus, P", "mg", "305", 5600),
    (1092, "Potassium, K", "mg", "306", 5700), (1093, "Sodium, Na", "mg", "307", 5800),
    (1095, "Zinc, Zn", "mg", "309", 5900), (1098, "Copper, Cu", "mg", "312", 6000),
    (1101, "Manganese, Mn", "mg", "315", 6100), (1100, "Iodine, I", "µg", "314", 6150),
    (1103, "Selenium, Se", "µg", "317", 6200), (1162, "Vitamin C, total ascorbic acid", "mg", "401", 6300),
    (1165, "Thiamin", "mg", "404", 6400), (1166, "Riboflavin", "mg", "405", 6500),
    (1167, "Niacin", "mg", "406", 6600), (1170, "Pantothenic acid", "mg", "410", 6700),
    (1175, "Vitamin B-6", "mg", "415", 6800), (1176, "Biotin", "µg", "416", 6850),
    (1177, "Folate, total", "µg", "417", 6900), (1190, "Folate, DFE", "µg", "435", 7200),
    (1180, "Choline, total", "mg", "421", 7220), (1178, "Vitamin B-12", "µg", "418", 7300),
    (1106, "Vitamin A, RAE", "µg", "320", 7420), (1109, "Vitamin E (alpha-tocopherol)", "mg", "323", 7905),
    (1114, "Vitamin D (D2 + D3)", "µg", "328", 8700), (1185, "Vitamin K (phylloquinone)", "µg", "430", 8800),
]

# Nutrients offered when entering a custom food from a nutrition label, in label order.
LABEL_NUTRIENTS = [
    1008, 1004, 1258, 1257, 1292, 1293, 1253, 1093, 1005, 1079, 2000, 1235, 1003,
    1114, 1087, 1089, 1092, 1106, 1162, 1109, 1185, 1165, 1166, 1167, 1175, 1190, 1178,
    1090, 1095, 1091, 1103, 1018, 1057,
]

GROUP_ORDER = ["General", "Carbohydrates", "Fats", "Protein & amino acids", "Vitamins", "Minerals", "Other"]

_UNIT_LABELS = {"G": "g", "MG": "mg", "UG": "µg", "KCAL": "kcal", "KJ": "kJ", "IU": "IU", "MCG_RE": "µg RE"}


def normalise_unit(raw: str) -> str:
    return _UNIT_LABELS.get(raw.upper(), raw.lower())


_GENERAL_ORDER = [ENERGY, PROTEIN, FAT, CARBS, ALCOHOL, 1051]


def sort_key(nutrient_id: int, rank: float | None) -> tuple:
    group = group_for(nutrient_id, rank)
    within = _GENERAL_ORDER.index(nutrient_id) if nutrient_id in _GENERAL_ORDER else (rank if rank is not None else 1e9)
    return GROUP_ORDER.index(group), within


def group_for(nutrient_id: int, rank: float | None) -> str:
    """USDA's `rank` already orders nutrients by family; we slice it into display groups."""
    if nutrient_id in (ENERGY, PROTEIN, FAT, CARBS, ALCOHOL, 1051):
        return "General"
    r = rank if rank is not None else 1e9
    if 1100 <= r < 3000:
        return "Carbohydrates"
    if 5300 <= r < 6300:
        return "Minerals"
    if 6300 <= r < 9000:
        return "Vitamins"
    if 9700 <= r < 16300:
        return "Fats"
    if 16300 <= r < 18200:
        return "Protein & amino acids"
    return "Other"


_MINERAL_SUFFIX = re.compile(r", [A-Z][a-z]?$")


def display_name(nutrient_id: int, name: str) -> str:
    if nutrient_id in DISPLAY_NAMES:
        return DISPLAY_NAMES[nutrient_id]
    return _MINERAL_SUFFIX.sub("", name)


# ---------------------------------------------------------------------------------------------
# Targets
# ---------------------------------------------------------------------------------------------

ACTIVITY_FACTORS = {
    "sedentary": 1.2,
    "light": 1.375,
    "moderate": 1.55,
    "active": 1.725,
    "very_active": 1.9,
}
KCAL_PER_KG = 7700  # energy content of ~1 kg of body-weight change

# FDA Daily Values (21 CFR 101.9, 2016 rule) for adults and children ≥ 4 years.
FDA_DAILY_VALUES: dict[int, tuple[str, float]] = {
    FIBER: ("min", 28), ADDED_SUGARS: ("max", 50), SAT_FAT: ("max", 20), CHOLESTEROL: ("max", 300),
    SODIUM: ("max", 2300), 1092: ("min", 4700), 1087: ("min", 1300), 1089: ("min", 18),
    1090: ("min", 420), 1095: ("min", 11), 1091: ("min", 1250), 1098: ("min", 0.9), 1101: ("min", 2.3),
    1103: ("min", 55), 1100: ("min", 150), 1106: ("min", 900), 1162: ("min", 90), 1114: ("min", 20),
    1109: ("min", 15), 1185: ("min", 120), 1165: ("min", 1.2), 1166: ("min", 1.3), 1167: ("min", 16),
    1170: ("min", 5), 1175: ("min", 1.7), 1176: ("min", 30), 1190: ("min", 400), 1178: ("min", 2.4),
    1180: ("min", 550),
}


def age_on(birth: date, today: date) -> int:
    return today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))


def dri_targets(sex: str, age: int, kcal: float) -> dict[int, tuple[str, float]]:
    """Adult (19+) RDA/AI values; limits are expressed as ('max', value)."""
    m = sex == "male"
    t: dict[int, tuple[str, float]] = {
        FIBER: ("min", round(14 * kcal / 1000, 1)),  # AI: 14 g per 1000 kcal
        ADDED_SUGARS: ("max", round(kcal * 0.10 / 4, 1)),  # DGA: < 10 % of energy
        SAT_FAT: ("max", round(kcal * 0.10 / 9, 1)),  # DGA: < 10 % of energy
        SODIUM: ("max", 2300),  # Chronic Disease Risk Reduction intake
        1092: ("min", 3400 if m else 2600),  # potassium (AI, 2019)
        1087: ("min", 1000 if age <= 50 or (m and age <= 70) else 1200),  # calcium
        1089: ("min", 8 if m or age > 50 else 18),  # iron
        1090: ("min", (400 if age <= 30 else 420) if m else (310 if age <= 30 else 320)),  # magnesium
        1095: ("min", 11 if m else 8),  # zinc
        1091: ("min", 700),  # phosphorus
        1098: ("min", 0.9),  # copper
        1101: ("min", 2.3 if m else 1.8),  # manganese (AI)
        1103: ("min", 55),  # selenium
        1100: ("min", 150),  # iodine
        1106: ("min", 900 if m else 700),  # vitamin A, RAE
        1162: ("min", 90 if m else 75),  # vitamin C
        1114: ("min", 20 if age > 70 else 15),  # vitamin D
        1109: ("min", 15),  # vitamin E
        1185: ("min", 120 if m else 90),  # vitamin K (AI)
        1165: ("min", 1.2 if m else 1.1),  # thiamin
        1166: ("min", 1.3 if m else 1.1),  # riboflavin
        1167: ("min", 16 if m else 14),  # niacin
        1170: ("min", 5),  # pantothenic acid (AI)
        1175: ("min", 1.3 if age <= 50 else (1.7 if m else 1.5)),  # vitamin B6
        1176: ("min", 30),  # biotin (AI)
        1190: ("min", 400),  # folate, DFE
        1178: ("min", 2.4),  # vitamin B12
        1180: ("min", 550 if m else 425),  # choline (AI)
    }
    return t


def compute_targets(profile: dict, weight_kg: float | None, today: date) -> dict:
    """Energy via Mifflin-St Jeor × activity factor, adjusted for the weight goal."""
    sex = profile.get("sex")
    birth = profile.get("birth_date")
    height = profile.get("height_cm")
    complete = bool(sex and birth and height and weight_kg)
    warnings: list[str] = []
    bmr = tdee = None
    age = age_on(birth, today) if birth else None

    if complete:
        bmr = 10 * weight_kg + 6.25 * height - 5 * age + (5 if sex == "male" else -161)
        tdee = bmr * ACTIVITY_FACTORS[profile["activity_level"]]
        delta = profile["goal_rate_kg_per_week"] * KCAL_PER_KG / 7
        kcal = tdee + {"lose": -delta, "maintain": 0, "gain": delta}[profile["goal"]]
        floor = 1500 if sex == "male" else 1200
        if kcal < floor:
            warnings.append(
                f"Your goal implies {round(kcal)} kcal/day, below the {floor} kcal minimum generally advised "
                "without medical supervision. The target was raised to that minimum."
            )
            kcal = floor
        if age is not None and age < 19:
            warnings.append("Micronutrient targets use adult (19+) reference values.")
    else:
        kcal = 2000.0

    if profile.get("calorie_target_override"):
        kcal = profile["calorie_target_override"]

    kcal = round(kcal)
    macros = {
        "protein": round(kcal * profile["protein_pct"] / 100 / 4, 1),
        "carbs": round(kcal * profile["carbs_pct"] / 100 / 4, 1),
        "fat": round(kcal * profile["fat_pct"] / 100 / 9, 1),
    }
    micros = dri_targets(sex, age, kcal) if complete else dict(FDA_DAILY_VALUES)
    return {
        "profile_complete": complete,
        "age": age,
        "bmr": round(bmr) if bmr else None,
        "tdee": round(tdee) if tdee else None,
        "kcal": kcal,
        "macros": macros,
        "micros": {str(k): {"kind": v[0], "value": v[1]} for k, v in micros.items()},
        "basis": "Dietary Reference Intakes (adults)" if complete else "FDA Daily Values (2,000 kcal)",
        "warnings": warnings,
    }
