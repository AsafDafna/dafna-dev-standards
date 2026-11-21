---
description: Act as COO with two named problems; the lead orients through one digest subagent on sonnet, then dispatches, and opens no repo file and runs no git status check itself.
runs: 3
max_turns: 30
timeout_seconds: 600
allowed_tools: [Bash, Read, Glob, Grep, Edit, Write, Skill, Agent]
plugins: ["../..", "../../../core", "../../../../evals/stub-workers"]
env:
  EVAL_STUB_REPLY_1: "Digest of the three repos. shop-api: 1 failing test, 'listItems returns an empty result for an empty list' at test/items.test.js:9; the other test passes. docs-site: 1 broken link, at index.md:4, to reference/missing-page.md, which does not exist. shop-web: clean. No repo has uncommitted changes."
---

Act as COO: get these repos clean. shop-api has a failing test, and docs-site has a broken link.
