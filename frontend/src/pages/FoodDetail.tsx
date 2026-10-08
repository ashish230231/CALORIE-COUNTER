import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { SourceChip } from '../components/FoodSearch'
import { Icon } from '../components/Icon'
import { invalidateDiary } from '../components/LogFood'
import { NutrientTable } from '../components/Nutrients'
import { MacroPreview, PortionPicker, usePortion } from '../components/Portion'
import { useToast } from '../components/Toast'
import { KCAL_SOURCE_NOTES, MEAL_LABELS, SOURCE_LABELS, amountLabel, kcal, num, today } from '../format'
import { useProfile } from '../hooks'
import type { FoodDetail, Meal } from '../types'
import { MEALS } from '../types'

function EnergySplit({ food }: { food: FoodDetail }) {
  const p = (food.protein ?? 0) * 4
  const c = (food.carbs ?? 0) * 4
  const f = (food.fat ?? 0) * 9
  const total = p + c + f
  if (!total) return null
  const parts = [
    { label: 'Protein', v: p, color: 'var(--protein)' },
    { label: 'Carbs', v: c, color: 'var(--carbs)' },
    { label: 'Fat', v: f, color: 'var(--fat)' },
  ]
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="muted small">Calories by macronutrient</div>
      <div className="bar" style={{ height: 12, display: 'flex' }}>
        {parts.map((x) => (
          <i key={x.label} style={{ width: `${(x.v / total) * 100}%`, background: x.color, borderRadius: 0 }} />
        ))}
      </div>
      <div className="row small">
        {parts.map((x) => (
          <span key={x.label}>
            <i className="dot" style={{ background: x.color }} />
            {x.label} {Math.round((x.v / total) * 100)}%
          </span>
        ))}
      </div>
    </div>
  )
}

