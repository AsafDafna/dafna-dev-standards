#!/bin/sh
# SessionStart hook: inject the shared workflow rules into session context.
# stdout from a SessionStart hook is appended to Claude's context.
RULES="${CLAUDE_PLUGIN_ROOT}/rules/RULES.md"
if [ -f "$RULES" ]; then
  cat "$RULES"
else
  echo "[dafna-core rules MISSING - plugin install is broken, RULES.md not found]"
fi

# Git drift briefing: a collaborator may have pushed since the last session.
# GIT_TERMINAL_PROMPT=0 prevents auth prompts from hanging a session start;
# fetch failure (offline, no remote) is silently tolerated.
if git rev-parse --git-dir >/dev/null 2>&1; then
  GIT_TERMINAL_PROMPT=0 git fetch --quiet 2>/dev/null || true
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
  counts=$(git rev-list --left-right --count '@{upstream}...HEAD' 2>/dev/null) || counts=""
  if [ -n "$counts" ]; then
    # shellcheck disable=SC2086  # intentional word-splitting of "behind ahead"
    set -- $counts
    if [ "$1" != "0" ]; then
      echo "[git] branch $branch is $1 commit(s) behind upstream - pull/rebase before starting work"
    fi
  fi
fi
