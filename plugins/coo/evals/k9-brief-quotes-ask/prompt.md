---
description: Act as COO on a small ask in two repos; each implementer brief quotes its ask sentence word for word, marks what the lead added, has a stop-and-report tripwire, and tells the worker to make its own worktree on a named new branch.
runs: 5
max_turns: 30
timeout_seconds: 600
allowed_tools: [Bash, Read, Glob, Grep, Edit, Write, Skill, Agent]
plugins: ["../..", "../../../core", "../../../../evals/stub-workers"]
env:
  EVAL_STUB_REPLY_1: "Digest of the three repos. All three are on main with one commit and no uncommitted changes; none has a remote. shop-api: src/items.js has listItems and countItems and no sort function; items are objects with a name field; npm test: 1 of 2 pass (test/items.test.js:9, listItems on an empty list, fails; not related). makeOrder in src/orders.js returns id, total and price. shop-web: src/order-view.js renders an order as 'Order <id>: <price>' and does not show the total; shop-web has no tests. docs-site: not involved. Nothing changed."
  EVAL_STUB_REPLY_2: "No change made. git worktree add failed in this repo, because .git/worktrees is read-only in this sandbox, so no worktree, branch or commit exists. To go on, I need approval to work on a new branch in the repo's main checkout."
  EVAL_STUB_REPLY_3: "No change made. git worktree add failed in this repo, because .git/worktrees is read-only in this sandbox, so no worktree, branch or commit exists. To go on, I need approval to work on a new branch in the repo's main checkout."
  EVAL_STUB_REPLY_4: "No change made. git worktree add failed in this repo, because .git/worktrees is read-only in this sandbox, so no worktree, branch or commit exists. To go on, I need approval to work on a new branch in the repo's main checkout."
  EVAL_STUB_REPLY_5: "No change made. git worktree add failed in this repo, because .git/worktrees is read-only in this sandbox, so no worktree, branch or commit exists. To go on, I need approval to work on a new branch in the repo's main checkout."
---

Act as COO: in shop-api, add a sortByName function to src/items.js that sorts items by name. In shop-web, show the order total in the order view.
