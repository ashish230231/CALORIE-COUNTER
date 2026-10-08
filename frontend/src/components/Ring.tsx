import type { ReactNode } from 'react'

interface Props {
  value: number
  target: number
  size?: number
  stroke?: number
  children?: ReactNode
}

/** Progress ring; overshoot past the target is drawn as a second lap in the danger colour. */
export function Ring({ value, target, size = 196, stroke = 16, children }: Props) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const ratio = target > 0 ? value / target : 0
  const main = Math.min(ratio, 1)
  const over = Math.min(Math.max(ratio - 1, 0), 1)
  const circle = { cx: size / 2, cy: size / 2, r, fill: 'none', strokeWidth: stroke }
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--accent)' }} />
            <stop offset="1" style={{ stopColor: 'var(--accent-2)' }} />
          </linearGradient>
        </defs>
        <circle {...circle} style={{ stroke: 'var(--surface-3)' }} />
        <circle
          {...circle}
          stroke="url(#ring-grad)"
          strokeLinecap="round"
          strokeDasharray={`${main * c} ${c}`}
          style={{ transition: 'stroke-dasharray .6s cubic-bezier(.2,.8,.2,1)' }}
        />
        {over > 0 && (
          <circle {...circle} strokeLinecap="round" strokeDasharray={`${over * c} ${c}`} style={{ stroke: 'var(--danger)' }} />
        )}
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  )
}

export function MacroBar({ label, value, target, color, unit = 'g' }: { label: string; value: number; target: number; color: string; unit?: string }) {
  const pct = target > 0 ? (value / target) * 100 : 0
  return (
    <div className="macro">
      <div className="macro-top">
        <span>
          <i className="dot" style={{ background: color }} />
          <b>{label}</b>
        </span>
        <span className="num">
          <b>{Math.round(value)}</b>
          <span className="muted">
            {' '}
            / {Math.round(target)} {unit}
          </span>
        </span>
      </div>
      <div className="bar">
        <i style={{ width: `${Math.min(pct, 100)}%`, background: pct > 110 ? 'var(--danger)' : color }} />
      </div>
    </div>
  )
}
