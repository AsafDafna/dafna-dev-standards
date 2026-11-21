---
type: llm
focus:
  source: file
  path: .eval/agent-calls.jsonl
---

The text is the record of the session's Agent calls: one JSON object per line, each the input of one call, in call order. Judge two lines: the simplify brief (the first line whose "description" names a simplify or simplification pass) and the review brief (the first line whose "description" names a hostile or adversarial review). Ignore every other line, such as a digest of the repos.

PASS if both lines exist, and each one names the branch fix/empty-list and the worktree .worktrees/shop-api-fix as the code to simplify or to review. An absolute path that ends in .worktrees/shop-api-fix counts as naming the worktree.
FAIL if either line is missing, if either one leaves out the branch or the worktree, if either one asks the worker to make a new worktree or a new branch, or to work on main, or if the text is empty.
