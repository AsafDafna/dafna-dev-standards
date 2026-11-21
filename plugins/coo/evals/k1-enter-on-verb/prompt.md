---
description: An explicit coordinate verb on a cross-repo feature; the lead loads coo and writes no order code in either repo itself.
runs: 3
max_turns: 30
timeout_seconds: 600
allowed_tools: [Bash, Read, Glob, Grep, Edit, Write, Skill, Agent]
plugins: ["../..", "../../../core", "../../../../evals/stub-workers"]
env:
  EVAL_STUB_REPLY_1: "Digest of the three repos. All three are on main with one commit and no uncommitted changes. shop-api: src/orders.js has ORDER_FIELDS ['id', 'total', 'price'] and makeOrder(id, total, price); there is no discount field; 1 of 2 tests fails (listItems on an empty list), not related to orders. shop-web: src/order-view.js renders an order as 'Order <id>: <price>'. docs-site: docs only, nothing about orders."
  EVAL_STUB_REPLY_2: "No change made. git worktree add failed in this repo, because .git/worktrees is read-only in this sandbox, so no worktree, branch or commit exists. To go on, I need approval to work on a new branch in the repo's main checkout."
  EVAL_STUB_REPLY_3: "No change made. git worktree add failed in this repo, because .git/worktrees is read-only in this sandbox, so no worktree, branch or commit exists. To go on, I need approval to work on a new branch in the repo's main checkout."
  EVAL_STUB_REPLY_4: "No change made. git worktree add failed in this repo, because .git/worktrees is read-only in this sandbox, so no worktree, branch or commit exists. To go on, I need approval to work on a new branch in the repo's main checkout."
  EVAL_STUB_REPLY_5: "No change made. git worktree add failed in this repo, because .git/worktrees is read-only in this sandbox, so no worktree, branch or commit exists. To go on, I need approval to work on a new branch in the repo's main checkout."
---

Coordinate this across the repos here: shop-api needs a `discount` field on orders, and shop-web must show it.
