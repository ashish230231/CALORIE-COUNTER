import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { BarcodeLookup } from '../components/Barcode'
import { FoodRow, FoodSearch } from '../components/FoodSearch'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { useStatus } from '../hooks'

const FILTERS: { key: string; label: string; sources?: string[] }[] = [
  { key: 'all', label: 'All' },
  { key: 'foundation', label: 'Lab-analysed', sources: ['foundation'] },
  { key: 'sr_legacy', label: 'Standard reference', sources: ['sr_legacy'] },
  { key: 'survey', label: 'Dishes (FNDDS)', sources: ['survey'] },
  { key: 'mine', label: 'Mine', sources: ['custom', 'recipe', 'barcode'] },
]

export function FoodsPage() {
  const [filter, setFilter] = useState('all')
  const [scan, setScan] = useState(false)
  const navigate = useNavigate()
  const status = useStatus()
  const mine = useQuery({ queryKey: ['mine'], queryFn: api.myFoods })
  const total = Object.values(status.data?.counts ?? {}).reduce((a, b) => a + (b ?? 0), 0)
  const sources = FILTERS.find((f) => f.key === filter)?.sources

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Foods</h1>
          <div className="muted small">{total ? `${total.toLocaleString()} foods with full nutrient profiles` : ''}</div>
        </div>
        <div className="row wrap">
          <button className="btn" onClick={() => setScan(true)}>
            <Icon name="barcode" size={16} /> Barcode
          </button>
          <Link className="btn" to="/recipes/new">
            <Icon name="book" size={16} /> New recipe
          </Link>
          <Link className="btn primary" to="/foods/new">
            <Icon name="plus" size={16} /> New food
          </Link>
        </div>
      </div>
      <div className="row wrap mb">
        {FILTERS.map((f) => (
          <button key={f.key} className={`toggle-chip${filter === f.key ? ' on' : ''}`} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      <FoodSearch autoFocus sources={sources} onPick={(f) => navigate(`/foods/${f.id}`)} />

      <div className="card flush mt">
        <div className="meal-head">
          <h2>My foods & recipes</h2>
          <span className="muted small">{mine.data?.length ?? 0}</span>
        </div>
        {mine.data?.length ? (
          <div className="list">
            {mine.data.map((f) => (
              <FoodRow key={f.id} food={f} onClick={() => navigate(`/foods/${f.id}`)} />
            ))}
          </div>
        ) : (
          <div className="empty">
            Create custom foods from nutrition labels, build recipes, or scan barcodes. They appear here and rank first in
            search.
          </div>
        )}
      </div>

      <div className="card mt">
        <h2 className="row">
          <Icon name="database" /> Where the data comes from
        </h2>
        <ul className="muted small" style={{ paddingLeft: 18, marginBottom: 0 }}>
          <li>
            <b>Lab-analysed</b>: USDA Foundation Foods, nutrient values measured in accredited labs with documented
            sampling. The most precise data available.
          </li>
          <li>
            <b>Standard reference</b>: USDA SR Legacy, the long-standing national reference with up to 150 nutrients per food.
          </li>
          <li>
            <b>Dishes</b>: USDA FNDDS, about 5,400 foods and mixed dishes as people actually eat them, with realistic portions.
          </li>
          <li>All values are stored per 100 g and scaled exactly to the amount you log. Nothing is rounded until it is displayed.</li>
        </ul>
      </div>

      {scan && (
        <Modal narrow title="Barcode lookup" onClose={() => setScan(false)}>
          <BarcodeLookup onFound={(f) => navigate(`/foods/${f.id}`)} />
        </Modal>
      )}
    </>
  )
}
