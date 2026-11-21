---
type: regex
target:
  source: file
  path: .worktrees/shop-api-fix/src/items.js
pattern: '^  const first = items\.length > 0 \? items\[0\]\.name : null;$'
flags: m
match: "count:1"
---
