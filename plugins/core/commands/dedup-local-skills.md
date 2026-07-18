---
description: Interactively remove ~/.claude/skills copies that duplicate installed dafna-dev-standards plugin skills
---

For each directory under ~/.claude/skills/ whose name matches a skill shipped by an
installed dafna-dev-standards plugin (lessons-log, spec-review, plan-review,
checklists, dev-env-setup, coo): diff every file in the local skill directory
against the plugin copy's directory as a whole (e.g. `diff -r
~/.claude/skills/<skill-name> <plugin-root>/skills/<skill-name>`) — not just
SKILL.md — since multi-file skills (checklists, dev-env-setup) can have divergent
supporting files even when SKILL.md itself is identical, and comparing SKILL.md
alone can produce a false "identical" verdict.

Locate the plugin copy's directory as follows:
- Core's own copies live under `${CLAUDE_PLUGIN_ROOT}/skills/` (this variable
  expands in command files). If it appears unexpanded, locate the installed core
  plugin the same marker-based way as /bootstrap-repo: `grep -rl 'dafna-core
  rules' ~/.claude/plugins --include=RULES.md 2>/dev/null | head -1` → the plugin
  root is that file's grandparent directory (…/rules/RULES.md); its skills live
  under <plugin-root>/skills/.
- For other plugins of this marketplace (e.g. coo): search ~/.claude/plugins for
  a directory containing skills/<skill-name>/SKILL.md whose path also contains
  the plugin name, e.g. `find ~/.claude/plugins -path "*coo*/skills/<skill-name>/SKILL.md"`.

Show a one-line summary reflecting the whole-directory diff status (identical /
local is older / local has divergent edits, based on the full `diff -r` result —
not SKILL.md alone), and ask per skill whether to delete the local copy. Delete
only on explicit yes. If the local copy has divergent edits, recommend porting
them into the plugin via PR before deleting. Never touch skills that don't
collide.
