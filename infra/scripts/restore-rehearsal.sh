#!/usr/bin/env bash
set -euo pipefail
dump=${1:?path to a custom PostgreSQL dump}
[[ -s $dump ]]
container=$(docker run -d --rm -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine)
trap 'docker stop "$container" >/dev/null' EXIT
for attempt in {1..30}; do
    if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
    sleep 1
done
docker exec "$container" createdb -U postgres att_rehearsal
docker exec -i "$container" pg_restore -U postgres --no-owner --no-privileges     --exit-on-error -d att_rehearsal < "$dump"
docker exec "$container" psql -U postgres -d att_rehearsal -v ON_ERROR_STOP=1     -c 'SELECT version_num FROM alembic_version'     -c 'SELECT count(*) AS tournaments FROM tournaments'     -c 'SELECT count(*) AS players FROM players'     -c 'SELECT count(*) AS matches FROM matches'     -c 'SELECT count(*) AS drinks FROM drinks'
