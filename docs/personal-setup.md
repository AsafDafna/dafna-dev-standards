# Personal `~/.claude` setup

These plugins cover shared repo-level standards. Some things stay in each
developer's own `~/.claude` because they're personal or account-specific
rather than shared team process. This is a generic starting guide, not a
copy-paste config — adapt it to your own preferences.

## First-time install

The install sequence itself (adding the marketplace from GitHub,
installing `core` and `coo`, and confirming the
`[dafna-core rules v1.0.0]` marker appears in a fresh session) lives in
README.md — see **Install** and **For Claude sessions: bootstrap
checklist**. Everything below is the personal layer that sits *around*
that install and is deliberately not shipped by the plugins.

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

## Windows: where things must live

Run Claude Code **inside WSL2**, not native Windows — `core`'s
SessionStart hook is a POSIX `sh` script and there is no native-Windows
code path for it. README.md's *Platform support* section states the same
constraint; this section covers the path choices that follow from it.

The rule of thumb: everything Claude Code touches should live on the
**Linux filesystem**, not on a `/mnt/c` Windows mount.

- **`~/.claude` must be your Linux home** — `/home/<user>/.claude`, not
  `/mnt/c/Users/<user>/.claude`. Windows drives are mounted via `drvfs`,
  which does not reliably preserve the Unix executable bit. A hook script
  that loses `+x` silently stops firing, and the failure looks like "the
  plugin just isn't active" rather than a permissions error.
- **Clone repos under the Linux home too** (e.g. `~/dev-projects/...`).
  Same exec-bit caveat for any repo-local hooks or scripts, plus `/mnt/c`
  file I/O is markedly slower — noticeable on installs and large `git`
  operations.
- **Don't share one checkout across the WSL and Windows sides.** Editing
  the same working tree from both produces line-ending churn and
  permission-bit noise in `git status`.

If the marker check from the README's bootstrap checklist fails on
Windows, verify the path assumptions above before anything else:

```bash
ls -l ~/.claude/plugins/marketplaces/dafna-dev-standards   # Linux home?
df -T ~ | tail -1                                          # not drvfs?
```

Multi-account users on Windows: `CLAUDE_CONFIG_DIR` should likewise point
at a Linux-side directory (e.g. `~/.claude-org`), per **Multi-account
installs** above.

For the surrounding terminal environment on Windows — WSL2 + Ghostty +
herdr, the `devenv` launcher, and Windows shortcuts — see the
`dev-env-setup` skill in `core` (`windows-wsl.md`). That guide covers the
terminal stack; this section covers only where the Claude Code config and
repos belong.
