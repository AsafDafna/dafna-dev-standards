# shellcheck shell=sh
# shellcheck disable=SC2016 # single-quoted scripts run in a child shell, which expands them
# Tests of secrets run. Run: sh run.sh test-run.sh

secrets() { sh "$PLUGIN_DIR/bin/secrets" "$@"; }

# run_repo: a repo "proj" with refs A, the item A = v1 and a token that reads proj.
run_repo() {
  new_repo "$TEST_DIR/proj" || return 1
  cd "$TEST_DIR/proj" || return 1
  printf 'A=op://proj/A/password\n' > .secrets-refs
  fake_item proj A v1
  fake_token tok proj
  fake_keychain op-sa-proj tok
}

test_run_passes_values() {
  run_repo
  assert_status 0 secrets run -- sh -c 'test "$A" = v1'
}

test_run_removes_token() {
  run_repo
  assert_status 0 secrets run -- sh -c 'test -z "${OP_SERVICE_ACCOUNT_TOKEN+x}"'
}

test_run_exit_code() {
  run_repo
  assert_status 7 secrets run -- sh -c 'exit 7'
}

test_run_keeps_arguments() {
  run_repo
  assert_status 0 secrets run -- sh -c 'printf "%s|" "$@"' x 'a b' '' c
  assert_eq 'a b||c|' "$OUT"
}

test_run_stage() {
  run_repo
  printf 'A=op://proj/E/password\n' > .secrets-refs.e2e
  printf 'B=op://proj/B/password\n' >> .secrets-refs
  fake_item proj E v-e2e
  fake_item proj B v-b
  assert_status 0 secrets run --stage e2e -- sh -c 'test "$A" = v-e2e && test -z "${B+x}"'
}

test_run_guarded_adds_file() {
  run_repo
  printf 'G=op://proj/G/password\n' > .secrets-refs.guarded
  fake_item proj G v-g
  assert_status 0 secrets run --guarded -- sh -c 'test "$G" = v-g && test "$A" = v1'
  assert_status 0 secrets run -- sh -c 'test -z "${G+x}" && test "$A" = v1'
}

test_run_hard_stop_names_each() {
  run_repo
  printf 'B=op://proj/B/password\nC=op://proj/C/password\n' >> .secrets-refs
  assert_status 1 secrets run -- sh -c ": > \"$TEST_DIR/marker\""
  assert_contains "$ERR" 'secrets: cannot read B (item B in vault proj)'
  assert_contains "$ERR" 'secrets: cannot read C (item C in vault proj)'
  assert_not_contains "$ERR" 'cannot read A'
  [ ! -e "$TEST_DIR/marker" ] || fail "the command started"
}

test_run_guarded_hint() {
  run_repo
  printf 'G=op://proj/G/password\n' > .secrets-refs.guarded
  fake_item proj-guarded G v-g
  assert_status 1 secrets run --guarded -- true
  assert_contains "$ERR" 'secrets: cannot read G (item G in vault proj)'
  assert_contains "$ERR" 'ask the owner to move G from proj-guarded to proj'
}

test_run_duplicate_title() {
  run_repo
  fake_item proj A v1 '' 2
  assert_status 1 secrets run -- true
  assert_contains "$ERR" 'secrets: more than one item is titled A in vault proj. Keep one.'
}

test_run_bad_refs_chars_no_op() {
  run_repo
  printf 'A=op://proj/$OP_SERVICE_ACCOUNT_TOKEN/password\n' > .secrets-refs
  assert_status 1 secrets run -- true
  assert_contains "$ERR" 'line 1 is not NAME=op://vault/title/password'
  [ ! -s "$FAKE_OP_DIR/argv.log" ] || fail "op was called"
}

test_run_titles_uncached() {
  run_repo
  printf 'B=op://proj/B/password\n' >> .secrets-refs
  assert_status 1 secrets run -- true
  assert_contains "$(cat "$FAKE_OP_DIR/argv.log")" 'item list --vault proj --format json --cache=false'
}

test_run_no_token() {
  run_repo
  rm "$FAKE_SEC_DIR/items/op-sa-proj"
  assert_status 1 secrets run -- true
  assert_contains "$ERR" 'secrets: no token for proj on this Mac. Run: secrets setup proj'
  [ ! -s "$FAKE_OP_DIR/argv.log" ] || fail "op was called"
}

test_run_keychain_error() {
  run_repo
  export FAKE_SEC_FAIL=36
  assert_status 1 secrets run -- true
  assert_contains "$ERR" 'secrets: cannot read the Keychain item op-sa-proj (security exit 36)'
  assert_not_contains "$ERR" 'no token'
  [ ! -s "$FAKE_OP_DIR/argv.log" ] || fail "op was called"
}

test_fake_rejects_no_masking() {
  run_repo
  assert_status 2 op run --no-masking --env-file .secrets-refs -- true
  assert_contains "$ERR" 'not modeled'
}

test_run_invalid_token() {
  run_repo
  fake_keychain op-sa-proj bogus
  assert_status 1 secrets run -- true
  assert_contains "$ERR" 'secrets: the token for proj does not work. Run: secrets setup proj, with --renew if the owner revoked it'
}

test_run_no_refs() {
  run_repo
  rm .secrets-refs
  assert_status 1 secrets run -- true
  assert_contains "$ERR" "secrets: no .secrets-refs in $TEST_DIR/proj"
}

test_run_unreachable() {
  run_repo
  FAKE_OP_FAIL=unreachable assert_status 1 secrets run -- true
  assert_contains "$ERR" 'secrets: 1Password is not reachable. Check the network, then try again.'
}

test_run_ratelimit() {
  run_repo
  FAKE_OP_FAIL=ratelimit assert_status 1 secrets run -- true
  assert_contains "$ERR" 'secrets: the 1Password request limit is reached. Wait, then try again.'
}

test_run_interrupt_cleans() {
  run_repo
  perl -e 'setpgrp(0,0); $SIG{INT}="DEFAULT"; exec @ARGV' sh "$PLUGIN_DIR/bin/secrets" run -- sleep 5 &
  _pid=$!
  sleep 1
  kill -INT "-$_pid"
  _i=0
  while kill -0 "$_pid" 2>/dev/null && [ "$_i" -lt 20 ]; do
    sleep 0.1
    _i=$((_i + 1))
  done
  if kill -0 "$_pid" 2>/dev/null; then
    kill -KILL "-$_pid"
    fail "secrets run did not end within 2 seconds of INT"
  fi
  wait "$_pid"
  assert_eq 130 "$?" "exit code"
  assert_eq '' "$(ls "$TMPDIR")" "temp folders left"
}

test_run_signal_death_code() {
  run_repo
  assert_status 255 secrets run -- sh -c 'kill -TERM $$'
}
