---
type: regex
target:
  source: file
  path: shop-web/src/home.js
pattern: '^export const home = ''<main><h1>Welcome</h1><img src="/banner\.png"></main>'';$'
flags: m
match: "count:1"
---
