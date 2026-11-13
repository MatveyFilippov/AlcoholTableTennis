# ATT — architecture, canonical timeline, data model and API contract

This is an implementation contract, not a demand to generate a sprawling framework. **KISS:** modular monolith, 1 database, stateless API, one frontend, one edge proxy.

## 1. Preferred stack and repository layout

- `frontend/`: React + TypeScript + Vite, React Router, TanStack Query (or similarly clear server-state approach), Tailwind CSS, a small accessible UI primitive library if needed, Recharts (or a demonstrably appropriate lightweight chart library), Zod/form validation where helpful.
- `backend/`: Python 3.12+ with verified support, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic, PostgreSQL driver, pytest, Ruff; mypy/pyright for critical typed modules if feasible.
- `infra/`: Dockerfiles, `compose.prod.yml`, Caddyfile, deployment/backup/restore scripts, infrastructure examples. Deploy Compose uses 3 services: `web` (Caddy+compiled frontend with TLS and `/api/*` reverse proxy), `api` (FastAPI internal only), `db` (PostgreSQL internal only). Persistent named volumes for PG data and Caddy data/config; no `api` or `db` ports exposed to the internet.
- `.github/workflows/`: CI, image-build/publish, release/deploy; `.github/`: PR template, optional Code Owners.
- `docs/`: architecture, end-user instructions, deployment runbook, troubleshooting, API/algorithm explanation.
- root: `README.md`, `AGENTS.md`, `.env.example` with placeholders only, `.gitignore`, `LICENSE` only if owner elects to add one (public repo does **not** imply an open-source license).

Prefer React Router + query caching over heavy SSR, microservices, Redis, Celery, event bus or GraphQL. Charts must consume the same backend projections as score tables. The implementation may refine libraries as justified in PR but must preserve behavior and tests.

## 2. Canonical event ordering (critical design constraint)

**Problem:** admin corrections, simultaneous anonymous submissions, a local Live counter and drink logs must lead to repeatable Elo and consistent alcohol snapshots.

**Solution:** maintain a singleton `timeline_clock` row with `last_seq` incremented by the backend **under a transaction/row lock** for any published player, stage, drink or match. The integer sequence is monotonic in committed publication order. This is independent of client clock and display timestamp. A deleted/corrected event retains original sequence and audit trail. On update, rebuild derived projections from active canonical records sorted by `seq`, tie-break id if needed. Reads expose `snapshot_seq = last committed event seq`.

- Stage #0 is system-seeded and conceptually precedes timeline event #1. Player creations also consume a sequence number so the server can validate that a participant existed at an earlier Live snapshot.
- `GET /api/v1/state` returns current stage, `snapshot_seq`, players and their cumulative ethanol as of that sequence. A Live scorekeeper **reads** this once at start and stores `snapshot_seq` + stage id locally; it does not create a server match before completion.
- Quick match uses a `snapshot_seq` from state in its creation form. If not stale, persist the same snapshot; for stale state show a human-friendly warning and allow refresh (do not secretly replace snapshot). A finished Live match may be published with an older valid snapshot (e.g., another person logged a drink in the meantime) if the selected stage was active at that snapshot and participants existed then. Server reconstructs drink totals **as of** snapshot, not as of the later publication.
- Newly published match gets its own **publication seq** used for Elo order, even when state snapshot seq is earlier. This trade-off is intentional to avoid claiming exact physical chronology from client timestamps.
- Admin edits alcohol events may change grams for every later snapshot; app recalculates all affected consumption snapshots and sober eligibility from `snapshot_seq`, then replays ratings. Admin soft deletes have the same impact.
- Don't allow anonymous backdating or arbitrary changing of `seq`; admin cannot casually reorder events. `started_at` is informational only.
- Side-effect-free reads may use cached projections with version checking. At this expected scale (dozens of players, hundreds of matches) replaying on a write is cheap and simpler. If caching is used, update atomically or invalidate within same transaction to prevent stale published analytics.
- Every public POST that creates a persistent entry accepts `Idempotency-Key` UUID; store unique keys with response reference (scoped to endpoint/operation, reasonable TTL). Two retries with the same key and same request return the same result; same key with different payload must return HTTP 409.

## 3. Database entities (normalized suggestion)

### `tournaments`
- `id` singleton PK; `title`, `created_at`. No create/delete API. Only one record.

### `timeline_clock`
- Singleton `last_seq` BIGINT. Lock and increment inside all event creation transactions.

### `players`
- `id` UUID PK; `tournament_id` FK; `name`, `normalized_name` unique within tournament, `color_key`, `created_seq` BIGINT UNIQUE, `created_at`, `updated_at`, `archived_at` nullable, `row_version` for optimistic concurrency. No forced phone/email/auth identity.

### `stages`
- `id` UUID PK; `tournament_id` FK; `number` UNIQUE, `name`, `seq` UNIQUE nullable only for initial stage, `created_at`, `deleted_at` nullable; stage #0 seeded and immutable.

