#!/usr/bin/env bash
set -euo pipefail
tag=${1:?release tag}
main=${2:?main commit}
release=${3:?release commit}
[[ $tag =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || {
    echo "Invalid stable release tag" >&2; exit 1;
}
[[ $main =~ ^[0-9a-f]{40}$ && $release == "$main" ]] || {
    echo "Release must point to the current main commit" >&2; exit 1;
}
