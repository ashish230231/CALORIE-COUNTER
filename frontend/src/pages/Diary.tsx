import { useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { AddFoodDialog } from '../components/AddFoodDialog'
import { Icon } from '../components/Icon'
import { invalidateDiary } from '../components/LogFood'
import { Modal } from '../components/Modal'
import { NutrientGrid, NutrientTable } from '../components/Nutrients'
import { MacroPreview, PortionPicker, usePortion } from '../components/Portion'
import { MacroBar, Ring } from '../components/Ring'
import { useToast } from '../components/Toast'
import {
  MEAL_LABELS, amountLabel, clockTime, fullDate, kcal, kgToLb, lbToKg, num, prettyDate, shiftDate, shortDate, today,
} from '../format'
import { useProfile } from '../hooks'
import type { Day, DiaryEntry, Meal } from '../types'
import { MEALS } from '../types'

function LiveClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="num" title={now.toLocaleString()}>
      {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  )
}

function DateNav({ date, setDate }: { date: string; setDate: (d: string) => void }) {
  return (
    <div className="row">
      <button className="btn icon" onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day">
        <Icon name="left" />
      </button>
      <label className="btn" style={{ position: 'relative', minWidth: 150 }}>
        <Icon name="today" size={16} /> {shortDate(date)}
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
          aria-label="Pick date"
        />
      </label>
      <button className="btn icon" onClick={() => setDate(shiftDate(date, 1))} aria-label="Next day">
        <Icon name="right" />
      </button>
      {date !== today() && (
        <button className="btn ghost sm" onClick={() => setDate(today())}>
          Today
        </button>
      )}
    </div>
  )
}

