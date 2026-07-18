# dafna-dev-standards

Shared Claude Code dev-workflow standards for the Dafna dev collaboration
(Asaf and Nir), extracted so both developers work from the same rules,
review skills, and environment setup instead of copy-pasting config
between repos.

## Install

```
/plugin marketplace add <github-user>/dafna-dev-standards
/plugin install core@dafna-dev-standards
/plugin install coo@dafna-dev-standards   # optional, personal orchestration mode
```

(`<github-user>` is a placeholder — publishing this repo finalizes the
real slug; see Task 10.)

Both `core` and `coo` install at **user scope** — once per machine/account,
not per repo. Multi-account users (e.g. a separate org `CLAUDE_CONFIG_DIR`)
need to install once per account; see `docs/personal-setup.md`.

## Platform support

macOS and Linux/WSL shells only. Native-Windows Claude Code (outside WSL)
is unsupported — the `core` SessionStart hook is POSIX `sh`. Windows users
should run Claude Code inside WSL2; see the `dev-env-setup` skill in
`core` for the WSL setup path.

## What `core` injects

`core` ships a SessionStart hook that injects `plugins/core/rules/RULES.md`
into every session's context — no copying rules into per-repo CLAUDE.md
files, so a plugin update changes behavior everywhere at once.

The first line of RULES.md is a version marker, e.g. `[dafna-core rules
v1.0.0]`. If a session shows no such marker anywhere in context, the plugin
isn't active — check the install and `/plugin update`.

## Adopting these standards in a repo

Run `/bootstrap-repo` once per repo. It drops the PR template, CODEOWNERS
skeleton, `docs/DECISIONS.md`, and an empty `.claude/lessons.md`, and
flags any locally-installed skills that collide by name with plugin
skills.

## Not a supported product

This repo is public because that's the practical way to share a plugin
marketplace between two developers on independent GitHub accounts — it
is not a maintained open-source product. External use is at your own
risk: no support, no compatibility guarantees, no issue triage for
non-collaborators.

See `CONTRIBUTING.md` for how changes land, and `CHANGELOG.md` for
release history.
