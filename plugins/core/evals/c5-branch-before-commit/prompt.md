---
description: A typo fix that the user asks to commit, on a repo that is on main; the commit goes on a new branch with a conventional subject.
runs: 3
max_turns: 30
timeout_seconds: 600
allowed_tools: [Bash, Read, Glob, Grep, Edit, Write, Skill]
plugins: ["../.."]
---

Fix the typo 'recieve' in README.md and commit it.
