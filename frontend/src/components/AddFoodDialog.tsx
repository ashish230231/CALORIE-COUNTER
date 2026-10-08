import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { MEAL_LABELS, amountLabel, kcal } from '../format'
import type { FoodDetail, FoodHit, Meal, RecentFood } from '../types'
import { BarcodeLookup } from './Barcode'
import { FoodRow, FoodSearch } from './FoodSearch'
import { Icon } from './Icon'
import { LogFoodForm, invalidateDiary } from './LogFood'
import { Modal } from './Modal'
import { useToast } from './Toast'

type Tab = 'search' | 'recent' | 'mine' | 'barcode' | 'quick'
const TABS: { key: Tab; label: string }[] = [
  { key: 'search', label: 'Search' },
  { key: 'recent', label: 'Recent' },
  { key: 'mine', label: 'My foods' },
  { key: 'barcode', label: 'Barcode' },
  { key: 'quick', label: 'Quick add' },
]

function RecentList({ date, meal, onPick }: { date: string; meal: Meal; onPick: (f: FoodHit) => void }) {
  const recent = useQuery({ queryKey: ['recent'], queryFn: api.recent })
  const qc = useQueryClient()
  const toast = useToast()
  const relog = useMutation({
    mutationFn: (f: RecentFood) =>
      api.addEntry({ date, meal, food_id: f.id, grams: f.grams, quantity: f.quantity, unit_label: f.unit_label }),
    onSuccess: (_, f) => {
      invalidateDiary(qc)
      toast(`Added ${f.description.split(',')[0]}`)
    },
    onError: (e: Error) => toast(e.message, true),
  })
  if (recent.isLoading) return <div className="empty">Loading…</div>
  if (!recent.data?.length) return <div className="empty">Foods you log will show up here for one-tap re-logging.</div>
  return (
    <div className="card flush">
      <div className="list">
        {recent.data.map((f) => (
          <FoodRow
            key={f.id}
            food={{ ...f, portion: { label: amountLabel(f.quantity, f.unit_label), grams: f.grams } }}
            onClick={() => onPick(f)}
            right={
              <div className="row">
                <span className="num small">{kcal(f.kcal === null ? null : (f.kcal * f.grams) / 100)} kcal</span>
                <button
                  className="btn sm primary icon"
                  title={`Add ${amountLabel(f.quantity, f.unit_label)} again`}
                  onClick={(e) => {
                    e.stopPropagation()
                    relog.mutate(f)
                  }}
                >
                  <Icon name="plus" size={16} />
                </button>
              </div>
            }
          />
        ))}
      </div>
    </div>
  )
}

function MyFoods({ onPick }: { onPick: (f: FoodHit) => void }) {
  const mine = useQuery({ queryKey: ['mine'], queryFn: api.myFoods })
  if (mine.isLoading) return <div className="empty">Loading…</div>
  return (
    <div className="stack">
      <div className="row">
        <Link className="btn sm" to="/foods/new">
          <Icon name="plus" size={16} /> Custom food
        </Link>
        <Link className="btn sm" to="/recipes/new">
          <Icon name="book" size={16} /> Recipe
        </Link>
      </div>
      {mine.data?.length ? (
        <div className="card flush">
          <div className="list">
            {mine.data.map((f) => (
              <FoodRow key={f.id} food={f} onClick={() => onPick(f)} />
            ))}
          </div>
        </div>
      ) : (
        <div className="empty">No custom foods or recipes yet.</div>
      )}
    </div>
  )
}

function QuickAdd({ date, meal, onDone }: { date: string; meal: Meal; onDone: () => void }) {
  const [value, setValue] = useState('')
  const qc = useQueryClient()
  const toast = useToast()
  const add = useMutation({
    mutationFn: () => api.quickAdd({ date, meal, kcal: parseFloat(value) }),
    onSuccess: () => {
      invalidateDiary(qc)
      toast(`Added ${value} kcal`)
      onDone()
    },
    onError: (e: Error) => toast(e.message, true),
  })
  const valid = parseFloat(value) > 0
  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>
        Know only the calories? Log them directly. Quick entries count toward energy but carry no nutrient detail.
      </p>
      <div className="row">
        <input
          className="input num"
          style={{ width: 160 }}
          inputMode="decimal"
          autoFocus
          placeholder="kcal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && valid && add.mutate()}
        />
        <button className="btn primary" disabled={!valid || add.isPending} onClick={() => add.mutate()}>
          Add to {MEAL_LABELS[meal]}
        </button>
      </div>
    </div>
  )
}

export function AddFoodDialog({ date, meal: initialMeal, onClose }: { date: string; meal: Meal; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('search')
  const [meal, setMeal] = useState<Meal>(initialMeal)
  const [picked, setPicked] = useState<number | null>(null)
  const [scanned, setScanned] = useState<FoodDetail | null>(null)
  const [query, setQuery] = useState('')
  const detail = useQuery({
    queryKey: ['food', picked],
    queryFn: () => api.food(picked!),
    enabled: picked !== null && !scanned,
  })
  const food = scanned ?? detail.data
  const back = () => {
    setPicked(null)
    setScanned(null)
  }

  const title = picked !== null || scanned ? (
    <span className="row">
      <button className="btn ghost icon sm" onClick={back} aria-label="Back">
        <Icon name="left" />
      </button>
      <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {food?.description ?? 'Loading…'}
      </span>
    </span>
  ) : (
    `Add to ${MEAL_LABELS[meal]}`
  )

  const tabs =
    picked === null && !scanned ? (
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
    ) : undefined

  return (
    <Modal title={title} onClose={onClose} tabs={tabs}>
      <div style={{ paddingTop: 16 }}>
        {picked !== null || scanned ? (
          food ? (
            <LogFoodForm food={food} date={date} meal={meal} onMealChange={setMeal} onDone={back} autoFocus />
          ) : (
            <div className="empty">
              <span className="spinner" style={{ display: 'inline-block' }} />
            </div>
          )
        ) : tab === 'search' ? (
          <FoodSearch autoFocus initialQuery={query} onQueryChange={setQuery} onPick={(f) => setPicked(f.id)} />
        ) : tab === 'recent' ? (
          <RecentList date={date} meal={meal} onPick={(f) => setPicked(f.id)} />
        ) : tab === 'mine' ? (
          <MyFoods onPick={(f) => setPicked(f.id)} />
        ) : tab === 'barcode' ? (
          <BarcodeLookup onFound={(f) => setScanned(f)} />
        ) : (
          <QuickAdd date={date} meal={meal} onDone={onClose} />
        )}
      </div>
    </Modal>
  )
}
