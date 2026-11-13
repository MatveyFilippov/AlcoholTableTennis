import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { date, decimal, percent, playerName, stageName } from './api'
import type { Match, Player, Stage, State } from './api'

export function Header({ title, children, detail }: { title: string; children?: ReactNode; detail?: string }) {
  return <header className="page-head"><div><h1>{title}</h1>{detail && <p>{detail}</p>}</div>{children}</header>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p className={error ? 'notice error' : 'notice'} role={error ? 'alert' : 'status'}>{children}</p>
}

export function PlayerSelect({ label, players, value, onChange, exclude, optional = false }: {
  label: string; players: Player[]; value: string; onChange: (id: string) => void
  exclude?: string; optional?: boolean
}) {
  return <label>{label}<select required={!optional} value={value} onChange={e => onChange(e.target.value)}>
    <option value="">{optional ? 'Все игроки' : 'Выберите игрока'}</option>
    {players.filter(p => p.id !== exclude).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
  </select></label>
}

export function StageSelect({ stages, value, onChange, optional = false }: {
  stages: Stage[]; value: string; onChange: (id: string) => void; optional?: boolean
}) {
  return <label>Этап<select value={value} onChange={e => onChange(e.target.value)} required={!optional}>
    {optional && <option value="">Все этапы</option>}
    {stages.map(s => <option key={s.id} value={s.id}>№{s.number} · {s.name}</option>)}
  </select></label>
}

export function Assessment({ label, value, onChange, initial = false }: {
  label: string; value: number | null; onChange: (value: number | null) => void; initial?: boolean
}) {
  return <label>{label}<select disabled={initial} value={value ?? ''} onChange={e =>
    onChange(e.target.value === '' ? null : Number(e.target.value))}>
    <option value="">Неизвестно</option>
    {Array.from({ length: 11 }, (_, n) => <option key={n} value={n}>{n} / 10</option>)}
  </select></label>
}

export function Leaderboard({ players, sober = false }: { players: Player[]; sober?: boolean }) {
  const played = players.filter(p => sober ? p.sober_matches : p.n)
  if (!played.length) return <Empty>{sober ? 'Пока нет трезвых матчей.' : 'Рейтинг появится после первого матча.'}</Empty>
  return <div className="table-wrap"><table><thead><tr><th>Игрок</th><th>Elo</th><th>В–П</th><th>Победы</th>
    {!sober && <th>Трезвый Elo</th>}</tr></thead><tbody>
    {[...played].sort((a, b) => sober ? (a.sober_rank ?? 0) - (b.sober_rank ?? 0) : (a.rank ?? 0) - (b.rank ?? 0))
      .map(p => <tr key={p.id}><th scope="row"><span className="rank">{sober ? p.sober_rank : p.rank}</span>
        <Link to={'/players/' + p.id}>{p.name}</Link>
        {(!sober && p.preliminary || sober && p.sober_matches < 5) && <small>Предварительный</small>}</th>
      <td><strong>{decimal(sober ? p.sober_elo : p.elo, 0)}</strong>
        {!sober && <small>{p.elo_delta > 0 ? '+' : ''}{decimal(p.elo_delta, 0)}</small>}</td>
      <td>{sober ? p.observations.filter(o => o.sober_elo_after !== undefined && o.actual).length : p.wins}–{
        sober ? p.observations.filter(o => o.sober_elo_after !== undefined && !o.actual).length : p.losses}</td>
      <td>{percent(sober ? p.observations.filter(o => o.sober_elo_after !== undefined && o.actual).length /
        p.sober_matches : p.win_rate)}</td>
      {!sober && <td>{p.sober_elo === null ? '—' : decimal(p.sober_elo, 0)}<small>{p.sober_matches} матч.</small></td>}</tr>)}
  </tbody></table></div>
}

export function MatchList({ matches, state, details = false }: { matches: Match[]; state: State; details?: boolean }) {
  if (!matches.length) return <Empty>Пока нет матчей.</Empty>
  return <ul className="list matches">{matches.map(m => <li key={m.id}>
    <div className="match-line">
      <Link className={m.winner_id === m.player_a_id ? 'winner' : ''} to={'/players/' + m.player_a_id}>
        {playerName(state, m.player_a_id)}</Link>
      <strong className="result">{m.score_a}<span>:</span>{m.score_b}</strong>
      <Link className={m.winner_id === m.player_b_id ? 'winner' : ''} to={'/players/' + m.player_b_id}>
        {playerName(state, m.player_b_id)}</Link>
    </div>
    <small>До {m.target} · {stageName(state, m.stage_id)} · {date(m.started_at ?? m.created_at)}</small>
    {details && <small>Δ Elo {decimal(m.a.elo_after - m.a.elo_before)} / {decimal(m.b.elo_after - m.b.elo_before)} ·
      Этанол {decimal(m.a.ethanol_g)} / {decimal(m.b.ethanol_g)} г · Самооценка {
        m.a.self_rating ?? 'неизвестно'} / {m.b.self_rating ?? 'неизвестно'}</small>}
  </li>)}</ul>
}