### `drink_events`
- `id` UUID PK; `player_id`, `stage_id`, `name`, `volume_ml` NUMERIC, `abv_percent` NUMERIC, `seq` BIGINT UNIQUE, `created_at`, `deleted_at` nullable, `row_version`, `created_request_id`. Recalculate grams from stored inputs; do not use float for money-like precision in records; decimal from DB, float only for analytics if well-defined.

### `matches`
- `id` UUID PK; `player_a_id`, `player_b_id` different; `target` in {11,21}; `score_a`,`score_b`; `stage_id` FK; `snapshot_seq` BIGINT; `seq` BIGINT UNIQUE; `started_at` optional client-supplied informational; `published_at` server timestamp; `a_intoxication` and `b_intoxication` nullable int 0..10; `deleted_at` nullable; `row_version`; `created_request_id`.
- Validate score and disallow inactive/deleted players at creation. Ensure stage existed at snapshot, both players existed by that point, and `snapshot_seq <= current last_seq`.
- Do not store outcome as an independently editable source of truth; derive winner from validated points. If materialized winner exists, update it atomically.

### `audit_log`
- `id`, `admin_session_id` nullable, `entity_type`, `entity_id`, `action` (`edit`, `soft_delete`, `restore`), `before_json`, `after_json`, `created_at`. Never include passwords/session secrets. Admin only viewing.

### `admin_sessions`
- Opaque random session token hashed server-side; `token_hash`, `created_at`, `expires_at`, `revoked_at`. Cookie carries only opaque token; HttpOnly, Secure, SameSite=Lax or Strict. Password stored as an Argon2id hash in env (`ADMIN_PASSWORD_HASH`); secret/pepper generated via documented command if relevant. Login rate limiting and CSRF protection for state-changing admin endpoints. No JWT/localStorage token needed.

### `idempotency_records`
- `operation`, `key`, `payload_hash`, `result_id`, `created_at` with unique tuple and expiry/cleanup mechanism.

**Indexes:** `(seq)` on events/matches, `(player_id,seq)` drinks, `(player_a_id,seq)`/`(player_b_id,seq)` matches, `(stage_id,seq)`, unique normalized player name, foreign-key indexes, audit timestamp. Define ON DELETE RESTRICT for history-bearing FK; use soft deletes, not cascading irreversible removal.

## 4. Projection algorithm

Treat persisted matches/stages/drinks as immutable timeline events for read model purposes, with admin version updates/deletes.

1. Read active players, stages and drinks indexed by `seq`. Build fast per-player cumulative ethanol prefix sums (Decimal input, deterministic conversion). Handle unknown or invalid legacy rows explicitly instead of defaulting to 0.
2. Read active matches ordered by `seq`. Resolve both players and their consumption **as of each match's `snapshot_seq`**, not `seq` (unless quick entry uses identical state). Since a drink may be corrected, never assume previously stored consumption snapshots remain valid without recomputing.
3. Initialize overall Elo=1000 for every active player, sober Elo=1000 internally. For every match: capture before/after overall values using the formula in SPEC. A sober match additionally updates the *separate* sober stream. Count stats, rank and aggregate expected residual from **before-match** overall Elo.
4. Emit read models with `projection_version` derived from `timeline_clock.last_seq` **and admin mutation revision** (admin edits do not consume new seq). This prevents serving stale projections after corrections.
5. Return missing values as `null` with clear status, never NaN/Infinity. Sort ties deterministically (e.g. by normalized player name then UUID).
6. Use DB transaction boundaries so read APIs never observe half-recomputed states.

Design decision: admin soft-delete of a player with existing history is blocked with a clear dependency error; provide **archive/hide from new selections** instead. This preserves audited match history and is safer than silently re-scoring everybody.

## 5. REST API (suggested shapes; publish OpenAPI from real implementation)

Root prefix: `/api/v1`; all timestamps ISO-8601 UTC. Use UUIDs. `GET` always anonymous. `POST` anonymous unless under `/admin`. `PATCH/DELETE` restricted to admin. Validate all input on server. Request bodies/types in this table are **minimum**; Codex must finalize Pydantic schemas and document them.

