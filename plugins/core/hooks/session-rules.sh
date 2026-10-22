#!/bin/sh
# SessionStart hook: inject the shared workflow rules into session context.
# stdout from a SessionStart hook is appended to Claude's context.
# With the argument "subagent" it is the SubagentStart hook instead: rules and a
# subagent scope line, no git briefing.
RULES="${CLAUDE_PLUGIN_ROOT}/rules/RULES.md"
rules() {
  if [ -f "$RULES" ]; then
    cat "$RULES"
  else
    echo "[dafna-core rules MISSING - plugin install is broken, RULES.md not found]"
  fi
}

if [ "$1" = "subagent" ]; then
  # SubagentStart reads only JSON additionalContext, never plain stdout. Escape in
  # sed, not awk gsub (backslashes differ macOS vs Linux) or jq (absent on WSL).
  # C locale: under UTF-8, BSD tr aborts on an invalid byte and truncates the rules.
  export LC_ALL=C
  tab=$(printf '\t')
  {
    rules
    echo
    echo "Subagents: Git, Code comments and the Workflow gates \"Bugs\" line apply to your own work; the other Workflow gates, CI-minute economy, Pre-merge gates and Logs belong to the main session that dispatched you."
  } | tr -d '\000-\010\013-\037' \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e "s/$tab/\\\\t/g" \
    | awk '{ s = s $0 "\\n" }
      END { printf "{\"hookSpecificOutput\":{\"hookEventName\":\"SubagentStart\",\"additionalContext\":\"%s\"}}\n", s }'
  exit 0
fi

rules

# Git drift briefing: a collaborator may have pushed since the last session.
# GIT_TERMINAL_PROMPT=0 prevents auth prompts from hanging a session start;
# fetch failure (offline, no remote) is silently tolerated.
if git rev-parse --git-dir >/dev/null 2>&1; then
  GIT_TERMINAL_PROMPT=0 git fetch --quiet 2>/dev/null || true
  # Branch names are repo-controlled data headed into model context: allow only
  # safe filename chars and cap length so a hostile branch name can't smuggle
  # readable instruction text into the session.
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null | tr -cd 'A-Za-z0-9._/-' | cut -c1-60)
  [ -n "$branch" ] || branch="?"
  counts=$(git rev-list --left-right --count '@{upstream}...HEAD' 2>/dev/null) || counts=""
  if [ -n "$counts" ]; then
    # shellcheck disable=SC2086  # intentional word-splitting of "behind ahead"
    set -- $counts
    if [ "$1" != "0" ]; then
      echo "[git] branch $branch is $1 commit(s) behind upstream - pull/rebase before starting work"
    fi
  fi
fi
