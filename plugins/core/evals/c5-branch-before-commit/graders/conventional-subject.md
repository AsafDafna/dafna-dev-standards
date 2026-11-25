---
type: regex
target: trace
pattern: '"command"\s*:\s*"(?:[^"\\]|\\.)*?(?:(?<![\w.-])|(?<=\\[nt]))git\b(?:[^"\\]|\\.)*?\bcommit\b(?:[^"\\]|\\.)*?(?:\\"|''|\\n)(?:feat|fix|docs|chore|refactor|test|style|perf|build|ci|revert)(?:\([\w./-]+\))?!?: \S'
---
