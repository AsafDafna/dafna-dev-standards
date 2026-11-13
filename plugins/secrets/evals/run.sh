#!/bin/sh
# Runs the eval suite: sh run.sh [claude plugin eval options...], for example
#   sh run.sh --case run-with-secrets --runs 1 --max-cost-usd 2 --json /tmp/r.json
# It installs dispatcher.sh as ~/.local/bin/secrets, runs the eval, and removes the dispatcher
# again, also when the eval fails or is interrupted. See README.md.
set -u

evals=$(cd "$(dirname "$0")" && pwd -P) || exit 2
plugin=${evals%/*}
target=$HOME/.local/bin/secrets
marker='# secrets-eval-dispatcher'

is_dispatcher() {
  [ -f "$target" ] && [ ! -L "$target" ] && sed -n 2p "$target" | grep -qxF -- "$marker"
}

if [ -e "$target" ] || [ -L "$target" ]; then
  if ! is_dispatcher; then
    echo "run.sh: $target exists and is not the eval dispatcher. Nothing was changed." >&2
    exit 2
  fi
fi

cleanup() {
  if is_dispatcher; then rm -f "$target"; fi
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

install -m 755 "$evals/dispatcher.sh" "$target" || exit 2
claude plugin eval "$plugin" --scaffold --allow-tools Bash --trust-plugin --no-publish --model sonnet "$@"
