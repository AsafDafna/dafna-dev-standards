# shellcheck shell=sh
# shellcheck disable=SC2016 # an env line holds a literal $ that the parser must refuse
# Tests of secrets setup, the agent side, with the real window script and the fakes.
# Run: sh run.sh test-setup-agent.sh

secrets() { sh "$PLUGIN_DIR/bin/secrets" "$@"; }

open_log() { cat "$FAKE_OPEN_DIR/argv.log" 2>/dev/null; }

# stored VAULT TITLE: the stored value with an x after it, so a trailing newline shows.
stored() { cat "$FAKE_OP_DIR/vaults/$1/$2.value" && printf x; }

sa_repo() {
  new_repo "$TEST_DIR/proj" || return 1
  cd "$TEST_DIR/proj" || return 1
}

# result_later SECONDS TEXT: writes TEXT as the result file of the setup that waits now, SECONDS
# after its launcher exists, the way a window does (tmp file, then mv). Start it in the
# background, with FAKE_OPEN_MODE=ignore, so that no window writes a result.
result_later() {
  _rl_n=0
  while :; do
    for _rl_dir in "$TMPDIR"/secrets-setup.*; do
      [ ! -f "$_rl_dir/launch.command" ] || break 2
    done
    [ "$_rl_n" -lt 20 ] || return 1
    sleep 1
    _rl_n=$((_rl_n + 1))
  done
  sleep "$1"
  printf '%s' "$2" > "$_rl_dir/result.tmp" && mv "$_rl_dir/result.tmp" "$_rl_dir/result"
}

test_setup_validates_before_window() {
  sa_repo
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
  sa_repo
  for p in My_Proj agent-tokens; do
    assert_status 1 secrets setup "$p"
    assert_eq "secrets: \"$p\" is not a valid project name" "$ERR"
  done
  assert_status 1 secrets setup
  assert_contains "$ERR" 'secrets: no project.'
  assert_eq '' "$(open_log)" "open calls"
}

test_setup_launcher_quoting() {
  sa_repo
  mkdir "d q"
  printf 'A=val-qa\nB=val-qb\n' > "d q/x.env"
  printf 'C=val-c\n' > 'x+y=z,w@v~.env'
  printf 'D=val-d\n' > ./-dash.env
  assert_status 0 secrets setup proj --import "d q/x.env:e2e" --import 'x+y=z,w@v~.env' --import ./-dash.env:ci \
    --guard A,B --renew
  assert_eq val-qax "$(stored proj A.e2e)" "a path with a space, and its stage"
  assert_eq val-qbx "$(stored proj B.e2e)" "both guard names"
  assert_eq high-value "$(cat "$FAKE_OP_DIR/vaults/proj/B.e2e.tags")" "tag of a guard name"
  assert_eq val-cx "$(stored proj C)" "a path with the other allowed signs"
  assert_eq val-dx "$(stored proj D.ci)" "a path that starts with a dash"
  assert_eq "$(printf '%s\n' 'A=op://proj/A.e2e/password' 'B=op://proj/B.e2e/password')" \
    "$(cat .secrets-refs.e2e.guarded)" "refs file in the repo root"
  assert_contains "$(cat "$FAKE_OP_DIR/argv.log")" 'service-account create proj-agent-' "--renew"
  _copy="$TEST_DIR/p 'q' [ab]"
  mkdir "$_copy" || fail "plugin copy"
  cp -R "$PLUGIN_DIR/bin" "$PLUGIN_DIR/lib" "$PLUGIN_DIR/libexec" "$_copy/" || fail "plugin copy"
  assert_status 0 sh "$_copy/bin/secrets" setup proj
  case $(sed -n 2p "$FAKE_OPEN_DIR/launched") in
    "exec '$TEST_DIR/p '\\''q'\\'' [ab]/libexec/setup-window.sh' "*) ;;
    *) fail "a plugin folder with a quote and brackets: $(sed -n 2p "$FAKE_OPEN_DIR/launched")" ;;
  esac
}

