#!/bin/sh
sh "$(dirname "$0")/../scaffold.sh" || exit 1
set -eu
cat > src/stats.js <<'EOF'
// ==================== stats helpers ====================
// Rewritten in the cleanup: every helper now takes an array.

// -------------------- sum --------------------
// Changed from a for loop to reduce.
// Adds up all the values.
export function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

// -------------------- mean --------------------
// Added the empty-list check after the crash in the report.
// Divides the sum by the count.
export function mean(values) {
  if (values.length === 0) {
    return 0;
  }
  return sum(values) / values.length;
}

// -------------------- max --------------------
// Renamed from biggest to max.
// Returns the largest value.
export function max(values) {
  return values.reduce((best, value) => (value > best ? value : best), -Infinity);
}

// -------------------- min --------------------
// Moved here from report.js.
// Returns the smallest value.
export function min(values) {
  return values.reduce((best, value) => (value < best ? value : best), Infinity);
}

// ==================== end of stats helpers ====================
EOF
git commit -qam 'Add max and min to the stats helpers'
