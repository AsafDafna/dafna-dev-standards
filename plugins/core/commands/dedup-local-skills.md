---
description: Interactively remove ~/.claude/skills copies that duplicate installed dafna-dev-standards plugin skills
---

For each directory under ~/.claude/skills/ whose name matches a skill shipped by an
installed dafna-dev-standards plugin (lessons-log, spec-review, plan-review,
checklists, dev-env-setup, coo): diff the local SKILL.md against the plugin's copy
(under `${CLAUDE_PLUGIN_ROOT}/skills/` for core's own copies; for other plugins of
this marketplace, resolve the installed plugin directory under ~/.claude/plugins/),
show a one-line summary (identical / local is older / local has divergent edits),
and ask per skill whether to delete the local copy. Delete only on explicit yes.
If the local copy has divergent edits, recommend porting them into the plugin via
PR before deleting. Never touch skills that don't collide.
