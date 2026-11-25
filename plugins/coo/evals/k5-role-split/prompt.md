---
description: Act as COO on two fixes in two repos; the lead writes no code, passes model on every dispatch and no name.
runs: 3
max_turns: 30
timeout_seconds: 600
allowed_tools: [Bash, Read, Glob, Grep, Edit, Write, Skill, Agent]
plugins: ["../..", "../../../core", "../../../../evals/stub-workers"]
env:
  EVAL_STUB_REPLY_1: "Digest of the three repos. All three are on main with one commit and no uncommitted changes. shop-api: src/items.js:2 listItems reads items[0].name with no guard, so an empty list throws; test/items.test.js:9 covers this case and fails; listItems backs GET /items. shop-web: src/home.js has one img, /banner.png, with no alt attribute. docs-site: not involved."
  EVAL_STUB_REPLY_2: "No change made. git worktree add failed in this repo, because .git/worktrees is read-only in this sandbox, so no worktree, branch or commit exists. To go on, I need approval to work on a new branch in the repo's main checkout."
  EVAL_STUB_REPLY_3: "No change made. git worktree add failed in this repo, because .git/worktrees is read-only in this sandbox, so no worktree, branch or commit exists. To go on, I need approval to work on a new branch in the repo's main checkout."
  EVAL_STUB_REPLY_4: "No change made. git worktree add failed in this repo, because .git/worktrees is read-only in this sandbox, so no worktree, branch or commit exists. To go on, I need approval to work on a new branch in the repo's main checkout."
  EVAL_STUB_REPLY_5: "No change made. git worktree add failed in this repo, because .git/worktrees is read-only in this sandbox, so no worktree, branch or commit exists. To go on, I need approval to work on a new branch in the repo's main checkout."
---

Act as COO: fix the 500 on `GET /items` with an empty list in shop-api, and add the missing alt text on the shop-web home page.
