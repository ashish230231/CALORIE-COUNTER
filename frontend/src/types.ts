export type Source = 'foundation' | 'sr_legacy' | 'survey' | 'custom' | 'recipe' | 'barcode'
export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snacks'
export const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snacks']

export interface Portion {
  label: string
  grams: number
}

export interface FoodHit {
  id: number
  source: Source
  description: string
  brand?: string | null
  category?: string | null
  kcal: number | null
  protein: number | null
  fat: number | null
  carbs: number | null
  kcal_source?: string | null
  portion?: Portion | null
  uses?: number
}

export interface RecentFood extends FoodHit {
  grams: number
  quantity: number
  unit_label: string
  meal: Meal
  last_used: string
}

export interface NutrientAmount {
  id: number
  name: string
  unit: string
  group: string
  amount: number
}

export interface RecipeIngredient {
  food_id: number
  description: string
  source: Source
  grams: number
  quantity: number
  unit_label: string
  kcal: number | null
}

export interface FoodDetail extends FoodHit {
  source_id: string
  fiber: number | null
  sugars: number | null
  sat_fat: number | null
  sodium: number | null
  archived: boolean
  replaced_by: number | null
  portions: Portion[]
  nutrients: NutrientAmount[]
  recipe: { servings: number; cooked_grams: number | null; notes: string | null; ingredients: RecipeIngredient[] } | null
}

export interface Target {
  kind: 'min' | 'max'
  value: number
}

export interface Targets {
  profile_complete: boolean
  age: number | null
  bmr: number | null
  tdee: number | null
  kcal: number
  macros: { protein: number; carbs: number; fat: number }
  micros: Record<string, Target>
  basis: string
  warnings: string[]
}

export interface DiaryEntry {
  id: number
  meal: Meal
  grams: number
  quantity: number
  unit_label: string
  created_at: string
  food_id: number
  description: string
  brand: string | null
  source: Source
  source_id: string
  kcal_source: string | null
  kcal: number | null
  protein: number | null
  fat: number | null
  carbs: number | null
  fiber: number | null
}

export interface DayNutrient extends NutrientAmount {
  rank: number | null
  coverage: number
  target: Target | null
  key: boolean
}

export type Totals = Record<'kcal' | 'protein' | 'fat' | 'carbs' | 'fiber' | 'sugars' | 'sat_fat' | 'sodium', number>

export interface Day {
  date: string
  entries: DiaryEntry[]
  totals: Totals
  nutrients: DayNutrient[]
  targets: Targets
  water_ml: number
  weight_kg: number | null
}

export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'

export interface Profile {
  name: string | null
  sex: 'male' | 'female' | null
  birth_date: string | null
  height_cm: number | null
  activity_level: ActivityLevel
  goal: 'lose' | 'maintain' | 'gain'
  goal_rate_kg_per_week: number
  calorie_target_override: number | null
  protein_pct: number
  carbs_pct: number
  fat_pct: number
  water_target_ml: number
  unit_system: 'metric' | 'imperial'
}

export interface ProfileResponse {
  profile: Profile
  weight_kg: number | null
  targets: Targets
}

export interface StatsDay {
  date: string
  entries: number
  kcal: number
  protein: number
  fat: number
  carbs: number
  fiber: number
  sugars: number
  sodium: number
}

export interface Stats {
  start: string
  end: string
  days: StatsDay[]
  weights: { date: string; weight_kg: number }[]
  averages: Record<'kcal' | 'protein' | 'fat' | 'carbs' | 'fiber' | 'sugars' | 'sodium', number | null>
  logged_days: number
  nutrients: { id: number; name: string; unit: string; group: string; avg: number; target: Target; pct: number | null; coverage: number }[]
  top_foods: { id: number; description: string; times: number; grams: number; kcal: number | null; protein: number | null }[]
  targets: Targets
  streak: number
}

export interface DatasetStatus {
  dataset: string
  file: string
  version: string
  status: 'pending' | 'downloading' | 'parsing' | 'loading' | 'done' | 'error' | 'skipped'
  progress: number
  message: string
  foods: number
  imported_version: string | null
  imported_at: string | null
}

export interface SystemStatus {
  importing: boolean
  datasets: DatasetStatus[]
  counts: Partial<Record<Source, number>>
  diary_entries: number
  auto_import: boolean
  openfoodfacts: boolean
}

export interface CatalogNutrient {
  id: number
  name: string
  unit: string
  group: string
  label: boolean
  label_order: number | null
}
