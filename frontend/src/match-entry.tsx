import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { api, ApiError, decimal } from './api'
import type { Match, State } from './api'
import { addPoint, draftKey, draftLifetime, finished, matchBody, maxPoints, readDraft, score, undo } from './scoring'
import type { Draft, Setup } from './scoring'
import { Assessment, Empty, Header, Notice, PlayerSelect } from './ui'

function SetupForm({ state, live, refresh, onStart, onSaved }: {
  state: State; live: boolean; refresh: () => Promise<State>; onStart: (draft: Draft) => void
  onSaved: () => void
}) {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [target, setTarget] = useState(11)
  const [pointsA, setPointsA] = useState('')
  const [pointsB, setPointsB] = useState('')
  const [ratingA, setRatingA] = useState<number | null>(null)
  const [ratingB, setRatingB] = useState<number | null>(null)
  const [review, setReview] = useState<{ setup: Setup; a: number; b: number; key: string } | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [stale, setStale] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const lock = useRef(false)
  const active = state.players.filter(p => !p.archived_at)
  const stage = state.current_stage
  const valid = pointsA !== '' && pointsB !== '' && finished(target, Number(pointsA), Number(pointsB))

  async function prepare(event: FormEvent) {
    event.preventDefault()
    const playerA = active.find(p => p.id === a)
    const playerB = active.find(p => p.id === b)
    if (!playerA || !playerB || a === b || (!live && !valid) || lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      if (live) {
        const current = await refresh()
        if (current.projection_version !== state.projection_version) {
          setError('Вечер обновился. Проверьте этап и участников, затем начните снова.')
          return
        }
      }
      const setup: Setup = {
        player_a_id: a, player_b_id: b, target, stage_id: stage.id, snapshot_seq: state.snapshot_seq,
        a_intoxication: stage.number === 0 ? 0 : ratingA,
        b_intoxication: stage.number === 0 ? 0 : ratingB,
        nameA: playerA.name, nameB: playerB.name, stageName: stage.name,
        gramsA: playerA.ethanol_g, gramsB: playerB.ethanol_g,
        ...(live ? { started_at: new Date().toISOString() } : {}),
      }
      const key = crypto.randomUUID()
      if (live) onStart({ version: 1, timestamp: Date.now(), key, setup, points: [], pending: false })
      else setReview({ setup, a: Number(pointsA), b: Number(pointsB), key })
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false); lock.current = false }
  }

  async function publish() {
    if (!review || lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await api<Match>('/matches', { method: 'POST', key: review.key,
        body: matchBody(review.setup, review.a, review.b, 'quick') })
      setReview(null)
      setSaved(true)
      setPointsA('')
      setPointsB('')
      onSaved()
    } catch (err) {
      setError((err as Error).message)
      setStale(err instanceof ApiError && err.code === 'STALE_STATE')
      setUncertain(err instanceof ApiError && (err.status === 0 || err.status >= 500))
    } finally { setBusy(false); lock.current = false }
  }

  async function reconcile() {
    setBusy(true)
    try { await refresh(); setReview(null); setError(''); setStale(false) }
    catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }

  if (active.length < 2) return <Empty>Для матча нужны два игрока. <Link to="/players">Добавить игроков</Link></Empty>
  if (review) return <section className="panel form-panel">
    <h2>Проверка результата</h2>
    <p className="review-score">{review.setup.nameA} <strong>{review.a} : {review.b}</strong> {review.setup.nameB}</p>
    <p>Победитель — {review.a > review.b ? review.setup.nameA : review.setup.nameB}.</p>
    <p className="muted">{review.setup.stageName} · до {review.setup.target} · снимок №{review.setup.snapshot_seq}</p>
    {error && <Notice error>{error}</Notice>}
    <div className="actions">
      {stale ? <button className="primary" disabled={busy} onClick={reconcile}>Обновить данные</button> :
        <button className="primary" disabled={busy} onClick={publish}>{busy ? 'Сохранение…' : 'Подтвердить и записать'}</button>}
      <button className="quiet" disabled={busy} onClick={() => {
        if (uncertain && !window.confirm('Запись могла сохраниться. Проверьте историю матчей. Вернуться к форме?')) return
        setReview(null); setError(''); setStale(false); setUncertain(false)
      }}>К форме</button>
    </div>
  </section>
  return <form className="panel form-panel" onSubmit={prepare}>
    {saved && <Notice>Матч записан. Можно записать ещё один матч этой пары.</Notice>}
    <div className="form-context"><span className="stage">№{stage.number} · {stage.name}</span>
      <small>Состояние на записи №{state.snapshot_seq}</small></div>
    <div className="fields">
      <PlayerSelect label="Игрок 1" players={active} value={a} onChange={setA} exclude={b} />
      <PlayerSelect label="Игрок 2" players={active} value={b} onChange={setB} exclude={a} />
    </div>
    <fieldset><legend>Формат</legend><div className="segments">{[11, 21].map(value =>
      <label key={value}><input type="radio" name="target" checked={target === value}
        onChange={() => setTarget(value)} />До {value}</label>)}</div></fieldset>
    {!live && <div className="fields">
      <label>Очки игрока 1<input type="number" inputMode="numeric" min="0" max={maxPoints} required value={pointsA}
        onChange={e => { setPointsA(e.target.value); setSaved(false) }} /></label>
      <label>Очки игрока 2<input type="number" inputMode="numeric" min="0" max={maxPoints} required value={pointsB}
        onChange={e => { setPointsB(e.target.value); setSaved(false) }} /></label>
      {pointsA !== '' && pointsB !== '' && <small className="wide">{valid ? 'Счёт допустим' : 'Игра заканчивается при достижении цели и перевесе в два очка.'}</small>}
    </div>}
    <fieldset><legend>Самооценка в начале игры</legend>
      <div className="fields">
        <Assessment label="Игрок 1 · 0–10" initial={stage.number === 0} value={stage.number === 0 ? 0 : ratingA} onChange={setRatingA} />
        <Assessment label="Игрок 2 · 0–10" initial={stage.number === 0} value={stage.number === 0 ? 0 : ratingB} onChange={setRatingB} />
      </div>
      {stage.number === 0 && <small>На начальном этапе обе оценки равны 0.</small>}
    </fieldset>
    {error && <Notice error>{error}</Notice>}
    <button className="primary" disabled={busy || !a || !b || (!live && !valid)}>{live ? 'Начать матч' : 'Проверить результат'}</button>
  </form>
}

