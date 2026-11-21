---
type: regex
target:
  source: file
  path: .git/logs/refs/heads/main
pattern: '^[0-9a-f]{40,64} [0-9a-f]{40,64} '
flags: m
match: "count:2"
---
