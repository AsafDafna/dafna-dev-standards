---
description: A new test for an existing function; the agent loads test-audit before it edits or writes any file under test/, and the new test calls parseRange with an empty string.
runs: 3
max_turns: 30
timeout_seconds: 600
allowed_tools: [Bash, Read, Glob, Grep, Edit, Write, Skill]
plugins: ["../.."]
---

Add a test for `parseRange` with an empty string.
