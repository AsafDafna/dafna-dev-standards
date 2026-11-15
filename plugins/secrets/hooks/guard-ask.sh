#!/bin/sh
# PreToolUse hook for the Bash tool: when the command runs `secrets run` with --guarded, it returns
# the decision "ask", so Claude Code asks the owner first. It runs before every Bash call: a call
# whose input does not hold the text --guarded costs one read loop and one case, with no program.
# Every error path asks and exits 0, because a hook that exits with another code may let the
# command run. It never prints allow or deny.

ask() {
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"secrets: this command loads guarded secrets (--guarded). Approve it only if you asked for this work."}}'
  exit 0
}

nl='
'
raw=''
while IFS= read -r line; do
  raw=$raw$line$nl
done
raw=$raw$line
case $raw in *--guarded*) ;; *) exit 0 ;; esac

# The join of a backslash and a line end, as the shell does it, is in jq: a loop in sh takes
# quadratic time, and a hook that runs past its timeout lets the command run.
cmd=$(printf '%s' "$raw" | jq -er '.tool_input.command | strings | split("\\\n") | join("")' 2>/dev/null) || ask

# Words split at blanks, operators, quotes and backslashes: a quoted path, a compound command and
# the text of `sh -c '...'` all become plain words. After `secrets` and `run`, only the options up
# to `--` count: a --guarded after it belongs to the started command.
IFS=" $(printf '\t')$nl;&|()<>\`\"'\\"
set -f
# shellcheck disable=SC2086 # the split is the point; globbing is off
set -- $cmd
state=''
for word do
  case $state:$word in
    run:--guarded) ask ;;
    run:--) state='' ;;
    run:*) ;;
    # A volume that ignores case runs the tool for any spelling of its name.
    *:[Ss][Ee][Cc][Rr][Ee][Tt][Ss] | *:*/[Ss][Ee][Cc][Rr][Ee][Tt][Ss]) state=secrets ;;
    secrets:run) state=run ;;
  esac
done
exit 0