export function MatchEntry({ state, live = false, refresh, onSaved }: {
  state: State | null; live?: boolean; refresh: () => Promise<State>; onSaved: () => void
}) {
  const navigate = useNavigate()
  const [draft, setDraft] = useState<Draft | null>(() => {
    try { return live ? readDraft(localStorage.getItem(draftKey)) : null }
    catch { return null }
  })
  const [recover, setRecover] = useState(Boolean(draft))
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [storageError, setStorageError] = useState(false)
  const [published, setPublished] = useState(false)
  const latest = useRef(draft)
  const inFlight = useRef(false)

  function store(next: Draft | null) {
    latest.current = next
    setDraft(next)
    try {
      if (next) localStorage.setItem(draftKey, JSON.stringify(next))
      else localStorage.removeItem(draftKey)
    } catch { setStorageError(true) }
  }

  function discard() {
    const message = latest.current?.pending
      ? 'Отправка могла завершиться. Проверьте историю матчей перед повторной записью. Удалить черновик?'
      : 'Удалить черновик с этого устройства?'
    if (!window.confirm(message)) return
    store(null)
    setRecover(false)
    setConfirm(false)
    setError('')
  }

  async function publish() {
    const active = latest.current
    if (!active || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    const [a, b] = score(active.points)
    store({ ...active, pending: true })
    try {
      await api('/matches', { method: 'POST', key: active.key, body: matchBody(active.setup, a, b, 'live') })
      store(null)
      setConfirm(false)
      setPublished(true)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 &&
          !['RATE_LIMIT', 'IDEMPOTENCY_CONFLICT'].includes(err.code)) store({ ...active, pending: false })
    } finally { setBusy(false); inFlight.current = false }
  }

  const header = <Header title={live ? 'Счётчик матча' : 'Записать матч'}
    detail={live ? 'Счёт остаётся на этом устройстве до подтверждения результата.' : 'Итоговый счёт уже сыгранного матча.'}>
    <Link className="button quiet" to={live ? '/matches/new' : '/scorekeeper'}>{live ? 'Быстрый ввод' : 'Открыть счётчик'}</Link>
  </Header>
  if (published) return <>{header}<section className="panel form-panel"><Notice>Матч записан.</Notice>
    <div className="actions"><button className="primary" onClick={() => setPublished(false)}>Новый матч</button>
      <button className="quiet" onClick={() => navigate('/matches')}>К матчам</button></div></section></>
  if (!live || !draft) return <>{header}{state ?
    <SetupForm state={state} live={live} refresh={refresh} onSaved={onSaved} onStart={store} /> :
    <Empty>Подключитесь к серверу, чтобы получить список игроков.</Empty>}</>

  const [a, b] = score(draft.points)
  const done = finished(draft.setup.target, a, b)
  const expired = Date.now() - draft.timestamp > draftLifetime
  if (recover) return <>{header}<section className="panel form-panel">
    <h2>{expired ? 'Черновику больше двух дней' : 'Продолжить матч?'}</h2>
    <p>{draft.setup.nameA} · {a} : {b} · {draft.setup.nameB}</p>
    <div className="actions"><button className="primary" onClick={() => setRecover(false)}>Восстановить черновик</button>
      <button className="quiet" onClick={discard}>Начать заново</button></div>
  </section></>

  const gamePoint = !done && (finished(draft.setup.target, a + 1, b) || finished(draft.setup.target, a, b + 1))
  return <>{header}<section className="scorekeeper">
    <div className="board-meta"><span>{draft.setup.stageName}</span><span>До {draft.setup.target}</span>
      <span>{done ? 'Матч завершён' : gamePoint ? 'Матчбол' : 'Матч идёт'}</span></div>
    <div className="board">
      {(['a', 'b'] as const).map(side => {
        const name = side === 'a' ? draft.setup.nameA : draft.setup.nameB
        const points = side === 'a' ? a : b
        return <button className="score-side" key={side} type="button"
          aria-label={`${name}: ${points}, добавить очко`} disabled={done || draft.pending || points >= maxPoints}
          onClick={() => latest.current && store(addPoint(latest.current, side))}>
          <span>{name}</span><strong>{points}</strong><small>{done ? (points === Math.max(a, b) ? 'Победа' : 'Итог') : '+1 очко'}</small>
        </button>
      })}
    </div>
    <p className="muted">Снимок №{draft.setup.snapshot_seq} · этанол {decimal(draft.setup.gramsA)} / {decimal(draft.setup.gramsB)} г ·
      самооценка {draft.setup.a_intoxication ?? 'неизвестно'} / {draft.setup.b_intoxication ?? 'неизвестно'}</p>
    {storageError && <Notice error>Браузер не сохраняет черновик. Оставьте вкладку открытой до публикации.</Notice>}
    {error && <Notice error>{error}</Notice>}
    {(confirm || draft.pending) && <Notice>Будет записан счёт {a} : {b} со снимком на начало матча.</Notice>}
    <div className="actions score-actions">
      <button className="quiet" disabled={!draft.points.length || draft.pending || busy}
        onClick={() => { if (latest.current) store(undo(latest.current)); setConfirm(false) }}>Отменить очко</button>
      <button className="quiet" disabled={busy} onClick={discard}>Начать заново</button>
      {done && <button className="primary" disabled={busy} onClick={confirm || draft.pending ? publish : () => setConfirm(true)}>
        {busy ? 'Сохранение…' : draft.pending ? 'Повторить отправку' : confirm ? 'Подтвердить и записать' : 'Записать результат'}
      </button>}
    </div>
  </section></>
}
