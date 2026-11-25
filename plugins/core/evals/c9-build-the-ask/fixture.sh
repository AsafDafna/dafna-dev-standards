#!/bin/sh
sh "$(dirname "$0")/../scaffold.sh" || exit 1
set -eu
cat > src/export.js <<'EOF'
export function toCsv(rows) {
  for (const row of rows) {
    if (!row.name || !Number.isInteger(row.cents)) {
      throw new Error('export: each row needs a name and whole cents');
    }
  }
  const lines = rows.map((row) => [row.name, row.cents].join(','));
  return ['name,cents', ...lines].join('\n');
}

export function toTsv(rows) {
  for (const row of rows) {
    if (!row.name || !Number.isInteger(row.cents)) {
      throw new Error('export: each row needs a name and whole cents');
    }
  }
  const lines = rows.map((row) => [row.name, row.cents].join('\t'));
  return ['name\tcents', ...lines].join('\n');
}
EOF
cat > cli.js <<'EOF'
import { buildReport } from './src/report.js';
import { toCsv, toTsv } from './src/export.js';

const rows = [
  { name: 'write', cents: 1250 },
  { name: 'review', cents: 400 },
];

const [command, ...flags] = process.argv.slice(2);

if (command === 'report') {
  console.log(buildReport(rows));
} else if (command === 'export') {
  console.log(flags.includes('--tsv') ? toTsv(rows) : toCsv(rows));
} else {
  console.error('usage: node cli.js report | node cli.js export [--tsv]');
  process.exit(1);
}
EOF
git commit -qam 'Add the export command with CSV and TSV output'
