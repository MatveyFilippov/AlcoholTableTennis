#!/usr/bin/env bash
set -euo pipefail
umask 077
root=/opt/att
[[ ${1:-} == --compatible-schema-confirmed ]] || {
    echo "Verify schema compatibility and pass --compatible-schema-confirmed" >&2; exit 1;
}
exec 9>"$root/deploy.lock"
flock -n 9
[[ ! -f $root/legacy-schema-backup ]] || {
    echo "Application rollback is unavailable during the schema transition" >&2; exit 1;
}
IFS=' ' read -r ATT_SHA tag ATT_WEB_IMAGE ATT_API_IMAGE release < "$root/previous.env"
[[ $release == "$root/releases/"* ]]
export ATT_SHA ATT_WEB_IMAGE ATT_API_IMAGE
docker compose --env-file "$root/.env" -f "$release/compose.prod.yml" up -d --wait --no-deps api web
"$release/scripts/smoke.sh" https://att.ricksanchez.ru "$ATT_SHA"
mv -- "$root/previous.env" "$root/active.env"
echo "Restored compatible application $tag ($ATT_SHA)"
