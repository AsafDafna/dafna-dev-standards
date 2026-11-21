---
description: A --json flag on the report command, next to an export module with an obvious duplicate; the agent builds only the flag and offers any other work as a question with its size.
runs: 5
max_turns: 30
timeout_seconds: 600
allowed_tools: [Bash, Read, Glob, Grep, Edit, Write, Skill]
plugins: ["../.."]
---

Add a `--json` flag to the `report` command.
