#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$root"
for file in infra/scripts/*.sh; do bash -n "$file"; done
bash infra/scripts/check-production-domain.sh
sha=0123456789012345678901234567890123456789
other=1234567890123456789012345678901234567890
infra/scripts/release-guard.sh v1.0.0 "$sha" "$sha"
for tag in v01.0.0 v1.0 v1.0.0-rc.1 v1.0.0+build 1.0.0; do
    if infra/scripts/release-guard.sh "$tag" "$sha" "$sha"; then exit 1; fi
done
if infra/scripts/release-guard.sh v1.0.0 "$sha" "$other"; then exit 1; fi
admin_env=$(mktemp)
trap 'rm -f "$admin_env"' EXIT
ATT_ADMIN_ENV_FILE="$admin_env" APP_DOMAIN=att.example.test POSTGRES_USER=att POSTGRES_DB=att POSTGRES_PASSWORD=config-only \
ATT_WEB_IMAGE=att-web:config ATT_API_IMAGE=att-api:config \
    docker compose -f infra/compose.prod.yml config --quiet
