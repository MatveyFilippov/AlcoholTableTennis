import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError, date, decimal } from './api'
import type { Drink, Match, Player, State } from './api'
import { Assessment, Empty, Header, Notice, PlayerSelect } from './ui'

type Entity = keyof Records
interface Impact {
  id: string
  name: string
  before: number
  after: number
}
interface Records {
  players: Player[]
  drinks: Drink[]
  matches: Match[]
}
interface Audit {
  id: string; action: string; entity: string; entity_id: string; created_at: string
  before: unknown; after: unknown
}
const labels = { players: 'Игроки', drinks: 'Напитки', matches: 'Матчи' }
const actions: Record<string, string> = { edit: 'Исправление', delete: 'Удаление', restore: 'Восстановление' }

function EditForm({ state, records, entity, id, onChange }: {
  state: State; records: Records; entity: Entity; id: string
  onChange: (method: string, body: unknown, suffix?: string) => Promise<void>
}) {
  const row = records[entity].find(r => r.id === id)!
  const player = entity === 'players' ? row as Player : null
  const drink = entity === 'drinks' ? row as Drink : null
  const match = entity === 'matches' ? row as Match : null
  const [name, setName] = useState(player?.name ?? drink?.name ?? '')
  const [archived, setArchived] = useState(Boolean(player?.archived_at))
  const [a, setA] = useState(match?.player_a_id ?? drink?.player_id ?? '')
  const [b, setB] = useState(match?.player_b_id ?? '')
  const [target, setTarget] = useState(match?.target ?? 11)
  const [scoreA, setScoreA] = useState(match?.score_a ?? 0)
  const [scoreB, setScoreB] = useState(match?.score_b ?? 0)
  const [ratingA, setRatingA] = useState(match?.a_intoxication ?? null)
  const [ratingB, setRatingB] = useState(match?.b_intoxication ?? null)
  const [volume, setVolume] = useState(String(drink?.volume_ml ?? ''))
  const [abv, setAbv] = useState(String(drink?.abv_percent ?? ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ body: string; rows: Impact[] } | null>(null)
  const rev = { row_version: row.row_version }
  const players = state.players.filter(p => match ? p.seq <= match.snapshot_seq : !drink || p.seq < drink.seq)

  async function perform(method: string, body: unknown, suffix?: string) {
    if (busy) return
    const message = method === 'DELETE' ? 'Удалить запись? Связанная статистика и рейтинг будут пересчитаны.' :
      suffix ? 'Восстановить запись и пересчитать статистику?' :
      match ? `Сохранить счёт ${scoreA} : ${scoreB}? Все последующие рейтинги будут пересчитаны.` :
      'Сохранить изменения? Связанная статистика будет пересчитана.'
    if (!window.confirm(message)) return
    setBusy(true); setError('')
    try { await onChange(method, body, suffix) }
    catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const body = match ? {
      player_a_id: a, player_b_id: b, target, score_a: scoreA, score_b: scoreB,
      snapshot_seq: match.snapshot_seq, started_at: match.started_at,
      a_intoxication: ratingA, b_intoxication: ratingB,
    } : drink ? { player_id: a, name, volume_ml: volume, abv_percent: abv } :
      player ? { name, archived } : { name }
    const payload = { ...rev, ...body }
    if (match && preview?.body !== JSON.stringify(payload)) {
      setBusy(true); setError(''); setPreview(null)
      try {
        const rows = await api<Impact[]>(`/admin/matches/${id}/preview`, { method: 'POST', body: payload })
        setPreview({ body: JSON.stringify(payload), rows })
      } catch (err) { setError((err as Error).message) }
      finally { setBusy(false) }
      return
    }
    await perform('PATCH', payload)
  }

  return <form className="panel form-panel" onSubmit={submit}>
    {row.deleted_at ? <><p>Запись удалена {date(row.deleted_at)}.</p><button type="button" disabled={busy}
      onClick={() => perform('POST', rev, '/restore')}>Восстановить</button></> :
      <fieldset disabled={busy} onChange={() => setPreview(null)}>
        {!match && <label>Название<input required value={name} maxLength={player ? 40 : 60} onChange={e => setName(e.target.value)} /></label>}
        {player && <label className="checkbox"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />Скрыть из новых записей</label>}
        {(drink || match) && <>
          <PlayerSelect label={match ? 'Игрок 1' : 'Игрок'} players={players} value={a} onChange={setA} exclude={b} />
        </>}
        {drink && <div className="fields"><label>Объём, мл<input required type="number" min=".000001" max="5000" step="any" value={volume}
          onChange={e => setVolume(e.target.value)} /></label><label>Крепость, %<input required type="number" min="0" max="100" step="any"
          value={abv} onChange={e => setAbv(e.target.value)} /></label></div>}
        {match && <>
          <PlayerSelect label="Игрок 2" players={players} value={b} onChange={setB} exclude={a} />
          <label>Формат<select value={target} onChange={e => setTarget(Number(e.target.value))}><option value="11">До 11</option>
            <option value="21">До 21</option></select></label>
          <div className="fields"><label>Очки игрока 1<input required type="number" min="0" max="999" value={scoreA}
            onChange={e => setScoreA(e.target.valueAsNumber)} /></label><label>Очки игрока 2<input required type="number" min="0" max="999"
            value={scoreB} onChange={e => setScoreB(e.target.valueAsNumber)} /></label></div>
          <div className="fields"><Assessment label="Самооценка 1" value={ratingA} onChange={setRatingA} />
            <Assessment label="Самооценка 2" value={ratingB} onChange={setRatingB} /></div>
        </>}
        {preview && <div aria-live="polite"><h3>После пересчёта</h3>
          {preview.rows.length ? <ul className="list">{preview.rows.map(p => <li key={p.id}>
            <strong>{p.name}</strong><small>Elo {decimal(p.before, 2)} → {decimal(p.after, 2)}</small>
          </li>)}</ul> : <p>Итоговые рейтинги сохранятся.</p>}
        </div>}
        <div className="actions"><button className="primary">{match && !preview ? 'Проверить влияние' : 'Сохранить'}</button>
          <button className="quiet danger" type="button" onClick={() => perform('DELETE', rev)}>Удалить</button></div>
      </fieldset>}
    {error && <Notice error>{error}</Notice>}
  </form>
}

export function AdminPage({ state, onSaved }: { state: State; onSaved: () => void }) {
  const [records, setRecords] = useState<Records | null>(null)
  const [audit, setAudit] = useState<Audit[]>([])
  const [entity, setEntity] = useState<Entity>('matches')
  const [id, setId] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const load = useCallback(async (signal?: AbortSignal) => {
    const [rows, log] = await Promise.all([
      api<Records>('/admin/records', { signal }), api<Audit[]>('/admin/audit', { signal }),
    ])
    setRecords(rows)
    setAudit(log)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal).catch(err => {
      if (!controller.signal.aborted && !(err instanceof ApiError && err.status === 401)) setError(err.message)
    })
    return () => controller.abort()
  }, [load])

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { await api('/admin/login', { method: 'POST', body: { password } }); setPassword(''); await load() }
    catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }

  async function logout() {
    setError(''); setBusy(true)
    try {
      await api('/admin/logout', { method: 'POST' })
      setRecords(null); setAudit([]); setId(''); setStatus('')
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }

  async function change(method: string, body: unknown, suffix = '') {
    setStatus('')
    await api(`/admin/${entity}/${id}${suffix}`, { method, body })
    setStatus('Изменения сохранены.')
    onSaved()
    try { await load() }
    catch { setError('Изменения сохранены. Обновите страницу, чтобы загрузить журнал.') }
  }

  const row = records?.[entity].find(r => r.id === id)
  return <><Header title="Администрирование">{records && <button className="quiet" disabled={busy} onClick={logout}>Выйти</button>}</Header>
    {error && <Notice error>{error}</Notice>}
    {!records ? <form className="panel form-panel" onSubmit={login}>
      <label>Пароль администратора<input required autoComplete="current-password" type="password" maxLength={256}
        value={password} onChange={e => setPassword(e.target.value)} /></label>
      <button className="primary" disabled={busy}>Войти</button></form> : <>
      <div className="filters">
        <label>Раздел<select value={entity} onChange={e => { setEntity(e.target.value as Entity); setId(''); setStatus('') }}>
          {Object.entries(labels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
        </select></label>
        <label>Запись<select value={id} onChange={e => { setId(e.target.value); setStatus('') }}>
          <option value="">Выберите запись</option>{records[entity].map(r => <option value={r.id} key={r.id}>
            #{r.seq} · {'name' in r ? r.name : r.score_a + ' : ' + r.score_b}{r.deleted_at ? ' · удалено' : ''}
          </option>)}</select></label>
      </div>
      {status && <Notice>{status}</Notice>}
      {row && <EditForm key={row.id + row.row_version} state={state} records={records} entity={entity} id={id} onChange={change} />}
      <section><h2>Журнал изменений</h2><div className="panel">{audit.length ? <ul className="list">{audit.map(a =>
        <li key={a.id}><details><summary>{actions[a.action]} · {labels[a.entity as Entity] ?? "Историческая запись"} · {date(a.created_at)}</summary>
          <p>До</p><pre>{JSON.stringify(a.before, null, 2)}</pre><p>После</p><pre>{JSON.stringify(a.after, null, 2)}</pre>
        </details></li>)}</ul> : <Empty>Исправлений пока нет.</Empty>}</div></section>
    </>}
  </>
}
