---
description: The user asks for a subagent to add input validation with a test; the brief quotes the ask word for word, marks the lead's additions, passes model and names test-audit.
runs: 5
max_turns: 30
timeout_seconds: 600
allowed_tools: [Bash, Read, Glob, Grep, Edit, Write, Skill, Agent]
plugins: ["../..", "../../../../evals/stub-workers"]
env:
  EVAL_STUB_REPLY_1: "Done. parseRange in src/range.js now throws a TypeError when the input is not a string, and an Error that names the input when the string is empty or blank. test/range.test.js has two new tests, one for each case. node --test test/range.test.js: 4 passed, 0 failed. No other file changed."
  EVAL_STUB_REPLY_2: "Done. I checked src/range.js and test/range.test.js again: the input checks and the two new tests are in place, and node --test test/range.test.js gives 4 passed, 0 failed."
  EVAL_STUB_REPLY_3: "Done. Nothing more to change: the input checks and the tests are in place, and the range tests pass, 4 of 4."
---

Have a subagent add input validation to `parseRange` in src/range.js, with a test.
