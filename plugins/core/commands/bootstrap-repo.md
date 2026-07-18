---
description: One-time scaffolding for a repo adopting the dafna-dev-standards workflow
---

Bootstrap the current repo onto the shared standards. All template sources live at
`${CLAUDE_PLUGIN_ROOT}/templates/` (this variable expands in command files; if it
appears unexpanded, locate the installed plugin via its marker file: `grep -rl
'dafna-core rules' ~/.claude/plugins --include=RULES.md 2>/dev/null | head -1` →
the plugin root is that file's grandparent directory (…/rules/RULES.md), and its
templates live under <plugin-root>/templates/. The cache layout varies between
Claude Code versions, which is why this marker-based locate is used instead of a
fixed path guess).
Steps, in order; show a summary table at the end:

1. Confirm cwd is a git repo root; abort with instructions if not: "Not a git
   repo root — run from the repository root, or `git init` first."
2. Copy templates unless the destination exists (never overwrite; report "exists,
   skipped"): pull_request_template.md → .github/pull_request_template.md;
   DECISIONS.md → docs/DECISIONS.md; lessons.md → .claude/lessons.md;
   CODEOWNERS.skeleton → .github/CODEOWNERS with <owner> replaced by the GitHub
   user from `gh api user -q .login` (ask if gh is unavailable).
3. Skill-collision check (REPORT-ONLY) against the FIXED list of skills this
   marketplace ships — lessons-log, spec-review, plan-review, checklists,
   dev-env-setup, coo (coo ships via the separate `coo` plugin of this
   marketplace, not core) — regardless of which plugins are currently installed:
   list matching directory names under ~/.claude/skills/. Print a warning table —
   plugin skills are namespaced, so local copies DUPLICATE rather than shadow
   (both would trigger). Do NOT delete anything; point to /dedup-local-skills.
4. If .github/workflows/ contains CI, suggest (print, don't apply) a paths-ignore
   block for docs-only changes: paths-ignore: ["**.md", "docs/**"]. Warn: never
   add paths-ignore to a workflow that is a required status check — the PR would
   wait forever on a check that never reports.
5. If the repo will use stack plugins (supabase/nextjs — v2, not yet published):
   print this exact .claude/settings.json enable block for later use (include
   only the plugin(s) the repo will actually use):
   {"enabledPlugins": {"supabase@dafna-dev-standards": true, "nextjs@dafna-dev-standards": true}}
   Writing it is v2 bootstrap behavior.
