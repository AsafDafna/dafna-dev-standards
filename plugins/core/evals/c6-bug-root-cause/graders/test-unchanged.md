---
type: regex
target:
  source: file
  path: test/cart.test.js
pattern: '^test\(\x27one item at 19\.99 totals 1999 cents\x27, \(\) => \{\n  assert\.equal\(cartTotal\(\[\{ price: 19\.99, qty: 1 \}\]\), 1999\);$'
flags: m
match: "count:1"
---
