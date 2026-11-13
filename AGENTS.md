# AGENTS.md — working rules for agents in AlcoholTableTennis

## Mission

Implement and maintain ATT (Alcohol Table Tennis), a light, professional, mobile-first Russian web app for one continuous evening of table tennis and alcohol analytics. Primary product specification lives in `docs/SPECIFICATION.md` (Russian consolidated version: `ТЕХНИЧЕСКОЕ_ЗАДАНИЕ.md`); consult `docs/ARCHITECTURE_AND_API.md`, `docs/DESIGN_BRIEF.md`, `docs/TEST_PLAN.md`, `docs/GITHUB_AND_DEPLOYMENT.md`.

If these documents are attached to a Codex Work task but not yet in the repository, add them in the same feature branch so future agents can follow them.

## Git behavior (mandatory)

- Existing owner-managed repo: `MatveyFilippov/AlcoholTableTennis`. **Never create a replacement repository.** Do not modify repo settings or branch protection unless the owner explicitly requests it.
- Read existing repository structure and conventions first. Use latest `dev` as base for all task branches. Use only `codex/*` branches, e.g. `codex/feat/att-mvp`. **Never** use `code/*`.
- Do not push to `main`; do not push directly to `dev` for feature changes; do not merge PRs. Open PR to `dev` after implementation and tests. If prerequisites such as `dev` or write authorization are missing, describe the exact blocker rather than circumventing policy.
- Use Conventional Commits (`feat`, `fix`, `test`, `docs`, `ci`, `chore`, `refactor`, optional scope). Scope commits to actual changes; no fabricated test claims.
- No direct production interaction: **never SSH, provision, deploy, restore or inspect the configured production domain or VPS through your agent environment**. Codex Work may run and test locally. Production deployment is via GitHub Actions on approved GitHub Release after owner setup.

## Engineering

- KISS/DRY/SOLID as warranted; prefer a clear modular monolith over complexity. Python/FastAPI + React/TypeScript + PostgreSQL + Alembic + Docker Compose + Caddy as defined in docs.
- Strict boundary of concern: backend owns score validation, event timeline, ethanol math, Elo and analytics. Frontend displays authoritative API results; local scorekeeper is an unpublished device draft.
- No player accounts; public visitor may **create** players/drinks/completed matches; admin only may **edit/soft-delete/restore**. Public alcohol details are intentionally visible. Admin password comes only from secure environment variables.
- One evening, one tournament, no seasons. Per-match self-assessment is integer 0–10 or unknown (`null`). Each game to 11/21, must win by 2 and terminate at the earliest legal score.
- Ratings: one Elo rating (1000/K32) and descriptive alcohol analytics; deterministic full replay on corrections. Do not claim a causal alcohol effect or compute BAC.
- Designs MUST be light-first, polished, Apple-like clarity but original; tennis accent and just a hint of celebration. Avoid generic AI template aesthetics, dark-first and gratuitous gradients/3D.
- Use whichever relevant skills, tooling and libraries improve implementation quality. Verify dependency versions and official docs; avoid unjustified complexity and licensing problems.

## Testing and done

- Before PR run backend unit/integration, frontend unit, lint/type checks, Playwright E2E, Docker image builds/Compose validation, and UI reviews at mobile/desktop sizes. Include screenshots and exact executed commands/results in the PR description.
- Unit tests must include score edge cases and Elo golden values; integration must include admin auth, event ordering, idempotency, correction/replay, start/end comparison, and local-only counter publishing once.
- `AGENTS.md`, README, `.env.example`, migration docs, API/OpenAPI, release/deploy runbook, GitHub Actions workflows and recovery instructions are part of the deliverable.
- Do not log or commit credentials, local `.env`, node_modules, Python venv, DB volumes, unreviewed generated vendor code or screenshots containing secrets.
- Do not claim deployment succeeded because the workflow YAML exists. Clearly report anything dependent on the owner (secrets, GHCR visibility, branch rules, VPS bootstrap).
- If you cannot finish a required feature, open a transparent draft PR only if useful; enumerate the unfinished work instead of presenting a scaffold as complete.

## Expected output at end of work

1. Feature branch `codex/*`, commit(s), and PR targeting `dev`.
2. Concise scope summary, architecture decisions, known trade-offs.
3. Test matrix with actual run results and failures/blockers.
4. Design screenshots and demo notes (non-production data only).
5. Owner checklist: GitHub settings/secrets, VPS setup, first GHCR images, first Release, backup restore exercise.
