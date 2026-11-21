---
type: regex
target:
  source: file
  path: .eval/agent-calls.jsonl
pattern: '^(?=[^\n]*[{,]\s*"model"\s*:\s*"sonnet")(?![^\n]*[{,]\s*"description"\s*:\s*"(?:[^"\\]|\\.)*?\b(?:fix|add|implement|rename|patch|repair|edit)\b)'
flags: i
---
