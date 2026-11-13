#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
root=/opt/att
sha=${1:?commit}
tag=${2:?release tag}
web=${3:?web image}
api=${4:?api image}
[[ $sha =~ ^[0-9a-f]{40}$ && $tag =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
[[ $web =~ ^ghcr\.io/matveyfilippov/alcoholtabletennis-web@sha256:[0-9a-f]{64}$ ]]
[[ $api =~ ^ghcr\.io/matveyfilippov/alcoholtabletennis-api@sha256:[0-9a-f]{64}$ ]]
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
export ATT_COMPOSE_FILE="$here/../compose.prod.yml"
exec 9>"$root/deploy.lock"
flock -n 9 || { echo "Another ATT rollout holds the lock" >&2; exit 1; }
compose=(docker compose --env-file "$root/.env" -f "$ATT_COMPOSE_FILE")
domain=$(sed -n 's/^APP_DOMAIN=//p' "$root/.env")
[[ $domain == att.ricksanchez.ru ]]
if [[ -f $root/active.env ]]; then
    IFS=' ' read -r old_sha old_tag old_web old_api old_release < "$root/active.env"
    [[ $old_sha =~ ^[0-9a-f]{40}$ ]]
    [[ $old_release == "$root/releases/"* && -f $old_release/compose.prod.yml ]]
    if [[ $tag != "$old_tag" && $(printf '%s\n%s\n' "$tag" "$old_tag" | sort -V | tail -1) != "$tag" ]]; then
        echo "Release version precedes the active version" >&2; exit 1
    fi
    if [[ $tag == "$old_tag" && $sha != "$old_sha" ]]; then
        echo "Release tag was moved" >&2; exit 1
    fi
fi
export ATT_SHA=$sha ATT_WEB_IMAGE=$web ATT_API_IMAGE=$api
"${compose[@]}" config --quiet
"${compose[@]}" pull web api
"${compose[@]}" up -d --wait --no-recreate db
# The one-time 0001 transition removes columns used by the old app.
legacy_schema=$("${compose[@]}" exec -T db sh -ec '
    if [ "$(psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT to_regclass('\''alembic_version'\'')")" ]; then
        psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version_num FROM alembic_version"
    fi
')
if [[ $legacy_schema == 0001 ]]; then
    echo "Stopping the legacy application before the incompatible database migration"
    "${compose[@]}" stop web api
fi
backup=$("$here/backup.sh" "$sha")
echo "Database backup: $backup"
# Persist the barrier so a failed migration or rollout retry cannot select old images.
if [[ $legacy_schema == 0001 ]]; then
    printf '%s\n' "$backup" > "$root/legacy-schema-backup"
    rm -f -- "$root/previous.env"
fi
# PostgreSQL DDL is transactional.
"${compose[@]}" run --rm --no-deps api alembic upgrade head
if "${compose[@]}" up -d --wait --no-deps api web && "$here/smoke.sh" "https://$domain" "$sha"; then
    if [[ ! -f $root/legacy-schema-backup && -f $root/active.env && ${old_sha:-} != "$sha" ]]; then
        cp -- "$root/active.env" "$root/previous.env"
    fi
    printf '%s %s %s %s %s\n' "$sha" "$tag" "$web" "$api" "$(dirname "$here")" > "$root/active.next"
    mv -- "$root/active.next" "$root/active.env"
    rm -f -- "$root/legacy-schema-backup"
    echo "Deployed $tag ($sha)"
    exit 0
fi
echo "Rollout failed after migration. Backup: $backup" >&2
if [[ -n ${old_sha:-} && ! -f $root/legacy-schema-backup ]]; then
    export ATT_SHA=$old_sha ATT_WEB_IMAGE=$old_web ATT_API_IMAGE=$old_api
    if docker compose --env-file "$root/.env" -f "$old_release/compose.prod.yml" up -d --wait --no-deps api web &&
        "$here/smoke.sh" "https://$domain" "$old_sha"; then
        echo "Previous compatible application restored ($old_sha)" >&2
    else
        echo "Automatic application rollback failed. Follow infra/README.md." >&2
    fi
else
    "${compose[@]}" stop web api || true
    echo "No compatible application rollback is available; database and backup retained" >&2
fi
exit 1