test_setup_import_path_allowlist() {
  sa_repo
  export LC_ALL=C
  printf 'A=1\n' > 'a  b.env'
  ln -s 'a  b.env' link.env
  for _p in 'a  b.env' link.env "$(printf 'a\tb.env')" "$(printf 'a\033b.env')" "$(printf 'a\302\233b.env')" \
    "d 'q'/x.env" 'x[ab].env'; do
    assert_status 1 secrets setup proj --import "$_p"
    assert_eq 'secrets: an import path holds a character that setup does not accept' "$ERR" "[$_p]"
  done
  new_repo "$TEST_DIR/p  q"
  cd "$TEST_DIR/p  q" || fail cd
  assert_status 1 secrets setup proj
  assert_eq 'secrets: the repo path holds a character that setup does not accept' "$ERR" "repo path"
  assert_eq '' "$(open_log)" "open calls"
}

# A relative --import path starts from DIR, and setup works on the repo of DIR.
test_setup_dir_option() {
  sa_repo
  cd "$TEST_DIR" || fail cd
  printf 'A=val-a\n' > proj/.env
  assert_status 0 secrets -C proj setup proj --import .env
  assert_eq val-ax "$(stored proj A)"
  assert_eq 'A=op://proj/A/password' "$(cat proj/.secrets-refs)"
  _exec=$(sed -n 2p "$FAKE_OPEN_DIR/launched")
  assert_contains "$_exec" "'$TEST_DIR/proj' '$TMPDIR/secrets-setup." "the repo root"
  assert_contains "$_exec" "--import '$TEST_DIR/proj/.env'" "the import path"
}

test_setup_launcher_executable() {
  sa_repo
  assert_status 0 secrets setup proj
  assert_eq 'drwx------ -rwx------ ' "$(awk '{print substr($1, 1, 10)}' "$FAKE_OPEN_DIR/modes" | tr '\n' ' ')" \
    "folder and launcher modes"
  _exec=$(sed -n 2p "$FAKE_OPEN_DIR/launched")
  case $_exec in
    "exec '$PLUGIN_DIR/libexec/setup-window.sh' "*) ;;
    *) fail "the launcher does not run the window script directly: $_exec" ;;
  esac
}

test_setup_timeout() {
  sa_repo
  export FAKE_OPEN_MODE=ignore SECRETS_SETUP_WAIT=2
  assert_status 1 secrets setup proj
  assert_eq 'secrets: the setup window gave no result in 2 seconds' "$ERR"
  assert_eq '' "$(ls "$TMPDIR")" "temp folder"
  assert_eq 1 "$(open_log | wc -l | tr -d ' ')" "open calls"
}

test_setup_reports_result() {
  sa_repo
  assert_status 0 secrets setup proj
  assert_contains "$OUT" 'secrets: created vaults: agent-tokens, agent-shared, proj'
  assert_contains "$OUT" 'secrets: created service account proj-agent'
  assert_eq '' "$ERR"
  assert_eq '' "$(ls "$TMPDIR")" "temp folders"
}

test_setup_reports_failure() {
  sa_repo
  export FAKE_OP_ACCOUNTS=2
  assert_status 1 secrets setup proj
  assert_eq 'secrets: setup failed: set SECRETS_OP_ACCOUNT' "$(printf '%s\n' "$ERR" | sed -n 1p)"
  assert_contains "$(printf '%s\n' "$ERR" | sed -n 2p)" 'secrets: 1Password has 2 accounts on this Mac.' "a detail line"
  assert_eq '' "$OUT"
  unset FAKE_OP_ACCOUNTS
  export FAKE_OPEN_STDIN=''
  assert_status 1 secrets setup proj
  assert_eq 'secrets: setup failed: cancelled' "$ERR" "no more lines"
  unset FAKE_OPEN_STDIN
  export FAKE_OPEN_MODE=ignore SECRETS_SETUP_WAIT=30
  for body in 'fail' '' 'stored'; do
    result_later 0 "$body" &
    assert_status 1 secrets setup proj
    wait
    assert_eq 'secrets: the setup window failed' "$ERR" "[$body]"
  done
}

test_setup_waits_for_late_result() {
  sa_repo
  export FAKE_OPEN_MODE=ignore SECRETS_SETUP_WAIT=30
  result_later 3 'ok
secrets: stored 1 item
' &
  assert_status 0 secrets setup proj
  wait
  assert_eq 'secrets: stored 1 item' "$OUT"
}
