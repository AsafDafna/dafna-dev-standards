---
type: tool_order
before:
  tool: Agent
  input_match: '"description"\s*:\s*"(?:(?![Hh]ostile|[Aa]dversarial|[Rr]eviewer)(?:[^"\\]|\\.))*?[Ss]implif'
after:
  tool: Agent
  input_match: '"description"\s*:\s*"(?:(?![Ss]implif)(?:[^"\\]|\\.))*?(?:[Hh]ostile|[Aa]dversarial|[Rr]eviewer)'
---
