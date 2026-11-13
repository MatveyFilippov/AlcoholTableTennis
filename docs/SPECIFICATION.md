# ATT — Alcohol Table Tennis
## Product requirements & technical specification (v1 / alpha → production)

**Status:** agreed requirements. **Date:** 2026-11-12. **Repository:** `MatveyFilippov/AlcoholTableTennis` (public, created and configured by owner). **Production:** `https://att.ricksanchez.ru`, Ubuntu Server 24.04, DNS already configured.

> **Instruction priority:** This document is the functional source of truth; `ARCHITECTURE_AND_API.md` details the implementation contract, `DESIGN_BRIEF.md` the UI, `TEST_PLAN.md` the acceptance criteria, and `AGENTS.md` the execution rules. If a genuine contradiction remains, document it in the PR and prefer the simpler implementation that respects all decisions. Do not silently invent product features.

## 1. Purpose, audience and boundaries

Build a polished, practical, Russian-language, mobile-first web application for a group of friends to record **one continuous evening of singles table-tennis matches**, alcohol consumption and subjective intoxication, and to study the *association* between consumption and match performance. The number of players is unknown and can exceed two. A player may play only once or against only one opponent. The app remains online and editable indefinitely; it does **not** support multiple tournaments, seasons or automatic reset.

This is an informal exploratory experiment, **not** a blood-alcohol calculator, medical instrument or causal analysis. Do not assert that alcohol improves performance. Avoid suggesting consumption targets or competition in drinking.

**P0 (must ship):** anonymous public creation, public read, private admin corrections/deletions, match registration, single-device live counter, alcohol log, stages, player stats, Elo and sober Elo, visual analytics, responsive professional UI, tests, documented GitHub CI/CD and release deployment.

**P1 (nice if P0 is completed):** CSV/JSON export, image-free shareable player pages, keyboard shortcuts, reduced-motion animation polish, lightweight PWA installation (without promising offline synchronization). Never delay P0 for P1.

**Explicitly out of scope:** accounts, OAuth, roles beyond anonymous/admin, doubles, tournament brackets, multi-evening support, best-of-X sets, online multiplayer scorekeeper, real-time collaborative editing, comments, chat, BAC estimates, wagers, notifications, an AI assistant, gamification rewards for drinking.

## 2. Unambiguous user roles

| Operation | Anonymous visitor | Administrator |
|---|:---:|:---:|
| View dashboards, all players, alcohol events, ratings and detailed stats | Yes | Yes |
| Create player, alcohol stage, drink entry and match | Yes | Yes |
| Use local, unpublished scorekeeper | Yes | Yes |
| Edit or soft-delete existing data | No | Yes |
| View modification history, restore soft-deleted records | No | Yes |
| Export public statistics (if implemented) | Yes | Yes |

No registration or visitor passwords. Exactly one admin credential configured through secrets; admin login/logout establishes a secure server-validated session. No hardcoded default password. For anonymous writes, provide normal confirmation and clear validation errors; do not build heavy anti-abuse infrastructure for friends-only usage. Apply cheap basic rate limits, CSRF protection where appropriate, and strict server validation.

All recorded alcohol details are public: player pseudonym, beverage, amount, ABV, stages, intoxication ratings. Include a concise non-modal privacy notice near player creation and drink entry: *«Статистика этого вечера, включая сведения об алкоголе, публична. Используйте псевдонимы и добавляйте данные с согласия участников.»*

## 3. Core entities and flow

### 3.1 One singleton tournament

- Seed exactly one tournament during first initialization (id constant or singleton table). No UI/API for creating new tournaments, starting another evening, closing, archiving, or automatic resetting.
- It spans one continuous period of play and drinking on a single evening. The application may stay online long after; historical data stays visible and administratively correctable.
- UI shows project title, match count, player count, stage and last activity, without introducing seasons.
- When empty, show helpful empty states and one-click actions instead of fabricated sample statistics.

### 3.2 Players

- Create a player with a short display name/pseudonym; optional color/avatar initial generated from identity, not from AI stock photography. Set a predictable accent color per player.
- Normalize whitespace and Unicode; reject empty, overlong, control characters and case-insensitive duplicate normalized names with actionable error. Admin may rename and soft-delete. Block deletion if it would silently orphan records; admin can soft-delete with clear impact warning, with results omitted from active analytics or explicitly anonymized according to the implementation policy. Preferred: prohibit deleting players referenced in matches/drinks; allow rename and archive/hide from creation lists, retaining statistics.
- New players initialize at Elo 1000 and sober Elo 1000; do not rank unplayed players above participants just because of initial score.
- Player profile: match log, wins/losses, match count, Win Rate, overall Elo, sober Elo, change from baseline, rank, opponent breakdown, drink log, total ethanol, subjective intoxication plot, performance by stage, sample-size warnings.

