import { Fragment } from 'react'
import { num } from '../format'
import type { Target } from '../types'

export interface NutrientRow {
  id: number
  name: string
  unit: string
  group: string
  amount: number
  target?: Target | null
  coverage?: number
}

const COVERAGE_OK = 0.95

function barColor(target: Target, pct: number) {
  if (target.kind === 'max') return pct > 100 ? 'var(--danger)' : pct > 80 ? 'var(--warn)' : 'var(--accent-2)'
  return pct >= 100 ? 'var(--ok)' : 'var(--accent)'
}

export function coverageNote(coverage: number) {
  return `Only ${Math.round(coverage * 100)}% of the food (by weight) has a measured value for this nutrient, so the true total is likely higher.`
}

function Amount({ row }: { row: NutrientRow }) {
  const partial = row.coverage !== undefined && row.coverage < COVERAGE_OK
  return (
    <span title={partial ? coverageNote(row.coverage!) : undefined}>
      {partial && row.amount > 0 && <span className="warn-text">≥ </span>}
      {num(row.amount)} {row.unit}
    </span>
  )
}

export function TargetBar({ amount, target }: { amount: number; target: Target }) {
  const pct = (amount / target.value) * 100
  return (
    <div className="bar thin">
      <i style={{ width: `${Math.min(pct, 100)}%`, background: barColor(target, pct) }} />
    </div>
  )
}

/** Grouped, complete nutrient table. */
export function NutrientTable({ rows, showCoverage }: { rows: NutrientRow[]; showCoverage?: boolean }) {
  let lastGroup = ''
  return (
    <table className="ntable">
      <thead>
        <tr>
          <th>Nutrient</th>
          <th className="r">Amount</th>
          <th className="r pct-cell">Daily target</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const header = r.group !== lastGroup
          lastGroup = r.group
          const pct = r.target ? (r.amount / r.target.value) * 100 : null
          return (
            <Fragment key={r.id}>
              {header && (
                <tr className="group">
                  <td colSpan={3}>{r.group}</td>
                </tr>
              )}
              <tr>
                <td>
                  {r.name}
                  {showCoverage && r.coverage !== undefined && r.coverage < COVERAGE_OK && r.amount > 0 && (
                    <span className="faint tiny"> · {Math.round(r.coverage * 100)}% data</span>
                  )}
                </td>
                <td className="r">
                  <Amount row={r} />
                </td>
                <td className="r pct-cell">
                  {r.target && pct !== null ? (
                    <div className="stack" style={{ gap: 4 }}>
                      <span className="small">
                        {Math.round(pct)}% {r.target.kind === 'max' ? 'of limit' : ''}
                      </span>
                      <TargetBar amount={r.amount} target={r.target} />
                    </div>
                  ) : (
                    <span className="faint">–</span>
                  )}
                </td>
              </tr>
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

/** Compact grid of nutrients that have a daily target. */
export function NutrientGrid({ rows }: { rows: NutrientRow[] }) {
  return (
    <div className="nutrient-grid">
      {rows
        .filter((r) => r.target)
        .map((r) => {
          const pct = (r.amount / r.target!.value) * 100
          return (
            <div className="nutrient" key={r.id}>
              <div className="top">
                <span>{r.name}</span>
                <span>
                  <Amount row={r} /> · {Math.round(pct)}%{r.target!.kind === 'max' ? ' of max' : ''}
                </span>
              </div>
              <TargetBar amount={r.amount} target={r.target!} />
            </div>
          )
        })}
    </div>
  )
}
