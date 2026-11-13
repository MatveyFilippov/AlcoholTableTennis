# ATT — GitHub workflow, VPS bootstrap, CI/CD and production runbook

**Separation of responsibility:** Owner creates/configures `MatveyFilippov/AlcoholTableTennis`, its branch rules, secrets, GitHub Environment and clean Ubuntu server. **Codex Work** only uses the existing repo, writes code/workflows/scripts/docs, runs tests locally and opens PRs; it must **not** SSH into production or deploy directly. **GitHub Actions** alone performs automatic deployment upon qualifying published GitHub Release.

## 1. Branch/PR policy

```text
codex/feat/initial-app   --PR + CI-->  dev  --PR + CI-->  main
                                                      |
                                  main CI: build/publish immutable GHCR images
                                                      |
                                          v1.0.0 GitHub Release
                                                      |
                             GitHub Actions → production on Ubuntu 24.04
```

- `main`: canonical production source; **no direct push**, force push or deletion. PR only, with passing tests; require human approval only if a suitable separate reviewer exists. No production deploy on merge/push alone.
- `dev`: integration branch; prefer PR and passing checks; direct push discouraged. Protect via ruleset if desired; don't configure it so tightly that initial bootstrap becomes impossible.
- All agent feature branches begin `codex/` and branch off latest `dev`, e.g. `codex/feat/initial-app`, `codex/fix/elo-replay`, `codex/docs/deployment`. Do not use the mistaken prefix `code/`.
- Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `ci:`, `chore:`, `refactor:`; optional scope). PR titles follow the same spirit; substantial changes split into reviewable commits.
- If the existing repo is empty or has no `dev`, do not invent a bypass of `main` rules: report missing bootstrap prerequisite for the owner to create `dev` (or explicitly ask for permission to initialize it). Agent does not create/replace the repo itself.
- Change source and behavior only on `codex/*`; after completed checks create PR targeting `dev`. Do not merge or release without owner action.

### Owner: branch rulesets in GitHub UI

For a public GitHub repo, rulesets are supported on GitHub Free. In **Settings → Rules → Rulesets** create branch rules for `main`, optionally separate one for `dev`:

1. Target `main`, require pull request before merging, block force pushes and branch deletion, require status checks (e.g. `backend-tests`, `frontend-tests`, `e2e`, `docker-build`, names must match implemented workflows), require branch up to date if appropriate, minimum one approval if practical.
2. Avoid bypass for routine merges. Decide whether owner can bypass for emergency recovery; document any bypass explicitly.
3. Optional `dev` ruleset: require pull request and checks. The owner must bootstrap `dev` first. Avoid redundant constraints that interfere with initial CI setup.
4. Allow only expected merge mode (suggest squash merges) and delete `codex/*` after merge. Ensure rules are in **Active** rather than Evaluate state.
5. Enable repository Actions with least-privilege workflow permissions and restrict who can approve external contributions. Do not provide secrets to PR jobs.

Official: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets

## 2. CI workflow specification

### `ci.yml` (required for PR to `dev` and `main`; also push to `dev` and `main`)

- Triggers: `pull_request` to `dev`/`main`, `push` to `dev`/`main` (do not run secret-privileged code on untrusted PRs).
- Jobs with stable names: `backend-tests` (Ruff, type checks, pytest DB integration), `frontend-tests` (TypeScript, ESLint, Vitest, production build), `e2e` (Playwright against ephemeral Compose stack), `docker-build` (test Dockerfiles and Compose config). Cache where safe.
- Check basic security hygiene and migrations; do not require expensive SaaS. All tests must run on pull request; failures block merge.
- `permissions: contents: read`; do not call deployment steps; use hosted runners, not persistent self-hosted runners.
- Pin third-party actions to full commit SHA as feasible. Use artifacts/logs without leaked credentials. No direct write to main/dev.

### `publish-images.yml` (on successful push to `main`)

- Re-run/verify necessary gates, then build `web` and `api` via reproducible Dockerfiles.
- Publish immutable images to GHCR: suggested packages `ghcr.io/matveyfilippov/alcoholtabletennis-web:sha-<40-char-SHA>` and `...-api:sha-<40-char-SHA>`; record **digests**. No dependency on mutable `latest`.
- Use `GITHUB_TOKEN` with job-scoped `packages: write`, `contents: read` for publishing packages linked to repository. If package visibility is private by default, owner sets package **Public** after the first image publication or configures read-only pull auth (see bootstrap note).
- No production deployment in this workflow.

