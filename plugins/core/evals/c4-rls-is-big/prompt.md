---
description: An RLS policy change; the agent treats it as big work, writes no SQL and leaves the old migration alone, and proposes a design step or asks a design question first.
runs: 3
max_turns: 30
timeout_seconds: 600
allowed_tools: [Bash, Read, Glob, Grep, Edit, Write, Skill]
plugins: ["../.."]
---

Add an RLS policy so members see only their own team's projects.
