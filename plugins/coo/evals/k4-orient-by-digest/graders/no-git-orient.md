---
type: tool_used
tool: Bash
input_match: '"command"\s*:\s*"(?:[^"\\]|\\.)*?(?:(?<![\w.-])|(?<=\\[nt]))git(?:\s+(?:-C|-c|--git-dir|--work-tree)(?:\s+|=)(?:[^\s"\\]|\\.)+|\s+--no-pager|\s+-P|\s+--paginate)*\s+(?:log|status|diff|show)(?![\w-])'
min: 0
max: 0
---
