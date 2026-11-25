---
type: regex
target: trace
pattern: '^(?:(?!"name"\s*:\s*"Agent")[\s\S])*?"command"\s*:\s*"(?:[^"\\]|\\.)*?(?:(?<![\w.-])|(?<=\\[nt]))git(?:\s+(?:-C|-c|--git-dir|--work-tree)(?:\s+|=)(?:[^\s"\\]|\\.)+|\s+--no-pager|\s+-P|\s+--paginate)*\s+(?:log|status|diff|show)(?![\w-])'
match: not_contains
---