function Summary({ day }: { day: Day }) {
  const t = day.targets
  const eaten = day.totals.kcal
  const remaining = t.kcal - eaten
  return (
    <div className="card">
      <div className="summary">
        <Ring value={eaten} target={t.kcal}>
          <div className="big">{kcal(Math.abs(remaining))}</div>
          <div className="muted small">{remaining >= 0 ? 'kcal remaining' : 'kcal over'}</div>
        </Ring>
        <div className="grow" style={{ width: '100%' }}>
          <div className="summary-stats">
            <div className="stat">
              <span className="label">Target</span>
              <span className="value">{kcal(t.kcal)}</span>
            </div>
            <div className="stat">
              <span className="label">Eaten</span>
              <span className="value">{kcal(eaten)}</span>
            </div>
            <div className="stat">
              <span className="label">{remaining >= 0 ? 'Left' : 'Over'}</span>
              <span className="value" style={{ color: remaining >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
                {kcal(Math.abs(remaining))}
              </span>
            </div>
          </div>
          <div className="stack" style={{ gap: 12 }}>
            <MacroBar label="Protein" value={day.totals.protein} target={t.macros.protein} color="var(--protein)" />
            <MacroBar label="Carbs" value={day.totals.carbs} target={t.macros.carbs} color="var(--carbs)" />
            <MacroBar label="Fat" value={day.totals.fat} target={t.macros.fat} color="var(--fat)" />
            {t.micros['1079'] && (
              <MacroBar label="Fiber" value={day.totals.fiber} target={t.micros['1079'].value} color="var(--fiber)" />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function WaterCard({ day, targetMl }: { day: Day; targetMl: number }) {
  const qc = useQueryClient()
  const set = useMutation({
    mutationFn: (ml: number) => api.setWater(day.date, Math.max(0, ml)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['day', day.date] }),
  })
  const cup = 250
  const cups = Math.max(8, Math.ceil(targetMl / cup))
  const filled = Math.round(day.water_ml / cup)
  return (
    <div className="card">
      <div className="card-head">
        <h2 className="row">
          <Icon name="drop" size={18} /> Water
        </h2>
        <span className="num">
          <b>{(day.water_ml / 1000).toFixed(2)}</b> <span className="muted">/ {(targetMl / 1000).toFixed(1)} L</span>
        </span>
      </div>
      <div className="water-cups">
        {Array.from({ length: cups }, (_, i) => (
          <button
            key={i}
            className={`water-cup${i < filled ? ' full' : ''}`}
            title={`${(i + 1) * cup} ml`}
            onClick={() => set.mutate(i + 1 === filled ? i * cup : (i + 1) * cup)}
            aria-label={`Set water to ${(i + 1) * cup} ml`}
          />
        ))}
      </div>
      <div className="row mt">
        <button className="btn sm" onClick={() => set.mutate(day.water_ml - cup)}>
          −250 ml
        </button>
        <button className="btn sm" onClick={() => set.mutate(day.water_ml + cup)}>
          +250 ml
        </button>
        <button className="btn sm" onClick={() => set.mutate(day.water_ml + 500)}>
          +500 ml
        </button>
      </div>
    </div>
  )
}

function WeightCard({ day, imperial }: { day: Day; imperial: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const shown = day.weight_kg === null ? '' : (imperial ? kgToLb(day.weight_kg) : day.weight_kg).toFixed(1)
  const [value, setValue] = useState(shown)
  useEffect(() => setValue(shown), [shown])
  const save = useMutation({
    mutationFn: () => {
      const v = parseFloat(value.replace(',', '.'))
      return api.setWeight(day.date, imperial ? lbToKg(v) : v)
    },
    onSuccess: () => {
      for (const k of ['day', 'profile', 'stats']) qc.invalidateQueries({ queryKey: [k] })
      toast('Weight saved')
    },
    onError: (e: Error) => toast(e.message, true),
  })
  return (
    <div className="card">
      <div className="card-head">
        <h2 className="row">
          <Icon name="scale" size={18} /> Weight
        </h2>
        <span className="muted small">{prettyDate(day.date)}</span>
      </div>
      <div className="row">
        <input
          className="input num"
          inputMode="decimal"
          placeholder="0.0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && parseFloat(value) > 0 && save.mutate()}
          aria-label="Weight"
        />
        <span className="muted">{imperial ? 'lb' : 'kg'}</span>
        <button className="btn primary" disabled={!(parseFloat(value) > 0) || save.isPending || value === shown} onClick={() => save.mutate()}>
          Save
        </button>
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>
        Weigh in at the same time each day; trends show on the Trends page.
      </p>
    </div>
  )
}

function EditEntryDialog({ entry, onClose }: { entry: DiaryEntry; onClose: () => void }) {
  const food = useQuery({ queryKey: ['food', entry.food_id], queryFn: () => api.food(entry.food_id) })
  const portion = usePortion(food.data, { quantity: entry.quantity, unit_label: entry.unit_label })
  const [meal, setMeal] = useState<Meal>(entry.meal)
  const qc = useQueryClient()
  const toast = useToast()
  const quick = entry.source_id === 'quick-add'
  const [quickKcal, setQuickKcal] = useState(String(entry.grams))
  const save = useMutation({
    mutationFn: () =>
      quick
        ? api.updateEntry(entry.id, { meal, grams: parseFloat(quickKcal), quantity: parseFloat(quickKcal), unit_label: 'kcal' })
        : api.updateEntry(entry.id, { meal, grams: portion.grams, quantity: portion.qty, unit_label: portion.unit.label }),
    onSuccess: () => {
      invalidateDiary(qc)
      onClose()
    },
    onError: (e: Error) => toast(e.message, true),
  })
  const remove = useMutation({
    mutationFn: () => api.deleteEntry(entry.id),
    onSuccess: () => {
      invalidateDiary(qc)
      onClose()
    },
  })
  const valid = quick ? parseFloat(quickKcal) > 0 : portion.valid
  return (
    <Modal
      narrow
      title={entry.description}
      onClose={onClose}
      footer={
        <>
          <button className="btn danger" onClick={() => remove.mutate()}>
            <Icon name="trash" size={16} /> Delete
          </button>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            Save
          </button>
        </>
      }
    >
      <div className="stack">
        {quick ? (
          <input className="input num" inputMode="decimal" value={quickKcal} onChange={(e) => setQuickKcal(e.target.value)} autoFocus />
        ) : food.data ? (
          <>
            <PortionPicker state={portion} autoFocus onEnter={() => save.mutate()} />
            <MacroPreview food={food.data} grams={portion.grams} />
          </>
        ) : (
          <div className="spinner" />
        )}
        <div className="segmented">
          {MEALS.map((m) => (
            <button key={m} className={m === meal ? 'on' : ''} onClick={() => setMeal(m)}>
              {MEAL_LABELS[m]}
            </button>
          ))}
        </div>
        {!quick && (
          <Link className="small muted" to={`/foods/${entry.food_id}`}>
            View full nutrition →
          </Link>
        )}
      </div>
    </Modal>
  )
}

function MealCard({ meal, day, onAdd, onEdit }: { meal: Meal; day: Day; onAdd: () => void; onEdit: (e: DiaryEntry) => void }) {
  const entries = day.entries.filter((e) => e.meal === meal)
  const sum = (k: 'kcal' | 'protein' | 'carbs' | 'fat') => entries.reduce((a, e) => a + (e[k] ?? 0), 0)
  const qc = useQueryClient()
  const toast = useToast()
  const copy = useMutation({
    mutationFn: () => api.copyEntries({ from_date: shiftDate(day.date, -1), to_date: day.date, meal }),
    onSuccess: (r) => {
      invalidateDiary(qc)
      toast(r.copied ? `Copied ${r.copied} item${r.copied > 1 ? 's' : ''}` : `Nothing logged for ${MEAL_LABELS[meal].toLowerCase()} yesterday`)
    },
  })
  return (
    <div className="card flush">
      <div className="meal-head">
        <h2>{MEAL_LABELS[meal]}</h2>
        {entries.length > 0 && (
          <div className="macro-mini">
            <span className="p">{Math.round(sum('protein'))}g</span>
            <span className="c">{Math.round(sum('carbs'))}g</span>
            <span className="f">{Math.round(sum('fat'))}g</span>
          </div>
        )}
        <b className="num">{kcal(sum('kcal'))}</b>
        <span className="muted small">kcal</span>
        {entries.length === 0 && (
          <button className="btn ghost sm" title="Copy from the previous day" onClick={() => copy.mutate()}>
            <Icon name="copy" size={15} />
          </button>
        )}
        <button className="btn sm primary" onClick={onAdd}>
          <Icon name="plus" size={16} /> Add
        </button>
      </div>
      <div className="list">
        {entries.map((e) => (
          <div key={e.id} className="list-item" onClick={() => onEdit(e)}>
            <div className="grow">
              <div className="title">{e.description}</div>
              <div className="sub">
                <span title={new Date(e.created_at).toLocaleString()}>{clockTime(e.created_at)}</span> ·{' '}
                {amountLabel(e.quantity, e.unit_label)}
                {e.unit_label !== 'g' && e.unit_label !== 'kcal' ? ` · ${num(e.grams)} g` : ''}
                {e.brand ? ` · ${e.brand}` : ''}
              </div>
            </div>
            {e.source_id !== 'quick-add' && (
              <div className="macro-mini entry-macros">
                <span className="p">{num(e.protein)}</span>
                <span className="c">{num(e.carbs)}</span>
                <span className="f">{num(e.fat)}</span>
              </div>
            )}
            <div className="right" style={{ minWidth: 56 }}>
              <b>{kcal(e.kcal)}</b>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function DiaryPage() {
  const [params, setParams] = useSearchParams()
  const date = params.get('date') ?? today()
  const setDate = (d: string) => setParams(d === today() ? {} : { date: d })
  const day = useQuery({ queryKey: ['day', date], queryFn: () => api.day(date), placeholderData: keepPreviousData })
  const profile = useProfile()
  const [adding, setAdding] = useState<Meal | null>(null)
  const [editing, setEditing] = useState<DiaryEntry | null>(null)
  const [allNutrients, setAllNutrients] = useState(false)

  // "/" or "a" opens the add dialog, arrow keys change day.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (adding || editing || el.closest('input, select, textarea, [role=dialog]')) return
      if (e.key === '/' || e.key === 'a') {
        e.preventDefault()
        const h = new Date().getHours()
        setAdding(h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 21 ? 'dinner' : 'snacks')
      } else if (e.key === 'ArrowLeft') setDate(shiftDate(date, -1))
      else if (e.key === 'ArrowRight') setDate(shiftDate(date, 1))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const d = day.data
  const imperial = profile.data?.profile.unit_system === 'imperial'
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{prettyDate(date)}</h1>
          <div className="muted row" style={{ gap: 8, marginTop: 4 }}>
            <span>{fullDate(date)}</span>
            <span className="faint">·</span>
            <Icon name="clock" size={15} />
            <LiveClock />
          </div>
        </div>
        <DateNav date={date} setDate={setDate} />
      </div>
      {profile.data && !profile.data.targets.profile_complete && (
        <div className="banner">
          <Icon name="info" />
          <span className="grow">
            Targets are generic FDA Daily Values for a 2,000 kcal diet. Add your body details for personalised energy and
            nutrient targets.
          </span>
          <Link className="btn sm primary" to="/profile">
            Set up profile
          </Link>
        </div>
      )}
      {d?.targets.warnings.map((w) => (
        <div className="banner warn" key={w}>
          <Icon name="info" /> <span>{w}</span>
        </div>
      ))}
      {!d ? (
        <div className="empty">
          <span className="spinner" style={{ display: 'inline-block' }} />
        </div>
      ) : (
        <>
          <div className="grid summary-grid">
            <Summary day={d} />
            <div className="stack" style={{ gap: 16 }}>
              <WaterCard day={d} targetMl={profile.data?.profile.water_target_ml ?? 2500} />
              <WeightCard day={d} imperial={imperial} />
            </div>
          </div>
          <div className="grid grid-2 mt">
            {MEALS.map((m) => (
              <MealCard key={m} meal={m} day={d} onAdd={() => setAdding(m)} onEdit={setEditing} />
            ))}
          </div>
          <div className="card mt">
            <div className="card-head">
              <div>
                <h2>Nutrients</h2>
                <div className="muted small">
                  Targets: {d.targets.basis}. “≥” marks totals where some foods lack data for that nutrient.
                </div>
              </div>
              <div className="segmented">
                <button className={!allNutrients ? 'on' : ''} onClick={() => setAllNutrients(false)}>
                  Key
                </button>
                <button className={allNutrients ? 'on' : ''} onClick={() => setAllNutrients(true)}>
                  All {d.nutrients.length}
                </button>
              </div>
            </div>
            {allNutrients ? (
              <NutrientTable rows={d.nutrients} showCoverage />
            ) : (
              <NutrientGrid rows={d.nutrients.filter((n) => n.key)} />
            )}
          </div>
          <p className="faint small mt">
            Tip: press <span className="kbd">/</span> to add food, <span className="kbd">←</span> <span className="kbd">→</span> to
            change day.
          </p>
        </>
      )}
      {adding && <AddFoodDialog date={date} meal={adding} onClose={() => setAdding(null)} />}
      {editing && <EditEntryDialog entry={editing} onClose={() => setEditing(null)} />}
    </>
  )
}
