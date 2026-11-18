---
name: lessons-log
description: Use when (a) something breaks unexpectedly, a test fails for a surprising reason, or a CI failure mode recurs; (b) you discover a non-obvious project gotcha: a framework footgun, a config that means the opposite of what it looks like, a hidden default; (c) a non-obvious approach is confirmed to work and is worth repeating; (d) the user says "log this", "save the lesson", "record this", "/log-lesson", "remember this". Also use before a non-trivial task in a repo that has `.claude/lessons.md`, to search it for that task. Project-scoped: applies in every repo that has a lessons.md, committed to git.
---

# `.claude/lessons.md`: the project's lessons log

A committed log of project gotchas and validated patterns, so a fresh session does not find the same problem again. /bootstrap-repo seeds the file at the repo root.

## When to read

Search the file before a task that touches code, schemas, infra or workflows. Do not read it whole at session start: a large file comes back cut.

- Search it (`grep -n -i`) for the task's anchors: file paths, function, table and column names, CLI and CI job names, error text, and the kind of change (for example `RLS policy` or `db reset`). Read the matching entries with Read `offset`/`limit`.
- A date pointer such as "`.claude/lessons.md`, 2026-07-16" means: search for that date. A line pointer such as `lessons.md:157` can drift: check that the entry matches, else search its words.
- You do not need to summarize the matches to the user; let them shape your work.

## What to log

Log sparingly. An entry is a real project gotcha (a surprising failure and its cause, a footgun, a CI failure that came back) or a validated pattern (a non-obvious approach that was confirmed to work). Give the why: "do not use X, it caused Y" survives new situations, a bare "do not use X" does not.

Do not log:
- Trivia, typos, normal iteration on a draft, or a change of approach with no specific reason.
- Praise that is not tied to a specific pattern.
- Anything a CLAUDE.md or a shared rule already says.
- Corrections about how you write or work in general. Those belong in the user's own rules, not in a project log.

## Format

```
- [YYYY-MM-DD] [+/-] Brief lesson. (context: what triggered it)
```

`+` is what worked, `-` is what to avoid. The lesson is one sentence; the context is one short clause that names the PR, file or incident. If the file uses another format, match it.

## Append flow

1. Find the file at the repo root: `<root>/.claude/lessons.md`. If it does not exist, ask the user before you create one; adopting the log is a project decision.
2. Read the first ~20 lines for the format, the order of entries and any rules in the header. Then search the file for the lesson's anchors.
3. One entry per subject. If an entry already covers the subject, update that entry instead of adding one. If the header says to add lines only at the end, follow the header.
4. Show the entry to the user before you write it: "About to log: `<entry>` to `<path>`. OK?" Skip this when the user asked you to log it.
5. Add the entry where the file's order puts it. Append with Bash (`cat >> <path> <<'EOF'`), or use the Edit tool after a Read of that part of the file: the Edit tool refuses a file you have not read.

## Pattern promotion

When 3 or more entries point at the same underlying pattern, it has earned a rule. Use the search from step 2, with the pattern's own words too. Ask the user whether to promote it to a rule in CLAUDE.md, and where; do not promote silently. A lesson that recurs in 2 or more repos can become a shared rule through a PR to dafna-dev-standards.
