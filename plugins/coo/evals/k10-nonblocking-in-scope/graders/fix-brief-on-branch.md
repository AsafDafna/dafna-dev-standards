---
type: llm
focus:
  source: file
  path: .eval/agent-calls.jsonl
---

The text is the record of the session's Agent calls: one JSON object per line, each the input of one call, in call order. Judge the brief that asks a worker to fix note N1: the name `res2` in `listItems`. If there are several, judge the first.

PASS if that brief names the branch fix/empty-list and the worktree .worktrees/shop-api-fix as where to work, and tells the worker to commit the fix there. An absolute path that ends in .worktrees/shop-api-fix counts as naming the worktree.
FAIL if there is no such brief, if it leaves out the branch or the worktree, if it asks the worker to make a new worktree or a new branch, or to work on main, or if it does not tell the worker to commit on that branch.
