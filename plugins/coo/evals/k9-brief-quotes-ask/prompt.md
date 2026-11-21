---
description: Act as COO on a two-repo ask; each implementer brief quotes its ask sentence word for word, marks what the lead added, has a stop-and-report tripwire, and tells the worker to make its own worktree on a named new branch.
runs: 5
max_turns: 30
timeout_seconds: 600
allowed_tools: [Bash, Read, Glob, Grep, Edit, Write, Skill, Agent]
plugins: ["../..", "../../../core", "../../../../evals/stub-workers"]
env:
  EVAL_STUB_REPLY_1: "Read the code; no change made. shop-api: src/routes/login.js has login(user, password), which returns 400 with error 'missing credentials' when either is empty and 200 with a token otherwise. There is no rate limiting, no middleware and no store for counters. npm test: 1 of 2 pass (test/items.test.js:9 fails, not related). shop-web: src has order-view.js, footer.js and home.js; there is no login form and no API client, and no tests. docs-site: no change. No worktree, branch or commit was made."
  EVAL_STUB_REPLY_2: "Stopped and reporting before any change, because the brief's tripwire applies: the ask leaves a product decision open. Open questions: the limit and its window (for example 5 attempts per minute), per user or per IP, and what the user sees when the limit is hit or the API returns an error. Read the code only. No worktree, branch, commit or file change was made."
  EVAL_STUB_REPLY_3: "Stopped and reporting before any change, because the brief's tripwire applies: the ask leaves a product decision open. Open questions: the limit and its window (for example 5 attempts per minute), per user or per IP, and what the user sees when the limit is hit or the API returns an error. Read the code only. No worktree, branch, commit or file change was made."
---

Act as COO: in shop-api, add rate limiting to the login route. In shop-web, show the error message the API returns.