### 3.3 Stages of consumption

- Stage #0 is predefined as **«Трезвые»**: initially every player is assumed to have consumed zero alcohol and is assigned subjective 0/10 **for matches in this stage**. Do **not** silently carry this subjective value into later stages, or interpret missing data elsewhere as 0.
- Visitors may create an unlimited number of subsequent stages: stage #1 «Раунд 1», #2 «Раунд 2» etc. Optional short display label. Stage is a timeline marker, not a set of matches and not a separate tournament.
- Stages are global, but participation in drinking is individual. A player may stay sober across all stages. Creating a stage does **not** imply that everybody drank.
- Only admin can rename/soft-delete stages; forbid deletion of stages referenced by active drink events/matches until dependencies are resolved. Make dependencies explicit in the UI.
- No reset of alcohol totals. Stage order is immutable in normal UX; no backdating arbitrary events by anonymous users.

### 3.4 Alcohol consumption events

- Anonymous visitor chooses player, stage, drink name/type, volume in ml (>0, sane maximum), ABV percentage (0..100), confirms entry. Store creation time and canonical event sequence assigned by backend. Optionally support non-alcoholic drinks at 0%; these do not increase ethanol.
- Formula for approximate **grams of pure ethanol**: `volume_ml × (abv_percent / 100) × 0.789` (ethanol density in g/ml, approximate). Preserve raw inputs at full precision; round for presentation only. Do not call the result BAC or effective drunkenness.
- For each player, display cumulative volume and cumulative ethanol by timeline. More ethanol does *not* automatically increase the subjective 0–10 score.
- All drinks, volumes and ABV are visible publicly. Admin can edit/soft-delete records; dependent derived state/statistics must be invalidated and recalculated.
- Drink names should be editable text (not a fixed catalog). Fast entry may offer recent templates, but no external alcohol product API is needed.

### 3.5 Subjective intoxication (0–10)

- **Integer** 0–10 inclusive. 0 = self-reported sober, 10 = highest self-reported intoxication on this scale; no conversion to BAC or claim of clinical accuracy.
- Store assessment separately for each **participant in each match**, reflecting their state **at match start**, nullable if unknown. The UI asks for/lets the recorder explicitly confirm both values; during stage #0 use prefilled 0 and label this initial premise. At subsequent stages, only suggest the prior value as a labeled suggestion; do not silently auto-fill unknowns as 0.
- A player who has not consumed alcohol can explicitly report 0 during later stages.
- Scorekeeper captures intended participant assessments in its **local draft** when starting the match. Quick score entry asks for the values as of the game, even if entering after it finished. Admin editing triggers complete analytics recomputation.

### 3.6 Matches: each game is an independent rated match

- Singles only: two **different** active players; exact 2 scores, target 11 or 21; no ties, draws, walkovers or best-of sets.
- Valid completion: one score >= target, lead >= 2, and the loser score must be below the minimal winning threshold for that winner's score. The rule to implement is: `winner_score >= target`, `winner_score - loser_score >= 2`, **and** (`winner_score == target` OR `loser_score >= target - 1` and `winner_score == loser_score + 2`). In particular `11:8`, `12:10`, `21:19`, `23:21` valid; `11:10`, `15:11` (target 11), `22:18` (target 21) invalid.
- Each valid completed match is exactly one win/loss and one Elo update, whether target 11 or 21. Raw points are secondary statistics; don't double-weight 21-point games.
- Quick-entry UI: pick two players, stage (defaults to current), target, final score, both subjective assessments; show winner and a clear preview, then confirm and publish. Provide immediate success feedback and optional “new match with same pair” shortcut.
- Server records a stable sequence when publishing a match. Preserve chronological ordering in Elo replay by **publication sequence**, not client-supplied time. Save `started_at` (optional display metadata), `published_at` (server timestamp), stage, score, assessments, and a snapshot of each player's consumption before the match as explained below. A match submitted later can be ordered later even if its displayed start time was earlier; make this explicit in docs.
- Admin can correct or soft-delete match results, stage and assessments with preview of the statistical effect. Rating history must be recomputed deterministically from active matches in publication order.

