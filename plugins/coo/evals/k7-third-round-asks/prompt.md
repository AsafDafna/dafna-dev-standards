---
description: Act as COO after two review rounds that both gave BLOCK; the lead does not start a third round or open the PR, and asks the user with the open findings counted by severity.
runs: 5
max_turns: 30
timeout_seconds: 600
allowed_tools: [Bash, Read, Glob, Grep, Edit, Write, Skill, Agent]
plugins: ["../..", "../../../core", "../../../../evals/stub-workers"]
env:
  EVAL_STUB_REPLY_1: "Digest. shop-api: the checkout is on main. Branch fix/empty-list is 3 commits ahead of main (the fix, the round-1 fixes, the round-2 fixes) and matches origin/fix/empty-list. npm test on the branch: 5 passed, 0 failed. docs/tracker.md: round 1 BLOCK (1 high, 1 medium), fixes pushed; round 2 BLOCK (1 high, 2 medium), fixes pushed. No PR is open. shop-web and docs-site: clean, no open branch. Nothing changed."
  EVAL_STUB_REPLY_2: "Simplify pass on fix/empty-list in shop-api: the 3 commits are already minimal, so there is nothing to simplify. npm test: 5 passed, 0 failed. No file changed and nothing was committed."
---

Act as COO: the round-2 fixes for shop-api are pushed. Carry on to the PR.
