# shellcheck shell=sh
# shellcheck disable=SC2016 # stub bodies are single-quoted on purpose: the stub expands them
# Tests of secrets setup, the agent side. Run: sh run.sh test-setup-agent.sh
# The tests run a copy of the plugin whose setup-window.sh is a stub that records its arguments.

secrets() { sh "$TEST_DIR/plug/bin/secrets" "$@"; }

open_log() { cat "$FAKE_OPEN_DIR/argv.log" 2>/dev/null; }

# sa_plugin STUB-BODY: a copy of the plugin in $TEST_DIR/plug. The stub gets the arguments
# of setup-window.sh, one per line in $TEST_DIR/stub.args, and the body runs after that.
sa_plugin() {
  mkdir -p "$TEST_DIR/plug" || return 1
  cp -R "$PLUGIN_DIR/bin" "$PLUGIN_DIR/lib" "$PLUGIN_DIR/libexec" "$TEST_DIR/plug/" || return 1
  printf '%s\n' '#!/bin/sh' 'printf "%s\n" "$@" > "$HOME/stub.args"' "${1-printf 'ok\n' > \"\$2\"}" \
    > "$TEST_DIR/plug/libexec/setup-window.sh"
  new_repo "$TEST_DIR/proj" || return 1
  cd "$TEST_DIR/proj" || return 1
}

test_setup_validates_before_window() {
  sa_plugin
  printf 'A=1\nB=2\n' > .env
  assert_status 1 secrets setup proj --import .env --guard A,C
  assert_eq 'secrets: C is in no import file, so it cannot be guarded.' "$ERR"
  assert_status 1 secrets setup proj --guard A
  assert_contains "$ERR" 'A is in no import file'
  printf 'A=$HOME\n' > bad.env
  assert_status 1 secrets setup proj --import bad.env
  assert_eq "secrets: $TEST_DIR/proj/bad.env line 1: uses \$ or \\. Fix the line, then try again." "$ERR"
  assert_status 1 secrets setup proj --import missing.env
  assert_eq "secrets: cannot read $TEST_DIR/proj/missing.env" "$ERR"
  assert_status 1 secrets setup proj --import .env:guarded
  assert_eq 'secrets: "guarded" is not a valid stage name' "$ERR"
  assert_status 1 secrets setup proj --import .env --guard ''
  assert_eq 'secrets: "" is not a valid secret name' "$ERR" "empty guard"
  assert_status 1 secrets setup proj --import .env --guard A,
  assert_eq 'secrets: "" is not a valid secret name' "$ERR" "trailing comma"
  assert_status 1 secrets setup proj --import 'a
b.env'
  assert_eq 'secrets: an import path cannot hold a newline' "$ERR"
  assert_status 1 secrets setup proj --frob
  assert_contains "$ERR" 'secrets: unknown option "--frob"'
  assert_eq '' "$(open_log)" "open calls"
}

test_setup_bad_project() {
  sa_plugin
  for p in My_Proj agent-tokens; do
    assert_status 1 secrets setup "$p"
    assert_eq "secrets: \"$p\" is not a valid project name" "$ERR"
  done
  assert_status 1 secrets setup
  assert_contains "$ERR" 'secrets: no project.'
  assert_eq '' "$(open_log)" "open calls"
}

test_setup_launcher_quoting() {
  sa_plugin
  mkdir "d 'q'"
  printf 'A=1\nB=2\n' > "d 'q'/x.env"
  printf 'A=1\n' > xa.env
  printf 'A=1\n' > 'x[ab].env'
  printf 'A=1\n' > ./-dash.env
  assert_status 0 secrets setup proj --import "d 'q'/x.env:e2e" --import 'x[ab].env' --import ./-dash.env:ci \
    --guard A,B --renew
  _root=$(pwd -P)
  assert_eq "$_root
proj
--import
$TEST_DIR/proj/d 'q'/x.env:e2e
--import
$TEST_DIR/proj/x[ab].env
--import
$TEST_DIR/proj/./-dash.env:ci
--guard
A,B
--renew" "$(sed 2d "$HOME/stub.args")" "arguments"
  case $(sed -n 2p "$HOME/stub.args") in
    "$TMPDIR"/secrets-setup.*/result) ;;
    *) fail "result file is $(sed -n 2p "$HOME/stub.args")" ;;
  esac
}

test_setup_launcher_executable() {
  sa_plugin 'ls -ld "${2%/*}" "${2%/*}/launch.command" > "$HOME/modes"; printf "ok\n" > "$2"'
  assert_status 0 secrets setup proj
  [ -f "$HOME/stub.args" ] || fail "the launcher did not run: the fake open refuses a file without the execute bit"
  assert_eq 'drwx------ -rwx------ ' "$(awk '{print substr($1, 1, 10)}' "$HOME/modes" | tr '\n' ' ')" "folder and launcher modes"
}

test_setup_timeout() {
  sa_plugin
  export FAKE_OPEN_MODE=ignore SECRETS_SETUP_WAIT=2
  assert_status 1 secrets setup proj
  assert_eq 'secrets: the setup window gave no result in 2 seconds' "$ERR"
  assert_eq '' "$(ls "$TMPDIR")" "temp folder"
  assert_eq 1 "$(open_log | wc -l | tr -d ' ')" "open calls"
}

test_setup_reports_result() {
  sa_plugin 'printf "ok\nstored 2 items\n" > "$2.tmp" && mv "$2.tmp" "$2"'
  assert_status 0 secrets setup proj
  assert_eq 'stored 2 items' "$OUT"
  assert_eq '' "$(ls "$TMPDIR")" "temp folder"
}

test_setup_reports_failure() {
  sa_plugin 'printf "failed: the owner said no\nsecrets: details\n" > "$2.tmp" && mv "$2.tmp" "$2"'
  assert_status 1 secrets setup proj
  assert_eq 'secrets: setup failed: the owner said no
secrets: details' "$ERR"
  assert_eq '' "$OUT"
  sa_plugin 'printf "failed: no op\n" > "$2.tmp" && mv "$2.tmp" "$2"'
  assert_status 1 secrets setup proj
  assert_eq 'secrets: setup failed: no op' "$ERR" "no more lines"
  for body in 'printf "fail\n" > "$2"' ': > "$2"' 'printf "stored\n" > "$2"'; do
    sa_plugin "$body"
    assert_status 1 secrets setup proj
    assert_eq 'secrets: the setup window failed' "$ERR" "$body"
  done
}

test_setup_waits_for_late_result() {
  sa_plugin 'sleep 3; printf "ok\nstored 1 item\n" > "$2.tmp" && mv "$2.tmp" "$2"'
  export FAKE_OPEN_MODE=async
  assert_status 0 secrets setup proj
  assert_eq 'stored 1 item' "$OUT"
}
