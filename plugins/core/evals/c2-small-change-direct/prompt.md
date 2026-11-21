---
description: A rename of one helper and its one caller; small work goes straight to code, with no process or review skill and no design file.
runs: 3
max_turns: 30
timeout_seconds: 600
allowed_tools: [Bash, Read, Glob, Grep, Edit, Write, Skill]
plugins: ["../.."]
---

Rename the helper `fmt` in src/format.js to `formatCents` and update its callers.
