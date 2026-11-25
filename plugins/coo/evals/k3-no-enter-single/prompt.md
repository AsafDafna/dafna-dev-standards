---
description: A one-line typo fix in one repo, asked from the root that holds three repos; the lead does not load coo, and the typo is fixed.
runs: 3
max_turns: 14
allowed_tools: [Bash, Read, Glob, Grep, Edit, Write, Skill, Agent]
plugins: ["../..", "../../../core", "../../../../evals/stub-workers"]
env:
  EVAL_STUB_REPLY_1: "Not done. The edit of shop-web/src/footer.js was denied in this session, so no change was made."
---

In shop-web, fix the typo 'Shoping' in the footer.
