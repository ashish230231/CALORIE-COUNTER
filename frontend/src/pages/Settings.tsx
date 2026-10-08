import { useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { useToast } from '../components/Toast'
import { type ThemePref, useStatus } from '../hooks'
import type { DatasetStatus } from '../types'

const DATASET_NAMES: Record<string, string> = {
  foundation: 'USDA Foundation Foods',
  sr_legacy: 'USDA SR Legacy',
  survey: 'USDA FNDDS (Survey)',
}

function DatasetRow({ d }: { d: DatasetStatus }) {
  const busy = !['done', 'error', 'pending', 'skipped'].includes(d.status)
  return (
    <div className="list-item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
      <div className="grow stack" style={{ gap: 6 }}>
        <div className="row">
          <b>{DATASET_NAMES[d.dataset] ?? d.dataset}</b>
          <span className="chip">{d.version}</span>
          {d.status === 'done' && <span className="chip foundation">ready</span>}
          {d.status === 'error' && <span className="chip warn">failed</span>}
          {busy && <span className="chip barcode">{d.status}</span>}
        </div>
        {busy && (
          <div className="bar thin">
            <i style={{ width: `${Math.round(d.progress * 100)}%` }} />
          </div>
        )}
        {d.message && <div className={`small ${d.status === 'error' ? 'warn-text' : 'muted'}`}>{d.message}</div>}
        {d.imported_at && d.status === 'done' && (
          <div className="faint tiny">imported {new Date(d.imported_at).toLocaleString()}</div>
        )}
      </div>
      <div className="right">
        <b>{d.foods.toLocaleString()}</b> <span className="muted small">foods</span>
      </div>
    </div>
  )
}

export function SettingsPage({ theme, setTheme }: { theme: ThemePref; setTheme: (t: ThemePref) => void }) {
  const status = useStatus()
  const qc = useQueryClient()
  const toast = useToast()
  const file = useRef<HTMLInputElement>(null)

  const reimport = useMutation({
    mutationFn: (force: boolean) => api.startImport(force),
    onSuccess: (r) => {
      toast(r.started ? 'Import started' : 'An import is already running')
      qc.invalidateQueries({ queryKey: ['status'] })
    },
  })
  const restore = useMutation({
    mutationFn: async (f: File) => api.restore(JSON.parse(await f.text())),
    onSuccess: (r) => {
      qc.invalidateQueries()
      const skipped = r.skipped_diary ? ` (${r.skipped_diary} entries skipped: their foods are not in this database yet)` : ''
      toast(`Restored ${r.diary} diary entries, ${r.foods} foods, ${r.weights} weigh-ins${skipped}`)
    },
    onError: (e: Error) => toast(e instanceof SyntaxError ? 'That file is not valid JSON' : e.message, true),
  })

  const s = status.data
  const hasError = s?.datasets.some((d) => d.status === 'error')

  return (
    <>
      <div className="page-head">
        <h1>Settings & data</h1>
      </div>

      <div className="grid grid-2">
        <div className="card stack">
          <h2>Appearance</h2>
          <div className="segmented" style={{ alignSelf: 'flex-start' }}>
            {(['system', 'light', 'dark'] as ThemePref[]).map((t) => (
              <button key={t} className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>
                <span className="row" style={{ gap: 6 }}>
                  <Icon name={t === 'dark' ? 'moon' : t === 'light' ? 'sun' : 'settings'} size={14} />
                  {t[0].toUpperCase() + t.slice(1)}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="card stack">
          <h2>Backups</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Everything is stored in a Postgres database on this machine, in a Docker volume that survives restarts and
            upgrades. The <b>backup</b> service also writes a full database dump to the <code>backups/</code> folder every day.
          </p>
          <div className="row wrap">
            <a className="btn primary" href="/api/system/export" download>
              <Icon name="download" size={16} /> Export my data (JSON)
            </a>
            <button className="btn" onClick={() => file.current?.click()} disabled={restore.isPending}>
              <Icon name="upload" size={16} /> {restore.isPending ? 'Restoring…' : 'Restore from JSON'}
            </button>
            <input
              ref={file}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) restore.mutate(f)
                e.target.value = ''
              }}
            />
          </div>
          <p className="faint tiny" style={{ margin: 0 }}>
            Restores merge into the current data and never duplicate entries. The export contains your profile, diary,
            weights, water, custom foods and recipes.
          </p>
        </div>
      </div>

      <div className="card flush mt">
        <div className="meal-head">
          <h2 className="row">
            <Icon name="database" /> Food databases
          </h2>
          {s && (
            <span className="muted small">
              {Object.values(s.counts)
                .reduce((a, b) => a + (b ?? 0), 0)
                .toLocaleString()}{' '}
              foods · {s.diary_entries.toLocaleString()} diary entries
            </span>
          )}
          <button className="btn sm" disabled={s?.importing || reimport.isPending} onClick={() => reimport.mutate(!hasError)}>
            <Icon name="refresh" size={14} /> {hasError ? 'Retry import' : 'Re-import'}
          </button>
        </div>
        <div className="list">{s?.datasets.map((d) => <DatasetRow key={d.dataset} d={d} />)}</div>
        <div className="notice" style={{ margin: 16 }}>
          Data from USDA FoodData Central (public domain), imported with every nutrient USDA publishes: up to 150+ per
          food, including vitamins, minerals, fatty acids and amino acids. Barcode lookups use Open Food Facts (ODbL)
          {s && !s.openfoodfacts ? ', which is currently disabled' : ''}.
        </div>
      </div>

      <div className="card mt">
        <h2>Keyboard shortcuts</h2>
        <div className="form-grid mt small">
          <div>
            <span className="kbd">/</span> or <span className="kbd">a</span> Add food
          </div>
          <div>
            <span className="kbd">←</span> <span className="kbd">→</span> Previous / next day
          </div>
          <div>
            <span className="kbd">↑</span> <span className="kbd">↓</span> <span className="kbd">Enter</span> Pick a search result
          </div>
          <div>
            <span className="kbd">Enter</span> Log the selected amount
          </div>
          <div>
            <span className="kbd">Esc</span> Close dialog
          </div>
        </div>
      </div>
    </>
  )
}
