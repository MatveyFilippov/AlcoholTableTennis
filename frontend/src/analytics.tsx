import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { api, decimal, percent, playerName, stageName } from './api'
import type { Pair, Profile, State, Stats } from './api'
import { AlcoholScatter, AssessmentChart, associationNote, ConsumptionChart, RatingChart } from './charts'
import { DrinkList } from './pages'
import { Empty, Header, Leaderboard, MatchList, Notice, PlayerSelect } from './ui'

function useData<T>(path: string, revision: string) {
  const [result, setResult] = useState<{ key: string; data?: T; error?: string }>()
  const [retry, setRetry] = useState(0)
  const key = path + revision + retry
  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    api<T>(path, { signal: controller.signal }).then(data => setResult({ key, data })).catch(err => {
      if (!controller.signal.aborted) setResult({ key, error: err.message })
    })
    return () => controller.abort()
  }, [path, key])
  return { ...(result?.key === key ? result : {}), retry: () => setRetry(n => n + 1) }
}

function Summary({ rows }: { rows: (Stats & { label: string })[] }) {
  return <div className="table-wrap"><table className="responsive-table"><thead><tr><th>Группа</th><th>Матчи</th><th>В–П</th>
    <th>Победы</th><th>Ожид.</th><th>Разница</th></tr></thead><tbody>
    {rows.map(row => <tr key={row.label}><th scope="row">{row.label}</th><td data-label="Матчи">{row.n}</td>
      <td data-label="В–П">{row.wins}–{row.losses}</td><td data-label="Победы">{percent(row.win_rate)}</td>
      <td data-label="Ожидание">{percent(row.expected)}</td><td data-label="Разница">{decimal(row.residual, 3)}</td></tr>)}
  </tbody></table></div>
}

export function PlayerPage({ state }: { state: State }) {
  const { id } = useParams()
  const { data: p, error, retry } = useData<Profile>('/players/' + id, state.projection_version)
  if (error) return <><Notice error>{error}</Notice><button onClick={retry}>Повторить</button></>
  if (!p) return <Notice>Загрузка профиля…</Notice>
  return <><Header title={p.name} detail={p.preliminary ? 'Предварительный рейтинг · менее пяти матчей' : undefined} />
    <div className="metrics"><div><span>Общий Elo</span><strong>{p.rank ? decimal(p.elo, 0) : '—'}</strong>
      <small>{p.rank ? `Место №${p.rank} · Δ ${decimal(p.elo_delta, 0)}` : 'Без матчей'}</small></div>
      <div><span>Трезвый Elo</span><strong>{p.sober_elo === null ? '—' : decimal(p.sober_elo, 0)}</strong>
        <small>{p.sober_matches} матч.</small></div>
      <div><span>Победы</span><strong>{percent(p.win_rate)}</strong><small>{p.wins} В · {p.losses} П</small></div></div>
    <div className="overview-grid">
      <section><h2>Динамика Elo</h2><div className="panel chart-panel"><RatingChart state={state} players={[p]} /></div></section>
      <section><h2>Соперники</h2><div className="panel">{p.opponents.length
        ? <Summary rows={p.opponents.map(s => ({ ...s, label: playerName(state, s.id) }))} />
        : <Empty>Личных встреч нет.</Empty>}</div></section>
    </div>
    <section><h2>По этапам</h2><div className="panel"><Summary rows={p.stages.map(s => ({ ...s, label: stageName(state, s.id) }))} /></div></section>
    <section><h2>Матчи</h2><div className="panel"><MatchList state={state} matches={p.matches} details /></div></section>
    <div className="overview-grid">
      <section><h2>Самооценка</h2><div className="panel chart-panel"><AssessmentChart player={p} observations={p.observations} /></div></section>
      <section><h2>Потребление</h2><div className="panel chart-panel"><ConsumptionChart player={p} drinks={p.drinks} /></div></section>
    </div>
    <section><h2>Напитки</h2><div className="panel"><DrinkList drinks={p.drinks} state={state} /></div></section>
  </>
}

