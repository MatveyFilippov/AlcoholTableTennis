# ATT — owner checklist (you, not Codex Work)

This is intentionally a **practical checklist**. Do not send SSH credentials, production DB password or admin password to Codex. Agent needs GitHub repository access to develop and open PR; GitHub Actions needs deploy credentials only after code is reviewed.

## Before starting Codex Work

- [ ] Create public repository [`MatveyFilippov/AlcoholTableTennis`](https://github.com/MatveyFilippov/AlcoholTableTennis). If newly created, initialize it with a minimal README or commit so `main` exists.
- [ ] Create `dev` from `main` in GitHub UI (or local Git). Make sure **`dev` exists remotely**. Leave `main` as default branch unless a clearly justified alternative is chosen; deployment workflow uses `main` explicitly.
- [ ] Give Codex Work permission to access **this existing repo** and create a `codex/*` branch and PR. Do not ask Codex to create a new repository or use production SSH.
- [ ] Upload the whole package to Work and paste `CODEX_WORK_PROMPT.md`. Confirm it read all included docs and is using latest `dev`.

## While reviewing the Codex PR

- [ ] PR targets **`dev`**, source starts with **`codex/`**, title/commits follow Conventional Commits.
- [ ] Review source for a real backend, database migrations, UI, functional scorekeeper, algorithms, tests and workflows; don't accept a template/scaffold as a finished app.
- [ ] Check screenshots for **light**, minimalist, coherent professional design. No dark-first default, giant gradients or generic AI dashboard.
- [ ] Check that tests actually ran and results are attached. Focus on scores `11:10` invalid, `12:10` valid, `12:9` invalid; Elo 1000/1000 → 1016/984, and recalc after old match edit.
- [ ] Check that public visitors can **add only**; administrator is required to edit/delete; all drink logs are publicly visible.
- [ ] Check `AGENTS.md`, user README, `.env.example`, API docs, Compose files, deploy/restore runbook and workflow definitions exist.
- [ ] Check that there are **no production secrets** or attempts to access your VPS from the Codex agent.

## GitHub repository and workflows

- [ ] After CI jobs first exist and have executed, create an Active `main` branch ruleset: no direct push, require PR, prevent force push/deletion, require real CI statuses. This is supported in public GitHub Free repos.
- [ ] Prefer to protect `dev` similarly, but ensure the repo bootstrap/CI path is not blocked.
- [ ] If you are the only contributor, **do not require an approval that only another person can give**, unless you have a reviewer. Required tests + PR restriction can be sufficient.
- [ ] Merge reviewed implementation PR into `dev`. Then create and merge **separate PR `dev` → `main`** after CI passes. Never deploy from `dev`.
- [ ] Check `publish-images.yml` successfully published `web` + `api` images tagged with the exact main commit SHA to GHCR. Verify both package pages exist and permit pulls (set each package Public if using anonymous pulls).
- [ ] In repo Settings → Environments create `production`. Restrict to stable release tag naming policy if supported; store only deploy-specific secrets (`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_PRIVATE_KEY`, `DEPLOY_KNOWN_HOSTS`, optional `DEPLOY_PORT`). Do not put Postgres/admin secrets in public repo files.

## One-time Ubuntu 24.04 server setup

- [ ] Verify `att.ricksanchez.ru` DNS A/AAAA resolves to the intended machine (user indicated DNS is ready); verify IPv6 if AAAA exists.
- [ ] Update Ubuntu, configure SSH key auth (confirm another active SSH session succeeds before disabling password login), create deployment account, review host/provider firewall. Preserve the actual SSH port.
- [ ] Install Docker Engine and Docker Compose plugin from the [official Docker Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/). Verify `sudo docker compose version`.
- [ ] Reserve/open inbound ports 80 and 443 and your real SSH port only; DB (5432), API (8000) are **not** exposed. Review Docker's interaction with UFW rules.
- [ ] Initialize `/opt/att` with deployment manifests and production `.env` (permissions 600; owner-controlled). Required runtime values: `APP_DOMAIN=att.ricksanchez.ru`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, any app-specific documented variables and image digest refs. Use a hash-generation helper that Codex implements; don't put plain admin password in config.
- [ ] Create GitHub deploy SSH key using strong modern key type (e.g., ed25519); put its private part only in GitHub Environment secret. Verify host key fingerprint through trusted VPS console and set `DEPLOY_KNOWN_HOSTS`; don't disable host key checking.
- [ ] Create persistent Docker volumes for DB/Caddy through Compose; verify writable backup directory `/opt/att/backups` and non-world-readable permissions.
- [ ] Confirm GHCR images can be pulled by production host before first Release (public package setting or documented read-only registry authentication).
- [ ] Run deployment script manually **only if the runbook requires a one-time initialization step**; regular releases must only deploy via GitHub Release/Actions. Manual bootstrap must not be misrepresented as agent deployment.

## First release (after approved `dev` → `main` merge)

- [ ] CI on `main` green and both matching SHA image digests available for pull.
- [ ] Publish first **non-prerelease GitHub Release** tag `v1.0.0` at the **current `main` HEAD**. Do not publish it from `dev`, a detached old commit or a dirty/unreviewed branch.
- [ ] Verify Actions production deploy job used `production` Environment, took DB backup before migration, deployed pinned images and completed HTTPS + API healthchecks.
- [ ] Open https://att.ricksanchez.ru on phone and desktop; create two dummy pseudonyms and one test match **only if you are happy to retain or administratively remove those records**. Prefer a test/staging DB first if possible.
- [ ] Verify admin can correct a record, anonymous users cannot, timeline and scores recompute, TLS valid.
- [ ] Record deployed commit/tag and backup location. Test restoration into an isolated **temporary database**, not over production.

## Future updates

1. Codex feature work on fresh `codex/*` from `dev` → PR & checks → merge to `dev`.
2. PR `dev` → `main` → checks/owner merge.
3. Wait for exact-SHA GHCR image build; publish next version Release `v1.0.1`, `v1.1.0` etc from current main HEAD.
4. Watch GitHub deployment logs and live health; if failure use documented compatible rollback, never erase production DB casually.

## What is deliberately **not** part of this package

No ready-made production password, SSH key, DB secret, server-specific IP, GitHub personal access token, source code implementation or claim of completed deployment. Those are created or configured by the owner and/or the implementing agent in the appropriate environment.
