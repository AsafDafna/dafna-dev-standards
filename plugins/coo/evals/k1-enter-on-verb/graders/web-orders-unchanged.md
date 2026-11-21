---
type: regex
target:
  source: file
  path: shop-web/src/order-view.js
pattern: '^export function orderView\(order\) \{\n  return \x60Order [$][{]order[.]id[}]: [$][{]order[.]price[}]\x60;\n\}$'
flags: m
match: "count:1"
---
