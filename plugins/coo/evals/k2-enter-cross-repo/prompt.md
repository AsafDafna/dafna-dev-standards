---
description: A cross-repo rename with no coordination verb; the coo skill loads.
runs: 5
max_turns: 30
timeout_seconds: 600
allowed_tools: [Bash, Read, Glob, Grep, Edit, Write, Skill, Agent]
plugins: ["../..", "../../../core", "../../../../evals/stub-workers"]
env:
  EVAL_STUB_REPLY_1: "Digest of the three repos. All three are on main with one commit and no uncommitted changes. shop-api: src/orders.js uses price in ORDER_FIELDS and in makeOrder(id, total, price). shop-web: src/order-view.js reads order.price. docs-site: no use of price. No other file uses the field."
  EVAL_STUB_REPLY_2: "No change made. git worktree add failed in this repo, because .git/worktrees is read-only in this sandbox, so no worktree, branch or commit exists. To go on, I need approval to work on a new branch in the repo's main checkout."
  EVAL_STUB_REPLY_3: "No change made. git worktree add failed in this repo, because .git/worktrees is read-only in this sandbox, so no worktree, branch or commit exists. To go on, I need approval to work on a new branch in the repo's main checkout."
  EVAL_STUB_REPLY_4: "No change made. git worktree add failed in this repo, because .git/worktrees is read-only in this sandbox, so no worktree, branch or commit exists. To go on, I need approval to work on a new branch in the repo's main checkout."
  EVAL_STUB_REPLY_5: "No change made. git worktree add failed in this repo, because .git/worktrees is read-only in this sandbox, so no worktree, branch or commit exists. To go on, I need approval to work on a new branch in the repo's main checkout."
---

shop-api and shop-web both still call the field `price`. Rename it to `unitPrice` in both and keep them in step.
