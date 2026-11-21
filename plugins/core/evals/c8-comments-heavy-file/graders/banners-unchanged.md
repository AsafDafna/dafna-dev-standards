---
type: regex
target:
  source: file
  path: src/stats.js
pattern: '^[ \t]*(?://|/\*|\*)[^\n]*?[-=*#~]{3,}[^\n]*$(?:(?=[\s\S]*?(?:export\s+(?:async\s+)?function\s*\*?\s*median\b|export\s+(?:const|let|var)\s+median\b|export\s*\{[^}]*\bmedian\b))|(?<=(?:export\s+(?:async\s+)?function\s*\*?\s*median\b|export\s+(?:const|let|var)\s+median\b|export\s*\{[^}]*\bmedian\b)[\s\S]*?))'
flags: m
match: "count:6"
---
