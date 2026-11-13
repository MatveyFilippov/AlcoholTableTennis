import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, decimal, percent, playerName } from './api'
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

const comparisonNote = 'Это изменение результатов по ходу вечера, а не доказанный эффект алкоголя. Влияют соперники, случайность и усталость.'

function pointsDifference(value: number | null) {
  return value === null ? '—' : `${value > 0 ? '+' : ''}${decimal(value * 100, 1)} п. п.`
}

function EveningComparison({ player }: { player: Profile | State['players'][number] }) {
  const { n, start, end, delta, omitted } = player.comparison
  return <section><h2>Начало vs Конец</h2>
    {!start || !end ? <div className="panel"><Empty>{n} матч. · Нужно минимум 4 матча для сравнения начала и конца.</Empty></div> :
      <div className="panel chart-panel">
        <div className="comparison-halves">
          {([['Начало', start], ['Конец', end]] as const).map(([label, half]) =>
            <div key={label}><h3>{label}</h3>
              <strong>{pointsDifference(half.residual)}</strong>
              <small>В среднем к ожиданию</small>
              <small>{half.n} матч. · {half.wins}–{half.losses} · {percent(half.win_rate)} побед</small>
              <small>В среднем {decimal(half.mean_ethanol_g, 3)} г к началу матча</small>
            </div>)}
        </div>
        <p><strong>{pointsDifference(delta)}</strong> · описательная разница между концом и началом</p>
        <details><summary>Как считаем</summary><p>Из результата матча (1 за победу, 0 за поражение) вычитаем вероятность победы по Elo перед матчем. Сравниваем средние этой разницы в двух половинах собственных матчей игрока. Порядок задаёт публикация.{omitted ? ' Средний матч исключён, чтобы в обеих половинах было поровну игр.' : ''}</p></details>
        {omitted > 0 && <p className="muted">Средний матч пропущен.</p>}
        {end.mean_ethanol_g === start.mean_ethanol_g &&
          <p className="muted">Среднее количество записанного этанола в обеих половинах одинаковое.</p>}
      </div>}
    <p className="muted">{comparisonNote}</p>
  </section>
}

export function PlayerPage({ state }: { state: State }) {
  const { id } = useParams()
  const { data: p, error, retry } = useData<Profile>('/players/' + id, state.projection_version)
  if (error) return <><Notice error>{error}</Notice><button onClick={retry}>Повторить</button></>
  if (!p) return <Notice>Загрузка профиля…</Notice>
  return <><Header title={p.name} detail={p.preliminary ? 'Предварительный рейтинг · менее пяти матчей' : undefined} />
    <div className="metrics"><div><span>Общий Elo</span><strong>{p.rank ? decimal(p.elo, 0) : '—'}</strong>
      <small>{p.rank ? `Место №${p.rank} · Δ ${decimal(p.elo_delta, 0)}` : 'Без матчей'}</small></div>
      <div><span>Матчи</span><strong>{p.n}</strong></div>
      <div><span>Победы</span><strong>{percent(p.win_rate)}</strong><small>{p.wins} В · {p.losses} П</small></div></div>
    <div className="overview-grid">
      <section><h2>Динамика Elo</h2><div className="panel chart-panel"><RatingChart players={[p]} /></div></section>
      <section><h2>Соперники</h2><div className="panel">{p.opponents.length
        ? <Summary rows={p.opponents.map(s => ({ ...s, label: playerName(state, s.id) }))} />
        : <Empty>Личных встреч нет.</Empty>}</div></section>
    </div>
    <EveningComparison player={p} />
    <section><h2>Матчи</h2><div className="panel"><MatchList state={state} matches={p.matches} details /></div></section>
    <div className="overview-grid">
      <section><h2>Самооценка</h2><div className="panel chart-panel"><AssessmentChart player={p} observations={p.observations} /></div></section>
      <section><h2>Потребление</h2><div className="panel chart-panel"><ConsumptionChart player={p} /></div></section>
    </div>
    <section><h2>Напитки</h2><p className="muted">Всего {decimal(p.volume_ml, 3)} мл · {decimal(p.ethanol_g, 3)} г этанола</p><div className="panel"><DrinkList drinks={p.drinks} state={state} /></div></section>
  </>
}

