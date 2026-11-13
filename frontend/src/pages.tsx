import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link } from 'react-router'
import { api, date, decimal, playerName, stageName } from './api'
import type { Drink, State } from './api'
import { Empty, Header, Leaderboard, MatchList, Notice, PlayerSelect, StageSelect } from './ui'
import { RatingChart } from './charts'

const privacy = 'Статистика этого вечера, включая сведения об алкоголе, публична. Используйте псевдонимы и добавляйте данные с согласия участников.'

export function Overview({ state }: { state: State }) {
  return <>
    <section className="evening">
      <div className="evening-copy">
        <span className="stage"><i /> Этап №{state.current_stage.number} · {state.current_stage.name}</span>
        <h1>Настольный<br />теннис<span>.</span></h1>
        <p>{state.matches.length ? 'Результаты и ход игрового вечера.' : 'Добавьте игроков, чтобы записать первый матч.'}</p>
        <div className="actions">
          <Link className="button primary" to={state.players.filter(p => !p.archived_at).length >= 2 ? '/matches/new' : '/players'}>
            {state.players.filter(p => !p.archived_at).length >= 2 ? 'Записать матч' : 'Добавить игроков'}
          </Link>
          <Link className="button quiet" to="/scorekeeper">Открыть счётчик</Link>
        </div>
      </div>
      <div className="court-art" aria-hidden="true"><div className="court-net" /><div className="court-ball" /></div>
    </section>
    <div className="metrics">
      <div><span>Матчи</span><strong>{state.matches.length}</strong></div>
      <div><span>Игроки</span><strong>{state.players.length}</strong></div>
      <div><span>Последняя запись</span><strong className="activity">{date(state.last_activity)}</strong></div>
    </div>
    <div className="overview-grid">
      <section><div className="section-head"><h2>Рейтинг</h2><Link to="/players">Все игроки</Link></div>
        <div className="panel"><Leaderboard players={state.players.slice(0, 5)} /></div></section>
      <section><div className="section-head"><h2>Недавние матчи</h2><Link to="/matches">Все матчи</Link></div>
        <div className="panel"><MatchList state={state} matches={state.matches.slice(0, 4)} /></div></section>
    </div>
    <section><div className="section-head"><h2>Динамика Elo</h2><Link to="/analytics">Аналитика</Link></div>
      <div className="panel chart-panel"><RatingChart state={state} players={state.players.filter(p => p.n).slice(0, 3)} /></div>
    </section>
  </>
}

export function Matches({ state }: { state: State }) {
  const [player, setPlayer] = useState('')
  const [opponent, setOpponent] = useState('')
  const [stage, setStage] = useState('')
  const [target, setTarget] = useState('')
  const [oldest, setOldest] = useState(false)
  const filtered = state.matches.filter(m =>
    (!player || [m.player_a_id, m.player_b_id].includes(player)) &&
    (!opponent || [m.player_a_id, m.player_b_id].includes(opponent)) &&
    (!stage || stage === m.stage_id) && (!target || Number(target) === m.target))
  return <><Header title="Матчи"><Link className="button primary" to="/matches/new">Записать матч</Link></Header>
    <div className="filters">
      <PlayerSelect label="Игрок" players={state.players} value={player} onChange={setPlayer} exclude={opponent} optional />
      <PlayerSelect label="Соперник" players={state.players} value={opponent} onChange={setOpponent} exclude={player} optional />
      <StageSelect stages={state.stages} value={stage} onChange={setStage} optional />
      <label>Формат<select value={target} onChange={e => setTarget(e.target.value)}>
        <option value="">Любой</option><option value="11">До 11</option><option value="21">До 21</option></select></label>
      <label>Порядок<select value={oldest ? 'old' : 'new'} onChange={e => setOldest(e.target.value === 'old')}>
        <option value="new">Сначала новые</option><option value="old">Сначала ранние</option></select></label>
    </div>
    <div className="panel"><MatchList state={state} matches={oldest ? filtered.reverse() : filtered} details /></div>
  </>
}

function PublicForm({ title, path, children, payload, onSaved }: {
  title: string; path: string; children: ReactNode; payload: () => unknown; onSaved: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState(false)
  const [pending, setPending] = useState<{ key: string; serialized: string } | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !window.confirm('Добавить запись в общую статистику?')) return
    const body = payload()
    const serialized = JSON.stringify(body)
    const key = pending?.serialized === serialized ? pending.key : crypto.randomUUID()
    setPending({ key, serialized })
    setBusy(true)
    setStatus('')
    try {
      await api(path, { method: 'POST', body, key })
      setPending(null)
      setError(false)
      setStatus('Запись добавлена.')
      onSaved()
    } catch (err) {
      setError(true)
      setStatus((err as Error).message)
    } finally { setBusy(false) }
  }
  return <form className="panel form-panel" onSubmit={submit}><h2>{title}</h2>
    <fieldset disabled={busy}>{children}</fieldset>
    <button className="primary" disabled={busy}>{busy ? 'Сохранение…' : title}</button>
    {status && <Notice error={error}>{status}</Notice>}
  </form>
}

