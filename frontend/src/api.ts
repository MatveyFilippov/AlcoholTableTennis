export interface RecordBase {
  id: string
  seq: number
  row_version: number
  created_at: string
  deleted_at: string | null
}
export interface Stats {
  n: number
  wins: number
  losses: number
  win_rate: number | null
  expected: number | null
  residual: number | null
}
export interface Observation {
  match_id: string
  seq: number
  stage_id: string
  opponent_id: string
  actual: number
  expected: number
  residual: number
  ethanol_g: number
  self_rating: number | null
  elo_before: number
  elo_after: number
  sober_elo_after?: number
}
export interface Player extends RecordBase, Stats {
  name: string
  archived_at: string | null
  rank: number | null
  sober_rank: number | null
  elo: number
  elo_delta: number
  sober_elo: number | null
  sober_matches: number
  preliminary: boolean
  ethanol_g: number
  volume_ml: number
  observations: Observation[]
}
export interface Stage extends RecordBase {
  name: string
  number: number
  matches: number
  assessments: number
  mean_rating: number | null
  median_rating: number | null
  ethanol_g: number
}
export interface Drink extends RecordBase {
  player_id: string
  stage_id: string
  name: string
  volume_ml: number
  abv_percent: number
  ethanol_g: number
  cumulative_g: number
  cumulative_ml: number
}
export interface MatchInput {
  player_a_id: string
  player_b_id: string
  stage_id: string
  target: number
  score_a: number
  score_b: number
  snapshot_seq: number
  a_intoxication: number | null
  b_intoxication: number | null
  started_at?: string
  mode: 'live' | 'quick'
}
export interface Match extends RecordBase, Omit<MatchInput, 'mode' | 'started_at'> {
  winner_id: string
  started_at: string | null
  sober: boolean
  a: Observation
  b: Observation
}
export interface State {
  tournament: { id: string; title: string }
  current_stage: Stage
  snapshot_seq: number
  projection_version: string
  last_activity: string | null
  stages: Stage[]
  players: Player[]
  drinks: Drink[]
  matches: Match[]
}
export interface Profile extends Player {
  matches: Match[]
  drinks: Drink[]
  bins: (Stats & { label: string })[]
  stages: (Stats & { id: string })[]
  opponents: (Stats & { id: string })[]
}
export interface Pair {
  n: number
  a_wins: number
  b_wins: number
  matches: Match[]
}

export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message)
  }
}

export async function api<T>(path: string, options?: {
  method?: string
  body?: unknown
  key?: string
  signal?: AbortSignal
}): Promise<T> {
  const headers = new Headers()
  if (options?.body !== undefined) headers.set('Content-Type', 'application/json')
  if (options?.key) headers.set('Idempotency-Key', options.key)
  if (path.startsWith('/admin/')) headers.set('X-ATT-Admin', '1')
  let response: Response
  try {
    response = await fetch('/api/v1' + path, {
      method: options?.method, headers, signal: options?.signal,
      body: options?.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch (error) {
    if (options?.signal?.aborted) throw error
    throw new ApiError('Нет связи с сервером. Повторите попытку.', 'NETWORK', 0)
  }
  const result = await response.json().catch(() => null)
  if (!response.ok || result === null) {
    throw new ApiError(result?.error?.message ?? 'Сервер временно недоступен.',
      result?.error?.code ?? 'UNAVAILABLE', response.status)
  }
  return result as T
}

export const decimal = (value: number | null, digits = 1) =>
  value === null ? '—' : value.toLocaleString('ru-RU', { maximumFractionDigits: digits })
export const percent = (value: number | null) => value === null ? '—' : decimal(value * 100, 0) + '%'
export const date = (value: string | null) => value
  ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  : '—'
export const playerName = (state: State, id: string) =>
  state.players.find(player => player.id === id)?.name ?? 'Игрок'
export const stageName = (state: State, id: string) =>
  state.stages.find(stage => stage.id === id)?.name ?? 'Этап'
