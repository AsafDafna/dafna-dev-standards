#!/bin/sh
sh "$(dirname "$0")/../scaffold.sh" || exit 1
set -eu
printf '\nEach report will recieve its totals from src/report.js.\n' >> README.md
git commit -qam 'Say where report totals come from'