export function FoodDetailPage() {
  const id = Number(useParams().id)
  const food = useQuery({ queryKey: ['food', id], queryFn: () => api.food(id) })
  const profile = useProfile()
  const portion = usePortion(food.data)
  const [meal, setMeal] = useState<Meal>('snacks')
  const [date, setDate] = useState(today())
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()

  const log = useMutation({
    mutationFn: () =>
      api.addEntry({ date, meal, food_id: id, grams: portion.grams, quantity: portion.qty, unit_label: portion.unit.label }),
    onSuccess: () => {
      invalidateDiary(qc)
      toast(`Logged to ${MEAL_LABELS[meal].toLowerCase()}`)
    },
    onError: (e: Error) => toast(e.message, true),
  })
  const remove = useMutation({
    mutationFn: () => api.deleteFood(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mine'] })
      qc.invalidateQueries({ queryKey: ['search'] })
      toast('Food deleted')
      navigate('/foods')
    },
    onError: (e: Error) => toast(e.message, true),
  })

  if (food.isError) return <div className="empty">Food not found.</div>
  const f = food.data
  if (!f) return <div className="empty"><span className="spinner" style={{ display: 'inline-block' }} /></div>

  const scale = portion.grams / 100
  const micros = profile.data?.targets.micros ?? {}
  const rows = f.nutrients.map((n) => ({
    ...n,
    amount: n.amount * scale,
    target: n.id === 1008 && profile.data ? { kind: 'min' as const, value: profile.data.targets.kcal } : micros[String(n.id)] ?? null,
  }))
  const editable = ['custom', 'barcode', 'recipe'].includes(f.source) && f.source_id !== 'quick-add' && !f.archived

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <div className="row wrap" style={{ marginBottom: 6 }}>
            <SourceChip source={f.source} />
            {f.category && <span className="muted small">{f.category}</span>}
          </div>
          <h1>{f.description}</h1>
          {f.brand && <div className="muted">{f.brand}</div>}
        </div>
        {editable && (
          <div className="row">
            <Link className="btn" to={f.source === 'recipe' ? `/recipes/${f.id}/edit` : `/foods/${f.id}/edit`}>
              <Icon name="edit" size={16} /> Edit
            </Link>
            <button className="btn danger" onClick={() => confirm('Delete this food? Diary entries keep their values.') && remove.mutate()}>
              <Icon name="trash" size={16} />
            </button>
          </div>
        )}
      </div>

      {f.archived && (
        <div className="banner warn">
          <Icon name="info" />
          <span className="grow">This is an older version kept so past diary entries stay accurate.</span>
          {f.replaced_by && (
            <Link className="btn sm" to={`/foods/${f.replaced_by}`}>
              Current version
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-2">
        <div className="card stack">
          <h2>Amount</h2>
          <PortionPicker state={portion} onEnter={() => log.mutate()} />
          <div className="muted small num">= {num(portion.grams, { digits: 1 })} g</div>
          <MacroPreview food={f} grams={portion.grams} />
          <EnergySplit food={f} />
          {f.kcal_source && (
            <div className={`notice${f.kcal_source === 'estimated' ? ' warn' : ''}`}>
              <Icon name="info" size={14} /> {KCAL_SOURCE_NOTES[f.kcal_source] ?? f.kcal_source}
            </div>
          )}
        </div>
        <div className="card stack">
          <h2>Log it</h2>
          <div className="form-grid">
            <label className="field">
              <span>Date</span>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              <span>Meal</span>
              <select className="select" value={meal} onChange={(e) => setMeal(e.target.value as Meal)}>
                {MEALS.map((m) => (
                  <option key={m} value={m}>
                    {MEAL_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="btn primary" disabled={!portion.valid || log.isPending || !date} onClick={() => log.mutate()}>
            <Icon name="plus" size={16} /> Add {num(portion.grams)} g · {kcal(f.kcal === null ? null : f.kcal * scale)} kcal
          </button>
          <hr className="sep" style={{ margin: '4px 0' }} />
          <div className="muted small">
            <b>Source:</b> {SOURCE_LABELS[f.source].long}
            {['foundation', 'sr_legacy', 'survey'].includes(f.source) && (
              <>
                {' '}
                ·{' '}
                <a href={`https://fdc.nal.usda.gov/food-details/${f.source_id}/nutrients`} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
                  FDC #{f.source_id}
                </a>
              </>
            )}
          </div>
          {f.portions.length > 0 && (
            <div className="muted small">
              <b>Measured portions:</b> {f.portions.map((p) => `${p.label} = ${num(p.grams)} g`).join(' · ')}
            </div>
          )}
        </div>
      </div>

      {f.recipe && (
        <div className="card flush mt">
          <div className="meal-head">
            <h2>Ingredients</h2>
            <span className="muted small">
              {num(f.recipe.servings)} servings
              {f.recipe.cooked_grams ? ` · ${num(f.recipe.cooked_grams)} g cooked` : ''}
            </span>
          </div>
          <div className="list">
            {f.recipe.ingredients.map((i, idx) => (
              <Link key={idx} to={`/foods/${i.food_id}`} className="list-item">
                <div className="grow">
                  <div className="title">{i.description}</div>
                  <div className="sub">
                    {amountLabel(i.quantity, i.unit_label)} · {num(i.grams)} g
                  </div>
                </div>
                <div className="right">{kcal(i.kcal)} kcal</div>
              </Link>
            ))}
          </div>
          {f.recipe.notes && <p className="muted small" style={{ padding: '0 16px 12px', whiteSpace: 'pre-wrap' }}>{f.recipe.notes}</p>}
        </div>
      )}

      <div className="card mt">
        <div className="card-head">
          <div>
            <h2>Complete nutrition</h2>
            <div className="muted small">
              {f.nutrients.length} nutrients for {num(portion.grams, { digits: 1 })} g · % of your daily targets
            </div>
          </div>
        </div>
        <NutrientTable rows={rows} />
      </div>
    </>
  )
}
