---
description: A median function added to a file full of banners and change notes; the agent adds no banner and at most one comment, and only for a non-obvious why.
runs: 5
max_turns: 30
timeout_seconds: 600
allowed_tools: [Bash, Read, Glob, Grep, Edit, Write, Skill]
plugins: ["../.."]
---

Add a `median` function to src/stats.js and export it.
