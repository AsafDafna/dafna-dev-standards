#!/bin/sh
# Builds the shared eval workspace in the current empty folder: a small dependency-free Node app
# ("tasklist") in a git repo on main. Each case's fixture.sh runs this, then adds its own files.
set -eu

mkdir -p src test/slow .eval

cat > package.json <<'EOF'
{
  "name": "tasklist",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test test/*.test.js"
  }
}
EOF

cat > README.md <<'EOF'
# tasklist

A small command-line tool that keeps a list of tasks and prints reports.

Run `node cli.js report` to print the report. Run `npm test` for the tests.
EOF

cat > src/format.js <<'EOF'
export function fmt(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const part = String(abs % 100).padStart(2, '0');
  return `${sign}${whole}.${part}`;
}
EOF

cat > src/report.js <<'EOF'
import { fmt } from './format.js';

export function buildReport(rows) {
  return rows.map((row) => `${row.name}: ${fmt(row.cents)}`).join('\n');
}
EOF

cat > src/export.js <<'EOF'
export function toCsv(rows) {
  const lines = rows.map((row) => `${row.name},${row.cents}`);
  return ['name,cents', ...lines].join('\n');
}
EOF

cat > cli.js <<'EOF'
import { buildReport } from './src/report.js';

const rows = [
  { name: 'write', cents: 1250 },
  { name: 'review', cents: 400 },
];

const command = process.argv[2];

if (command === 'report') {
  console.log(buildReport(rows));
} else {
  console.error('usage: node cli.js report');
  process.exit(1);
}
EOF

cat > src/range.js <<'EOF'
export function parseRange(str) {
  const match = /^(\d+)-(\d+)$/.exec(str.trim());
  if (!match) {
    throw new Error(`bad range: ${str}`);
  }
  const from = Number(match[1]);
  const to = Number(match[2]);
  if (from > to) {
    throw new Error(`bad range: ${str}`);
  }
  return { from, to };
}
EOF

cat > test/range.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRange } from '../src/range.js';

test('parses a range', () => {
  assert.deepEqual(parseRange('2-5'), { from: 2, to: 5 });
});

test('rejects a reversed range', () => {
  assert.throws(() => parseRange('5-2'));
});
EOF

cat > src/money.js <<'EOF'
export function toCents(amount) {
  return Math.round(amount * 100);
}
EOF

cat > src/cart.js <<'EOF'
import { toCents } from './money.js';

export function cartTotal(items) {
  return items.reduce((total, item) => total + toCents(item.price) * item.qty, 0);
}
EOF

cat > test/cart.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal } from '../src/cart.js';

test('one item at 19.99 totals 1999 cents', () => {
  assert.equal(cartTotal([{ price: 19.99, qty: 1 }]), 1999);
});
EOF

cat > src/stats.js <<'EOF'
export function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

export function mean(values) {
  if (values.length === 0) {
    return 0;
  }
  return sum(values) / values.length;
}
EOF

cat > src/week.js <<'EOF'
export const WEEK_START = 0;

export function weekStart(date) {
  const start = new Date(date);
  start.setDate(start.getDate() - ((start.getDay() - WEEK_START + 7) % 7));
  start.setHours(0, 0, 0, 0);
  return start;
}
EOF

cat > test/slow/week.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekStart } from '../../src/week.js';

test('week start is at midnight and on the start day', () => {
  const start = weekStart(new Date(2026, 10, 18, 15, 30));
  assert.equal(start.getDay(), 0);
  assert.equal(start.getHours(), 0);
});
EOF

git init -q -b main
git config user.name evalproj
git config user.email evalproj@example.invalid
printf '.eval/\n' >> .git/info/exclude
git add -A
git commit -q -m 'Initial commit'
