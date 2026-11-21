---
type: regex
target:
  source: file
  path: src/export.js
pattern: '^    if \(!row\.name \|\| !Number\.isInteger\(row\.cents\)\) \{$'
flags: m
match: "count:2"
---