**Scoring validation nuance:** don't allow a false winner after a completed game. For 11-point games, `13:11` is valid, `14:11` is invalid because the game should have ended at `13:11`; `12:9` is invalid because it should have ended at `11:9`. Validate the *earliest mathematically valid termination*, not merely `>= target` and a two-point lead. The formal predicate above expresses this.

### 3.7 Single-device live scorekeeper

- Counter is **local to the device/browser**. Do not publish the intermediate score, don't implement WebSockets or other-device synchronization.
- Before the first point, select two players, target, stage and both subjective assessments. Request the current public timeline `snapshot_seq` if online and store this plus initial consumption snapshot in the local draft. This is a read; it does **not** publish a match.
- Tap large `+1` controls for each participant, undo last point (stack, limited sensibly), optional keyboard controls, obvious score and game-point state. Disable or require special reset to continue adding points after a valid finished score. End screen shows confirmation, then sends **one** match creation request.
- Preserve local draft via `localStorage` between accidental reloads; include draft schema version, validation, expiration/recovery prompt, and a clear «Начать заново» button with confirmation. Never overwrite an active local draft silently. Local draft is not a server-side persisted match.
- If offline, user may operate the loaded counter, but saving requires network. Keep the draft on failure and allow retry without duplicates. Implement idempotency key per match.
- If more stage/drink events were recorded on the server after local match start, do not silently substitute the state at publication time: use the originally captured `snapshot_seq` or show an explicit conflict/reconciliation flow. The backend must validate ownership of the snapshot and that stage/snapshot are consistent; avoid accidentally attributing later drinking to an earlier match.
- No need for full offline PWA or multi-device syncing.

## 4. Rating system and analytics

### 4.1 Overall Elo

- Every player starts at 1000. Constant `K = 32`, independent of player level and match target.
- Pre-match expected score for A: `E_A = 1/(1 + 10^((R_B - R_A)/400))`. After result `S_A ∈ {0,1}`, `R'_A = R_A + K*(S_A - E_A)`; B updated **simultaneously from pre-match ratings**, using `S_B=1-S_A` and `E_B=1-E_A`.
- Preserve unrounded numerical values for all updates; round only on display. All results are computed on the server in a single deterministic algorithm, in ascending canonical publication sequence. An edit/soft-delete of a historical match causes full replay, not incremental patching.
- Store/use auditable per-match before/after rating snapshots or calculate from a deterministic cached projection that is invalidated after writes. Expose the same history via API, used by the chart. Use stable tie-breaks for equal rating/rank, and distinguish unplayed users.
- Rate 'preliminary' for fewer than 5 matches. Never imply confidence or uncertainty estimates beyond this coarse label.

### 4.2 Sober Elo

- A match participates only when **both players** have explicitly known subjective score 0 AND cumulative ethanol at match start is 0 for **both**. Stage by itself is **not** sufficient after stage #0.
- For qualifying matches, compute a completely separate Elo stream with same initial score/K. For participants with zero sober matches, show «Нет данных» rather than an authoritative sober ranking (internally still initialized 1000).
- If raw drink or match records change, recompute eligibility and sober Elo by timeline. Unknown is never sober.

### 4.3 Stage, relationship and player comparisons

- Main leaderboard: rating and rank, matches, W/L, Win Rate, change from 1000, sober matches/rating, stage marker. Sort meaningful played participants first; unrated entries in separate group.
- Player vs player: Head-to-Head W/L; show sample size and per-match scores. If they never played: «Личных встреч нет» rather than 50/50 inference.
- Rating progress: Elo over match sequence with stage vertical annotations; optional overlay of two players. For sparse players show discrete points rather than interpolated continuous performance.
- Match feed filters: player, opponent, stage, target, order. Stage summary shows number of matches, average/median subjective scores where known, and consumption grams.
- Player profile: drinking progression (grams), subjective 0–10 progression, W/L/expected vs actual, opponents, match list; show missing values explicitly.

### 4.4 Exploratory alcohol/performance association

