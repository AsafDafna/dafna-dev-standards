# Contributing

## Process

All changes land via pull request — no direct commits to `main`. The repo
owner (Asaf) merges. Fallback: if the owner is unavailable for more than
48 hours, the collaborator may merge with an explanatory note in the PR.
Peer-merge (either developer merges either PR) will be revisited after
~10 collaborator PRs have gone through this flow.

## RULES.md size cap

`plugins/core/rules/RULES.md` is injected into every session, so it stays
small: **~60 lines / ~800 tokens, hard cap**. If a rule needs more room
than that to state, it belongs in a skill instead of RULES.md.

## Rule changes

Any change to a rule (in RULES.md or a skill) requires, before merge:
1. A one-line entry in `CHANGELOG.md`.
2. A fresh-session smoke test — start a new session and confirm the
   `[dafna-core rules vX.Y]` marker described in README.md still appears.

## Versioning

Each plugin (`core`, `coo`, and later `supabase`/`nextjs`) has its own
semver in its `plugin.json`. Breaking rule changes bump the major version
and get a CHANGELOG line.

## Rollback

The repo is the single source of truth. Roll back a bad change with
`git revert` on `main`, then run `/plugin update` on each machine that
has it installed. There is no version-pinning machinery — the only
consumers are the two maintainers.
