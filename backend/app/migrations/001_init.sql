-- Core schema. Every amount in food_nutrient is per 100 g of edible food.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE nutrient (
    id           integer PRIMARY KEY,           -- USDA FoodData Central nutrient id
    name         text NOT NULL,
    unit         text NOT NULL,                 -- g, mg, ug, kcal, kJ, IU ...
    nutrient_nbr text,
    rank         double precision
);

CREATE TABLE food (
    id            bigserial PRIMARY KEY,
    source        text NOT NULL CHECK (source IN ('foundation', 'sr_legacy', 'survey', 'custom', 'recipe', 'barcode')),
    source_id     text NOT NULL,                -- fdc_id for USDA, barcode for products, uuid for user foods
    description   text NOT NULL,
    brand         text,
    category      text,
    -- Denormalised per-100 g headline values (also present in food_nutrient) for fast lists.
    kcal          double precision,
    protein       double precision,
    fat           double precision,
    carbs         double precision,
    fiber         double precision,
    sugars        double precision,
    sat_fat       double precision,
    sodium        double precision,
    kcal_source   text,                         -- reported | atwater_specific | atwater_general | estimated | computed | label
    archived      boolean NOT NULL DEFAULT false,
    replaced_by   bigint REFERENCES food(id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(description, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(brand, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(category, '')), 'D')
    ) STORED,
    -- Lexemes of the text before the first comma ("Rice, white, cooked" -> 'rice'): USDA names put
    -- the food itself first, so an exact match here means "this is the plain food you searched for".
    head          tsvector GENERATED ALWAYS AS (strip(to_tsvector('english', split_part(description, ',', 1)))) STORED,
    UNIQUE (source, source_id)
);
CREATE INDEX food_search_idx ON food USING gin (search_vector);
CREATE INDEX food_desc_trgm_idx ON food USING gin (description gin_trgm_ops);
CREATE INDEX food_user_idx ON food (source) WHERE source IN ('custom', 'recipe', 'barcode');

CREATE TABLE food_nutrient (
    food_id     bigint  NOT NULL REFERENCES food(id) ON DELETE CASCADE,
    nutrient_id integer NOT NULL REFERENCES nutrient(id),
    amount      double precision NOT NULL,
    PRIMARY KEY (food_id, nutrient_id)
);

CREATE TABLE food_portion (
    id          bigserial PRIMARY KEY,
    food_id     bigint NOT NULL REFERENCES food(id) ON DELETE CASCADE,
    seq         integer NOT NULL DEFAULT 0,
    label       text NOT NULL,
    gram_weight double precision NOT NULL CHECK (gram_weight > 0)
);
CREATE INDEX food_portion_food_idx ON food_portion (food_id);

-- A recipe is itself a food (source = 'recipe') whose nutrients are computed from its ingredients.
CREATE TABLE recipe (
    food_id      bigint PRIMARY KEY REFERENCES food(id) ON DELETE CASCADE,
    servings     double precision NOT NULL CHECK (servings > 0),
    cooked_grams double precision CHECK (cooked_grams > 0),
    notes        text
);

CREATE TABLE recipe_ingredient (
    recipe_food_id bigint  NOT NULL REFERENCES food(id) ON DELETE CASCADE,
    position       integer NOT NULL,
    food_id        bigint  NOT NULL REFERENCES food(id),
    grams          double precision NOT NULL CHECK (grams > 0),
    quantity       double precision NOT NULL,
    unit_label     text NOT NULL,
    PRIMARY KEY (recipe_food_id, position)
);

CREATE TABLE profile (
    id                      integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    name                    text,
    sex                     text CHECK (sex IN ('male', 'female')),
    birth_date              date,
    height_cm               double precision CHECK (height_cm > 0),
    activity_level          text NOT NULL DEFAULT 'light'
                            CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active')),
    goal                    text NOT NULL DEFAULT 'maintain' CHECK (goal IN ('lose', 'maintain', 'gain')),
    goal_rate_kg_per_week   double precision NOT NULL DEFAULT 0.5 CHECK (goal_rate_kg_per_week >= 0 AND goal_rate_kg_per_week <= 1.5),
    calorie_target_override double precision CHECK (calorie_target_override > 0),
    protein_pct             double precision NOT NULL DEFAULT 25,
    carbs_pct               double precision NOT NULL DEFAULT 50,
    fat_pct                 double precision NOT NULL DEFAULT 25,
    water_target_ml         double precision NOT NULL DEFAULT 2500,
    unit_system             text NOT NULL DEFAULT 'metric' CHECK (unit_system IN ('metric', 'imperial')),
    updated_at              timestamptz NOT NULL DEFAULT now()
);
INSERT INTO profile (id) VALUES (1);

CREATE TABLE diary_entry (
    id         bigserial PRIMARY KEY,
    entry_date date   NOT NULL,
    meal       text   NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'dinner', 'snacks')),
    food_id    bigint NOT NULL REFERENCES food(id),
    grams      double precision NOT NULL CHECK (grams > 0),
    quantity   double precision NOT NULL CHECK (quantity > 0),
    unit_label text   NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX diary_entry_date_idx ON diary_entry (entry_date);
CREATE INDEX diary_entry_food_idx ON diary_entry (food_id, created_at DESC);

CREATE TABLE weight_log (
    log_date    date PRIMARY KEY,
    weight_kg   double precision NOT NULL CHECK (weight_kg > 0),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE water_log (
    log_date date PRIMARY KEY,
    ml       double precision NOT NULL CHECK (ml >= 0)
);

CREATE TABLE dataset_import (
    dataset     text PRIMARY KEY,
    version     text NOT NULL,
    status      text NOT NULL,
    food_count  integer,
    message     text,
    imported_at timestamptz NOT NULL DEFAULT now()
);

-- "Quick add" lets people log raw calories: 1 g of this food == 1 kcal.
INSERT INTO nutrient (id, name, unit, nutrient_nbr, rank) VALUES (1008, 'Energy', 'kcal', '208', 300);
INSERT INTO food (source, source_id, description, category, kcal, kcal_source)
VALUES ('custom', 'quick-add', 'Quick calories', 'Quick add', 100, 'label');
INSERT INTO food_nutrient (food_id, nutrient_id, amount)
SELECT id, 1008, 100 FROM food WHERE source = 'custom' AND source_id = 'quick-add';