- Distinguish `ethanol_g`, `self_rating`, `stage`, and `relative performance`; do **not** create a fake unified “BAC/градус” metric.
- For each match and participant compute: `actual` = 1/0; `expected` = pre-match overall Elo expected probability; `residual = actual - expected` (ranges -1..1). **This is descriptive, not causal; ratings already depend on past alcohol-affected results.** Label accordingly.
- Visualize performance by self-report bins 0, 1–3, 4–6, 7–10, «неизвестно»: matches, W/L, observed Win Rate, average expected, average residual; all sample counts visible. Plot a scatter of cumulative ethanol grams against residual, with selectable participant, plus stage markers; no misleading connecting line when not justified.
- Optional Spearman rank coefficient for each participant for numeric self-rating vs residual **only when** at least 8 complete observations and at least 3 distinct self-rating levels. If unsupported or sample too small show «Недостаточно данных для корреляции»; do not show significance/p-values/causal claims. For tied ranks use the correct average-rank Spearman calculation, guard zero variance and NaN.
- Use a neutral plain-language note under every alcohol analytical visualization: «Связь не доказывает причинность: на результат влияют соперник, усталость и случайность.»
- Empty or one-match data must render correctly. Avoid inventing “insights” with no evidence.

## 5. Pages, navigation, states

1. `/` — **Overview**: clear title, compact stat cards, leaderboard preview, rating progression chart, latest matches, current stage, primary CTA «Записать матч».
2. `/matches` — chronological feed and filters, each row shows names, target, score, stage, timestamp, match delta if computed. Quick-entry modal/drawer or `/matches/new`; local scorekeeper at `/scorekeeper`.
3. `/players` — list with create action, ranking and filters; `/players/:id` — player stats, opponents, chart and consumption history.
4. `/alcohol` — current stage, add-stage action, quick add-drink form, public complete log, cumulative consumption, subjective trends with clearly defined missing values.
5. `/analytics` — compare players, Elo and sobriety, stage summaries, exploratory association, sample-size notices.
6. `/admin` — password login/logout, current session indicator, edit/soft-delete/recover workflows, revision log. Admin access should not pollute normal navigation.
7. A polished 404 and consistent loading, offline, API error, empty and success states. Keyboard navigation and accessible form labels everywhere.

Choose fewer pages if the design becomes clearer (e.g. merge Overview/Leaderboard) but **all capabilities must be easy to discover on mobile**. Keep actionable controls within reach.

## 6. Nonfunctional requirements

- Russian UI and error messages; English source code identifiers/documentation acceptable (documentation may be Russian, but consistent terminology). No placeholder marketing copy or obviously AI-generated layouts.
- Prioritize mobile widths 320–430px, then tablet/desktop. Scorekeeper must work one-handed and without horizontal scrolling.
- Aim for a fast first render on ordinary mobile connection; lazy-load analytical charts and avoid heavy animation. No arbitrary external analytics or trackers.
- WCAG 2.2 AA **as a target** for contrast, focus and form labels; keyboard-only operation; supports `prefers-reduced-motion`.
- All data and algorithms server authoritative; UTC timestamps in storage, presentation as user-local time; no client-side authoritative Elo calculation.
- Schema migrations via Alembic with tested upgrade; database persisted with named volume; Caddy certs persisted across image updates.
- Backups before deployment and a documented restoration drill; no automatic destructive DB reset. No secrets in repo/logs.
- JSON errors with machine-readable code and human-friendly Russian message; request ID for troubleshooting; sensible HTTP status codes.
- Pin supported dependency versions/lockfiles; use reasonably current stable versions verified during implementation, not assumed versions in this specification.
- Public site should never require an account to read or add routine data. Provide basic admin recovery and post-save safety confirmations.

## 7. Acceptance conditions (high-level)

1. Fresh deployment with an empty database launches one singleton evening and stage #0, no sample data.
2. Three or more users can be created. A user may play exactly one game and have correct stats.
3. Legal 11/21 scores accepted; illegal score and duplicate player rejected server-side.
4. Quick entry and recovered local live-counter draft publish exactly **one** completed match, never intermediate points.
5. Drink logs of different strengths and per-match 0–10 ratings are visible to everyone; unknown data distinguished from zero.
6. Overall and sober Elo calculations match golden test fixtures; historical changes perform deterministic full replay.
7. All analytics are honest for tiny/uneven samples and contain no causal overclaims.
8. Anonymous visitor cannot edit/delete saved records; admin can, with confirmation and revision trail.
9. Responsive professional light UI passes E2E tests for the core flow.
10. CI runs required checks on PR to `dev` and `main`; public repository release flow deploys **only** after qualifying GitHub Release, not after an ordinary push. Codex tests locally and opens PR into `dev`; Codex never touches production directly.

More detailed technical contracts and Gherkin-like cases are in the companion documents.
