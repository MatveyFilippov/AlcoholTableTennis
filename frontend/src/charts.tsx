import { useId, useState } from 'react'
import { date, decimal, percent, playerName } from './api'
import type { Observation, Player, State } from './api'
import { Empty, PlayerSelect } from './ui'

const palette = ['#286448', '#a34e28', '#486184', '#7f4b78', '#775c16']
function color(id: string) {
  let index = 0
  for (const character of id) index = (index * 31 + character.charCodeAt(0)) % palette.length
  return palette[index]
}

interface Point { x: number; y: number; label: string }
interface Series { name: string; id: string; points: Point[] }

function Plot({ series, xLabel, yLabel, lines = false, range }: {
  series: Series[]; xLabel: string; yLabel: string
  lines?: boolean; range?: [number, number]
}) {
  const id = useId()
  const points = series.flatMap(s => s.points)
  if (!points.length) return <Empty>Пока нет данных для графика.</Empty>
  const xMax = points.reduce((max, p) => Math.max(max, p.x), 1)
  const minimum = range?.[0] ?? points.reduce((min, p) => Math.min(min, p.y), 1000)
  const maximum = range?.[1] ?? points.reduce((max, p) => Math.max(max, p.y), 1001)
  const pad = range ? 0 : Math.max(4, (maximum - minimum) * .1)
  const yMin = minimum - pad
  const yMax = maximum + pad
  const x = (value: number) => 60 + value / xMax * 402
  const y = (value: number) => 192 - (value - yMin) / (yMax - yMin) * 159
  return <figure className="plot">
    <svg viewBox="0 0 480 232" role="img" aria-labelledby={id}>
      <title id={id}>{yLabel} по оси {xLabel.toLowerCase()}. Значения доступны под графиком.</title>
      <text x="60" y="17">{yLabel}</text>
      {[0, .25, .5, .75, 1].map(f => {
        const value = yMin + (yMax - yMin) * f
        return <g key={f}><line x1="60" x2="462" y1={y(value)} y2={y(value)} className="gridline" />
          <text x="51" y={y(value) + 4} textAnchor="end">{decimal(value, range ? 2 : 0)}</text></g>
      })}
      <text x="60" y="213">0</text><text x="462" y="213" textAnchor="end">{decimal(xMax)}</text>
      <text x="462" y="231" textAnchor="end">{xLabel}</text>
      {series.map(s => <g key={s.id} style={{ color: color(s.id) }}>
        {lines && s.points.length > 1 && <polyline fill="none" stroke="currentColor" strokeWidth="2"
          points={s.points.map(p => `${x(p.x)},${y(p.y)}`).join(' ')} />}
        {s.points.map((p, index) => <circle key={index} cx={x(p.x)} cy={y(p.y)} r="4" fill="currentColor">
          <title>{s.name} · {p.label}</title></circle>)}
      </g>)}
    </svg>
    <figcaption>{series.map(s => <span key={s.id}><i style={{ background: color(s.id) }} />{s.name} · {s.points.length} набл.</span>)}</figcaption>
    <details><summary>Значения графика</summary><ul>{series.flatMap(s => s.points.map((p, index) =>
      <li key={s.id + index}>{s.name} · {p.label}</li>))}</ul></details>
  </figure>
}

export function RatingChart({ players }: { players: Player[] }) {
  return <Plot lines xLabel="Номер записи" yLabel="Elo"
    series={players.filter(p => p.n).map(p => ({
      name: p.name, id: p.id, points: p.observations.map(o => ({
        x: o.seq, y: o.elo_after, label: `№${o.seq} · ${decimal(o.elo_after, 2)}`,
      })),
    }))} />
}

export function RatingSelection({ players }: { players: Player[] }) {
  const [primary, setPrimary] = useState('')
  const [secondary, setSecondary] = useState('')
  const played = players.filter(p => p.n)
  if (!played.length) return <Empty>Рейтинг появится после первого матча.</Empty>
  const a = played.find(p => p.id === primary) ?? played.find(p => p.id !== secondary) ?? played[0]
  const b = played.find(p => p.id === secondary && p.id !== a.id)
  return <>
    <div className="filters">
      <PlayerSelect label="Игрок на графике Elo" players={played} value={a.id} exclude={b?.id} onChange={setPrimary} />
      <PlayerSelect label="Сравнить Elo с игроком" players={played} value={b?.id ?? ''} exclude={a.id}
        onChange={setSecondary} emptyLabel="Без второго игрока" optional />
    </div>
    <RatingChart players={b ? [a, b] : [a]} />
  </>
}

export const associationNote = 'Связь не доказывает причинность: на результат влияют соперник, усталость и случайность.'

export function AlcoholScatter({ state, player }: { state: State; player: Player }) {
  const matches = new Map(state.matches.map(m => [m.id, m]))
  const points = player.observations.map(o => {
    const match = matches.get(o.match_id)
    const result = o.actual ? 'победа' : 'поражение'
    const score = match ? `${match.score_a} : ${match.score_b}` : '—'
    const assessment = o.self_rating === null ? 'неизвестно' : `${o.self_rating}/10`
    return {
      x: o.ethanol_g, y: o.residual,
      label: `№${o.seq} · ${date(match?.started_at ?? match?.created_at ?? null)} · ${playerName(state, o.opponent_id)} · счёт ${score} · ${result} · самооценка ${assessment} · ${decimal(o.ethanol_g, 3)} г · ожидание ${percent(o.expected)} · разница ${decimal(o.residual, 3)}`,
    }
  })
  return <>
    <Plot xLabel="Этанол на начало матча, г" yLabel="Факт − ожидание" range={[-1, 1]}
      series={[{ id: player.id, name: player.name, points }]} />
    {points.length > 0 && points.length < 4 && <p className="muted">Мало матчей для выводов.</p>}
    {points.length > 1 && new Set(points.map(p => p.x)).size === 1 &&
      <p className="muted">Во всех этих матчах записано одинаковое количество этанола.</p>}
    <p className="muted">{associationNote}</p>
  </>
}

export function AssessmentChart({ player, observations }: { player: Player; observations: Observation[] }) {
  const known = observations.flatMap(o => o.self_rating === null ? [] :
    [{ x: o.seq, y: o.self_rating, label: `№${o.seq} · ${o.self_rating}/10` }])
  return <><Plot xLabel="Номер записи" yLabel="Самооценка, 0–10" range={[0, 10]}
    series={[{ name: player.name, id: player.id, points: known }]} />
    <p className="muted">Неизвестных оценок: {observations.length - known.length}. {associationNote}</p></>
}

export function ConsumptionChart({ player }: { player: Player }) {
  const points = player.observations.map(o => ({
    x: o.seq, y: o.ethanol_g, label: `№${o.seq} · ${decimal(o.ethanol_g, 3)} г`,
  }))
  const maximum = points.reduce((value, point) => Math.max(value, point.y), 1)
  return <><Plot lines xLabel="Номер записи" yLabel="Этанол на начало матча, г" range={[0, maximum]}
    series={[{ name: player.name, id: player.id, points }]} /><p className="muted">{associationNote}</p></>
}
