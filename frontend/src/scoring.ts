import type { MatchInput } from './api'

export const maxPoints = 999
export const draftKey = 'att-scorekeeper-v2'
export const legacyDraftKey = 'att-scorekeeper-v1'
export const draftLifetime = 48 * 60 * 60 * 1000

export interface Setup extends Omit<MatchInput, 'mode' | 'score_a' | 'score_b'> {
  nameA: string
  nameB: string
  gramsA: number
  gramsB: number
}

export interface Draft {
  version: 2
  timestamp: number
  key: string
  setup: Setup
  points: ('a' | 'b')[]
  pending: boolean
  needsPublicationCheck?: boolean
}

export function finished(target: number, a: number, b: number) {
  const winner = Math.max(a, b)
  const loser = Math.min(a, b)
  return (target === 11 || target === 21) && [a, b].every(Number.isInteger) &&
    loser >= 0 && winner <= maxPoints && winner === Math.max(target, loser + 2)
}

export function score(points: Draft['points']): [number, number] {
  let a = 0
  for (const point of points) if (point === 'a') a++
  return [a, points.length - a]
}

export function addPoint(draft: Draft, side: 'a' | 'b'): Draft {
  const [a, b] = score(draft.points)
  if (draft.pending || finished(draft.setup.target, a, b) || (side === 'a' ? a : b) >= maxPoints) {
    return draft
  }
  return { ...draft, points: [...draft.points, side] }
}

export function undo(draft: Draft): Draft {
  return draft.pending ? draft : { ...draft, points: draft.points.slice(0, -1) }
}

export function readDraft(raw: string | null): Draft | null {
  if (!raw) return null
  try {
    const d = JSON.parse(raw) as Omit<Draft, 'version'> & { version: number }
    const s = d.setup
    const uuid = (value: unknown) => typeof value === 'string' &&
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    const rating = (value: unknown) => value === null ||
      (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10)
    if (![1, 2].includes(d.version) || !Number.isFinite(d.timestamp) || d.timestamp <= 0 ||
      !uuid(d.key) || typeof d.pending !== 'boolean' ||
      (d.needsPublicationCheck !== undefined && (d.needsPublicationCheck !== true || !d.pending)) ||
      ![s.player_a_id, s.player_b_id].every(uuid) ||
      s.player_a_id === s.player_b_id || ![11, 21].includes(s.target) ||
      !Number.isSafeInteger(s.snapshot_seq) || s.snapshot_seq < 0 ||
      !rating(s.a_intoxication) || !rating(s.b_intoxication) ||
      ![s.nameA, s.nameB].every(value => typeof value === 'string' && value.length > 0) ||
      ![s.gramsA, s.gramsB].every(value => Number.isFinite(value) && value >= 0) ||
      !s.started_at || !Number.isFinite(Date.parse(s.started_at)) ||
      !Array.isArray(d.points) || d.points.length > maxPoints * 2) return null
    let a = 0
    let b = 0
    for (const point of d.points) {
      if (finished(s.target, a, b)) return null
      if (point === 'a') a++
      else if (point === 'b') b++
      else return null
    }
    if (Math.max(a, b) > maxPoints || (d.pending && !finished(s.target, a, b))) return null
    return {
      version: 2, timestamp: d.timestamp, key: d.key, points: d.points, pending: d.pending,
      ...(d.needsPublicationCheck || (d.version === 1 && d.pending) ? { needsPublicationCheck: true } : {}),
      setup: {
        player_a_id: s.player_a_id, player_b_id: s.player_b_id, target: s.target,
        snapshot_seq: s.snapshot_seq, a_intoxication: s.a_intoxication, b_intoxication: s.b_intoxication,
        started_at: s.started_at, nameA: s.nameA, nameB: s.nameB, gramsA: s.gramsA, gramsB: s.gramsB,
      },
    }
  } catch {
    return null
  }
}

export function matchBody(setup: Setup, a: number, b: number, mode: MatchInput['mode']): MatchInput {
  const { player_a_id, player_b_id, target, snapshot_seq,
    a_intoxication, b_intoxication, started_at } = setup
  return { player_a_id, player_b_id, target, snapshot_seq,
    a_intoxication, b_intoxication, started_at, score_a: a, score_b: b, mode }
}
