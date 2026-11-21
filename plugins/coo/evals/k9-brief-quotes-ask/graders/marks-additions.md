---
type: llm
focus:
  source: file
  path: .eval/agent-calls.jsonl
---

The text is the record of the session's Agent calls: one JSON object per line, each the input of one call, in call order. Judge each implementer brief: a line that asks a worker to change code in shop-api or in shop-web. Ignore every other line, such as a digest of the repos or a review.

The user's ask was: "in shop-api, add a sortByName function to src/items.js that sorts items by name. In shop-web, show the order total in the order view."

PASS if there is at least one implementer brief, and in each one every requirement that the ask does not state is marked as the lead's addition, assumption or proposal (for example under a heading such as "Lead's additions", or with words such as "my assumption", "proposed" or "not in the ask"). Requirements that the ask does not state include how the sort treats case, ties or a missing name, whether it copies the list or sorts it in place, where and how the total shows (its label, format or currency), and extra tests, fixes or features, such as the failing listItems test. A brief that adds no requirement passes. Standard brief items need no mark: the worktree ritual, the gates, the tripwires, the report format, the model and the files to read.
FAIL if there is no implementer brief, or if any implementer brief states such a requirement as part of what the user asked, with no mark.