### `release-deploy.yml` (only on `release: { types: [published] }`)

- Validate: `!github.event.release.prerelease && !github.event.release.draft`; tag strictly `vMAJOR.MINOR.PATCH`, no suffix; resolve signed/unsigned tag to **commit**, ensure commit is **exactly current remote `main` HEAD** for first version. This conservative policy prevents stale/downgrade releases and non-main releases. Re-evaluate only by documented owner decision.
- Require successful CI and published images for that exact commit. Do not assume a release implies CI passed. If CI/images not ready, fail with a clear precondition error rather than build unknown source.
- Resolve GHCR digests and deploy `web@sha256:...`, `api@sha256:...`. Tag is descriptive; digest is executable identity.
- `production` GitHub Environment; secrets available only to deployment job. Concurrency group `att-production` with `cancel-in-progress: false` (do not terminate partially completed deployment). Use minimal permissions: contents read, packages read as needed; restrict actions to trusted code. Deploy via pinned SSH host key with key-based authentication, not password; avoid interpolating untrusted release metadata into remote shell.
- SSH invokes a **versioned, reviewed deployment script** or uploads a reviewed manifest and calls an allowlisted entrypoint; no adhoc production editing by agent. Before upgrade: make DB backup and record current images; pull images; run **backward-compatible** Alembic migration; switch services; run readiness + HTTPS smoke. Log deployed SHA and result.
- On failed readiness: revert to previous compatible app images and mark workflow failed. Database restoration, if necessary for an incompatible schema, is **manual and documented**, not an automatic destructive restore. Stop rollout if migration fails.
- Do not run a deployment for raw tag push, `dev` push, PR, prerelease or non-main tag. If the release job is re-run, be idempotent and avoid accidental downgrade.

GitHub reference: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows

## 3. Owner: clean Ubuntu 24.04 initial installation (one-time)

**Assumptions:** DNS A/AAAA records point to this VPS; outbound internet access; root/sudo available for initial host setup; available public 80/443. Owner must verify CPU architecture, RAM, disk space and networking. Aim for a modest VPS (at least ~2 GB RAM suggested, verify in deployment docs with actual load); do not hardcode architecture.

1. Update OS and security patches; choose SSH key authentication, disable password auth **only after a verified key-based session**; create a non-root deploy account. Record SSH port and provider firewall before enabling a host firewall.
2. Install Docker Engine + Compose plugin from Docker's **official** Ubuntu apt repository, not the convenience curl-install script. The official installation includes `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, `docker-compose-plugin`.
3. Create `/opt/att` for deployment manifests/active version, `/opt/att/backups` for database backups (permissions not world-readable), and persistent Docker volumes for DB/Caddy. Create runtime `.env` with strict access rights. **Never commit runtime `.env`, password hash, SSH key or DB password.**
4. Allow inbound SSH (configured port), HTTP 80 and HTTPS 443. Expose no API/DB host ports. Note: Docker-published ports can bypass ordinary `ufw` rules; rely on Compose binding only web 80/443 and review firewall behavior, not `ufw` alone.
5. Create dedicated deploy SSH key and add public key to host's deploy user. Store **private** key in GitHub Environment `production` secret; pin verified `known_hosts` fingerprint, never `StrictHostKeyChecking=no`.
6. Decide deploy-user Docker permissions: Docker socket/group is effectively **root-equivalent**. For a small dedicated VPS this may be acceptable if documented; alternatively install a tightly controlled root-owned deploy script with constrained sudo rules. Never claim Docker-group access is low-privilege.
7. Set app secrets: `ADMIN_PASSWORD_HASH` (Argon2id, not cleartext), `SESSION_SECRET` (strong random), `POSTGRES_PASSWORD` (strong random), `POSTGRES_USER`, `POSTGRES_DB`, app domain and any supported configuration; only production host keeps these. Document secure generation helper in repo.
8. After first successful image publish on `main`, set corresponding GHCR packages Public (package visibility is independently controlled), or explicitly configure secure read-only registry access. The initial deployment will not succeed if anonymous image pull is disabled and no credentials exist; **do this before the first Release**.
9. Set GitHub `production` Environment and deploy secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_PRIVATE_KEY`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_PORT` if non-default. Use GitHub environment protection/selected tag restrictions appropriate to release tags; preserve automatic deployment (do not require manual approval unless owner explicitly changes policy).
10. Ensure tested deployment runbook and scripts are already merged to main and initial images built before the first Release. Release v1.0.0 manually from main after images + branch checks are green.

