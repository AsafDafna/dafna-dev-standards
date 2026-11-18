[dafna-core rules v1.0.0]

# Shared dev-workflow rules (dafna-dev-standards/core)

## Workflow
- Big or risky work gets the full process: a new feature, a database or RLS change, auth or permissions, payments, a bulk or irreversible action on production data, or work across repos. The full process is brainstorming -> spec (committed to git) -> spec-review -> plan (a writing-plans file) -> plan-review -> subagent implementers -> code review. The main session orchestrates, reviews and runs the gates.
- Other work goes straight to code: make the change inline and run one code review before the PR. When you are not sure which kind a task is, treat it as the smaller kind and say so in one line.
- Pick the model for each dispatch by the job: a lighter model for mechanical work, opus for real work, Fable only when opus fell short.
- Plan mode is for execution planning, not for feature design.
- Bugs: investigate, find the root cause, fix, verify. Do not patch on a guess.
- Parallel sessions in one repo use git worktrees, not a shared checkout.

## Git
- Work on feature branches (feature/, fix/, docs/) with conventional commit messages. Do not commit directly to main.

## Code comments
- Default to none. Comment only a non-obvious why (one or two lines), a
  constraint enforced elsewhere (name where), or an API contract the types
  cannot express. This holds in a heavily commented file too.
- Do not write banners, comments that repeat the code, change narration, or
  history.
- When you edit a function, delete its banners and repeating comments, and fix
  comments your change breaks.
- Exempt: comments a tool reads (lint, type and test directives, `@deprecated`,
  `-- Reviewed:`) and headers that a repo rule or a skill requires.

## Quality gates
- Before the PR, on the branch: simplify pass, then code review, then open the
  PR, so CI runs once on reviewed code. Batch fix commits; rerun only failed CI.
- Security review for diffs touching auth, PII, or public endpoints.
- No leftover debug code (console.log, debugger, stray TODO).
- Docs-only PRs skip CI via paths-ignore.

## Logs
- Project gotchas and validated patterns go to .claude/lessons.md. Search that file for your topic; do not read it whole (see the lessons-log skill).
- Significant decisions: append one line to docs/DECISIONS.md (the format is in that file's header; /bootstrap-repo seeds it).

## Secrets
- In a repo with a `.secrets-refs` file, run every command that needs a secret
  through `secrets run`, and follow the `secrets` skill. Do not print a secret value.
