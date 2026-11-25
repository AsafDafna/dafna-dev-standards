---
type: regex
target: trace
pattern: '^(?:(?!"name"\s*:\s*"Agent")[\s\S])*?"name"\s*:\s*"Read"[^{}]*?"input"\s*:\s*\{(?:[^{}"]|"(?:[^"\\]|\\.)*")*?"file_path"\s*:\s*"(?:[^"\\/]*/)*(?:shop-api|shop-web|docs-site)/'
match: not_contains
---
