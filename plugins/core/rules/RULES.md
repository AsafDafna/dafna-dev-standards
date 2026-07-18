[dafna-core rules v1.0.0]

# Shared dev-workflow rules (dafna-dev-standards/core)

## Workflow gates
- Enter plan mode for any non-trivial task (3+ steps or architectural decisions).
- Execution-mode gate: after a plan is approved, STATE the execution mode out loud
  before writing code. 3+ files or any DB migration => dispatch subagent
  implementers; the main session orchestrates, reviews, and runs gates. Inline
  implementation only for <=2-file changes.
- Feature design uses brainstorming -> spec (committed to git) -> spec-review;
  plan mode is for execution planning, not feature design. Plans get plan-review.
- Bugs: investigate -> root cause -> fix -> verify. Never guess-and-patch.
- Parallel sessions in one repo => git worktrees, never a shared checkout.

## Git
- Feature branches (feature/, fix/, docs/); conventional commit messages;
  never commit directly to main.

## CI-minute economy
- Quality gates run PRE-PR on the branch/worktree: simplify pass -> code review ->
  only then open the PR, so CI runs once on already-reviewed code.
- Batch fix commits before pushing; use rerun-failed-only on red CI.
- Docs-only PRs skip CI via paths-ignore.

## Pre-merge gates
- Simplify pass, then code review on the diff.
- Security review for diffs touching auth, PII, or public endpoints.
- No leftover debug code (console.log, debugger, stray TODO).

## Logs
- Corrections, gotchas, and validated patterns go to .claude/lessons.md
  (see the lessons-log skill). A lesson recurring across 2+ repos is promoted
  to a shared rule via PR to dafna-dev-standards.
- Significant decisions: append one line to docs/DECISIONS.md
  (format documented in that file's header; seeded by /bootstrap-repo).
