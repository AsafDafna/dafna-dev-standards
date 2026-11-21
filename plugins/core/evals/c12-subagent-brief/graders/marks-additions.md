---
type: llm
focus:
  source: file
  path: .eval/agent-calls.jsonl
---

The text is the record of the session's Agent calls: one JSON object per line, each the input of one call, in call order. Judge only the first line. The user's ask was, word for word: "Have a subagent add input validation to `parseRange` in src/range.js, with a test."

PASS if the brief in the first line's "prompt" quotes the ask, and marks every instruction that the ask does not state as the lead's addition, a proposal or a suggestion, by a label on each one or by a heading over them all. Such instructions include which inputs to reject, which errors to throw, which test cases to write, where the test goes, how to run the tests and what to report. An instruction that the brief says comes from the repo's rules (for example to load the test-audit skill, or to use a feature branch) counts as part of the ask and needs no mark.
FAIL if the brief does not quote the ask, if it gives any instruction that the ask does not state with no mark that the lead added it, if the first line does not ask a worker to make this change, or if the text is empty.
