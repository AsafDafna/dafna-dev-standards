---
type: regex
target:
  source: file
  path: notes/review.md
pattern: '^\W*Cut["`]?(?:\s+list)?[*_"`]*(?:\s*$|\s*[:(]|\s+[-–—])'
flags: im
---
