# ATT verification plan and definition of done

A PR is **not** complete merely because code compiles. CI must run deterministic automated checks; Codex Work must also run local tests and inspect a production-like UI.

## 1. Required test layers

- **Backend unit (pytest):** scoring validator, Elo formula, sober qualification, cumulative ethanol, stage order, analytics buckets, Spearman (if implemented), tie handling and unknown values. Golden fixtures with explicit expected numbers.
- **Backend integration:** PostgreSQL real DB via Compose or testcontainers; migrations from empty schema, FK/unique, transactions and canonical timeline, historical edit replay, soft delete/restore, idempotency, admin/anonymous permissions, contradictory snapshots, concurrent public POSTs.
- **Frontend unit (Vitest + Testing Library):** forms, numeric validation, scorekeeper state machine, undo/recovery, null-state messages, admin UI gating, chart empty states.
- **E2E (Playwright):** mobile + desktop major journeys against running backend/database, isolated fresh DB/test namespace, no real production endpoint or credentials. Use deterministic seeded **test fixtures only**.
- **Static:** TypeScript strict, ESLint, formatting, Python Ruff (+ typing where practical), dependency vulnerability review (non-blocking unless high-risk and exploitable), build.
- **Deployment dry-run:** `docker compose config`, container healthchecks, startup/migration smoke, GitHub Actions workflow syntax and release tag guard tests or a script test harness. Docker image build on CI.

## 2. Score validator cases (mandatory table-driven)

| Target | Score | Expected |
|---:|---|---|
| 11 | 11:0, 11:9, 12:10, 13:11 | valid |
| 11 | 11:10, 12:9, 13:10, 15:11, 10:10, 0:0 | invalid |
| 21 | 21:0, 21:19, 22:20, 23:21 | valid |
| 21 | 21:20, 22:18, 23:19, 20:20 | invalid |
| 11 or 21 | negative, fractional, string, missing, huge (> sensible bound), equal players | invalid |

Also test either side can win; target switch, score entry and undo after a finished score, no ties and idempotent post.

## 3. Elo golden cases

- A=1000, B=1000, A wins: A=1016, B=984; B wins return expected values using **pre-match** ratings, not sequential in-place update.
- First upset (1000 vs 1200): expected numeric change matches pure formula with K=32 within tolerance 1e-8.
- Two target formats with identical pre-ratings/outcome produce identical rating delta.
- 3 players and sequence A>B, B>C, C>A; full replay deterministic after recalculation; no winner inference from scoreboard string.
- Edit earliest match (A>B becomes B>A): later before/after Elo and ranking recalculated, matching clean replay from corrected source list.
- Admin delete/restore returns exactly the original projections when restoration recreates original active data.
- One-time player and never-met pair: no fake high confidence or inferred Head-to-Head.
- Verify sum of two changes per match is ~0 to numerical precision.

## 4. Alcohol & timelines

- 500 ml at 5% ABV gives 19.725 g ethanol approximately; 0% beverage adds 0 g; 100 ml 40% gives 31.56 g.
- Stage #0 initial matches: 0 known and no consumption; sober eligible. Later stage without drink: explicit 0+0 still sober. Unknown assessment is not sober, even without drink.
- One player drinks while opponent does not; stage creation alone must not add ethanol for anyone.
- Live draft captures `snapshot_seq=10`; a new drink logged at seq 11 before match published at seq 12 must **not** appear in that match's captured consumption. A quick match created after drink uses seq >=11 and sees drink.
- Admin edits/removes the seq-11 drink: snapshots of matches whose snapshot_seq >=11 change; earlier captured matches do not. Replay changes sober qualification where applicable.
- Repeat POST with same idempotency key: one persisted event/match; changed payload under same key returns 409.
- Concurrent drink + match writes get globally unique ordered seq and never produce an invalid cumulative snapshot.
- Subjective values 0,10 accepted; -1,11 and non-integer rejected; `null` displayed as unknown and excluded from numeric statistics.
- Spearman: insufficient sample, all-same values, ties, null, perfect positive/negative toy datasets, zero-variance guard. No NaN emitted.

## 5. User journeys

### Visitor flow

1. Load empty site; no demo players or fake chart data.
2. Add players A, B, C; prevent duplicate names; show all.
3. Add stage #1, log different drinks for A and B, no drink for C.
4. Add match A vs B quick entry up to 11, set both 0–10 scores, save; verify standings/drink snapshots.
5. Start live match B vs C up to 21, add points, undo, refresh and recover draft, end and confirm once; verify no server match was created before confirming and retry doesn't duplicate.
6. Visit Overview, head-to-head, sober comparison, player details, analytics; confirm small-sample notices are accurate.

### Admin flow

1. Anonymous PATCH/DELETE denied (401/403), while public POST succeeds.
2. Admin wrong password throttled; correct password creates HttpOnly secure session; logout revokes.
3. Fix old match, assert all downstream Elo history matches replay.
4. Edit old drink, assert consumption and sober eligibility updated, audit entry recorded.
5. Try to delete referenced player/stage; blocked with readable dependency explanation, not a broken FK or cascade.
6. Confirm admin edit stale row_version returns 409 and indicates refresh/retry.

### Responsive/accessibility flow

- 320px, 390px and desktop width; no horizontal scroll on main screens, keyboard-driven forms, clearly named score buttons, visible focus states, reduced-motion setting applied.
- No chart lies about absence of data; missing value not printed as `0`.
- No live scoreboard synchronization across browsers is claimed; only saved completed match is visible remotely.

## 6. Release/operation gates

- PR to `dev` and to `main`: all automated checks green; tests required before merge.
- Push to `main` builds immutable GHCR `sha-<commit>` web/api images, **not** deploy; tag is not a deployment event by itself.
- GitHub Release `published`: only stable `vMAJOR.MINOR.PATCH`, commit equals intended protected `main` HEAD or passes explicit repository-approved guard, non-prerelease; expected image SHA exists; deploy through `production` GitHub Environment with no direct Codex SSH.
- Deliberately create/tag a non-main commit in a test fixture: deployment guard fails without SSH.
- Before deploy, backup database; apply backward-compatible migrations; on failure, return to previous compatible images (never silently restore an incompatible schema) and report failure.
- HTTPS reachable at domain, application `/api/health/ready` and landing page healthy after deployment; database survives container rebuild.
- Run a manual backup restore rehearsal using a staging or temporary database; never test a destructive restore on live user data.

## 7. PR deliverables and evidence

- Functional source, lockfiles, reproducible local setup and relevant `.env.example`.
- Migrations and example fixtures for tests; scripts with clear usage; full passing test output in PR summary.
- User README, API OpenAPI, backend architecture explanation and decision record for non-obvious design choices.
- UI screenshots for representative mobile/desktop states; concise accessibility findings.
- GitHub Actions workflows, explicit owner-only bootstrap checklist, GHCR and production rollback runbook.
- `AGENTS.md` adopted. PR title/commit format Conventional Commits. No generated unrelated files, unrelated refactors, secrets, binaries or vendor directories.

**If external GitHub/VPS settings prevent completing a check:** mark it *blocked*, give precise owner instructions; never fabricate a successful deployment or claim tests passed if not run.
