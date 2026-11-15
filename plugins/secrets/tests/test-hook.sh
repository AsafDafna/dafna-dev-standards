# shellcheck shell=sh
# shellcheck disable=SC2016 # the commands are text for the hook; nothing expands them
# Tests of the PreToolUse hook, hooks/guard-ask.sh. Run: sh run.sh test-hook.sh

HOOK=$PLUGIN_DIR/hooks/guard-ask.sh
ASK='{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"secrets: this command loads guarded secrets (--guarded). Approve it only if you asked for this work."}}'
NL='
'
TAB=$(printf '\t')

# hook_input COMMAND: the input of the hook for a Bash call of COMMAND, as Claude Code sends it.
hook_input() {
  jq -n --arg c "$1" '{session_id: "s1", transcript_path: "/tmp/t.jsonl", cwd: "/tmp",
    permission_mode: "auto", hook_event_name: "PreToolUse", tool_name: "Bash",
    tool_input: {command: $c, description: "a call"}, tool_use_id: "t1"}'
}

hook_shells() { printf 'sh\n'; command -v dash > /dev/null && printf 'dash\n'; }

# hook_check WANT COMMAND: runs the hook in each shell on the input for COMMAND, and fails unless
# it exits 0 with stdout WANT (one line, or nothing when WANT is empty) and no stderr.
hook_check() {
  hook_input "$2" > "$TEST_DIR/in.json" || fail "no hook input for [$2]"
  if [ -n "$1" ]; then printf '%s\n' "$1"; fi > "$TEST_DIR/want"
  for _sh in $(hook_shells); do
    assert_status 0 "$_sh" "$HOOK" < "$TEST_DIR/in.json"
    cmp -s "$TEST_DIR/want" "$TEST_DIR/out" || fail "[$2] under $_sh: stdout [$OUT]"
    assert_eq '' "$ERR" "[$2] under $_sh: stderr"
  done
}

asks() { hook_check "$ASK" "$1"; }

silent() { hook_check '' "$1"; }

test_hook_asks_for_each_form() {
  asks 'secrets run --guarded -- x'
  asks 'secrets run --stage e2e --guarded -- x'
  asks 'secrets run --guarded --stage e2e -- x'
  asks '/opt/tools/bin/secrets run --guarded -- x'
  asks './bin/secrets run --guarded -- x'
  asks '../plugins/secrets/bin/secrets run --guarded -- x'
  asks '"/a b/secrets" run --guarded -- x'
  asks "'/a b/secrets' run --guarded -- x"
  asks 'FOO=1 secrets run --guarded -- x'
  asks "sh -c 'secrets run --guarded -- x'"
  asks 'true && secrets run --guarded -- x'
  asks 'a; secrets run --guarded -- x'
  asks 'printf y | secrets run --guarded -- x'
  asks 'true&&secrets run --guarded -- x'
  asks 'a;secrets run --guarded -- x|cat'
  asks "secrets${TAB}run${TAB}--guarded${TAB}--${TAB}x"
  asks 'secrets   run     --guarded  --   x'
  asks "secrets run \\${NL}  --guarded -- x"
  asks "secrets \\${NL}run --guarded -- x"
  asks "secr\\${NL}ets run --guarded -- x"
  asks "cd sub${NL}secrets run --guarded -- x"
}

test_hook_asks_for_more_forms() {
  asks 'echo "$(secrets run --guarded -- x)"'
  asks 'v=`secrets run --guarded -- x`'
  asks 'secrets run --guarded -- x 2>&1'
  asks 'secrets 2>/dev/null run --guarded -- x'
  asks 'secrets run --guarded>out -- x'
  asks 'secrets run --stage secrets --guarded -- x'
  asks "secrets run '--guarded' -- x"
  asks 'secrets run -- a; secrets run --guarded -- b'
  asks "secrets run -- sh -c 'secrets run --guarded -- y'"
  asks 'secrets run --stage e2e && secrets run --guarded -- y'
}

# A volume that ignores case starts the tool for any spelling of its name.
test_hook_asks_for_the_name_in_any_case() {
  asks 'SECRETS run --guarded -- x'
  asks 'Secrets run --guarded -- x'
  asks '/opt/tools/bin/SeCrEtS run --guarded -- x'
  silent 'SECRETS run -- x'
}

test_hook_silent_for_other_commands() {
  silent 'secrets run -- x'
  silent 'secrets run --stage guarded-x -- x'
  silent 'secrets status'
  silent 'grep -- --guarded file'
  silent 'grep -rn -- --guarded plugins/secrets'
  silent 'secrets run -- tool --guarded'
  silent "secrets run -- sh -c 'tool --guarded'"
  silent 'echo hello'
  silent ''
}

ms_now() { perl -MTime::HiRes=time -e 'printf "%d\n", time * 1000'; }

