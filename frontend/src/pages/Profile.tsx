import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { useToast } from '../components/Toast'
import { kcal, kgToLb, lbToKg, num, today } from '../format'
import { useProfile } from '../hooks'
import type { ActivityLevel, Profile } from '../types'

const ACTIVITY: { key: ActivityLevel; label: string; hint: string }[] = [
  { key: 'sedentary', label: 'Sedentary', hint: 'Desk job, little exercise' },
  { key: 'light', label: 'Light', hint: 'Exercise 1–3 days/week' },
  { key: 'moderate', label: 'Moderate', hint: 'Exercise 3–5 days/week' },
  { key: 'active', label: 'Active', hint: 'Hard exercise 6–7 days/week' },
  { key: 'very_active', label: 'Very active', hint: 'Physical job + training' },
]

const PRESETS = [
  { label: 'Balanced', p: 25, c: 50, f: 25 },
  { label: 'High protein', p: 35, c: 40, f: 25 },
  { label: 'Low carb', p: 30, c: 20, f: 50 },
  { label: 'Keto', p: 20, c: 5, f: 75 },
]

export function ProfilePage() {
  const profile = useProfile()
  const qc = useQueryClient()
  const toast = useToast()
  const [form, setForm] = useState<Profile | null>(null)
  const [weight, setWeight] = useState('')
  const [height, setHeight] = useState('')

  const imperial = form?.unit_system === 'imperial'
  useEffect(() => {
    if (!profile.data) return
    const p = profile.data.profile
    setForm(p)
    const imp = p.unit_system === 'imperial'
    setHeight(p.height_cm ? (imp ? p.height_cm / 2.54 : p.height_cm).toFixed(imp ? 1 : 0) : '')
    setWeight(profile.data.weight_kg ? (imp ? kgToLb(profile.data.weight_kg) : profile.data.weight_kg).toFixed(1) : '')
  }, [profile.data])

  const save = useMutation({
    mutationFn: async () => {
      const w = parseFloat(weight)
      const currentKg = profile.data?.weight_kg
      const kg = imperial ? lbToKg(w) : w
      if (w > 0 && (!currentKg || Math.abs(kg - currentKg) > 0.05)) await api.setWeight(today(), kg)
      const h = parseFloat(height)
      return api.saveProfile({ ...form!, height_cm: h > 0 ? (imperial ? h * 2.54 : h) : null })
    },
    onSuccess: (data) => {
      qc.setQueryData(['profile'], data)
      for (const k of ['day', 'stats']) qc.invalidateQueries({ queryKey: [k] })
      toast('Profile saved')
    },
    onError: (e: Error) => toast(e.message, true),
  })

  if (!form || !profile.data) return <div className="empty"><span className="spinner" style={{ display: 'inline-block' }} /></div>
  const t = profile.data.targets
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setForm({ ...form, [k]: v })
  const macroSum = form.protein_pct + form.carbs_pct + form.fat_pct
  const weightKg = profile.data.weight_kg

  const switchUnits = (unit: Profile['unit_system']) => {
    if (unit === form.unit_system) return
    const h = parseFloat(height)
    const w = parseFloat(weight)
    if (h > 0) setHeight((unit === 'imperial' ? h / 2.54 : h * 2.54).toFixed(unit === 'imperial' ? 1 : 0))
    if (w > 0) setWeight((unit === 'imperial' ? kgToLb(w) : lbToKg(w)).toFixed(1))
    set('unit_system', unit)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Profile & goals</h1>
          <div className="muted small">Used to compute your energy needs and nutrient targets. Stored only on this machine.</div>
        </div>
        <button className="btn primary" disabled={save.isPending || Math.abs(macroSum - 100) > 0.5} onClick={() => save.mutate()}>
          <Icon name="check" size={16} /> Save
        </button>
      </div>

      <div className="grid summary-grid">
        <div className="stack" style={{ gap: 16 }}>
          <div className="card stack">
            <div className="row spread">
              <h2>Body</h2>
              <div className="segmented">
                <button className={!imperial ? 'on' : ''} onClick={() => switchUnits('metric')}>
                  Metric
                </button>
                <button className={imperial ? 'on' : ''} onClick={() => switchUnits('imperial')}>
                  Imperial
                </button>
              </div>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Name</span>
                <input className="input" value={form.name ?? ''} onChange={(e) => set('name', e.target.value || null)} />
              </label>
              <label className="field">
                <span>Sex (for energy equations)</span>
                <select className="select" value={form.sex ?? ''} onChange={(e) => set('sex', (e.target.value || null) as Profile['sex'])}>
                  <option value="">Select…</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                </select>
              </label>
              <label className="field">
                <span>Birth date</span>
                <input className="input" type="date" value={form.birth_date ?? ''} onChange={(e) => set('birth_date', e.target.value || null)} />
              </label>
              <label className="field">
                <span>Height ({imperial ? 'in' : 'cm'})</span>
                <input className="input num" inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} />
              </label>
              <label className="field">
                <span>Current weight ({imperial ? 'lb' : 'kg'})</span>
                <input className="input num" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
              </label>
            </div>
          </div>

          <div className="card stack">
            <h2>Activity</h2>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
              {ACTIVITY.map((a) => (
                <button
                  key={a.key}
                  className={`toggle-chip${form.activity_level === a.key ? ' on' : ''}`}
                  style={{ height: 'auto', padding: '10px 12px', borderRadius: 12, textAlign: 'left' }}
                  onClick={() => set('activity_level', a.key)}
                >
                  <div>{a.label}</div>
                  <div className="tiny" style={{ fontWeight: 500 }}>
                    {a.hint}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="card stack">
            <h2>Goal</h2>
            <div className="segmented" style={{ alignSelf: 'flex-start' }}>
              {(['lose', 'maintain', 'gain'] as const).map((g) => (
                <button key={g} className={form.goal === g ? 'on' : ''} onClick={() => set('goal', g)}>
                  {g === 'lose' ? 'Lose weight' : g === 'gain' ? 'Gain weight' : 'Maintain'}
                </button>
              ))}
            </div>
            {form.goal !== 'maintain' && (
              <label className="field">
                <span>
                  Rate: {imperial ? `${num(kgToLb(form.goal_rate_kg_per_week), { digits: 1 })} lb` : `${form.goal_rate_kg_per_week} kg`} per week
                  ({kcal((form.goal_rate_kg_per_week * 7700) / 7)} kcal/day {form.goal === 'lose' ? 'deficit' : 'surplus'})
                </span>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={form.goal_rate_kg_per_week}
                  onChange={(e) => set('goal_rate_kg_per_week', parseFloat(e.target.value))}
                  style={{ accentColor: 'var(--accent)' }}
                />
              </label>
            )}
            <label className="field" style={{ maxWidth: 260 }}>
              <span>Manual calorie target (optional)</span>
              <input
                className="input num"
                inputMode="decimal"
                placeholder="auto"
                value={form.calorie_target_override ?? ''}
                onChange={(e) => set('calorie_target_override', parseFloat(e.target.value) > 0 ? parseFloat(e.target.value) : null)}
              />
            </label>
          </div>

          <div className="card stack">
            <div className="row spread">
              <h2>Macro split</h2>
              <span className={`small ${Math.abs(macroSum - 100) > 0.5 ? 'danger-text' : 'muted'}`}>total {num(macroSum, { digits: 0 })}%</span>
            </div>
            <div className="row wrap">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  className={`toggle-chip${form.protein_pct === p.p && form.carbs_pct === p.c && form.fat_pct === p.f ? ' on' : ''}`}
                  onClick={() => setForm({ ...form, protein_pct: p.p, carbs_pct: p.c, fat_pct: p.f })}
                >
                  {p.label} {p.p}/{p.c}/{p.f}
                </button>
              ))}
            </div>
            <div className="form-grid">
              {(
                [
                  ['protein_pct', 'Protein %', 'var(--protein)'],
                  ['carbs_pct', 'Carbs %', 'var(--carbs)'],
                  ['fat_pct', 'Fat %', 'var(--fat)'],
                ] as const
              ).map(([k, label, color]) => (
                <label className="field" key={k}>
                  <span>
                    <i className="dot" style={{ background: color }} />
                    {label}
                  </span>
                  <input className="input num" inputMode="decimal" value={form[k]} onChange={(e) => set(k, parseFloat(e.target.value) || 0)} />
                </label>
              ))}
            </div>
            <label className="field" style={{ maxWidth: 260 }}>
              <span>Water target (ml)</span>
              <input className="input num" inputMode="decimal" value={form.water_target_ml} onChange={(e) => set('water_target_ml', parseFloat(e.target.value) || 0)} />
            </label>
          </div>
        </div>

        <div className="stack">
          <div className="card stack" style={{ position: 'sticky', top: 20 }}>
            <h2>Your daily targets</h2>
            {t.profile_complete ? (
              <div className="grid grid-2" style={{ gap: 12 }}>
                <div className="stat">
                  <span className="label">BMR</span>
                  <span className="value">{kcal(t.bmr)}</span>
                </div>
                <div className="stat">
                  <span className="label">Maintenance</span>
                  <span className="value">{kcal(t.tdee)}</span>
                </div>
              </div>
            ) : (
              <div className="notice">Fill in sex, birth date, height and weight for personalised targets.</div>
            )}
            <div className="stat">
              <span className="label">Calorie target</span>
              <span className="value" style={{ fontSize: '2.2rem', color: 'var(--accent)' }}>
                {kcal(t.kcal)}
              </span>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <div className="row spread small">
                <span>
                  <i className="dot" style={{ background: 'var(--protein)' }} />
                  Protein
                </span>
                <b className="num">
                  {num(t.macros.protein, { digits: 0 })} g
                  {weightKg ? <span className="muted"> · {num(t.macros.protein / weightKg, { digits: 1 })} g/kg</span> : null}
                </b>
              </div>
              <div className="row spread small">
                <span>
                  <i className="dot" style={{ background: 'var(--carbs)' }} />
                  Carbs
                </span>
                <b className="num">{num(t.macros.carbs, { digits: 0 })} g</b>
              </div>
              <div className="row spread small">
                <span>
                  <i className="dot" style={{ background: 'var(--fat)' }} />
                  Fat
                </span>
                <b className="num">{num(t.macros.fat, { digits: 0 })} g</b>
              </div>
            </div>
            {t.warnings.map((w) => (
              <div className="notice warn" key={w}>
                {w}
              </div>
            ))}
            <p className="muted tiny" style={{ margin: 0 }}>
              Energy: Mifflin-St Jeor equation × activity factor, adjusted by 7,700 kcal per kg of weight change.
              Micronutrients: {t.basis}. Saved values update after you press Save. This is not medical advice.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
