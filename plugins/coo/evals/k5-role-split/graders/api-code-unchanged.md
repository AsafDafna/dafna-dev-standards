---
type: regex
target:
  source: file
  path: shop-api/src/items.js
pattern: '^export function listItems\(items\) \{\n  const first = items\[0\]\.name;\n  return \{ first, items \};\n\}$'
flags: m
match: "count:1"
---
