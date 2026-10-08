import type {
  CatalogNutrient, Day, FoodDetail, FoodHit, Meal, Profile, ProfileResponse, RecentFood, Stats, SystemStatus,
} from './types'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const data = await res.json()
      if (typeof data.detail === 'string') message = data.detail
      else if (Array.isArray(data.detail)) message = data.detail.map((d: { msg: string }) => d.msg.replace(/^Value error, /, '')).join('; ')
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

const get = <T,>(path: string) => request<T>('GET', path)

export interface EntryInput {
  date: string
  meal: Meal
  food_id: number
  grams: number
  quantity: number
  unit_label: string
}

export interface CustomFoodInput {
  description: string
  brand?: string | null
  category?: string | null
  basis_grams: number
  serving_label?: string | null
  nutrients: Record<number, number>
  portions?: { label: string; grams: number }[]
}

export interface RecipeInput {
  name: string
  servings: number
  cooked_grams?: number | null
  notes?: string | null
  ingredients: { food_id: number; grams: number; quantity: number; unit_label: string }[]
}

export const api = {
  search: (q: string, sources?: string[]) =>
    get<FoodHit[]>(`/foods/search?limit=40&q=${encodeURIComponent(q)}${sources?.length ? `&sources=${sources.join(',')}` : ''}`),
  recent: () => get<RecentFood[]>('/foods/recent'),
  myFoods: () => get<FoodHit[]>('/foods/mine'),
  food: (id: number) => get<FoodDetail>(`/foods/${id}`),
  barcode: (code: string) => get<FoodDetail>(`/foods/barcode/${encodeURIComponent(code)}`),
  nutrients: () => get<CatalogNutrient[]>('/nutrients'),
  createFood: (body: CustomFoodInput) => request<FoodDetail>('POST', '/foods', body),
  updateFood: (id: number, body: CustomFoodInput) => request<FoodDetail>('PUT', `/foods/${id}`, body),
  deleteFood: (id: number) => request<void>('DELETE', `/foods/${id}`),
  createRecipe: (body: RecipeInput) => request<FoodDetail>('POST', '/recipes', body),
  updateRecipe: (id: number, body: RecipeInput) => request<FoodDetail>('PUT', `/recipes/${id}`, body),

  day: (date: string) => get<Day>(`/diary/${date}`),
  addEntry: (body: EntryInput) => request<{ id: number }>('POST', '/diary', body),
  quickAdd: (body: { date: string; meal: Meal; kcal: number }) => request<{ id: number }>('POST', '/diary/quick', body),
  updateEntry: (id: number, body: Partial<Omit<EntryInput, 'food_id'>>) => request<{ id: number }>('PATCH', `/diary/${id}`, body),
  deleteEntry: (id: number) => request<void>('DELETE', `/diary/${id}`),
  copyEntries: (body: { from_date: string; to_date: string; meal?: Meal }) => request<{ copied: number }>('POST', '/diary/copy', body),

  profile: () => get<ProfileResponse>('/profile'),
  saveProfile: (body: Profile) => request<ProfileResponse>('PUT', '/profile', body),
  setWeight: (date: string, weight_kg: number) => request('PUT', `/weights/${date}`, { weight_kg }),
  deleteWeight: (date: string) => request<void>('DELETE', `/weights/${date}`),
  setWater: (date: string, ml: number) => request('PUT', `/water/${date}`, { ml }),
  stats: (start: string, end: string) => get<Stats>(`/stats?start=${start}&end=${end}`),

  status: () => get<SystemStatus>('/system/status'),
  startImport: (force = false) => request<{ started: boolean }>('POST', `/system/import?force=${force}`),
  restore: (data: unknown) => request<Record<string, number>>('POST', '/system/restore', data),
}
