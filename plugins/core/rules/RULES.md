[dafna-core rules v1.0.0]

# Shared dev-workflow rules (dafna-dev-standards/core)

## Workflow gates
- Plan non-trivial tasks (3+ steps); multi-task plans for subagents are writing-plans files.
- Execution-mode gate: after a plan is approved, STATE the execution mode out loud
  before writing code. 3+ files or any DB migration => dispatch subagent
  implementers; the main session orchestrates, reviews, and runs gates. Inline
  implementation only for <=2-file changes.
- Model per dispatch: pick the model that fits the job; do not just inherit
  yours. Lighter models for mechanical work, opus for real work, Fable only
  when opus fell short.
- Feature design uses brainstorming -> spec (committed to git) -> spec-review;
  plan mode is for execution planning, not feature design. Plans get plan-review.
- Bugs: investigate -> root cause -> fix -> verify. Never guess-and-patch.
- Parallel sessions in one repo => git worktrees, never a shared checkout.

## Git
- Feature branches (feature/, fix/, docs/); conventional commit messages;
  never commit directly to main.

## Code comments
- Default to none. Comment only a non-obvious why (one or two lines), a
  constraint enforced elsewhere (name where), or an API contract the types
  cannot express. This holds in a heavily commented file too.
- Never: banners, comments that repeat the code, change narration, or history.
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
- Corrections, gotchas, and validated patterns go to .claude/lessons.md
  (see the lessons-log skill). A lesson recurring across 2+ repos is promoted
  to a shared rule via PR to dafna-dev-standards.
- Significant decisions: append one line to docs/DECISIONS.md
  (format documented in that file's header; seeded by /bootstrap-repo).

## Secrets
- In a repo with a `.secrets-refs` file, run every command that needs a secret
  through `secrets run`, and follow the `secrets` skill. Never print a secret value.
