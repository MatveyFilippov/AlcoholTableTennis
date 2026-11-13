#!/usr/bin/env bash
set -euo pipefail
umask 077
root=${ATT_ROOT:-/opt/att}
label=${1:?backup label}
[[ $label =~ ^[a-zA-Z0-9_-]+$ ]]
: "${ATT_COMPOSE_FILE:?Set ATT_COMPOSE_FILE}"
compose=(docker compose --env-file "$root/.env" -f "$ATT_COMPOSE_FILE")
install -d -m 700 "$root/backups"
revision=$("${compose[@]}" exec -T db sh -ec '
  if [ "$(psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select to_regclass('\''alembic_version'\'')")" ]; then
    psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select version_num from alembic_version"
  else
    echo empty
  fi
')
[[ $revision =~ ^[a-zA-Z0-9_-]+$ ]]
path="$root/backups/$(date -u +%Y%m%dT%H%M%S%NZ)-$label-$revision.dump"
tmp=$(mktemp "$root/backups/.backup.XXXXXXXX")
trap 'rm -f -- "$tmp"' EXIT
"${compose[@]}" exec -T db sh -ec 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$tmp"
test -s "$tmp"
"${compose[@]}" exec -T db pg_restore --list < "$tmp" > /dev/null
mv -- "$tmp" "$path"
printf '%s\n' "$path"
