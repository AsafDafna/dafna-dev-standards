# Personal `~/.claude` setup

These plugins cover shared repo-level standards. Some things stay in each
developer's own `~/.claude` because they're personal or account-specific
rather than shared team process. This is a generic starting guide, not a
copy-paste config — adapt it to your own preferences.

## Personal CLAUDE.md

`~/.claude/CLAUDE.md` is your own global instructions file: response
style, personal working protocols, anything that's about *you* rather
than the team's process. It is not shared or synced by this repo — each
developer maintains their own.

## Package-install security hook

A `PreToolUse` hook that gates `npm`/`pip`/`cargo` install commands
(checking things like registry advisories, version cooldowns, or
typosquat risk) is a personal-layer addition, not part of `core`. Each
developer installs and maintains their own at the user level. A reference
implementation is available from the repo owner on request — it isn't
bundled here because install-time security tooling is opinionated and
evolves independently of the shared workflow rules.

## Usage-quota guard

If your account has a usage limit you want to track mid-session (e.g. to
avoid burning paid overage or hitting a hard stop on a metered seat), a
small script/hook that checks remaining quota before heavy subagent
batches is a personal addition. Not everyone needs this — only relevant
if your plan has quota constraints worth watching.

## Multi-account installs

Plugin installs are scoped per `CLAUDE_CONFIG_DIR`. If you use more than
one Claude Code account (e.g. a personal account plus an organization
account), install this marketplace and the plugins you want once **per
account** — an install in one `CLAUDE_CONFIG_DIR` does not carry over to
another.
