import { useId } from 'react'
import { decimal } from './api'
import type { Observation, Player, State } from './api'
import { Empty } from './ui'

const palette = ['#286448', '#a34e28', '#486184', '#7f4b78', '#775c16']
function color(id: string) {
  let index = 0
  for (const character of id) index = (index * 31 + character.charCodeAt(0)) % palette.length
  return palette[index]
}

interface Point { x: number; y: number; label: string }
interface Series { name: string; id: string; points: Point[] }

function Plot({ series, xLabel, yLabel, markers = [], lines = false, range }: {
  series: Series[]; xLabel: string; yLabel: string; markers?: { seq: number; label: string }[]
  lines?: boolean; range?: [number, number]
}) {
  const id = useId()
  const points = series.flatMap(s => s.points)
  if (!points.length) return <Empty>Пока нет данных для графика.</Empty>
  const xMax = Math.max(1, ...points.map(p => p.x), ...markers.map(m => m.seq))
  const minimum = range?.[0] ?? Math.min(1000, ...points.map(p => p.y))
  const maximum = range?.[1] ?? Math.max(1001, ...points.map(p => p.y))
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
      {markers.map(m => <line key={m.seq} x1={x(m.seq)} x2={x(m.seq)} y1="33" y2="192" className="marker">
        <title>{m.label}</title></line>)}
      <text x="60" y="213">0</text><text x="462" y="210" textAnchor="end">{decimal(xMax)}</text>
      <text x="462" y="231" textAnchor="end">{xLabel}</text>
      {series.map(s => <g key={s.id} style={{ color: color(s.id) }}>
        {lines && s.points.length > 1 && <polyline fill="none" stroke="currentColor" strokeWidth="2"
          points={s.points.map(p => `${x(p.x)},${y(p.y)}`).join(' ')} />}
        {s.points.map((p, index) => <circle key={index} cx={x(p.x)} cy={y(p.y)} r="4" fill="currentColor">
          <title>{s.name} · {p.label}</title></circle>)}
      </g>)}
    </svg>
    <figcaption>{series.map(s => <span key={s.id}><i style={{ background: color(s.id) }} />{s.name} · {s.points.length} набл.</span>)}</figcaption>
    {!!markers.length && <p className="muted">Этапы: {markers.map(m => `№${m.seq} · ${m.label}`).join('; ')}</p>}
    <details><summary>Значения графика</summary><ul>{series.flatMap(s => s.points.map((p, index) =>
      <li key={s.id + index}>{s.name} · {p.label}</li>))}</ul></details>
  </figure>
}

export function RatingChart({ state, players, sober = false }: { state: State; players: Player[]; sober?: boolean }) {
  return <Plot lines xLabel="Номер записи" yLabel={sober ? 'Трезвый Elo' : 'Elo'}
    markers={state.stages.slice(1).map(s => ({ seq: s.seq, label: s.name }))}
    series={players.map(p => ({ name: p.name, id: p.id, points: p.observations.flatMap(o => {
      const value = sober ? o.sober_elo_after : o.elo_after
      return value === undefined ? [] : [{ x: o.seq, y: value, label: `№${o.seq} · ${decimal(value, 2)}` }]
    }) }))} />
}

export const associationNote = 'Связь не доказывает причинность: на результат влияют соперник, усталость и случайность.'

export function AlcoholScatter({ state, player }: { state: State; player: Player }) {
  return <>
    <Plot xLabel="Этанол, г" yLabel="Факт − ожидание" range={[-1, 1]}
      series={state.stages.map(s => ({
        id: s.id, name: s.name, points: player.observations.filter(o => o.stage_id === s.id).map(o => ({
          x: o.ethanol_g, y: o.residual,
          label: `№${o.seq} · ${decimal(o.ethanol_g, 3)} г · ${decimal(o.residual, 3)}`,
        })),
      })).filter(s => s.points.length)} />
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

export function ConsumptionChart({ player, drinks }: { player: Player; drinks: { seq: number; cumulative_g: number }[] }) {
  return <><Plot lines xLabel="Номер записи" yLabel="Всего этанола, г" range={[0, Math.max(1, player.ethanol_g)]}
    series={[{ name: player.name, id: player.id, points: [...drinks].reverse().map(d => ({
      x: d.seq, y: d.cumulative_g, label: `№${d.seq} · ${decimal(d.cumulative_g, 3)} г`,
    })) }]} /><p className="muted">{associationNote}</p></>
}
