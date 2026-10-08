import { useEffect, useMemo, useState } from 'react'
import { kcal, num, unitOptions, type UnitOption } from '../format'
import type { FoodDetail, Portion } from '../types'

export interface PortionState {
  options: UnitOption[]
  quantity: string
  setQuantity: (q: string) => void
  unitKey: string
  setUnitKey: (k: string) => void
  unit: UnitOption
  grams: number
  qty: number
  valid: boolean
}

function defaults(portions: Portion[], initial?: { quantity: number; unit_label: string }) {
  const options = unitOptions(portions)
  if (initial) {
    const match = options.find((o) => o.label === initial.unit_label)
    if (match) return { unitKey: match.key, quantity: String(initial.quantity) }
  }
  return portions.length ? { unitKey: 'p0', quantity: '1' } : { unitKey: 'g', quantity: '100' }
}

export function usePortion(food: Pick<FoodDetail, 'id' | 'portions'> | undefined, initial?: { quantity: number; unit_label: string }): PortionState {
  const portions = food?.portions ?? []
  const options = useMemo(() => unitOptions(portions), [portions])
  const [state, setState] = useState(() => defaults(portions, initial))

  useEffect(() => {
    if (food) setState(defaults(food.portions, initial)) // reset only when a different food is loaded
  }, [food?.id])

  const unit = options.find((o) => o.key === state.unitKey) ?? options[options.length - 3]
  const qty = parseFloat(state.quantity.replace(',', '.'))
  const grams = qty > 0 ? qty * unit.grams : 0
  return {
    options,
    quantity: state.quantity,
    setQuantity: (quantity) => setState((s) => ({ ...s, quantity })),
    unitKey: unit.key,
    setUnitKey: (unitKey) => setState((s) => ({ ...s, unitKey })),
    unit,
    grams,
    qty,
    valid: grams > 0 && grams <= 100000,
  }
}

export function PortionPicker({ state, autoFocus, onEnter }: { state: PortionState; autoFocus?: boolean; onEnter?: () => void }) {
  return (
    <div className="row">
      <input
        className="input num"
        style={{ width: 110 }}
        inputMode="decimal"
        value={state.quantity}
        autoFocus={autoFocus}
        onFocus={(e) => e.target.select()}
        onChange={(e) => state.setQuantity(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && state.valid && onEnter?.()}
        aria-label="Quantity"
      />
      <select className="select grow" value={state.unitKey} onChange={(e) => state.setUnitKey(e.target.value)} aria-label="Unit">
        {state.options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
            {o.key.startsWith('p') ? ` (${num(o.grams)} g)` : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

type Per100 = Pick<FoodDetail, 'kcal' | 'protein' | 'carbs' | 'fat'>

export function MacroPreview({ food, grams }: { food: Per100; grams: number }) {
  const f = grams / 100
  const scaled = (v: number | null) => (v === null ? null : v * f)
  return (
    <div className="picker-preview">
      <div>
        <b>{kcal(scaled(food.kcal))}</b>
        <span>kcal</span>
      </div>
      <div>
        <b style={{ color: 'var(--protein)' }}>{num(scaled(food.protein))}</b>
        <span>Protein g</span>
      </div>
      <div>
        <b style={{ color: 'var(--carbs)' }}>{num(scaled(food.carbs))}</b>
        <span>Carbs g</span>
      </div>
      <div>
        <b style={{ color: 'var(--fat)' }}>{num(scaled(food.fat))}</b>
        <span>Fat g</span>
      </div>
    </div>
  )
}
