#!/bin/sh
# SessionStart hook: inject the shared workflow rules into session context.
# stdout from a SessionStart hook is appended to Claude's context.
RULES="${CLAUDE_PLUGIN_ROOT}/rules/RULES.md"
if [ -f "$RULES" ]; then
  cat "$RULES"
else
  echo "[dafna-core rules MISSING - plugin install is broken, RULES.md not found]"
fi
