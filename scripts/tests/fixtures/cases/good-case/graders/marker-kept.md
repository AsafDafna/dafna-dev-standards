---
type: regex
target:
  source: file
  path: src/app.js
pattern: '^export const LIMIT = 3;$'
flags: m
match: "count:1"
---
