import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { FoodSearch } from '../components/FoodSearch'
import { Icon } from '../components/Icon'
import { MacroPreview, PortionPicker, usePortion } from '../components/Portion'
import { useToast } from '../components/Toast'
import { amountLabel, kcal, num } from '../format'
import type { FoodDetail } from '../types'

interface Ingredient {
  food: Pick<FoodDetail, 'id' | 'description' | 'kcal' | 'protein' | 'carbs' | 'fat'>
  grams: number
  quantity: number
  unit_label: string
}

function IngredientPicker({ foodId, onAdd, onCancel }: { foodId: number; onAdd: (i: Ingredient) => void; onCancel: () => void }) {
  const food = useQuery({ queryKey: ['food', foodId], queryFn: () => api.food(foodId) })
  const portion = usePortion(food.data)
  if (!food.data) return <div className="spinner" />
  const add = () => portion.valid && onAdd({ food: food.data!, grams: portion.grams, quantity: portion.qty, unit_label: portion.unit.label })
  return (
    <div className="card stack" style={{ background: 'var(--surface-2)' }}>
      <b>{food.data.description}</b>
      <PortionPicker state={portion} autoFocus onEnter={add} />
      <MacroPreview food={food.data} grams={portion.grams} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" disabled={!portion.valid} onClick={add}>
          Add ingredient
        </button>
      </div>
    </div>
  )
}

export function RecipeFormPage() {
  const params = useParams()
  const editId = params.id ? Number(params.id) : null
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const existing = useQuery({ queryKey: ['food', editId], queryFn: () => api.food(editId!), enabled: editId !== null })

  const [name, setName] = useState('')
  const [servings, setServings] = useState('4')
  const [cooked, setCooked] = useState('')
  const [notes, setNotes] = useState('')
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [picking, setPicking] = useState<number | null>(null)
  const [searchKey, setSearchKey] = useState(0)

  useEffect(() => {
    const f = existing.data
    if (!f?.recipe) return
    setName(f.description)
    setServings(String(f.recipe.servings))
    setCooked(f.recipe.cooked_grams ? String(f.recipe.cooked_grams) : '')
    setNotes(f.recipe.notes ?? '')
    // Per-100 g values of each ingredient are needed for the live totals.
    Promise.all(f.recipe.ingredients.map((i) => api.food(i.food_id))).then((foods) =>
      setIngredients(f.recipe!.ingredients.map((i, idx) => ({ food: foods[idx], grams: i.grams, quantity: i.quantity, unit_label: i.unit_label }))),
    )
  }, [existing.data])

  const rawGrams = ingredients.reduce((a, i) => a + i.grams, 0)
  const finalGrams = parseFloat(cooked) > 0 ? parseFloat(cooked) : rawGrams
  const total = (k: 'kcal' | 'protein' | 'carbs' | 'fat') => ingredients.reduce((a, i) => a + ((i.food[k] ?? 0) * i.grams) / 100, 0)
  const nServ = parseFloat(servings) > 0 ? parseFloat(servings) : 1
  const perServing = { kcal: total('kcal') / nServ, protein: total('protein') / nServ, carbs: total('carbs') / nServ, fat: total('fat') / nServ }

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        servings: nServ,
        cooked_grams: parseFloat(cooked) > 0 ? parseFloat(cooked) : null,
        notes: notes.trim() || null,
        ingredients: ingredients.map((i) => ({ food_id: i.food.id, grams: i.grams, quantity: i.quantity, unit_label: i.unit_label })),
      }
      return editId ? api.updateRecipe(editId, body) : api.createRecipe(body)
    },
    onSuccess: (food) => {
      for (const k of ['mine', 'search', 'day']) qc.invalidateQueries({ queryKey: [k] })
      toast(editId ? 'Recipe updated' : 'Recipe created')
      navigate(`/foods/${food.id}`, { replace: true })
    },
    onError: (e: Error) => toast(e.message, true),
  })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{editId ? 'Edit recipe' : 'New recipe'}</h1>
          <div className="muted small">Nutrients are summed exactly from every ingredient's full profile.</div>
        </div>
      </div>
      <div className="grid summary-grid">
        <div className="stack">
          <div className="card stack">
            <label className="field">
              <span>Recipe name *</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Overnight oats" />
            </label>
            <div className="form-grid">
              <label className="field">
                <span>Servings *</span>
                <input className="input num" inputMode="decimal" value={servings} onChange={(e) => setServings(e.target.value)} />
              </label>
              <label className="field">
                <span>Cooked weight, g (optional)</span>
                <input className="input num" inputMode="decimal" value={cooked} onChange={(e) => setCooked(e.target.value)} placeholder={rawGrams ? num(rawGrams) : ''} />
              </label>
            </div>
            <div className="notice">
              <Icon name="info" size={14} /> Weigh the finished dish for best precision: cooking changes water content, not
              nutrients, so per-gram values are recalculated from the cooked weight.
            </div>
          </div>
          <div className="card stack">
            <h2>Ingredients</h2>
            {ingredients.length > 0 && (
              <div className="card flush">
                <div className="list">
                  {ingredients.map((i, idx) => (
                    <div key={idx} className="list-item" style={{ cursor: 'default' }}>
                      <div className="grow">
                        <div className="title">{i.food.description}</div>
                        <div className="sub">
                          {amountLabel(i.quantity, i.unit_label)} · {num(i.grams)} g
                        </div>
                      </div>
                      <div className="right">{kcal(((i.food.kcal ?? 0) * i.grams) / 100)} kcal</div>
                      <button className="btn ghost icon sm" onClick={() => setIngredients(ingredients.filter((_, j) => j !== idx))} aria-label="Remove">
                        <Icon name="x" size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {picking !== null ? (
              <IngredientPicker
                foodId={picking}
                onCancel={() => setPicking(null)}
                onAdd={(i) => {
                  setIngredients([...ingredients, i])
                  setPicking(null)
                  setSearchKey((k) => k + 1)
                }}
              />
            ) : (
              <FoodSearch key={searchKey} placeholder="Search for an ingredient…" onPick={(f) => setPicking(f.id)} />
            )}
          </div>
          <div className="card">
            <label className="field">
              <span>Notes</span>
              <textarea className="input" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Method, tips…" />
            </label>
          </div>
        </div>
        <div className="stack">
          <div className="card stack" style={{ position: 'sticky', top: 20 }}>
            <h2>Per serving</h2>
            <MacroPreview food={{ kcal: perServing.kcal, protein: perServing.protein, carbs: perServing.carbs, fat: perServing.fat }} grams={100} />
            <div className="muted small num">
              Serving = {num(finalGrams / nServ)} g · whole recipe {kcal(total('kcal'))} kcal, {num(finalGrams)} g
            </div>
            <button className="btn primary" disabled={!name.trim() || !ingredients.length || save.isPending} onClick={() => save.mutate()}>
              <Icon name="check" size={16} /> {editId ? 'Save recipe' : 'Create recipe'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
