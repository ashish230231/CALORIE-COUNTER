import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { KCAL_SOURCE_NOTES, MEAL_LABELS, num } from '../format'
import type { FoodDetail, Meal } from '../types'
import { MEALS } from '../types'
import { SourceChip } from './FoodSearch'
import { MacroPreview, PortionPicker, usePortion } from './Portion'
import { useToast } from './Toast'

export function invalidateDiary(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ['day', 'recent', 'stats', 'status']) qc.invalidateQueries({ queryKey: [key] })
}

interface Props {
  food: FoodDetail
  date: string
  meal: Meal
  onMealChange?: (m: Meal) => void
  onDone?: () => void
  autoFocus?: boolean
}

export function LogFoodForm({ food, date, meal, onMealChange, onDone, autoFocus }: Props) {
  const portion = usePortion(food)
  const qc = useQueryClient()
  const toast = useToast()
  const add = useMutation({
    mutationFn: () =>
      api.addEntry({ date, meal, food_id: food.id, grams: portion.grams, quantity: portion.qty, unit_label: portion.unit.label }),
    onSuccess: () => {
      invalidateDiary(qc)
      toast(`Added ${food.description.split(',')[0]} to ${MEAL_LABELS[meal].toLowerCase()}`)
      onDone?.()
    },
    onError: (e: Error) => toast(e.message, true),
  })
  const submit = () => portion.valid && !add.isPending && add.mutate()

  return (
    <div className="stack">
      <div className="row wrap">
        <SourceChip source={food.source} />
        {food.category && <span className="muted small">{food.category}</span>}
        {food.kcal_source && food.kcal_source !== 'reported' && (
          <span className={`chip${food.kcal_source === 'estimated' ? ' warn' : ''}`} title={KCAL_SOURCE_NOTES[food.kcal_source]}>
            {food.kcal_source.replace('_', ' ')}
          </span>
        )}
      </div>
      <PortionPicker state={portion} autoFocus={autoFocus} onEnter={submit} />
      <div className="muted small num">= {num(portion.grams, { digits: 1 })} g</div>
      <MacroPreview food={food} grams={portion.grams} />
      <div className="row">
        <select className="select" style={{ width: 160 }} value={meal} onChange={(e) => onMealChange?.(e.target.value as Meal)} aria-label="Meal">
          {MEALS.map((m) => (
            <option key={m} value={m}>
              {MEAL_LABELS[m]}
            </option>
          ))}
        </select>
        <button className="btn primary grow" disabled={!portion.valid || add.isPending} onClick={submit}>
          Add to {MEAL_LABELS[meal]} <span className="kbd" style={{ color: 'inherit', background: 'transparent' }}>Enter</span>
        </button>
      </div>
    </div>
  )
}
