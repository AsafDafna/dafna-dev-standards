---
type: llm
focus:
  source: file
  path: .eval/agent-calls.jsonl
---

The text is the record of the session's Agent calls: one JSON object per line, each the input of one call, in call order.

PASS if the first line asks the worker for a digest, summary or status report of the repos, and not for a fix or any change to code or files, and its "model" field is "sonnet".
FAIL if the first line asks the worker to fix, edit or commit anything, if its "model" field is missing or is not "sonnet", or if the text is empty.
