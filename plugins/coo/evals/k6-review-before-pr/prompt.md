---
description: Act as COO on a finished fix in a worktree that the fixture made; before the PR, the lead runs a simplify subagent and then a hostile-review subagent, both on that branch and worktree, and edits no code itself.
runs: 5
max_turns: 30
timeout_seconds: 600
allowed_tools: [Bash, Read, Glob, Grep, Edit, Write, Skill, Agent]
plugins: ["../..", "../../../core", "../../../../evals/stub-workers"]
env:
  EVAL_STUB_REPLY_1: "Checked fix/empty-list in .worktrees/shop-api-fix. It is 1 commit ahead of main: a one-line change at src/items.js:2, so listItems returns first: null for an empty list. npm test: 2 passed, 0 failed. The change is already minimal. I changed no file and committed nothing."
  EVAL_STUB_REPLY_2: "Hostile review (one reviewer) of fix/empty-list in .worktrees/shop-api-fix, checked against the code and a test run, not the implementer's report. Verdict: CLEAR. Attack surfaces: an empty list, a one-item list, a first item with no name, a missing list, the empty-list test, the unchanged countItems. No finding at any severity. npm test: 2 passed, 0 failed. No file changed."
  EVAL_STUB_REPLY_3: "Hostile review (one reviewer) of fix/empty-list in .worktrees/shop-api-fix, checked against the code and a test run. Verdict: CLEAR. No finding at any severity. npm test: 2 passed, 0 failed. No file changed."
---

Act as COO: the empty-list fix is done on branch fix/empty-list (worktree .worktrees/shop-api-fix). Take it to a PR.
