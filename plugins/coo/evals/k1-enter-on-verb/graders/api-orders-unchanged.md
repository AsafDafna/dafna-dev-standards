---
type: regex
target:
  source: file
  path: shop-api/src/orders.js
pattern: '^export const ORDER_FIELDS = \[''id'', ''total'', ''price''\];\n\nexport function makeOrder\(id, total, price\) \{\n  return \{ id, total, price \};\n\}$'
flags: m
match: "count:1"
---
