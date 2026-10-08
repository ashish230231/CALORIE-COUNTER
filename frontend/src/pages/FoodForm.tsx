import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { api, type CustomFoodInput } from '../api'
import { Icon } from '../components/Icon'
import { useToast } from '../components/Toast'
import type { FoodDetail } from '../types'

const CORE_COUNT = 13 // calories through protein, i.e. the mandatory part of a nutrition label
const INDENTED = new Set([1258, 1257, 1292, 1293, 1079, 2000, 1235])

const clean = (v: number) => String(Math.round(v * 10000) / 10000)

function fromFood(f: FoodDetail) {
  const basis = f.portions[0]?.grams ?? 100
  const values: Record<number, string> = {}
  for (const n of f.nutrients) values[n.id] = clean((n.amount * basis) / 100)
  return {
    description: f.description,
    brand: f.brand ?? '',
    category: f.category ?? '',
    servingLabel: f.portions[0]?.label ?? '100 g',
    basis: clean(basis),
    values,
    portions: f.portions.slice(1).map((p) => ({ label: p.label, grams: clean(p.grams) })),
  }
}

export function FoodFormPage() {
  const params = useParams()
  const editId = params.id ? Number(params.id) : null
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const catalog = useQuery({ queryKey: ['nutrients'], queryFn: api.nutrients, staleTime: Infinity })
  const existing = useQuery({ queryKey: ['food', editId], queryFn: () => api.food(editId!), enabled: editId !== null })

  const [form, setForm] = useState({
    description: '',
    brand: '',
    category: '',
    servingLabel: '1 serving',
    basis: '',
    values: {} as Record<number, string>,
    portions: [] as { label: string; grams: string }[],
  })
  const [showMore, setShowMore] = useState(false)
  useEffect(() => {
    if (existing.data) setForm(fromFood(existing.data))
  }, [existing.data])

  const labelNutrients = useMemo(
    () => (catalog.data ?? []).filter((n) => n.label).sort((a, b) => (a.label_order ?? 0) - (b.label_order ?? 0)),
    [catalog.data],
  )
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = useMutation({
    mutationFn: () => {
      const nutrients: Record<number, number> = {}
      for (const [id, raw] of Object.entries(form.values)) {
        const v = parseFloat(raw.replace(',', '.'))
        if (raw.trim() !== '' && !Number.isNaN(v)) nutrients[Number(id)] = v
      }
      const body: CustomFoodInput = {
        description: form.description.trim(),
        brand: form.brand.trim() || null,
        category: form.category.trim() || null,
        basis_grams: parseFloat(form.basis),
        serving_label: form.servingLabel.trim() || null,
        nutrients,
        portions: form.portions
          .filter((p) => p.label.trim() && parseFloat(p.grams) > 0)
          .map((p) => ({ label: p.label.trim(), grams: parseFloat(p.grams) })),
      }
      return editId ? api.updateFood(editId, body) : api.createFood(body)
    },
    onSuccess: (food) => {
      for (const k of ['mine', 'search', 'day']) qc.invalidateQueries({ queryKey: [k] })
      toast(editId ? 'Saved as a new version' : 'Food created')
      navigate(`/foods/${food.id}`, { replace: true })
    },
    onError: (e: Error) => toast(e.message, true),
  })

  const valid = form.description.trim() && parseFloat(form.basis) > 0 && Object.values(form.values).some((v) => v.trim() !== '')
  const shown = showMore ? labelNutrients : labelNutrients.slice(0, CORE_COUNT)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{editId ? 'Edit food' : 'New custom food'}</h1>
          <div className="muted small">Copy the values straight from the nutrition label. Leave unknown nutrients blank.</div>
        </div>
      </div>
      <div className="grid grid-2">
        <div className="card stack">
          <label className="field">
            <span>Name *</span>
            <input className="input" value={form.description} onChange={(e) => set('description', e.target.value)} autoFocus placeholder="e.g. Chocolate protein bar" />
          </label>
          <div className="form-grid">
            <label className="field">
              <span>Brand</span>
              <input className="input" value={form.brand} onChange={(e) => set('brand', e.target.value)} />
            </label>
            <label className="field">
              <span>Category</span>
              <input className="input" value={form.category} onChange={(e) => set('category', e.target.value)} />
            </label>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Serving name</span>
              <input className="input" value={form.servingLabel} onChange={(e) => set('servingLabel', e.target.value)} placeholder="1 bar" />
            </label>
            <label className="field">
              <span>Serving size (g or ml) *</span>
              <input className="input num" inputMode="decimal" value={form.basis} onChange={(e) => set('basis', e.target.value)} placeholder="40" />
            </label>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <div className="row spread">
              <b className="small">Other portions</b>
              <button className="btn sm ghost" onClick={() => set('portions', [...form.portions, { label: '', grams: '' }])}>
                <Icon name="plus" size={14} /> Add portion
              </button>
            </div>
            {form.portions.map((p, i) => (
              <div className="row" key={i}>
                <input
                  className="input grow"
                  placeholder="e.g. 1 cup"
                  value={p.label}
                  onChange={(e) => set('portions', form.portions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                />
                <input
                  className="input num"
                  style={{ width: 100 }}
                  placeholder="grams"
                  inputMode="decimal"
                  value={p.grams}
                  onChange={(e) => set('portions', form.portions.map((x, j) => (j === i ? { ...x, grams: e.target.value } : x)))}
                />
                <button className="btn ghost icon sm" onClick={() => set('portions', form.portions.filter((_, j) => j !== i))} aria-label="Remove portion">
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
          </div>
          {editId && (
            <div className="notice">
              Saving creates a new version. Diary entries already logged keep the values they were logged with.
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Nutrition facts</h2>
            <span className="muted small">per serving{form.basis ? ` (${form.basis} g)` : ''}</span>
          </div>
          {shown.map((n) => (
            <div key={n.id} className={`label-row${INDENTED.has(n.id) ? ' indent' : ''}`}>
              <span>{n.name}</span>
              <input
                className="input num"
                style={{ height: 34 }}
                inputMode="decimal"
                value={form.values[n.id] ?? ''}
                onChange={(e) => set('values', { ...form.values, [n.id]: e.target.value })}
                aria-label={n.name}
              />
              <span className="muted small">{n.unit}</span>
            </div>
          ))}
          <button className="btn ghost sm mt" onClick={() => setShowMore((s) => !s)}>
            {showMore ? 'Fewer nutrients' : `More vitamins & minerals (${labelNutrients.length - CORE_COUNT})`}
          </button>
          <p className="muted tiny">If calories are blank they are calculated from protein, carbs and fat (4/4/9 kcal per g).</p>
        </div>
      </div>
      <div className="row mt" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={() => navigate(-1)}>
          Cancel
        </button>
        <button className="btn primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          <Icon name="check" size={16} /> {editId ? 'Save changes' : 'Create food'}
        </button>
      </div>
    </>
  )
}
