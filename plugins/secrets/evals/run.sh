#!/bin/sh
# Runs the eval suite: sh run.sh [claude plugin eval options...], for example
#   sh run.sh --case run-with-secrets --runs 1 --max-cost-usd 2 --json /tmp/r.json
# It installs dispatcher.sh, with a new random token, as ~/.local/bin/secrets, runs the eval, and
# removes the dispatcher again, also when the eval fails or is interrupted. See README.md.
set -u

evals=$(cd "$(dirname "$0")" && pwd -P) || exit 2
plugin=${evals%/*}
target=$HOME/.local/bin/secrets
marker='# secrets-eval-dispatcher'
token=
tmp=

is_dispatcher() {
  [ -f "$target" ] && [ ! -L "$target" ] && [ "$(sed -n 2p "$target")" = "$marker" ]
}

# Only the file this run installed; a later run may have replaced it with its own token.
is_ours() {
  [ -n "$token" ] && is_dispatcher && [ "$(sed -n 3p "$target")" = "token=$token" ]
}

if [ -e "$target" ] || [ -L "$target" ]; then
  if ! is_dispatcher; then
    echo "run.sh: $target exists and is not the eval dispatcher. Nothing was changed." >&2
    exit 2
  fi
fi

cleanup() {
  [ -z "$tmp" ] || rm -f "$tmp"
  if is_ours; then rm -f "$target"; fi
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

token=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
[ "${#token}" -eq 32 ] || { echo 'run.sh: could not make a token' >&2; exit 2; }
tmp=$(mktemp "${TMPDIR:-/tmp}/secrets-dispatcher.XXXXXX") || exit 2
# The token goes into the file through builtins only, so it is in no program's arguments.
while IFS= read -r line || [ -n "$line" ]; do
  [ "$line" != token= ] || line=token=$token
  printf '%s\n' "$line"
done < "$evals/dispatcher.sh" > "$tmp" || exit 2
install -m 755 "$tmp" "$target" || exit 2
claude plugin eval "$plugin" --scaffold --allow-tools Bash --trust-plugin --no-publish --model sonnet "$@"