| Method | Endpoint | Permission | Purpose |
|---|---|---|---|
| GET | `/api/health/live` and `/api/health/ready` | public | liveness and DB readiness, no secrets |
| GET | `/api/v1/state` | public | tournament, current stage, last seq, players, state snapshot |
| GET/POST | `/api/v1/players` | public | list/create players |
| GET | `/api/v1/players/{id}` | public | full player profile and aggregated stats |
| GET/POST | `/api/v1/stages` | public | list/create stages |
| GET/POST | `/api/v1/drinks` | public | list/create drink entries with filters |
| GET/POST | `/api/v1/matches` | public | list/filter/create a validated completed match |
| GET | `/api/v1/matches/{id}` | public | match details and snapshot |
| GET | `/api/v1/leaderboard` | public | overall and sober standings |
| GET | `/api/v1/analytics/overview` | public | KPI, stage and timeline summary |
| GET | `/api/v1/analytics/players/{id}` | public | timeseries, buckets, correlation when eligible |
| GET | `/api/v1/analytics/head-to-head?player_a=...&player_b=...` | public | pair results |
| POST | `/api/v1/admin/login` | anonymous | password to secure session cookie |
| POST | `/api/v1/admin/logout` | admin | revoke session |
| GET | `/api/v1/admin/me` | admin | session status |
| PATCH | `/api/v1/admin/players/{id}` | admin | rename/archive (no destructive orphan deletion) |
| PATCH/DELETE | `/api/v1/admin/stages/{id}` | admin | edit/soft-delete when safe |
| PATCH/DELETE | `/api/v1/admin/drinks/{id}` | admin | edit/soft-delete and rebuild projections |
| PATCH/DELETE | `/api/v1/admin/matches/{id}` | admin | correct/delete and rebuild projections |
| POST | `/api/v1/admin/{entity}/{id}/restore` | admin | restore soft-deleted entry if safe |
| GET | `/api/v1/admin/audit` | admin | revision history |
| GET | `/api/v1/export` | public, P1 | JSON/CSV download with documented formats |

**State GET example (abbreviated)**:

```json
{
  "tournament": {"id": "...", "title": "ATT"},
  "current_stage": {"id": "...", "number": 2, "name": "Раунд 2"},
  "snapshot_seq": 27,
  "players": [{"id": "...", "name": "Rick", "ethanol_g": 19.725}]
}
```

**Match create example**:

```json
{
  "player_a_id": "UUID-A",
  "player_b_id": "UUID-B",
  "target": 11,
  "score_a": 12,
  "score_b": 10,
  "stage_id": "STAGE-UUID",
  "snapshot_seq": 27,
  "a_intoxication": 2,
  "b_intoxication": null,
  "started_at": "2026-11-12T17:30:00Z"
}
```

Response `201 Created` with match UUID, server seq, win/loss and version. ETags/`row_version` for admin edits and `409 Conflict` if a stale revision tries to overwrite another edit. Duplicate request with same Idempotency-Key returns canonical existing resource.

Errors: `400` bad request structure; `401` unauthorized admin; `403` forbidden action; `404` missing; `409` duplicate name, idempotency mismatch or conflicting revision; `422` score/range violations (align FastAPI validation); `429` rate-limited; `503` storage unavailable. Include `{ "error": { "code": "INVALID_SCORE", "message": "...", "request_id": "..." } }`. Admin routes should fail closed.

## 6. Frontend data handling

- Server state via cache/query library with invalidation on successful create/admin edit. The local scorekeeper is a separate state machine with a versioned `localStorage` draft.
- Never use `localStorage` as an authoritative backend database. Use it only for one device's draft. Persist points locally after each tap; implement undo stack and idempotency key in draft.
- Block start if A=B; show target and stage prominently; warn when ratings unknown; recover draft with explicit choice.
- For stale `snapshot_seq`, request an explicit reconciliation choice (refresh now vs retain original if valid); do not silently write incomplete state. Backend can reject if snapshot was invalidated by an administrative correction; keep draft and show how to recover.
- State update responses must never display developer stack traces to visitors. Show connection errors and retry action. Prevent double clicks during network calls.

## 7. Security and scope discipline

- Secrets: `.env.example` placeholder only; no real credentials in git, PR, screenshots, tests or logs.
- FastAPI trusted proxy headers and Caddy origin configuration, same-origin cookies, no wildcard CORS. Secure session cookies, password hash, admin login attempt throttling. Use parameterized queries and escaped React rendering; don't render arbitrary user-entered HTML.
- Public POST endpoints accept only explicitly allowed fields, bounded string lengths and sensible rate limits. Do not expose stack traces, Postgres or secret values in errors. Avoid CAPTCHA, OAuth, email verification or complex permission matrices unless an actual requirement emerges.
- Compose production services use non-root where practical, health checks and restart policy. Only edge exposes 80/443; SSH limited by firewall and key auth. Docker group access is root-equivalent — explicitly document this if chosen for the deploy account.
- Respect requests to use available skills/libraries, but audit output and remove unused dependencies. No speculative integrations.

## 8. Observability

- Structured application logs (request ID, method, route, status, latency), admin edit audit, startup migration log, deployment version in health response (without secrets).
- `/api/health/live` process up, `/api/health/ready` DB connectivity/schema readiness. If backend routes are implemented with `/api` directly, avoid double-prefix due to Caddy rewriting.
- No third-party telemetry by default. Supply scripts for inspecting Compose service health and last deployment SHA.
