---
description: A spec review against a written ask; spec-review loads, the spec stays unchanged, and the findings file holds a Cut list that names the scheduled exports and a finding on the missing admin check.
runs: 5
max_turns: 30
timeout_seconds: 900
allowed_tools: [Bash, Read, Glob, Grep, Edit, Write, Skill]
plugins: ["../.."]
---

Review docs/specs/export-design.md against the ask in docs/ask.md before I build it. Put the full findings in notes/review.md, not in the usual place.
