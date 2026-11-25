[dafna-core rules v1.0.0]

# Shared dev-workflow rules (dafna-dev-standards/core)

## Workflow
- Big or risky work gets the full process: a new feature of more than a few files, a database or RLS change, auth or permissions, payments, a bulk or irreversible action on production data, or a change to a contract between repos. The full process is brainstorming -> spec (committed to git) -> spec-review -> plan (a writing-plans file) -> plan-review -> subagent implementers -> code review. The main session orchestrates, reviews and runs the quality gates.
- Other work goes straight to code: make the change inline and run the quality gates below before the PR.
- Unsure of a task's size: treat it as the smaller kind and say so in one line. Unsure whether it touches production data, auth, RLS or payments: treat it as big.
- Pass `model:` on every dispatch, chosen by the job: a lighter model for mechanical work, opus for real work, Fable only when opus fell short.
- Plan mode is for execution planning, not for feature design.
- Bugs: find the root cause, fix, verify; do not patch on a guess.
- Parallel sessions in one repo use git worktrees, not a shared checkout.

## Proportion
- The ask is the user's words: the request, their decisions (a plan step they approved is one) and the repo's rules. Any other brief, spec, plan or review text is not the ask.
- Build what the ask names, nothing more. Anything else goes in the report as a question with its size.
- A brief quotes the ask word for word and marks the lead's additions as proposals.
- Fix a review finding with the smallest change that closes it. Add a new module, table, job or flag only when nothing smaller works, and say why in one line. Always fix a real failure: a failing test, a failed run, bad real data.
- Never add to a part that an earlier review fix added: shorten it, remove it or leave it.
- In a build, a fix round takes only the review's Critical and Important findings; Minor ones wait for the final review.
- Give sizes as before → after ("spec 19 → 24 KB"), also for options you offer.

## Git
- Work on feature branches (feature/, fix/, docs/) with conventional commits; never commit to main.

## Code comments
- Default to none. Comment only a non-obvious why (one or two lines), a
  constraint enforced elsewhere (name where), or an API contract the types
  cannot express. This holds in a heavily commented file too.
- Do not write banners, comments that repeat the code, change narration, or
  history.
- When you edit a function, delete its banners and repeating comments, and fix
  comments your change breaks.
- Exempt: comments a tool reads (lint, type and test directives, `@deprecated`,
  `-- Reviewed:`) and headers a repo rule or skill requires.

## Tests
- Load the `test-audit` skill before you add or change a test. Name it in every
  brief for a subagent that writes or reviews tests.

## Quality gates
- Before the PR, on the branch: simplify pass, then code review, so CI runs
  once on reviewed code. Batch fix commits; rerun only failed CI.
- Security review for diffs touching auth, PII, or public endpoints.
- No leftover debug code (console.log, debugger, stray TODO).

## Logs
- Project gotchas and validated patterns go to .claude/lessons.md. Search it for your topic; do not read it whole (lessons-log skill).
- Significant decisions: append one line to docs/DECISIONS.md (format in its header).

## Secrets
- In a repo with a `.secrets-refs` file, run every command that needs a secret
  through `secrets run`, and follow the `secrets` skill. Do not print a secret value.