export function Analytics({ state }: { state: State }) {
  const [tab, setTab] = useState('rating')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const selection = (state.players.find(p => p.id === a) ?? state.players.find(p => p.id !== b))?.id ?? ''
  const pair = useData<Pair>(tab === 'rating' && selection && b ?
    `/analytics/head-to-head?player_a=${selection}&player_b=${b}` : '', state.projection_version)
  const profile = useData<Profile>(tab === 'alcohol' && selection ? '/analytics/players/' + selection : '',
    state.projection_version)
  const selected = state.players.filter(p => p.id === selection || p.id === b)
  const chosen = state.players.find(p => p.id === selection)
  const comparable = state.comparison_order.flatMap(id => {
    const p = state.players.find(player => player.id === id)
    return p ? [p] : []
  })
  return <><Header title="Аналитика" />
    <div className="segments analytics-tabs">{[['rating', 'Рейтинг'], ['comparison', 'Начало vs Конец'], ['alcohol', 'Алкоголь и результаты']]
      .map(([key, label]) => <button key={key} aria-pressed={tab === key} onClick={() => { setTab(key); if (key === 'rating' && selection === b) setB('') }}>{label}</button>)}</div>
    <div className="filters">
      <PlayerSelect label="Игрок" players={state.players} value={selection} onChange={setA} exclude={tab === 'rating' ? b : undefined} />
      {tab === 'rating' && <PlayerSelect label="Соперник" players={state.players} value={b} onChange={setB} exclude={selection} optional />}
    </div>
    {tab === 'alcohol' ? <>
      {profile.error && <><Notice error>{profile.error}</Notice><button onClick={profile.retry}>Повторить</button></>}
      {profile.data ? <>
        <section><h2>Этанол и результат</h2><div className="panel chart-panel">
          <p>Разница между фактическим исходом и вероятностью победы по Elo до матча.</p>
          <AlcoholScatter state={state} player={profile.data} />
        </div></section>
        <section><h2>Результаты по самооценке</h2><div className="panel"><Summary rows={profile.data.bins} />
          <p className="chart-note muted">{associationNote}</p></div></section>
      </> : !profile.error && <Empty>{selection ? 'Загрузка наблюдений…' : 'Добавьте игроков, чтобы сравнить наблюдения.'}</Empty>}
    </> : tab === 'comparison' ? <>
      {chosen ? <EveningComparison player={chosen} /> : <Empty>Пока нечего сравнивать.</Empty>}
      <section><h2>Изменение результатов игроков</h2><div className="panel">
        {comparable.length < 2 ? <Empty>Пока нечего сравнивать. Нужны хотя бы два игрока с четырьмя матчами у каждого.</Empty> :
          <ul className="list">{comparable.map(p => <li key={p.id}><Link to={'/players/' + p.id}>{p.name}</Link>
            <small>{pointsDifference(p.comparison.delta)} · {p.n} матч.</small></li>)}</ul>}
      </div><p className="muted">{comparisonNote}</p></section>
    </> : <>
      <section><h2>Динамика Elo</h2>
        <div className="panel chart-panel"><RatingChart players={selected} /></div></section>
      <section><h2>Таблица рейтинга</h2><div className="panel"><Leaderboard players={state.players} /></div></section>
      {b && <section><h2>Личные встречи</h2><div className="panel">{pair.data ?
        pair.data.n ? <><p className="chart-note">{pair.data.n} матч. · {playerName(state, selection)} {pair.data.a_wins} : {pair.data.b_wins} {playerName(state, b)}</p>
          <MatchList matches={pair.data.matches} state={state} /></> : <Empty>Личных встреч нет.</Empty>
        : pair.error ? <><Notice error>{pair.error}</Notice><button onClick={pair.retry}>Повторить</button></> :
          <Empty>Загрузка встреч…</Empty>}</div></section>}
    </>}
  </>
}