export function Players({ state, onSaved }: { state: State; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [filter, setFilter] = useState('')
  const shown = state.players.filter(p => p.name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()))
  const unplayed = shown.filter(p => !p.n)
  return <><Header title="Игроки" detail="Рейтинг, результаты и история каждого участника." />
    <div className="split">
      <section><div className="section-head"><h2>Таблица рейтинга</h2></div>
        <label className="search">Поиск по имени<input value={filter} onChange={e => setFilter(e.target.value)} /></label>
        <div className="panel"><Leaderboard players={shown} /></div>
        {!!unplayed.length && <><h3>Без сыгранных матчей</h3><ul className="list panel">
          {unplayed.map(p => <li key={p.id}><Link to={'/players/' + p.id}>{p.name}</Link>
            {p.archived_at && <small>В архиве</small>}</li>)}</ul></>}
      </section>
      <PublicForm title="Добавить игрока" path="/players" payload={() => ({ name })}
        onSaved={() => { setName(''); onSaved() }}>
        <label>Псевдоним<input required maxLength={40} value={name} onChange={e => setName(e.target.value)} /></label>
        <small>{privacy}</small>
      </PublicForm>
    </div>
  </>
}

export function DrinkList({ drinks, state }: { drinks: Drink[]; state: State }) {
  if (!drinks.length) return <Empty>Пока нет записей о напитках.</Empty>
  return <ul className="list drinks">{drinks.map(d => <li key={d.id}><div>
    <strong>{d.name}</strong><small>{playerName(state, d.player_id)} · {stageName(state, d.stage_id)} · {date(d.created_at)}</small>
  </div><div><strong>{decimal(d.ethanol_g, 3)} г</strong><small>{decimal(d.volume_ml, 3)} мл · {decimal(d.abv_percent, 3)}%</small></div></li>)}</ul>
}

export function Alcohol({ state, onSaved }: { state: State; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [player, setPlayer] = useState('')
  const [drink, setDrink] = useState('')
  const [volume, setVolume] = useState('')
  const [abv, setAbv] = useState('')
  const [stage, setStage] = useState('')
  const chosenStage = stage || state.current_stage.id
  return <><Header title="Алкоголь" detail="Этапы, напитки и накопленное количество этанола." />
    <div className="split">
      <div>
        <section><div className="section-head"><h2>Этапы вечера</h2></div>
          <ol className="list panel stage-list">{state.stages.map(s => <li key={s.id}>
            <span className="stage-number">№{s.number}</span><div><strong>{s.name}</strong>
              <small>{s.matches} матч. · {decimal(s.ethanol_g)} г этанола · Самооценка {decimal(s.mean_rating)} / 10</small></div>
            {s.id === state.current_stage.id && <span className="stage current">Текущий</span>}
          </li>)}</ol></section>
        <section><div className="section-head"><h2>Напитки</h2></div><div className="panel"><DrinkList drinks={state.drinks} state={state} /></div></section>
        <section><div className="section-head"><h2>Итого по игрокам</h2></div><ul className="list panel">
          {state.players.map(p => <li key={p.id}><Link to={'/players/' + p.id}>{p.name}</Link>
            <small>{decimal(p.volume_ml)} мл · {decimal(p.ethanol_g)} г этанола</small></li>)}
          {!state.players.length && <li>Пока нет игроков.</li>}</ul></section>
      </div>
      <div className="stack">
        <PublicForm title="Добавить напиток" path="/drinks"
          payload={() => ({ name: drink, player_id: player, stage_id: chosenStage, volume_ml: volume, abv_percent: abv })}
          onSaved={() => { setDrink(''); setVolume(''); setAbv(''); onSaved() }}>
          <PlayerSelect label="Игрок" players={state.players.filter(p => !p.archived_at)} value={player} onChange={setPlayer} />
          <StageSelect stages={state.stages} value={chosenStage} onChange={setStage} />
          <label>Напиток<input required maxLength={60} value={drink} onChange={e => setDrink(e.target.value)} /></label>
          <div className="fields">
            <label>Объём, мл<input required type="number" min=".000001" max="5000" step="any" inputMode="decimal"
              value={volume} onChange={e => setVolume(e.target.value)} /></label>
            <label>Крепость, %<input required type="number" min="0" max="100" step="any" inputMode="decimal"
              value={abv} onChange={e => setAbv(e.target.value)} /></label>
          </div>
          {chosenStage === state.stages[0].id && <small>Для алкогольного напитка сначала добавьте этап.</small>}
          <small>{privacy}</small>
        </PublicForm>
        <PublicForm title="Добавить этап" path="/stages" payload={() => ({ name: name.trim() || null })}
          onSaved={() => { setName(''); setStage(''); onSaved() }}>
          <label>Название<input maxLength={60} value={name} onChange={e => setName(e.target.value)}
            placeholder={`Раунд ${state.current_stage.number + 1}`} /></label>
        </PublicForm>
      </div>
    </div>
  </>
}
