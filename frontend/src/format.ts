import type { Portion, Source } from './types'

export const SOURCE_LABELS: Record<Source, { short: string; long: string }> = {
  foundation: { short: 'Lab', long: 'USDA Foundation Foods: laboratory-analysed nutrient values' },
  sr_legacy: { short: 'SR', long: 'USDA Standard Reference (SR Legacy): the classic national nutrient reference' },
  survey: { short: 'FNDDS', long: 'USDA FNDDS: foods and dishes as typically eaten' },
  custom: { short: 'Mine', long: 'Your custom food' },
  recipe: { short: 'Recipe', long: 'Your recipe, computed from its ingredients' },
  barcode: { short: 'Product', long: 'Packaged product from Open Food Facts (label values)' },
}

export const KCAL_SOURCE_NOTES: Record<string, string> = {
  reported: 'Energy as published by USDA',
  atwater_specific: 'Energy from Atwater specific factors (most precise USDA method)',
  atwater_general: 'Energy from Atwater general factors (4/9/4 kcal per g)',
  estimated: 'USDA did not publish energy for this food; estimated from its macronutrients (4/9/4)',
  computed: 'Calculated from ingredients or macronutrients',
  label: 'From the nutrition label',
}

export const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks' } as const

/** Significant-figure aware formatting: precise for small amounts, clean for big ones. */
export function num(value: number | null | undefined, opts: { digits?: number } = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '–'
  const abs = Math.abs(value)
  const digits = opts.digits ?? (abs === 0 ? 0 : abs < 1 ? 2 : abs < 10 ? 1 : 0)
  return value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

export const kcal = (v: number | null | undefined) => (v === null || v === undefined ? '–' : Math.round(v).toLocaleString())

export function amountLabel(quantity: number, unit: string): string {
  if (['g', 'oz', 'lb', 'kcal', 'ml'].includes(unit)) return `${num(quantity, { digits: 2 })} ${unit}`
  if (quantity === 1) return unit
  return `${num(quantity, { digits: 2 })} × ${unit}`
}

export interface UnitOption {
  key: string
  label: string
  grams: number // grams per 1 of this unit
}

export const OZ = 28.349523125
export const LB = 453.59237

export function unitOptions(portions: Portion[]): UnitOption[] {
  return [
    ...portions.map((p, i) => ({ key: `p${i}`, label: p.label, grams: p.grams })),
    { key: 'g', label: 'g', grams: 1 },
    { key: 'oz', label: 'oz', grams: OZ },
    { key: 'lb', label: 'lb', grams: LB },
  ]
}

export function isoDate(d: Date): string {
  const tz = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - tz).toISOString().slice(0, 10)
}

export const today = () => isoDate(new Date())

export function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + days)
  return isoDate(d)
}

export function prettyDate(iso: string): string {
  const t = today()
  if (iso === t) return 'Today'
  if (iso === shiftDate(t, -1)) return 'Yesterday'
  if (iso === shiftDate(t, 1)) return 'Tomorrow'
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export function fullDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

export function clockTime(d: Date | string): string {
  return new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export const kgToLb = (kg: number) => kg / 0.45359237
export const lbToKg = (lb: number) => lb * 0.45359237
