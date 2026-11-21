#!/bin/sh

case $0 in */*) here=${0%/*} ;; *) here=. ;; esac
hook=$(cd "$here/.." && pwd -P)/hooks/stub-agent.sh || exit 1
tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT

for v in $(env | sed -n 's/^\(EVAL_STUB_REPLY_[A-Za-z0-9_]*\)=.*/\1/p'); do
  unset "$v"
done

failures=0
fail() {
  printf 'FAIL: %s\n' "$*"
  failures=$((failures + 1))
}
check() { # WHAT EXPECTED ACTUAL
  [ "$3" = "$2" ] || fail "$1: expected [$2], got [$3]"
}

call_input() { # DESCRIPTION
  jq -cn --arg d "$1" '{hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: {
    description: $d, prompt: ("Brief for " + $d), subagent_type: "Explore", model: "opus",
    run_in_background: true, isolation: "worktree", name: ("worker-" + $d)}}'
}

expected_prompt() { # REPLY
  printf 'Reply with exactly the text between the marker lines, and nothing else. Use no tools.\n<<<\n%s\n>>>' "$1"
}

rewritten() { # HOOK-OUTPUT
  printf '%s' "$1" | jq -r '.hookSpecificOutput | [.hookEventName, .permissionDecision,
    .updatedInput.description, .updatedInput.model, .updatedInput.subagent_type,
    (.updatedInput.run_in_background | tostring), (.updatedInput | has("isolation") | tostring),
    (.updatedInput | has("name") | tostring)] | join(" ")'
}

prompt_of() { # HOOK-OUTPUT
  printf '%s' "$1" | jq -r '.hookSpecificOutput.updatedInput.prompt'
}

lines_in() { # FILE
  if [ -f "$1" ]; then grep -c '' "$1"; else echo 0; fi
}

root=$tmp/sequence
mkdir -p "$root/.eval"
log=$root/.eval/agent-calls.jsonl
out1=$(call_input one | EVAL_STUB_REPLY_1='first reply' CLAUDE_PROJECT_DIR=$root "$hook")
check 'first call exit' 0 $?
out2=$(call_input two | EVAL_STUB_REPLY_1='first reply' CLAUDE_PROJECT_DIR=$root "$hook")
check 'second call exit' 0 $?
check 'record lines after two calls' 2 "$(lines_in "$log")"
check 'record line 1 is the original input' "$(call_input one | jq -cS .tool_input)" "$(sed -n 1p "$log" | jq -cS .)"
check 'record line 2 is the original input' "$(call_input two | jq -cS .tool_input)" "$(sed -n 2p "$log" | jq -cS .)"
check 'first call rewrite' 'PreToolUse allow one haiku general-purpose false false false' "$(rewritten "$out1")"
check 'second call rewrite' 'PreToolUse allow two haiku general-purpose false false false' "$(rewritten "$out2")"
check 'first call prompt' "$(expected_prompt 'first reply')" "$(prompt_of "$out1")"
check 'second call prompt' "$(expected_prompt 'done')" "$(prompt_of "$out2")"
[ ! -e "$root/.eval/.lock" ] || fail 'the lock is left after two calls'

root=$tmp/parallel
mkdir -p "$root/.eval"
log=$root/.eval/agent-calls.jsonl
pids=''
for k in 1 2 3 4 5; do
  call_input "d$k" | env EVAL_STUB_REPLY_1=r1 EVAL_STUB_REPLY_2=r2 EVAL_STUB_REPLY_3=r3 \
    EVAL_STUB_REPLY_4=r4 EVAL_STUB_REPLY_5=r5 CLAUDE_PROJECT_DIR="$root" "$hook" > "$tmp/out$k" &
  pids="$pids $!"
done
k=0
for pid in $pids; do
  k=$((k + 1))
  wait "$pid"
  check "parallel call d$k exit" 0 $?
done
check 'record lines after five parallel calls' 5 "$(lines_in "$log")"
check 'recorded descriptions' 'd1 d2 d3 d4 d5' "$(jq -r .description "$log" | sort | tr '\n' ' ' | sed 's/ $//')"
replies=''
for k in 1 2 3 4 5; do
  n=$(grep -n -F "\"description\":\"d$k\"" "$log" | cut -d: -f1)
  check "parallel call d$k gets the reply of its line" "$(expected_prompt "r$n")" "$(prompt_of "$(cat "$tmp/out$k")")"
  replies="$replies$(prompt_of "$(cat "$tmp/out$k")" | sed -n 3p)
"
done
check 'parallel reply set' 'r1 r2 r3 r4 r5' "$(printf '%s' "$replies" | sort | tr '\n' ' ' | sed 's/ $//')"

root=$tmp/held
mkdir -p "$root/.eval/.lock"
call_input held | CLAUDE_PROJECT_DIR=$root "$hook" >/dev/null 2>&1
check 'held lock exit' 2 $?
check 'held lock record lines' 0 "$(lines_in "$root/.eval/agent-calls.jsonl")"
[ -d "$root/.eval/.lock" ] || fail 'the hook removed a lock that another call holds'

root=$tmp/unwritable
mkdir -p "$root/.eval/agent-calls.jsonl"
call_input unwritable | CLAUDE_PROJECT_DIR=$root "$hook" >/dev/null 2>&1
check 'failed append exit' 2 $?
[ ! -e "$root/.eval/.lock" ] || fail 'the hook kept its own lock after a failed append'

root=$tmp/bare
mkdir -p "$root"
call_input bare | CLAUDE_PROJECT_DIR=$root "$hook" >/dev/null 2>&1
check 'no .eval/ folder exit' 2 $?
[ ! -e "$root/.eval" ] || fail 'the hook made .eval/'

root=$tmp/badstdin
mkdir -p "$root/.eval"
printf 'not json' | CLAUDE_PROJECT_DIR=$root "$hook" >/dev/null 2>&1
check 'bad stdin exit' 2 $?
printf '{"tool_name": "Agent"}' | CLAUDE_PROJECT_DIR=$root "$hook" >/dev/null 2>&1
check 'stdin without tool_input exit' 2 $?
check 'bad stdin record lines' 0 "$(lines_in "$root/.eval/agent-calls.jsonl")"

if [ "$failures" -eq 0 ]; then
  echo PASS
else
  exit 1
fi
