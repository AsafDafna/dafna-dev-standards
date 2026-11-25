#!/bin/sh
# Every failure exits 2, so Claude Code blocks the call and no real worker starts.
set -eu

held=''
lock=''
on_exit() {
  rc=$?
  [ -z "$held" ] || rmdir "$lock" 2>/dev/null || :
  [ "$rc" -eq 0 ] || exit 2
}
trap on_exit EXIT
trap 'exit 2' HUP INT TERM

fail() {
  printf 'stub-workers: %s\n' "$1" >&2
  exit 2
}

root=${CLAUDE_PROJECT_DIR:-}
[ -n "$root" ] && [ -d "$root/.eval" ] || fail 'CLAUDE_PROJECT_DIR has no .eval/ folder'
call=$(jq -esc 'select(length == 1) | .[0].tool_input | objects' 2>/dev/null) ||
  fail 'stdin is not one hook input with a tool_input object'

lock=$root/.eval/.lock
tries=0
until mkdir "$lock" 2>/dev/null; do
  tries=$((tries + 1))
  [ "$tries" -le 50 ] || fail '.eval/.lock stayed held for 5 seconds'
  sleep 0.1
done
held=1
log=$root/.eval/agent-calls.jsonl
printf '%s\n' "$call" >> "$log"
n=$(grep -c '' "$log")
rmdir "$lock"
held=''

printf '%s\n' "$call" | jq -c --arg n "$n" '
  ($ENV["EVAL_STUB_REPLY_" + $n] // "done") as $reply
  | {hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: (
        .prompt = "Reply with exactly the text between the marker lines, and nothing else. Use no tools.\n<<<\n\($reply)\n>>>"
        | .model = "haiku"
        | .subagent_type = "general-purpose"
        | .run_in_background = false
        | del(.isolation, .name))}}'
