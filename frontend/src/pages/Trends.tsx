import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api'
import { TargetBar } from '../components/Nutrients'
import { kcal, kgToLb, num, shiftDate, today } from '../format'
import { useCssVars, useProfile } from '../hooks'

const RANGES = [7, 30, 90, 365]

function shortDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function ChartTooltip({ active, payload, label, unit }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; unit: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="tt">
      <b>{label && shortDate(label)}</b>
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color }}>
          {p.name}: {num(p.value, { digits: 1 })} {unit}
        </div>
      ))}
    </div>
  )
}

export function TrendsPage() {
  const [days, setDays] = useState(30)
  const end = today()
  const start = shiftDate(end, -(days - 1))
  const stats = useQuery({ queryKey: ['stats', start, end], queryFn: () => api.stats(start, end), placeholderData: keepPreviousData })
  const profile = useProfile()
  const c = useCssVars(['--accent', '--accent-2', '--protein', '--carbs', '--fat', '--danger', '--border', '--muted', '--surface-3'])
  const imperial = profile.data?.profile.unit_system === 'imperial'
  const s = stats.data

  // Fill gaps so the x-axis is continuous.
  const series = useMemo(() => {
    if (!s) return []
    const byDate = new Map(s.days.map((d) => [d.date, d]))
    return Array.from({ length: days }, (_, i) => {
      const date = shiftDate(start, i)
      const d = byDate.get(date)
      return { date, kcal: d?.kcal ?? null, protein: d?.protein ?? 0, carbs: d?.carbs ?? 0, fat: d?.fat ?? 0 }
    })
  }, [s, days, start])

  const weights = useMemo(() => {
    if (!s) return []
    const w = s.weights.map((x) => ({ date: x.date, weight: imperial ? kgToLb(x.weight_kg) : x.weight_kg }))
    // 7-entry trailing average smooths daily water fluctuations.
    return w.map((x, i) => {
      const win = w.slice(Math.max(0, i - 6), i + 1)
      return { ...x, trend: win.reduce((a, b) => a + b.weight, 0) / win.length }
    })
  }, [s, imperial])

  if (!s) return <div className="empty"><span className="spinner" style={{ display: 'inline-block' }} /></div>

  const t = s.targets
  const reliable = s.nutrients.filter((n) => n.coverage >= 0.6)
  const low = reliable.filter((n) => n.target.kind === 'min' && (n.pct ?? 0) < 70)
  const over = reliable.filter((n) => n.target.kind === 'max' && (n.pct ?? 0) > 100)
  const weightChange = weights.length > 1 ? weights[weights.length - 1].trend - weights[0].trend : null
  const axis = { stroke: c['--muted'], fontSize: 12, tickLine: false, axisLine: false }

  return (
    <>
      <div className="page-head">
        <h1>Trends</h1>
        <div className="segmented">
          {RANGES.map((r) => (
            <button key={r} className={r === days ? 'on' : ''} onClick={() => setDays(r)}>
              {r === 365 ? '1 year' : `${r} days`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-4">
        <div className="card stat">
          <span className="label">Avg calories</span>
          <span className="value">{kcal(s.averages.kcal)}</span>
          <span className="muted small">target {kcal(t.kcal)}</span>
        </div>
        <div className="card stat">
          <span className="label">Avg protein</span>
          <span className="value">{num(s.averages.protein, { digits: 0 })} g</span>
          <span className="muted small">target {num(t.macros.protein, { digits: 0 })} g</span>
        </div>
        <div className="card stat">
          <span className="label">Days logged</span>
          <span className="value">
            {s.logged_days}/{days}
          </span>
          <span className="muted small">streak {s.streak} day{s.streak === 1 ? '' : 's'}</span>
        </div>
        <div className="card stat">
          <span className="label">Weight trend</span>
          <span className="value">
            {weightChange === null ? '–' : `${weightChange > 0 ? '+' : ''}${num(weightChange, { digits: 1 })}`}
          </span>
          <span className="muted small">{imperial ? 'lb' : 'kg'} over the period</span>
        </div>
      </div>

      {(low.length > 0 || over.length > 0) && (
        <div className="card mt">
          <h2>Insights</h2>
          <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
            {low.length > 0 && (
              <li>
                On average you get less than 70% of your target for <b>{low.map((n) => n.name).join(', ')}</b>.
              </li>
            )}
            {over.length > 0 && (
              <li>
                You average above the recommended limit for <b>{over.map((n) => n.name).join(', ')}</b>.
              </li>
            )}
          </ul>
          <p className="muted tiny" style={{ marginBottom: 0 }}>
            Based on logged days only, and only nutrients measured in at least 60% of the food you logged.
          </p>
        </div>
      )}

      <div className="grid grid-2 mt">
        <div className="card">
          <div className="card-head">
            <h2>Calories</h2>
            <span className="muted small">dashed line = target</span>
          </div>
          <div className="chart-box">
            <ResponsiveContainer>
              <BarChart data={series} margin={{ left: -10, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke={c['--border']} />
                <XAxis dataKey="date" tickFormatter={shortDate} {...axis} minTickGap={24} />
                <YAxis {...axis} />
                <Tooltip content={<ChartTooltip unit="kcal" />} cursor={{ fill: c['--surface-3'], opacity: 0.5 }} />
                <ReferenceLine y={t.kcal} stroke={c['--accent-2']} strokeDasharray="5 5" />
                <Bar dataKey="kcal" name="Calories" fill={c['--accent']} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Macronutrients</h2>
            <span className="muted small">grams per day</span>
          </div>
          <div className="chart-box">
            <ResponsiveContainer>
              <BarChart data={series} margin={{ left: -10, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke={c['--border']} />
                <XAxis dataKey="date" tickFormatter={shortDate} {...axis} minTickGap={24} />
                <YAxis {...axis} />
                <Tooltip content={<ChartTooltip unit="g" />} cursor={{ fill: c['--surface-3'], opacity: 0.5 }} />
                <Bar dataKey="protein" name="Protein" stackId="m" fill={c['--protein']} maxBarSize={28} />
                <Bar dataKey="carbs" name="Carbs" stackId="m" fill={c['--carbs']} maxBarSize={28} />
                <Bar dataKey="fat" name="Fat" stackId="m" fill={c['--fat']} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card mt">
        <div className="card-head">
          <h2>Weight</h2>
          <span className="muted small">dots = weigh-ins · line = 7-entry trend</span>
        </div>
        {weights.length ? (
          <div className="chart-box">
            <ResponsiveContainer>
              <LineChart data={weights} margin={{ left: -10, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke={c['--border']} />
                <XAxis dataKey="date" tickFormatter={shortDate} {...axis} minTickGap={24} />
                <YAxis {...axis} domain={['dataMin - 1', 'dataMax + 1']} tickFormatter={(v: number) => v.toFixed(0)} />
                <Tooltip content={<ChartTooltip unit={imperial ? 'lb' : 'kg'} />} />
                <Line dataKey="weight" name="Weight" stroke={c['--muted']} strokeWidth={0} dot={{ r: 3, fill: c['--muted'] }} isAnimationActive={false} />
                <Line dataKey="trend" name="Trend" stroke={c['--accent']} strokeWidth={3} dot={false} type="monotone" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="empty">Log your weight on the Today page to see your trend.</div>
        )}
      </div>

      <div className="grid grid-2 mt">
        <div className="card">
          <div className="card-head">
            <h2>Average daily nutrients</h2>
            <span className="muted small">lowest first</span>
          </div>
          {s.logged_days ? (
            <table className="ntable">
              <tbody>
                {s.nutrients.map((n) => (
                  <tr key={n.id}>
                    <td>
                      {n.name}
                      {n.coverage < 0.6 && <span className="faint tiny"> · limited data</span>}
                    </td>
                    <td className="r">
                      {num(n.avg)} {n.unit}
                    </td>
                    <td className="r pct-cell">
                      <div className="stack" style={{ gap: 4 }}>
                        <span className="small">{Math.round(n.pct ?? 0)}%</span>
                        <TargetBar amount={n.avg} target={n.target} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">No food logged in this period.</div>
          )}
        </div>
        <div className="card flush">
          <div className="meal-head">
            <h2>Top calorie sources</h2>
          </div>
          {s.top_foods.length ? (
            <div className="list">
              {s.top_foods.map((f) => (
                <div key={f.id} className="list-item" style={{ cursor: 'default' }}>
                  <div className="grow">
                    <div className="title">{f.description}</div>
                    <div className="sub">
                      {f.times}× · {num(f.grams)} g total · {num(f.protein, { digits: 0 })} g protein
                    </div>
                  </div>
                  <div className="right">
                    <b>{kcal(f.kcal)}</b> <span className="muted small">kcal</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">Nothing yet.</div>
          )}
        </div>
      </div>
    </>
  )
}