Official Docker installation reference (always verify current commands): https://docs.docker.com/engine/install/ubuntu/

> **Example: official apt setup for Docker on Ubuntu 24.04** (owner executes after reviewing the current Docker docs):
>
> ```bash
> sudo apt update
> sudo apt install -y ca-certificates curl
> sudo install -m 0755 -d /etc/apt/keyrings
> sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
> sudo chmod a+r /etc/apt/keyrings/docker.asc
> sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF_DOCKER
> Types: deb
> URIs: https://download.docker.com/linux/ubuntu
> Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
> Components: stable
> Architectures: $(dpkg --print-architecture)
> Signed-By: /etc/apt/keyrings/docker.asc
> EOF_DOCKER
> sudo apt update
> sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
> sudo docker compose version
> ```
>
> Confirm exact upstream instructions before use; do not issue blanket firewall commands without checking the actual SSH port.

## 4. Required production infrastructure deliverables from Codex

- Multi-stage Dockerfile for web (Vite build → Caddy static content and reverse proxy), multi-stage/lean Dockerfile for FastAPI.
- A `Caddyfile` for `att.ricksanchez.ru` that serves SPA frontend (proper `try_files ... /index.html`) and proxies `/api/*` to `api:8000` **without wrong path rewriting**. Caddy automatic HTTPS; persist data volumes; no external frontend resources needed for site availability.
- Compose production file references `ATT_WEB_IMAGE` and `ATT_API_IMAGE` by digest, includes DB internal network and restart/health checks, uses persisted PostgreSQL volume. Internal `api`/`db` not published.
- Scripts under `infra/scripts/` for backup, deploy, smoke, manual rollback and restore rehearsal; shell strict mode, quoting, lock to prevent simultaneous deploys, return reliable exit codes, redacted logs, and executable test where possible.
- `infra/README.md` and `.env.example` show all required variables and how to generate secrets, but never values of actual credentials.
- An explicit distinction between **application rollback** and **database rollback**; backward-compatible-only migrations for release v1. Avoid auto-running downgrade migrations on failure.

## 5. Backups and restoration

- Pre-deployment `pg_dump` in a PostgreSQL-compatible custom format (`-Fc`), written to a restrictive backup directory on persistent storage, verify nonzero file and return code before continuing. Label with timestamp, git SHA and schema migration revision. Apply retention, e.g. keep 14 recent daily/pre-deploy backups initially, protect manual restore points from automatic deletion.
- Document independent off-server backup as **strongly recommended**; same-host backups do not protect against disk loss. No credentials in backup file names/logs.
- Rehearse restoration into a **temporary** database container or local environment, checking row counts and core queries. Never restore over active production without maintenance mode, confirmation, verified backup and explicit owner action.
- If a new image fails while schema remains backward compatible: auto-rollback images only. Otherwise stop, report incident, follow documented manual data-restore process; do not pretend automatic rollback always works.
- Provide incident guide: check failed job, image tags/digests, `docker compose ps`, API health/logs, Caddy certificate logs, DB health and disk usage. Document steps to retry a failed release safely without version downgrade.

## 6. Launch checklist and operations

- Domain resolves correctly and 80/443 accessible; TLS cert is valid with auto-renewal; HTTP redirects to HTTPS.
- App's `/api/health/live` and `/api/health/ready` both pass, API docs optionally restricted to development; no open DB port.
- Owner can log into admin through HTTPS, anonymous creation works and anonymous modifications are rejected.
- Fresh seeded tournament has zero activity. Local scorekeeper draft remains local; end/save works on a phone.
- Main/Dev protection is active; failed tests block PR; normal push/PR cannot deploy; only stable published release deploys.
- Current version commit and backup path visible to operator; recovery command tested on copy.

## 7. Official upstream references to include in final project docs

- GitHub branch rulesets: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets
- GitHub required status checks: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- GitHub Actions release event: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- GitHub deployment environments: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- GitHub GHCR: https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
- GitHub workflow hardening: https://docs.github.com/en/code-security/tutorials/secure-your-organization/protect-against-threats
- Docker Ubuntu: https://docs.docker.com/engine/install/ubuntu/
- Caddy automatic HTTPS/reverse proxy: https://caddyserver.com/docs/automatic-https and https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
