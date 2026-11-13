# Sourced by the production entry points. Read only APP_DOMAIN without evaluating .env.
read_production_domain() {
    local env_file=$1 contents line domain='' count=0 label valid=1
    local LC_ALL=C
    local -a labels
    local label_pattern='^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$'

    if [[ ! -r $env_file ]]; then
        printf 'Cannot read production configuration: %s\n' "$env_file" >&2
        return 1
    fi
    # A successful NUL-delimited read means the file contains a NUL byte.
    if IFS= read -r -d '' contents < "$env_file"; then
        printf 'Cannot read APP_DOMAIN: %s contains a NUL byte\n' "$env_file" >&2
        return 1
    fi
    while IFS= read -r line; do
        if [[ $line == APP_DOMAIN=* ]]; then
            domain=${line#APP_DOMAIN=}
            count=$((count + 1))
        fi
    done <<< "$contents"

    if (( count != 1 )); then
        printf 'Set exactly one APP_DOMAIN=hostname entry in %s\n' "$env_file" >&2
        return 1
    fi
    if [[ ${#domain} -le 253 && $domain =~ ^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$ &&
        ! ${domain##*.} =~ ^[0-9]+$ ]]; then
        IFS=. read -r -a labels <<< "$domain"
        for label in "${labels[@]}"; do
            if [[ ! $label =~ $label_pattern ]]; then
                valid=0
                break
            fi
        done
        if (( valid )); then
            printf '%s\n' "$domain"
            return 0
        fi
    fi
    printf 'Invalid APP_DOMAIN in %s: use a DNS hostname such as att.example.test, without a scheme, port, path, quotes or whitespace\n' "$env_file" >&2
    return 1
}
