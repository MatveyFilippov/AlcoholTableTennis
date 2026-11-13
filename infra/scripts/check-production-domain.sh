#!/usr/bin/env bash
set -euo pipefail

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$here/production-domain.sh"
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT

expect_invalid() {
    if read_production_domain "$fixture/.env" > "$fixture/output" 2> "$fixture/error"; then
        echo "Expected invalid production domain" >&2
        exit 1
    fi
    [[ ! -s $fixture/output ]]
    grep -q APP_DOMAIN "$fixture/error"
}

for domain in att.tennisfans.ru att.example.test app-2.example.com; do
    printf '# Example production config\nAPP_DOMAIN=%s' "$domain" > "$fixture/.env"
    [[ $(read_production_domain "$fixture/.env") == "$domain" ]]
done
for domain in '' 'http://att.tennisfans.ru' 'https://att.tennisfans.ru' 'att.tennisfans.ru:443' \
    'att.tennisfans.ru/path' 'att.example.test ' 'att example.test' $'att.example.test\r' \
    $'att.\texample.test' 'att_example.test' 'att..example.test' '-att.example.test' \
    'att-.example.test' '127.0.0.1' '"att.example.test"'; do
    printf 'APP_DOMAIN=%s\n' "$domain" > "$fixture/.env"
    expect_invalid
done
printf 'APP_DOMAIN=att.example\0.test\n' > "$fixture/.env"
expect_invalid
printf 'OTHER=value\n' > "$fixture/.env"
expect_invalid
printf 'APP_DOMAIN=att.example.test\nAPP_DOMAIN=att.tennisfans.ru\n' > "$fixture/.env"
expect_invalid

# Exercise both entry points with a temporary root and no Docker or HTTP calls.
release="$fixture/releases/test"
mkdir -p "$release/scripts" "$fixture/bin"
for script in deploy rollback; do
    sed 's|^root=/opt/att$|root=$ATT_TEST_ROOT|' "$here/$script.sh" > "$release/scripts/$script.sh"
    grep -Fxq 'root=$ATT_TEST_ROOT' "$release/scripts/$script.sh"
done
cp "$here/production-domain.sh" "$release/scripts/"
touch "$release/compose.prod.yml"
cat > "$fixture/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -eu
[[ $APP_DOMAIN == "$ATT_TEST_DOMAIN" ]]
[[ $1 == compose && $2 == --env-file && $3 == "$ATT_TEST_ROOT/.env" ]]
if [[ $* == *' exec -T db '* ]]; then
    printf '0002\n'
fi
STUB
cat > "$release/scripts/backup.sh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$ATT_TEST_ROOT/backup.dump"
STUB
cat > "$release/scripts/smoke.sh" <<'STUB'
#!/usr/bin/env bash
set -eu
[[ $APP_DOMAIN == "$ATT_TEST_DOMAIN" && $1 == "https://$ATT_TEST_DOMAIN" ]]
printf '%s %s\n' "$1" "$2" >> "$ATT_TEST_ROOT/smoke.log"
[[ $2 != "${ATT_TEST_FAIL_SHA:-}" ]]
STUB
chmod +x "$fixture/bin/docker" "$release/scripts/"*.sh
export PATH="$fixture/bin:$PATH" ATT_TEST_ROOT="$fixture"
sha=0123456789012345678901234567890123456789
digest=$(printf '%064d' 0)
web="ghcr.io/matveyfilippov/alcoholtabletennis-web@sha256:$digest"
api="ghcr.io/matveyfilippov/alcoholtabletennis-api@sha256:$digest"
for domain in att.tennisfans.ru att.example.test; do
    export ATT_TEST_DOMAIN="$domain"
    # A caller's environment must not override the production file.
    export APP_DOMAIN=wrong.example.test
    printf 'APP_DOMAIN=%s\n' "$domain" > "$fixture/.env"
    rm -f "$fixture/active.env"
    : > "$fixture/smoke.log"
    "$release/scripts/deploy.sh" "$sha" v1.0.1 "$web" "$api"
    cp "$fixture/active.env" "$fixture/previous.env"
    "$release/scripts/rollback.sh" --compatible-schema-confirmed
    expected=$(printf 'https://%s %s\nhttps://%s %s\n' "$domain" "$sha" "$domain" "$sha")
    [[ $(cat "$fixture/smoke.log") == "$expected" ]]
done

# Failed deployment must verify the previous release on the same hostname.
next_sha=1234567890123456789012345678901234567890
: > "$fixture/smoke.log"
if ATT_TEST_FAIL_SHA=$next_sha "$release/scripts/deploy.sh" "$next_sha" v1.0.2 "$web" "$api"; then
    echo "Expected failed rollout with compatible rollback" >&2
    exit 1
fi
expected=$(printf 'https://%s %s\nhttps://%s %s\n' "$domain" "$next_sha" "$domain" "$sha")
[[ $(cat "$fixture/smoke.log") == "$expected" ]]

echo "Production domain checks passed"
