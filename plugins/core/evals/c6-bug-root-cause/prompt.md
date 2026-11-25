---
description: A failing cart test whose cause is Math.floor in toCents; the agent fixes toCents with Math.round, keeps the test's expected value, and runs the tests.
runs: 3
max_turns: 30
timeout_seconds: 600
allowed_tools: [Bash, Read, Glob, Grep, Edit, Write, Skill]
plugins: ["../.."]
---

The cart test fails. Make it pass.
