---
description: A change to the week start, in a repo with a long lessons log; the agent searches the log, finds that npm test skips test/slow/, and runs the slow tests.
runs: 3
max_turns: 30
timeout_seconds: 600
allowed_tools: [Bash, Read, Glob, Grep, Edit, Write, Skill]
plugins: ["../.."]
---

Change the week start from Sunday to Saturday across the app, and check it.
