import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { SOURCE_LABELS, kcal, num } from '../format'
import { useDebounced } from '../hooks'
import type { FoodHit } from '../types'
import { Icon } from './Icon'

export function SourceChip({ source }: { source: FoodHit['source'] }) {
  return (
    <span className={`chip ${source}`} title={SOURCE_LABELS[source].long}>
      {SOURCE_LABELS[source].short}
    </span>
  )
}

export function FoodRow({ food, active, onClick, right }: { food: FoodHit; active?: boolean; onClick: () => void; right?: React.ReactNode }) {
  const p = food.portion
  const per = p ? `${p.label} (${num(p.grams)} g)` : '100 g'
  const portionKcal = food.kcal === null ? null : p ? (food.kcal * p.grams) / 100 : food.kcal
  return (
    <div className={`list-item${active ? ' active' : ''}`} onClick={onClick} role="option" aria-selected={active}>
      <div className="grow">
        <div className="title">{food.description}</div>
        <div className="sub">
          {food.brand ? `${food.brand} · ` : ''}
          {per}
        </div>
      </div>
      <SourceChip source={food.source} />
      <div className="right" style={{ minWidth: 64 }}>
        {right ?? (
          <>
            <div>
              <b>{kcal(portionKcal)}</b> <span className="muted small">kcal</span>
            </div>
            {food.kcal_source === 'estimated' && <div className="tiny warn-text">estimated</div>}
          </>
        )}
      </div>
    </div>
  )
}

interface Props {
  onPick: (food: FoodHit) => void
  autoFocus?: boolean
  sources?: string[]
  placeholder?: string
  initialQuery?: string
  onQueryChange?: (q: string) => void
}

export function FoodSearch({ onPick, autoFocus, sources, placeholder, initialQuery = '', onQueryChange }: Props) {
  const [query, setQuery] = useState(initialQuery)
  const [active, setActive] = useState(0)
  const q = useDebounced(query.trim(), 140)
  const listRef = useRef<HTMLDivElement>(null)
  const results = useQuery({
    queryKey: ['search', q, sources?.join(',')],
    queryFn: () => api.search(q, sources),
    enabled: q.length > 0,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  })
  const hits = q ? results.data ?? [] : []

  useEffect(() => setActive(0), [q])
  useEffect(() => {
    listRef.current?.querySelector('.list-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, hits.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' && hits[active]) {
      e.preventDefault()
      onPick(hits[active])
    }
  }

  return (
    <div className="stack">
      <div className="search-box">
        <Icon name="search" />
        <input
          className="input"
          value={query}
          autoFocus={autoFocus}
          placeholder={placeholder ?? 'Search 13,000+ foods: "greek yogurt", "brocoli", "rice cooked"…'}
          onChange={(e) => {
            setQuery(e.target.value)
            onQueryChange?.(e.target.value)
          }}
          onKeyDown={onKey}
          aria-label="Search foods"
        />
        {results.isFetching && <div className="spinner" style={{ position: 'absolute', right: 14, top: 14 }} />}
      </div>
      {q && (
        <div className="card flush" ref={listRef} role="listbox">
          {hits.length ? (
            <div className="list" style={{ maxHeight: 420, overflow: 'auto' }}>
              {hits.map((h, i) => (
                <FoodRow key={h.id} food={h} active={i === active} onClick={() => onPick(h)} />
              ))}
            </div>
          ) : (
            !results.isFetching && <div className="empty">No foods match “{q}”. Try fewer words, or create a custom food.</div>
          )}
        </div>
      )}
    </div>
  )
}