# The hook runs before every Bash call, and a timed-out hook lets the command run.
test_hook_long_command_is_fast() {
  _i=0
  while [ "$_i" -lt 5000 ]; do
    printf 'echo line-%05d-abcdef \\\n' "$_i"
    _i=$((_i + 1))
  done > "$TEST_DIR/cmd"
  printf '&& secrets run --guarded -- x' >> "$TEST_DIR/cmd"
  _size=$(wc -c < "$TEST_DIR/cmd")
  [ "$_size" -gt 90000 ] || fail "the command has only $_size bytes"
  hook_input "$(cat "$TEST_DIR/cmd")" > "$TEST_DIR/in.json"
  for _sh in $(hook_shells); do
    _t0=$(ms_now)
    assert_status 0 "$_sh" "$HOOK" < "$TEST_DIR/in.json"
    _ms=$(($(ms_now) - _t0))
    [ "$_ms" -lt 5000 ] || fail "$_sh: $_ms ms"
    assert_eq "$ASK" "$OUT" "$_sh"
  done
}

# A command without the text --guarded never reaches jq.
test_hook_no_jq_without_the_flag() {
  hook_input 'secrets run -- x' > "$TEST_DIR/in.json"
  : > "$SHIM_LOG"
  sh "$HOOK" < "$TEST_DIR/in.json" > "$TEST_DIR/out" || fail "exit $?"
  assert_eq '' "$(/bin/cat "$TEST_DIR/out")"
  assert_eq '' "$(/bin/cat "$SHIM_LOG")" "calls of a shimmed tool"
  hook_input 'grep -- --guarded file' > "$TEST_DIR/in.json"
  sh "$HOOK" < "$TEST_DIR/in.json" > "$TEST_DIR/out" || fail "exit $?"
  assert_contains "$(/bin/cat "$SHIM_LOG")" 'jq -er' "a call with the text --guarded"
}

# Without jq the hook cannot tell a guarded run from other text, so it asks.
test_hook_asks_without_jq() {
  mkdir "$TEST_DIR/nobin"
  for _sh in $(hook_shells); do
    _shp=$(command -v "$_sh")
    hook_input 'grep -- --guarded file' > "$TEST_DIR/in.json"
    (env PATH="$TEST_DIR/nobin" "$_shp" "$HOOK" < "$TEST_DIR/in.json" > "$TEST_DIR/out" 2> "$TEST_DIR/err")
    assert_eq 0 "$?" "$_sh: exit"
    assert_eq "$ASK" "$(cat "$TEST_DIR/out")" "$_sh: stdout"
    assert_eq '' "$(cat "$TEST_DIR/err")" "$_sh: stderr"
    hook_input 'echo hello' > "$TEST_DIR/in.json"
    (env PATH="$TEST_DIR/nobin" "$_shp" "$HOOK" < "$TEST_DIR/in.json" > "$TEST_DIR/out" 2> "$TEST_DIR/err")
    assert_eq 0 "$?" "$_sh: exit, no flag"
    assert_eq '' "$(cat "$TEST_DIR/out")" "$_sh: stdout, no flag"
  done
}

test_hook_asks_on_bad_input() {
  for _sh in $(hook_shells); do
    for _in in 'not json --guarded' '{"tool_input": {"command": "grep -- --guarded f"' \
      '{"tool_input": {"description": "--guarded"}}' '{"tool_input": {"command": 5}, "x": "--guarded"}' \
      '["--guarded"]'; do
      printf '%s' "$_in" > "$TEST_DIR/in.json"
      assert_status 0 "$_sh" "$HOOK" < "$TEST_DIR/in.json"
      assert_eq "$ASK" "$OUT" "$_sh: [$_in]"
    done
    for _in in 'not json' '' '{"tool_input": {"command": "echo hi", "description": "no --guarded here"}}'; do
      printf '%s' "$_in" > "$TEST_DIR/in.json"
      assert_status 0 "$_sh" "$HOOK" < "$TEST_DIR/in.json"
      assert_eq '' "$OUT" "$_sh: [$_in]"
    done
  done
}

test_hook_runs_as_a_program() {
  [ -x "$HOOK" ] || fail "the hook is not executable"
  hook_input 'secrets run --guarded -- x' > "$TEST_DIR/in.json"
  assert_status 0 "$HOOK" < "$TEST_DIR/in.json"
  assert_eq "$ASK" "$OUT"
}

test_hook_json_wires_the_hook() {
  _h=$PLUGIN_DIR/hooks/hooks.json
  assert_eq 'Bash|command|${CLAUDE_PLUGIN_ROOT}/hooks/guard-ask.sh' \
    "$(jq -r '.hooks.PreToolUse[] | .matcher as $m | .hooks[] | "\($m)|\(.type)|\(.command)"' "$_h")"
  assert_eq PreToolUse "$(jq -r '.hooks | keys | join(" ")' "$_h")" "events"
}
