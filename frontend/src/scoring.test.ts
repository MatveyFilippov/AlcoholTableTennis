import { describe, expect, it } from 'vitest'
import { addPoint, finished, matchBody, readDraft, score, undo } from './scoring'
import type { Draft } from './scoring'

const uuid = (n: number) => `00000000-0000-0000-0000-00000000000${n}`
const draft: Draft = {
  version: 2, timestamp: 100, key: uuid(1), points: [], pending: false,
  setup: {
    player_a_id: uuid(2), player_b_id: uuid(3),
    target: 11, snapshot_seq: 7, a_intoxication: 0, b_intoxication: null,
    nameA: 'Анна', nameB: 'Борис', gramsA: 0, gramsB: 10,
    started_at: '2026-11-13T12:00:00Z',
  },
}

describe('scorekeeper', () => {
  it.each([[11, 11, 0, true], [11, 12, 10, true], [21, 21, 19, true], [21, 21, 23, true],
    [11, 11, 10, false], [11, 12, 9, false], [21, 22, 18, false], [11, 11.5, 9, false]])(
    'target %i, score %i:%i', (target, a, b, valid) => expect(finished(target, a, b)).toBe(valid))
  it('recovers, stops and undoes a completed match', () => {
    const completed = Array.from({ length: 11 }).reduce<Draft>(current => addPoint(current, 'a'), draft)
    expect(score(completed.points)).toEqual([11, 0])
    expect(addPoint(completed, 'b')).toBe(completed)
    expect(readDraft(JSON.stringify(completed))).toEqual(completed)
    expect(score(undo(completed).points)).toEqual([10, 0])
    expect(undo({ ...completed, pending: true }).points).toHaveLength(11)
  })
  it('discards malformed drafts and preserves unknown rating in the retry body', () => {
    expect(readDraft('{bad')).toBeNull()
    expect(readDraft(JSON.stringify({ ...draft, points: ['a', 'c'] }))).toBeNull()
    expect(readDraft(JSON.stringify({ ...draft, points: Array(12).fill('a') }))).toBeNull()
    expect(matchBody(draft.setup, 11, 0, 'live')).toMatchObject({
      snapshot_seq: 7, a_intoxication: 0, b_intoxication: null, score_a: 11,
    })
  })
})

it('migrates legacy scores and blocks an uncertain legacy publication until reconciled', () => {
  const legacy = { ...draft, version: 1, points: Array(11).fill('a'),
    setup: { ...draft.setup, stage_id: uuid(4), stageName: 'Старый этап' } }
  const unsent = readDraft(JSON.stringify(legacy))!
  expect(unsent.version).toBe(2)
  expect(unsent.setup).toEqual(draft.setup)
  expect(unsent.key).toBe(draft.key)
  expect(unsent.points).toHaveLength(11)
  const pending = readDraft(JSON.stringify({ ...legacy, pending: true }))!
  expect(pending).toMatchObject({ version: 2, pending: true, needsPublicationCheck: true })
  expect(undo(pending)).toBe(pending)
  expect(readDraft(JSON.stringify(pending))).toEqual(pending)
})
