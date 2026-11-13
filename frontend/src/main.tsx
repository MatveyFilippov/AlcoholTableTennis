import { lazy, StrictMode, Suspense, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router'
import { api } from './api'
import type { State } from './api'
import { MatchEntry } from './match-entry'
import { Alcohol, Matches, Overview, Players } from './pages'
import { Empty, Header, Notice } from './ui'
import './style.css'

const Analytics = lazy(() => import('./analytics').then(m => ({ default: m.Analytics })))
const PlayerPage = lazy(() => import('./analytics').then(m => ({ default: m.PlayerPage })))
const AdminPage = lazy(() => import('./admin').then(m => ({ default: m.AdminPage })))
const navigation = [['/', 'Обзор'], ['/matches', 'Матчи'], ['/players', 'Игроки'],
  ['/alcohol', 'Алкоголь'], ['/analytics', 'Аналитика']]

function App() {
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState('')
  const { pathname } = useLocation()
  const refresh = useCallback(async () => {
    try {
      const data = await api<State>('/state')
      setState(old => {
        if (!old) return data
        const [seq, rev] = old.projection_version.split('.').map(Number)
        const [nextSeq, nextRev] = data.projection_version.split('.').map(Number)
        return nextSeq < seq || nextRev < rev ? old : data
      })
      setError('')
      return data
    } catch (err) {
      setError((err as Error).message)
      throw err
    }
  }, [])
  const reload = useCallback(() => { void refresh().catch(() => undefined) }, [refresh])
  useEffect(() => { reload() }, [pathname, reload])
  useEffect(() => {
    window.addEventListener('online', reload)
    window.addEventListener('focus', reload)
    return () => { window.removeEventListener('online', reload); window.removeEventListener('focus', reload) }
  }, [reload])
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  const waiting = <Empty>Загрузка данных вечера…</Empty>

  return <>
    <a className="skip" href="#content">К содержанию</a>
    <div className="topbar"><div className="shell top-inner">
      <Link className="brand" to="/" aria-label="ATT · обзор"><span className="brand-mark" aria-hidden="true" />ATT</Link>
      <nav aria-label="Основная навигация">{navigation.map(([to, label]) =>
        <NavLink end={to === '/'} to={to} key={to}>{label}</NavLink>)}</nav>
      <Link className="button primary nav-add" to="/matches/new"><span aria-hidden="true">+</span> Матч</Link>
    </div></div>
    <main className="shell content" id="content">
      {error && <div className="connection"><Notice error>{error}</Notice><button className="quiet" onClick={reload}>Повторить</button></div>}
      <Suspense fallback={waiting}><Routes>
        <Route path="/" element={state ? <Overview state={state} /> : !error && waiting} />
        <Route path="/matches" element={state ? <Matches state={state} /> : waiting} />
        <Route path="/matches/new" element={<MatchEntry key="quick" state={state} refresh={refresh} onSaved={reload} />} />
        <Route path="/scorekeeper" element={<MatchEntry key="live" live state={state} refresh={refresh} onSaved={reload} />} />
        <Route path="/players" element={state ? <Players state={state} onSaved={reload} /> : waiting} />
        <Route path="/players/:id" element={state ? <PlayerPage state={state} /> : waiting} />
        <Route path="/alcohol" element={state ? <Alcohol state={state} onSaved={reload} /> : waiting} />
        <Route path="/analytics" element={state ? <Analytics state={state} /> : waiting} />
        <Route path="/admin" element={state ? <AdminPage state={state} onSaved={reload} /> : waiting} />
        <Route path="*" element={<><Header title="Страница не найдена" /><Link className="button primary" to="/">Вернуться к обзору</Link></>} />
      </Routes></Suspense>
    </main>
    <footer className="shell footer"><span>Alcohol Table Tennis</span><Link to="/admin">Администрирование</Link></footer>
  </>
}

createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>)
