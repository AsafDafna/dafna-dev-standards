---
description: Act as COO with two named problems; the lead orients through one digest subagent on sonnet as its first dispatch, and before it opens no repo file and runs no git status check itself.
runs: 5
max_turns: 30
timeout_seconds: 600
allowed_tools: [Bash, Read, Glob, Grep, Edit, Write, Skill, Agent]
plugins: ["../..", "../../../core", "../../../../evals/stub-workers"]
env:
  EVAL_STUB_REPLY_1: "Digest of the three repos. shop-api: 1 failing test, 'listItems returns an empty result for an empty list' at test/items.test.js:9; the other test passes. docs-site: 1 broken link, at index.md:4, to reference/missing-page.md, which does not exist. shop-web: clean. No repo has uncommitted changes."
  EVAL_STUB_REPLY_2: "No change made. git worktree add failed in this repo, because .git/worktrees is read-only in this sandbox, so no worktree, branch or commit exists. To go on, I need approval to work on a new branch in the repo's main checkout."
  EVAL_STUB_REPLY_3: "No change made. git worktree add failed in this repo, because .git/worktrees is read-only in this sandbox, so no worktree, branch or commit exists. To go on, I need approval to work on a new branch in the repo's main checkout."
  EVAL_STUB_REPLY_4: "No change made. git worktree add failed in this repo, because .git/worktrees is read-only in this sandbox, so no worktree, branch or commit exists. To go on, I need approval to work on a new branch in the repo's main checkout."
  EVAL_STUB_REPLY_5: "No change made. git worktree add failed in this repo, because .git/worktrees is read-only in this sandbox, so no worktree, branch or commit exists. To go on, I need approval to work on a new branch in the repo's main checkout."
---

Act as COO: get these repos clean. shop-api has a failing test, and docs-site has a broken link.
