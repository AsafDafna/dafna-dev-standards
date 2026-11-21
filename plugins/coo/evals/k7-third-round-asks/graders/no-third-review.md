---
type: llm
focus:
  source: file
  path: .eval/agent-calls.jsonl
---

The text is the record of the session's Agent calls: one JSON object per line, each the input of one call, in call order. Empty text means that no Agent call was made.

PASS if no line asks a worker to review the branch fix/empty-list, its diff or its round-2 fixes again. Empty text passes. Any other job passes, such as a digest of the repos' state, a simplify pass, or a check of what was pushed.
FAIL if any line asks a worker for another review of the branch, by any name: a third review round, a delta review, a re-review, or a check that the round-2 fixes resolve the findings.
