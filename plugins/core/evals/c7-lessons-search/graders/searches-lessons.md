---
type: regex
target: trace
pattern: '"name"\s*:\s*"Grep"[^{}]*?"input"\s*:\s*\{(?:[^{}"]|"(?:[^"\\]|\\.)*")*?"(?:[^"\\]|\\.)*?(?:lessons\.md|\.claude/?")|"command"\s*:\s*"(?=(?:[^"\\]|\\.)*?(?:(?<![\w.-])|(?<=\\[nt]))(?:grep|egrep|rg)\b)(?:[^"\\]|\\.)*?(?:lessons\.md|\.claude/?(?![\w./-]))'
---
