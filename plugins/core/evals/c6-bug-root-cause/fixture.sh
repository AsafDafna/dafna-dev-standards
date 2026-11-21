#!/bin/sh
sh "$(dirname "$0")/../scaffold.sh" || exit 1
set -eu
cat > src/money.js <<'JS'
export function toCents(amount) {
  return Math.floor(amount * 100);
}
JS
git commit -qam 'Tidy toCents'
