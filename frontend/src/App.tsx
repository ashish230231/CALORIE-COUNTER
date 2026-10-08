import { Suspense, lazy } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import { BrandMark, Icon } from './components/Icon'
import { useStatus, useTheme } from './hooks'
import { DiaryPage } from './pages/Diary'
import { FoodDetailPage } from './pages/FoodDetail'
import { FoodFormPage } from './pages/FoodForm'
import { FoodsPage } from './pages/Foods'
import { ProfilePage } from './pages/Profile'
import { RecipeFormPage } from './pages/RecipeForm'
import { SettingsPage } from './pages/Settings'

// Charts are only needed on Trends, so the charting library loads on demand.
const TrendsPage = lazy(() => import('./pages/Trends').then((m) => ({ default: m.TrendsPage })))

const NAV = [
  { to: '/', label: 'Today', icon: 'today' },
  { to: '/foods', label: 'Foods', icon: 'search' },
  { to: '/trends', label: 'Trends', icon: 'chart' },
  { to: '/profile', label: 'Profile', icon: 'user' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

function NavLinks() {
  return (
    <>
      {NAV.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          <Icon name={n.icon} size={19} />
          <span>{n.label}</span>
        </NavLink>
      ))}
    </>
  )
}

function ImportBanner() {
  const status = useStatus()
  const s = status.data
  if (!s) return null
  const active = s.datasets.find((d) => !['done', 'error', 'pending', 'skipped'].includes(d.status))
  const failed = s.datasets.filter((d) => d.status === 'error')
  const empty = !Object.values(s.counts).some(Boolean)
  if (active) {
    const done = s.datasets.filter((d) => d.status === 'done').length
    return (
      <div className="banner">
        <span className="spinner" />
        <div className="grow stack" style={{ gap: 6 }}>
          <div className="small">
            <b>Setting up the food database</b> ({done + 1}/{s.datasets.length}): {active.message || active.status}… This
            only happens once.
          </div>
          <div className="bar thin">
            <i style={{ width: `${((done + active.progress) / s.datasets.length) * 100}%` }} />
          </div>
        </div>
      </div>
    )
  }
  if (failed.length) {
    return (
      <div className="banner warn">
        <Icon name="info" />
        <span className="grow small">
          {failed.length === s.datasets.length || empty ? 'The USDA food database could not be loaded' : 'Some USDA data could not be loaded'}.
          See Settings for details. Custom foods and barcode lookups still work.
        </span>
        <NavLink className="btn sm" to="/settings">
          Details
        </NavLink>
      </div>
    )
  }
  return null
}

export default function App() {
  const [theme, setTheme] = useTheme()
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark /> Calorie Counter
        </div>
        <NavLinks />
        <div className="sidebar-foot">
          Self-hosted · your data stays on this machine
          <br />
          Nutrient data: USDA FoodData Central
        </div>
      </aside>
      <main className="main">
        <ImportBanner />
        <Routes>
          <Route path="/" element={<DiaryPage />} />
          <Route path="/foods" element={<FoodsPage />} />
          <Route path="/foods/new" element={<FoodFormPage />} />
          <Route path="/foods/:id" element={<FoodDetailPage />} />
          <Route path="/foods/:id/edit" element={<FoodFormPage />} />
          <Route path="/recipes/new" element={<RecipeFormPage />} />
          <Route path="/recipes/:id/edit" element={<RecipeFormPage />} />
          <Route
            path="/trends"
            element={
              <Suspense fallback={<div className="empty"><span className="spinner" style={{ display: 'inline-block' }} /></div>}>
                <TrendsPage />
              </Suspense>
            }
          />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage theme={theme} setTheme={setTheme} />} />
          <Route path="*" element={<div className="empty">Page not found.</div>} />
        </Routes>
      </main>
      <nav className="bottom-nav">
        <NavLinks />
      </nav>
    </div>
  )
}