export function Analytics({ state }: { state: State }) {
  const [tab, setTab] = useState('rating')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const selection = a || state.players[0]?.id || ''
  const pair = useData<Pair>(selection && b ?
    `/analytics/head-to-head?player_a=${selection}&player_b=${b}` : '', state.projection_version)
  const profile = useData<Profile>(tab === 'alcohol' && selection ? '/analytics/players/' + selection : '',
    state.projection_version)
  const selected = state.players.filter(p => p.id === selection || p.id === b)
  return <><Header title="Аналитика" />
    <div className="segments analytics-tabs">{[['rating', 'Рейтинг'], ['sober', 'Трезвая игра'], ['alcohol', 'Алкоголь и результаты']]
      .map(([key, label]) => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div>
    <div className="filters">
      <PlayerSelect label="Игрок" players={state.players} value={selection} onChange={setA} exclude={b} />
      {tab !== 'alcohol' && <PlayerSelect label="Соперник" players={state.players} value={b} onChange={setB} exclude={selection} optional />}
    </div>
    {tab === 'alcohol' ? <>
      {profile.error && <><Notice error>{profile.error}</Notice><button onClick={profile.retry}>Повторить</button></>}
      {profile.data ? <>
        <section><h2>Этанол и результат</h2><div className="panel chart-panel">
          <p>Разница между фактическим исходом и вероятностью победы по Elo до матча.</p>
          <AlcoholScatter state={state} player={profile.data} />
          <small>{profile.data.observations.filter(o => o.self_rating !== null).length < 8
            ? "Недостаточно данных для корреляции." : "Показаны отдельные наблюдения и сводка по группам."}</small>
        </div></section>
        <section><h2>Результаты по самооценке</h2><div className="panel"><Summary rows={profile.data.bins} />
          <p className="chart-note muted">{associationNote}</p></div></section>
      </> : !profile.error && <Empty>{selection ? 'Загрузка наблюдений…' : 'Добавьте игроков, чтобы сравнить наблюдения.'}</Empty>}
    </> : <>
      <section><h2>{tab === 'sober' ? 'Динамика трезвого Elo' : 'Динамика общего Elo'}</h2>
        <div className="panel chart-panel"><RatingChart state={state} players={selected} sober={tab === 'sober'} /></div></section>
      <section><h2>Таблица рейтинга</h2><div className="panel"><Leaderboard players={state.players} sober={tab === 'sober'} /></div></section>
      {b && <section><h2>Личные встречи</h2><div className="panel">{pair.data ?
        pair.data.n ? <><p className="chart-note">{pair.data.n} матч. · {playerName(state, selection)} {pair.data.a_wins} : {pair.data.b_wins} {playerName(state, b)}</p>
          <MatchList matches={pair.data.matches} state={state} /></> : <Empty>Личных встреч нет.</Empty>
        : pair.error ? <><Notice error>{pair.error}</Notice><button onClick={pair.retry}>Повторить</button></> :
          <Empty>Загрузка встреч…</Empty>}</div></section>}
    </>}
    <section><h2>Сводка по этапам</h2><div className="panel table-wrap"><table className="responsive-table">
      <thead><tr><th>Этап</th><th>Матчи</th><th>Этанол, г</th><th>Средн. / мед.</th><th>Оценки</th></tr></thead>
      <tbody>{state.stages.map(s => <tr key={s.id}><th scope="row">{s.name}</th><td data-label="Матчи">{s.matches}</td>
        <td data-label="Этанол, г">{decimal(s.ethanol_g)}</td>
        <td data-label="Средн. / мед.">{decimal(s.mean_rating)} / {decimal(s.median_rating)}</td>
        <td data-label="Оценки">{s.assessments}</td></tr>)}</tbody>
    </table></div><p className="muted">{associationNote}</p></section>
  </>
}
