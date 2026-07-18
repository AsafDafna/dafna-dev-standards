---
name: lessons-log
description: Use when (a) the user corrects an approach, reverts your output, or says "stop doing X" / "no, not like that"; (b) the user praises a specific pattern or accepts a non-obvious choice ("yes, exactly", "perfect, keep doing that"); (c) something breaks unexpectedly, a test fails for a surprising reason, or a CI failure mode recurs; (d) you discover a non-obvious gotcha — a framework footgun, a config that means the opposite of what it looks like; (e) the user says "log this", "save the lesson", "record this", "/log-lesson", "remember this". Also use at session start if `.claude/lessons.md` exists in the current repo and the first task is non-trivial. Project-scoped: applies in every repo that has a lessons.md, committed to git.
---

# `.claude/lessons.md` — corrections + wins log

A running, committed log of corrections, gotchas, and validated wins for the project you're working in. The protocol is shared across all repos that adopt this pattern (seeded by /bootstrap-repo).

## Why bother

Most of the same mistakes get re-made by fresh Claude sessions because the prior conversation is gone. A committed lessons file fixes that — both future contributors and future Claude sessions see it. The cost of one wrong append is tiny; the cost of repeating a fix the user already corrected once is large (their time, plus the trust hit).

The *why* matters for every entry. A bare correction ("don't use X") rots fast. A correction with context ("don't use X — last time it caused Y") survives translation to new situations.

## When to read

Read `.claude/lessons.md` near session start if:

- The file exists in the project you're working in (look for `<cwd>/.claude/lessons.md` or the nearest enclosing repo root's version).
- The user's first task touches code, schemas, infra, or workflows (anything that could trip on a prior incident). Skip for pure conversation or trivial reads.

If you read it, you don't need to summarize back to the user — just hold the entries in working memory so they shape your suggestions.

## When to append

Five triggers. Apply them generously — over-logging is better than under-logging because thin entries are cheap to skip later, while missing entries get re-discovered as "new" problems.

1. **User correction.** User reverts your output, edits it significantly, or says "no, do X instead." Even soft pushback counts ("hmm, I'd rather …", "actually let's …"). The `-` entry captures what to avoid + the why.

2. **User validation.** User explicitly praises a pattern or accepts a non-obvious choice without redirecting. "yes, exactly that", "perfect, keep doing that", "that's the right call here." These deserve a `+` entry because the bias is to only log mistakes; without `+` entries, the file becomes a graveyard and you drift away from validated approaches.

3. **Breakage.** Something failed unexpectedly — tests, CI, a runtime behavior that surprised you. Append the failure mode + the actual cause + the fix. Especially valuable when the fix isn't obvious from the error message.

4. **Gotcha discovery.** You learned a framework footgun, a config that means the opposite of what it looks like, a hidden default, a quirk in a library version. Worth logging even if it didn't cause a problem this time — it will eventually.

5. **CI failure recurrence.** A CI failure mode that has now hit twice. Log explicitly and consider promotion (see Pattern promotion below). Recurring CI breakage is the highest-signal log target.

## Format

Default format (bullet style):

```
- [YYYY-MM-DD] [+/-] Brief lesson. (context: what triggered it)
```

- `+` = positive / what worked
- `-` = negative / what to avoid
- Lesson ≤ 1 sentence. Why matters more than what — explain the underlying reason if it's not obvious.
- Context ≤ 1 short clause. Name the PR, file, or incident if it's discoverable later.

If the project's existing `lessons.md` uses a different format (e.g., `## YYYY-MM-DD` headers + `### Title`), match the existing style. Read the file's first ~20 lines to detect format before appending.

## Append flow

1. Detect the project's `.claude/lessons.md` location. Walk up from cwd if needed — the file lives at the repo root's `.claude/lessons.md`.
2. Read the file's header / first existing entry to confirm the format.
3. Draft the entry. Use today's date in `YYYY-MM-DD`.
4. **Show the entry to the user before writing.** One line: "About to log: `<entry>` to `<path>` — OK?" Wait for confirmation unless the user explicitly said "log it" / "/log-lesson" / similar (in which case the confirmation is implicit).
5. Append using the Edit tool (find the last entry in the file, add the new one after it) or Bash with proper quoting.

If the project doesn't have a `.claude/lessons.md` yet, ask the user before creating one — adopting the pattern is a project-level decision, not a per-session one.

## Pattern promotion

The lessons file is a staging ground, not the final resting place. When you append, scan the rest of the file:

- If 3+ existing entries point at the same underlying pattern (e.g., three different incidents that all boil down to "Supabase RLS WITH CHECK was missing"), the pattern has earned a rule.
- Surface this to the user: "Three entries now reference RLS WITH CHECK omissions. Want to promote this to a rule in CLAUDE.md and note in the lessons entries which section it consolidates into?"
- Don't promote silently. The user decides whether to promote, where the rule lands, and how to phrase it.

Promotion prevents lessons.md from becoming a graveyard. Without it, the file just accumulates without ever shaping the day-to-day rules.

## What NOT to log

- Trivia, single-keystroke typos, normal iteration on a draft.
- Conversational pivots ("let's try a different approach" without a specific reason).
- Praise that wasn't tied to a specific pattern ("nice work" is not a lesson).
- Anything you already wrote into CLAUDE.md as a rule. That promotion already happened.

A lessons file with 20 high-signal entries is far more useful than one with 200 mixed ones.
