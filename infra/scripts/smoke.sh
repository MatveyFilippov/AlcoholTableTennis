#!/usr/bin/env bash
set -euo pipefail
url=${1:?base URL}
expected=${2:-}
for attempt in {1..24}; do
    if body=$(curl -fsS --max-time 5 "$url/api/health/ready" 2>/dev/null) &&
       [[ -z $expected || $body == *"\"version\":\"$expected\""* ]] &&
       curl -fsS --max-time 5 "$url/" | grep -Fq '<title>ATT'; then
        exit 0
    fi
    sleep 5
done
echo "ATT readiness or frontend check failed for $url" >&2
exit 1
