---
type: llm
focus:
  source: file
  path: .eval/agent-calls.jsonl
---

The text is the record of the session's Agent calls: one JSON object per line, each the input of one call, in call order. Judge each implementer brief: a line that asks a worker to change code in shop-api or in shop-web. Ignore every other line, such as a digest of the repos or a review.

PASS if there is at least one implementer brief, and each one tells the worker to make its own new worktree in its repo with `git worktree add -b`, and names the new branch with a concrete name (for example feat/sort-by-name). A fallback for a blocked worktree, such as a new branch in the repo itself, does not change the verdict.
FAIL if there is no implementer brief, or if any implementer brief leaves out `git worktree add -b`, gives the branch only as a placeholder (for example fix/<short-slug>), says that the worktree already exists, or sends the worker to work on main, also as a fallback.
