# shellcheck shell=sh
# shellcheck disable=SC2016 # single-quoted scripts run in a child shell, which expands them
# Tests of the setup window, libexec/setup-window.sh. Run: sh run.sh test-setup-window.sh
# Most tests run the script directly, as the launcher does, with stdin from $TEST_DIR/stdin.

secrets() { sh "$PLUGIN_DIR/bin/secrets" "$@"; }

op_log() { cat "$FAKE_OP_DIR/argv.log" 2>/dev/null; }

sec_log() { cat "$FAKE_SEC_DIR/argv.log" 2>/dev/null; }

keychain() { cat "$FAKE_SEC_DIR/items/op-sa-$1" 2>/dev/null; }

# stored VAULT TITLE: the stored value with an x after it, so a trailing newline shows.
stored() { cat "$FAKE_OP_DIR/vaults/$1/$2.value" && printf x; }

first_line() { printf '%s\n' "${1%%
*}"; }

# sw_repo: the repo proj (the working folder), with .env holding A and G, and the result folder.
sw_repo() {
  new_repo "$TEST_DIR/proj" || return 1
  cd "$TEST_DIR/proj" || return 1
  printf 'A=val-a-long\nG=val-g-long\n' > .env
  mkdir "$TEST_DIR/res"
}

# window [FLAG...]: runs the window for project proj, with stdin from $TEST_DIR/stdin (default:
# one Enter). Sets RC, SCREEN (its output) and RESULT (the result file; empty when there is none).
window() {
  rm -f "$TEST_DIR/res/result"
  [ -f "$TEST_DIR/stdin" ] || printf '\n' > "$TEST_DIR/stdin"
  "$PLUGIN_DIR/libexec/setup-window.sh" "$TEST_DIR/proj" "$TEST_DIR/res/result" proj "$@" \
    < "$TEST_DIR/stdin" > "$TEST_DIR/screen" 2>&1
  RC=$?
  SCREEN=$(cat "$TEST_DIR/screen")
  RESULT=$(cat "$TEST_DIR/res/result" 2>/dev/null)
}

# window_bg [FLAG...]: starts the window in its own process group, as a Terminal window runs,
# with its stdin on fd 5 of the test. Sets W_PID.
window_bg() {
  mkfifo "$TEST_DIR/enter"
  perl -e 'setpgrp(0, 0); $SIG{INT} = "DEFAULT"; exec @ARGV' "$PLUGIN_DIR/libexec/setup-window.sh" \
    "$TEST_DIR/proj" "$TEST_DIR/res/result" proj "$@" < "$TEST_DIR/enter" > "$TEST_DIR/screen" 2>&1 &
  W_PID=$!
  exec 5> "$TEST_DIR/enter"
}

window_wait() { # TEXT: returns once the window output shows TEXT
  _ww_n=0
  until grep -qF -- "$1" "$TEST_DIR/screen"; do
    [ "$_ww_n" -lt 20 ] || fail "the window did not show [$1]"
    sleep 1
    _ww_n=$((_ww_n + 1))
  done
}

window_end() { # closes the window's stdin, waits for it, and sets RC and RESULT
  exec 5>&-
  wait "$W_PID"
  RC=$?
  RESULT=$(cat "$TEST_DIR/res/result" 2>/dev/null)
}

test_window_no_op_before_enter() {
  sw_repo
  export FAKE_OPEN_STDIN=''
  assert_status 1 secrets setup proj --import .env --guard G
  assert_eq 'secrets: setup failed: cancelled' "$ERR"
  assert_eq '' "$(op_log)" "op calls"
  assert_contains "$(cat "$FAKE_OPEN_DIR/window.log")" 'A → proj (A)' "the screen"
}

test_window_only_enter_continues() {
  sw_repo
  printf 'no\n' > "$TEST_DIR/stdin"
  window --import "$TEST_DIR/proj/.env"
  assert_eq 'failed: cancelled' "$RESULT"
  assert_eq '' "$(op_log)" "op calls"
}

test_window_agent_gone() {
  sw_repo
  rmdir "$TEST_DIR/res"
  window --import "$TEST_DIR/proj/.env"
  assert_eq 1 "$RC" "exit"
  assert_eq '' "$(op_log)" "op calls"
  assert_contains "$SCREEN" 'secrets: setup failed: the agent stopped waiting'
  [ ! -e "$TEST_DIR/res" ] || fail "the window made the result folder"
}

test_window_screen_lists_targets() {
  sw_repo
  printf 'B=val-b-long\nE=\n' > .env.e2e
  : > "$TEST_DIR/stdin"
  window --import "$TEST_DIR/proj/.env" --import "$TEST_DIR/proj/.env.e2e" --guard G
  assert_contains "$SCREEN" 'A → proj (A)'
  assert_contains "$SCREEN" 'G → proj-guarded (G)'
  assert_contains "$SCREEN" 'B → proj (B.e2e)'
  assert_contains "$SCREEN" 'E  (empty, skipped)'
  assert_contains "$SCREEN" 'agent-tokens, agent-shared, proj, proj-guarded'
  assert_contains "$SCREEN" 'proj-agent'
  assert_eq 'failed: cancelled' "$RESULT"
}

test_window_screen_marks_short() {
  sw_repo
  printf 'LOG_LEVEL=info\n' >> .env
  window --import "$TEST_DIR/proj/.env"
  assert_eq ok "$(first_line "$RESULT")" "result (screen: $SCREEN)"
  assert_eq '    LOG_LEVEL → proj (LOG_LEVEL)  (short value: masked in all output)' \
    "$(printf '%s\n' "$SCREEN" | grep -F 'LOG_LEVEL →')"
  assert_not_contains "$SCREEN" info
  assert_contains "$SCREEN" 'secrets: LOG_LEVEL match'
}

test_window_first_call_is_vault_list() {
  sw_repo
  fake_token ops_agent proj:w
  export OP_SERVICE_ACCOUNT_TOKEN=ops_agent
  window --import "$TEST_DIR/proj/.env"
  assert_eq 'vault list --format json' "$(op_log | sed -n 1p)"
  assert_eq ok "$(first_line "$RESULT")" "an agent token in the environment (screen: $SCREEN)"
  assert_contains "$(op_log)" 'vault create proj' "the owner made the calls"
}

test_window_two_accounts() {
  sw_repo
  export FAKE_OP_ACCOUNTS=2
  window --import "$TEST_DIR/proj/.env"
  assert_eq 'failed: set SECRETS_OP_ACCOUNT' "$(first_line "$RESULT")"
  assert_eq "$(printf '%s\n' 'vault list --format json' 'account list --format json' signout)" "$(op_log)" "op calls"
  assert_eq "$(printf '\n\n\n')" "$(cat "$FAKE_OP_DIR/account.log")" "no account without SECRETS_OP_ACCOUNT"
  : > "$FAKE_OP_DIR/argv.log"
  : > "$FAKE_OP_DIR/account.log"
  export SECRETS_OP_ACCOUNT=account2.example.invalid
  window --import "$TEST_DIR/proj/.env"
  assert_eq ok "$(first_line "$RESULT")" "with SECRETS_OP_ACCOUNT (screen: $SCREEN)"
  assert_contains "$SCREEN" 'account2.example.invalid'
  assert_not_contains "$(op_log)" 'account list'
  assert_eq signout "$(op_log | sed -n '$p')" "last op call"
  assert_eq "$(op_log | wc -l | tr -d ' ')" "$(grep -cx account2.example.invalid "$FAKE_OP_DIR/account.log")" \
    "every op call, signout included, has the account"
}

test_window_new_project() {
  sw_repo
  window --import "$TEST_DIR/proj/.env" --guard G
  assert_eq 0 "$RC" "exit (screen: $SCREEN)"
  _log=$(op_log)
  for _v in agent-tokens agent-shared proj proj-guarded; do
    assert_contains "$_log" "vault create $_v"
  done
  assert_eq 4 "$(printf '%s\n' "$_log" | grep -c '^vault create ')" "vault creates"
  assert_eq 'service-account create proj-agent --vault proj:read_items,write_items --vault agent-shared:read_items --raw' \
    "$(printf '%s\n' "$_log" | grep '^service-account create')"
  assert_eq ops_fake_proj-agentx "$(stored agent-tokens proj)" "token item"
  assert_eq ops_fake_proj-agent "$(keychain proj)" "Keychain"
  assert_eq val-a-longx "$(stored proj A)"
  assert_eq val-g-longx "$(stored proj-guarded G)"
  assert_eq high-value "$(cat "$FAKE_OP_DIR/vaults/proj-guarded/G.tags")" "tag of G"
  [ ! -f "$FAKE_OP_DIR/vaults/proj/A.tags" ] || fail "A has a tag"
  assert_eq 'A=op://proj/A/password' "$(cat .secrets-refs)"
  assert_eq 'G=op://proj/G/password' "$(cat .secrets-refs.guarded)"
  assert_contains "$SCREEN" 'secrets: A match'
  assert_contains "$SCREEN" 'secrets: G match'
  assert_contains "$SCREEN" 'secrets: keychain match'
  assert_eq signout "$(printf '%s\n' "$_log" | sed -n '$p')" "last op call"
  assert_eq ok "$(first_line "$RESULT")"
  assert_contains "$RESULT" 'secrets: stored in proj: A'
  assert_eq 'secrets: read back: 2 stored and matched' "$(printf '%s\n' "$RESULT" | sed -n '$p')" "last summary line"
}

test_window_again_creates_nothing() {
  sw_repo
  window --import "$TEST_DIR/proj/.env" --guard G
  assert_eq 0 "$RC" "first run (screen: $SCREEN)"
  : > "$FAKE_OP_DIR/argv.log"
  : > "$FAKE_SEC_DIR/argv.log"
  printf '\nyes\n' > "$TEST_DIR/stdin"
  window --import "$TEST_DIR/proj/.env" --guard G
  assert_eq 0 "$RC" "second run (screen: $SCREEN)"
  assert_not_contains "$(op_log)" 'vault create'
  assert_not_contains "$(op_log)" 'service-account create'
  assert_not_contains "$(op_log)" 'item create'
  assert_eq 0 "$(sec_log | grep -cx -- -i)" "Keychain writes"
  assert_eq 'A=op://proj/A/password' "$(cat .secrets-refs)" "one refs line"
  [ ! -f "$FAKE_OP_DIR/vaults/proj/A.copies" ] || fail "a second item titled A"
}

sw_replace_line='secrets: G: an item G already exists in vault proj-guarded; this setup will replace its value'

test_window_replace_guarded_with_yes() {
  sw_repo
  window --import "$TEST_DIR/proj/.env" --guard G
  assert_eq ok "$(first_line "$RESULT")" "first run (screen: $SCREEN)"
  printf 'A=val-a-long\nG=val-g-new\n' > .env
  printf '\nyes\n' > "$TEST_DIR/stdin"
  window --import "$TEST_DIR/proj/.env" --guard G
  assert_eq ok "$(first_line "$RESULT")" "after yes (screen: $SCREEN)"
  assert_contains "$SCREEN" "$sw_replace_line"
  assert_contains "$SCREEN" 'Type yes to replace the value of each item above: '
  assert_not_contains "$SCREEN" 'secrets: A: an item'
  assert_eq val-g-newx "$(stored proj-guarded G)"
  assert_eq high-value "$(cat "$FAKE_OP_DIR/vaults/proj-guarded/G.tags")" "tag of G"
  assert_contains "$SCREEN" 'secrets: G match'
}

test_window_replace_guarded_declined() {
  sw_repo
  window --import "$TEST_DIR/proj/.env" --guard G
  assert_eq ok "$(first_line "$RESULT")" "first run (screen: $SCREEN)"
  _refs=$(cat .secrets-refs .secrets-refs.guarded)
  printf 'A=val-a-new\nG=val-g-new\n' > .env
  for _answer in no EOF; do
    if [ "$_answer" = EOF ]; then printf '\n'; else printf '\n%s\n' "$_answer"; fi > "$TEST_DIR/stdin"
    : > "$FAKE_OP_DIR/argv.log"
    : > "$FAKE_SEC_DIR/argv.log"
    window --import "$TEST_DIR/proj/.env" --guard G --renew
    assert_eq 'failed: cancelled' "$RESULT" "$_answer (screen: $SCREEN)"
    assert_contains "$SCREEN" "$sw_replace_line" "$_answer"
    assert_not_contains "$(op_log)" 'create' "$_answer"
    assert_not_contains "$(op_log)" 'item edit' "$_answer"
    assert_eq 0 "$(sec_log | grep -cx -- -i)" "$_answer: Keychain writes"
  done
  assert_eq val-a-longx "$(stored proj A)"
  assert_eq val-g-longx "$(stored proj-guarded G)"
  assert_eq "$_refs" "$(cat .secrets-refs .secrets-refs.guarded)" "refs files"
}

test_window_interrupt_at_replace() {
  sw_repo
  window --import "$TEST_DIR/proj/.env" --guard G
  assert_eq ok "$(first_line "$RESULT")" "first run (screen: $SCREEN)"
  printf 'A=val-a-new\nG=val-g-new\n' > .env
  : > "$FAKE_OP_DIR/argv.log"
  window_bg --import "$TEST_DIR/proj/.env" --guard G
  window_wait 'Press Enter'
  printf '\n' >&5
  window_wait 'Type yes to replace'
  kill -INT "-$W_PID"
  window_end
  assert_eq 130 "$RC" "exit"
  assert_eq 'failed: cancelled' "$RESULT"
  assert_not_contains "$(op_log)" 'item edit'
  assert_eq val-a-longx "$(stored proj A)"
}

test_window_second_mac() {
  sw_repo
  fake_item agent-tokens proj tok-from-item
  mkdir -p "$FAKE_OP_DIR/vaults/agent-shared" "$FAKE_OP_DIR/vaults/proj"
  window --import "$TEST_DIR/proj/.env"
  assert_eq 0 "$RC" "exit (screen: $SCREEN)"
  assert_eq tok-from-item "$(keychain proj)"
  assert_not_contains "$(op_log)" 'service-account create'
  assert_contains "$SCREEN" 'secrets: keychain match'
}

test_window_stale_keychain() {
  sw_repo
  fake_item agent-tokens proj tok-new
  fake_keychain op-sa-proj tok-old
  mkdir -p "$FAKE_OP_DIR/vaults/agent-shared" "$FAKE_OP_DIR/vaults/proj"
  window
  assert_eq 0 "$RC" "exit (screen: $SCREEN)"
  assert_eq tok-new "$(keychain proj)"
}

test_window_renew() {
  sw_repo
  window
  assert_eq 0 "$RC" "first run (screen: $SCREEN)"
  window --renew
  assert_eq 0 "$RC" "renew (screen: $SCREEN)"
  _sa=$(op_log | sed -n 's/^service-account create \(proj-agent-[0-9]*\) .*/\1/p')
  case $_sa in
    proj-agent-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;;
    *) fail "renewed service account [$_sa]" ;;
  esac
  assert_contains "$(op_log)" 'item edit proj --vault agent-tokens'
  assert_eq "ops_fake_${_sa}x" "$(stored agent-tokens proj)" "token item"
  [ ! -f "$FAKE_OP_DIR/vaults/agent-tokens/proj.copies" ] || fail "a second token item"
  assert_eq "ops_fake_$_sa" "$(keychain proj)" "Keychain"
}

test_window_existing_vault_needs_yes() {
  sw_repo
  mkdir -p "$FAKE_OP_DIR/vaults/Proj"
  printf '\nno\n' > "$TEST_DIR/stdin"
  window --import "$TEST_DIR/proj/.env"
  assert_eq 'failed: vault exists' "$RESULT"
  assert_not_contains "$(op_log)" create
  printf '\nyes\n' > "$TEST_DIR/stdin"
  window --import "$TEST_DIR/proj/.env"
  assert_eq ok "$(first_line "$RESULT")" "after yes (screen: $SCREEN)"
  assert_not_contains "$(op_log)" 'vault create proj'
  assert_eq val-a-longx "$(stored Proj A)"
}

test_window_open_name_in_guarded_vault() {
  sw_repo
  fake_item agent-tokens proj tok-1
  fake_keychain op-sa-proj tok-1
  mkdir -p "$FAKE_OP_DIR/vaults/agent-shared" "$FAKE_OP_DIR/vaults/proj"
  fake_item proj-guarded A val-old
  window --import "$TEST_DIR/proj/.env"
  assert_eq 'failed: item is guarded' "$(first_line "$RESULT")"
  assert_contains "$SCREEN" 'secrets: A is in vault proj-guarded. Add A to --guard, or move the item.'
  assert_contains "$RESULT" 'secrets: A is in vault proj-guarded. Add A to --guard, or move the item.'
  assert_not_contains "$(op_log)" 'item create'
  assert_not_contains "$(op_log)" 'item edit'
  fake_item proj A val-old
  window --import "$TEST_DIR/proj/.env"
  assert_eq 'failed: more than one item is titled A in vaults proj and proj-guarded. Keep one.' \
    "$(first_line "$RESULT")" "the same title in both vaults"
  assert_not_contains "$(op_log)" 'item create'
  assert_not_contains "$(op_log)" 'item edit'
}

# sw_open_g VALUE: the vaults, token item and Keychain item of an earlier setup, item G in vault
# proj with VALUE, and no item A.
sw_open_g() {
  fake_item agent-tokens proj tok-1
  fake_keychain op-sa-proj tok-1
  mkdir -p "$FAKE_OP_DIR/vaults/agent-shared" "$FAKE_OP_DIR/vaults/proj-guarded"
  fake_item proj G "$1"
  rm -f "$FAKE_OP_DIR/vaults/proj/A.value"
  : > "$FAKE_OP_DIR/argv.log"
}

test_window_guard_name_in_open_vault_is_skipped() {
  sw_repo
  printf 'A=SENTINEL-a-file\nG=SENTINEL-g-file\n' > .env
  _notice='secrets: G skipped: an item G is already in vault proj, which agents can read. Setup did not read or change it.'
  _advice='secrets: If you moved it there yourself, nothing is needed. If not, delete it or move it to proj-guarded, then run setup again.'
  _first=''
  for _g in SENTINEL-g-file SENTINEL-g-other; do
    sw_open_g "$_g"
    window --import "$TEST_DIR/proj/.env" --guard G
    assert_eq ok "$(first_line "$RESULT")" "$_g: result (screen: $SCREEN)"
    for _out in "$SCREEN" "$RESULT"; do
      assert_contains "$_out" "$_notice" "$_g"
      assert_contains "$_out" "$_advice" "$_g"
    done
    assert_contains "$SCREEN" 'secrets: A match' "$_g"
    assert_not_contains "$SCREEN" 'secrets: G match' "$_g"
    assert_not_contains "$SCREEN" 'secrets: G mismatch' "$_g"
    assert_eq SENTINEL-a-filex "$(stored proj A)" "$_g: A imported"
    _log=$(op_log)
    assert_not_contains "$_log" '/G/password' "$_g: a read of G"
    assert_not_contains "$_log" 'item get' "$_g"
    assert_not_contains "$_log" 'item edit G ' "$_g"
    assert_not_contains "$_log" 'item create --vault proj-guarded' "$_g"
    assert_eq "${_g}x" "$(stored proj G)" "$_g: G unchanged"
    [ ! -e "$FAKE_OP_DIR/vaults/proj-guarded/G.value" ] || fail "$_g: an item G in proj-guarded"
    [ ! -e .secrets-refs.guarded ] || fail "$_g: a guarded refs file"
    assert_eq 'A=op://proj/A/password' "$(cat .secrets-refs)" "$_g: open refs"
    for _text in "$SCREEN" "$RESULT" "$_log" "$(sec_log)" "$(cat "$SHIM_LOG")"; do
      assert_not_contains "$_text" SENTINEL- "$_g"
    done
    assert_eq "ok
$_notice
$_advice
secrets: stored in proj: A
secrets: wrote .secrets-refs
secrets: read back: 1 stored and matched, 1 skipped and not read" "$RESULT" "$_g: the summary"
    if [ -z "$_first" ]; then
      _first=$SCREEN$RESULT
    else
      assert_eq "$_first" "$SCREEN$RESULT" "the output does not depend on the value of G"
    fi
  done
}

test_window_skip_keeps_existing_refs_line() {
  sw_repo
  sw_open_g val-g-other
  printf '%s\n' '# guarded' 'G=op://proj/G/password' > .secrets-refs.guarded
  _before=$(cat .secrets-refs.guarded)
  window --import "$TEST_DIR/proj/.env" --guard G
  assert_eq ok "$(first_line "$RESULT")" "result (screen: $SCREEN)"
  assert_eq "$_before" "$(cat .secrets-refs.guarded)" "guarded refs file"
}

test_window_guard_moves_open_refs_line() {
  sw_repo
  window --import "$TEST_DIR/proj/.env"
  assert_eq ok "$(first_line "$RESULT")" "first run (screen: $SCREEN)"
  assert_eq "$(printf '%s\n' 'A=op://proj/A/password' 'G=op://proj/G/password')" "$(cat .secrets-refs)" "open refs"
  mkdir "$FAKE_OP_DIR/vaults/proj-guarded"
  mv "$FAKE_OP_DIR/vaults/proj/G.value" "$FAKE_OP_DIR/vaults/proj-guarded/G.value"
  printf '\nyes\n' > "$TEST_DIR/stdin"
  window --import "$TEST_DIR/proj/.env" --guard G
  assert_eq ok "$(first_line "$RESULT")" "run with --guard G (screen: $SCREEN)"
  assert_eq 'A=op://proj/A/password' "$(cat .secrets-refs)" "open refs after --guard G"
  assert_eq 'G=op://proj/G/password' "$(cat .secrets-refs.guarded)" "guarded refs"
  assert_contains "$RESULT" 'secrets: wrote .secrets-refs, .secrets-refs.guarded'
  assert_status 0 secrets run -- sh -c 'test "$A" = val-a-long && test -z "${G+x}"'
}

test_window_guard_only_stage() {
  sw_repo
  printf 'G=val-g-long\n' > .env
  window --import "$TEST_DIR/proj/.env" --guard G
  assert_eq ok "$(first_line "$RESULT")" "result (screen: $SCREEN)"
  assert_contains "$RESULT" 'secrets: wrote .secrets-refs.guarded, .secrets-refs'
  assert_eq '' "$(cat .secrets-refs)" "open refs file"
  TERM_PROGRAM=xterm
  export TERM_PROGRAM
  assert_status 0 secrets status
  assert_contains "$OUT" 'secrets: G waits in proj-guarded'
  mv "$FAKE_OP_DIR/vaults/proj-guarded/G.value" "$FAKE_OP_DIR/vaults/proj/G.value"
  assert_status 0 secrets run --guarded -- sh -c 'test "$G" = val-g-long'
  assert_status 0 secrets status
  assert_contains "$OUT" 'secrets: G open to agents'
}

test_window_screen_shows_files() {
  sw_repo
  mkdir real
  printf 'B=val-b-long\n' > real/vals.env
  ln -s real/vals.env .env.e2e
  : > "$TEST_DIR/stdin"
  window --import "$TEST_DIR/proj/.env" --import "$TEST_DIR/proj/.env.e2e"
  assert_contains "$SCREEN" "From $TEST_DIR/proj/.env, stage default:
    A → proj (A)
    G → proj (G)"
  assert_contains "$SCREEN" "From $TEST_DIR/proj/real/vals.env, stage e2e:
    B → proj (B.e2e)"
  assert_not_contains "$SCREEN" '.env.e2e'
}

test_window_reads_the_shown_file() {
  sw_repo
  printf 'G=val-g-other\n' > other.env
  printf 'G=val-g-shown\n' > shown.env
  ln -s shown.env .env.e2e
  window_bg --import "$TEST_DIR/proj/.env.e2e"
  window_wait 'Press Enter'
  ln -sfn other.env .env.e2e
  printf '\n' >&5
  window_end
  assert_eq ok "$(first_line "$RESULT")" "result"
  assert_eq val-g-shownx "$(stored proj G.e2e)"
}

test_window_import_unreadable() {
  sw_repo
  mkdir adir
  ln -s nowhere.env dangling.env
  for _p in missing.env adir dangling.env; do
    window --import "$TEST_DIR/proj/$_p"
    assert_eq "failed: cannot read $TEST_DIR/proj/$_p" "$(first_line "$RESULT")" "$_p"
    assert_not_contains "$SCREEN" 'Press Enter' "$_p"
  done
  window --import "$TEST_DIR/proj/$(printf 'a\033[2Jb.env')"
  assert_eq 'failed: an import path holds a control character' "$(first_line "$RESULT")"
  assert_eq '' "$(op_log)" "op calls"
}

test_window_repeated_name() {
  sw_repo
  printf 'A=val-a-other\n' > .env.local
  ln -s .env.local link.env
  window --import "$TEST_DIR/proj/.env" --import "$TEST_DIR/proj/link.env"
  assert_eq "failed: A is in $TEST_DIR/proj/.env and $TEST_DIR/proj/.env.local for the same stage. Keep one." \
    "$(first_line "$RESULT")"
  assert_not_contains "$SCREEN" 'Press Enter'
  assert_eq '' "$(op_log)" "op calls"
}

test_window_token_item_readback() {
  sw_repo
  export FAKE_OP_READ_CHANGE=proj
  window --import "$TEST_DIR/proj/.env"
  assert_eq 'failed: token not stored' "$(first_line "$RESULT")"
  assert_contains "$(op_log)" 'read --cache=false op://agent-tokens/proj/password'
  assert_contains "$SCREEN" 'Delete proj-agent on 1password.com'
  assert_eq '' "$(sec_log)" "Keychain calls"
}

test_window_token_store_fails() {
  sw_repo
  export FAKE_OP_FAIL_MATCH='item create --vault agent-tokens'
  window --import "$TEST_DIR/proj/.env"
  assert_eq 'failed: token not stored' "$(first_line "$RESULT")"
  assert_eq 2 "$(op_log | grep -c '^item create --vault agent-tokens')" "tries"
  assert_contains "$SCREEN" 'Delete proj-agent on 1password.com'
  assert_contains "$RESULT" 'Delete proj-agent on 1password.com'
  assert_eq '' "$(sec_log)" "Keychain calls"
  assert_not_contains "$(op_log)" 'item create --vault proj '
}

test_window_mismatch() {
  sw_repo
  export FAKE_OP_READ_CHANGE=A
  window --import "$TEST_DIR/proj/.env"
  assert_contains "$SCREEN" 'secrets: A mismatch'
  assert_contains "$SCREEN" 'secrets: G match'
  assert_eq 'failed: mismatch' "$(first_line "$RESULT")"
  assert_eq signout "$(op_log | sed -n '$p')" "last op call"
}

test_window_signout_on_error() {
  sw_repo
  export FAKE_OP_FAIL_AFTER=1
  window --import "$TEST_DIR/proj/.env"
  assert_eq 'failed: 1Password is not reachable. Check the network, then try again.' "$(first_line "$RESULT")"
  assert_eq signout "$(op_log | sed -n '$p')" "last op call"
}

test_window_no_account() {
  sw_repo
  export FAKE_OP_FAIL=noaccount
  window --import "$TEST_DIR/proj/.env"
  assert_eq 'failed: no account found' "$(first_line "$RESULT")"
  assert_contains "$RESULT" '"Integrate with 1Password CLI"'
  assert_contains "$RESULT" '"Data shared by 1Password and affiliated apps"'
  assert_contains "$SCREEN" '"Integrate with 1Password CLI"'
  assert_eq "$(printf '%s\n' 'vault list --format json' signout)" "$(op_log)" "op calls"
  assert_not_contains "$RESULT" 'SECRETS_OP_ACCOUNT'
  export SECRETS_OP_ACCOUNT=account9.example.invalid
  window --import "$TEST_DIR/proj/.env"
  assert_contains "$RESULT" 'check that SECRETS_OP_ACCOUNT (account9.example.invalid) names an account of this Mac'
}

test_window_keychain_readback() {
  sw_repo
  export FAKE_SEC_TRUNCATE=10
  window --import "$TEST_DIR/proj/.env"
  assert_eq 'failed: keychain mismatch' "$(first_line "$RESULT")"
  assert_not_contains "$SCREEN" 'keychain match'
}

test_window_interrupt_at_enter() {
  sw_repo
  window_bg --import "$TEST_DIR/proj/.env"
  window_wait 'Press Enter'
  kill -INT "-$W_PID"
  window_end
  assert_eq 130 "$RC" "exit"
  assert_eq 'failed: cancelled' "$RESULT"
  assert_eq '' "$(op_log)" "op calls"
  assert_eq '' "$(ls "$TMPDIR")" "temp folders"
}

test_window_closed_signs_out() {
  sw_repo
  mkdir -p "$FAKE_OP_DIR/vaults/Proj"
  window_bg --import "$TEST_DIR/proj/.env"
  window_wait 'Press Enter'
  printf '\n' >&5
  window_wait 'Type yes'
  kill -HUP "-$W_PID"
  window_end
  assert_eq 129 "$RC" "exit"
  assert_eq 'failed: the window was closed' "$RESULT"
  assert_eq signout "$(op_log | sed -n '$p')" "last op call"
  assert_not_contains "$(op_log)" create
  assert_eq '' "$(ls "$TMPDIR")" "temp folders"
}

test_window_reads_each_file_once() {
  sw_repo
  printf 'G=val-g-other\n' > other.env
  printf 'G=val-g-shown\n' > shown.env
  ln -s shown.env .env.e2e
  window_bg --import "$TEST_DIR/proj/.env.e2e"
  window_wait 'Press Enter'
  rm shown.env
  ln -s other.env shown.env
  printf '\n' >&5
  window_end
  assert_eq ok "$(first_line "$RESULT")" "result"
  assert_eq val-g-shownx "$(stored proj G.e2e)" "the resolved file was replaced after the screen"
  rm "$TEST_DIR/enter"
  window_bg --import "$TEST_DIR/proj/.env"
  window_wait 'Press Enter'
  printf 'NEW=val-new-long\n' >> .env
  printf '\n' >&5
  window_end
  assert_eq ok "$(first_line "$RESULT")" "result after a line was added"
  assert_eq val-a-longx "$(stored proj A)"
  [ ! -e "$FAKE_OP_DIR/vaults/proj/NEW.value" ] || fail "a line added after the screen was stored"
}

test_window_no_interrupt_around_token_store() {
  sw_repo
  export FAKE_OP_FAIL_MATCH='item create --vault agent-tokens'
  window_bg --import "$TEST_DIR/proj/.env"
  window_wait 'Press Enter'
  printf '\n' >&5
  window_wait 'secrets: 1Password is not reachable'
  kill -INT "-$W_PID" || fail "the window ended before the interrupt"
  window_end
  assert_eq 1 "$RC" "exit"
  assert_eq 'failed: token not stored' "$(first_line "$RESULT")"
  assert_contains "$RESULT" 'Delete proj-agent on 1password.com'
  assert_eq 2 "$(op_log | grep -c '^item create --vault agent-tokens')" "tries"
}

test_window_trace_prints_no_value() {
  sw_repo
  printf 'S=SENTINEL-7f3a\nG=SENTINEL-7f3a-g\n' > .env
  printf '\n' > "$TEST_DIR/stdin"
  sh -x "$PLUGIN_DIR/libexec/setup-window.sh" "$TEST_DIR/proj" "$TEST_DIR/res/result" proj \
    --import "$TEST_DIR/proj/.env" --guard G < "$TEST_DIR/stdin" > "$TEST_DIR/screen" 2>&1
  assert_eq ok "$(first_line "$(cat "$TEST_DIR/res/result")")" "sh -x (screen: $(cat "$TEST_DIR/screen"))"
  _all=$(cat "$TEST_DIR/screen")
  _first=$_all
  rm -rf "$TEST_DIR/res/result" "$FAKE_OP_DIR/vaults" "$FAKE_OP_DIR/tokens" "$FAKE_SEC_DIR/items"
  env SHELLOPTS=xtrace sh "$PLUGIN_DIR/libexec/setup-window.sh" "$TEST_DIR/proj" "$TEST_DIR/res/result" proj \
    --import "$TEST_DIR/proj/.env" --guard G < "$TEST_DIR/stdin" > "$TEST_DIR/screen" 2>&1
  assert_eq ok "$(first_line "$(cat "$TEST_DIR/res/result")")" "SHELLOPTS (screen: $(cat "$TEST_DIR/screen"))"
  _all=$_all$(cat "$TEST_DIR/screen")
  assert_not_contains "$_all" SENTINEL-7f3a "a value"
  assert_not_contains "$_all" ops_fake_ "the token"
  assert_contains "$_first" "+ set +x" "the trace was on"
}

test_window_no_value_printed() {
  sw_repo
  printf 'S=SENTINEL-7f3a\nG=SENTINEL-7f3a-g\n' > .env
  assert_status 0 secrets setup proj --import .env --guard G
  assert_eq SENTINEL-7f3ax "$(stored proj S)" "import"
  assert_contains "$OUT" 'secrets: stored in proj: S' "the result reached the agent"
  assert_not_contains "$OUT$ERR" SENTINEL-7f3a "agent stdout and stderr"
  assert_not_contains "$OUT$ERR" ops_fake_ "agent stdout and stderr: the token"
  assert_contains "$(cat "$SHIM_LOG")" 'jq -Rsc --arg title S ' "the shim log"
  for _f in "$FAKE_OPEN_DIR/window.log" "$FAKE_OPEN_DIR/launched" "$FAKE_OP_DIR/argv.log" \
    "$FAKE_SEC_DIR/argv.log" "$SHIM_LOG"; do
    [ -s "$_f" ] || fail "$_f is empty"
    assert_not_contains "$(cat "$_f")" SENTINEL-7f3a "$_f"
    assert_not_contains "$(cat "$_f")" ops_fake_ "$_f: the token"
  done
}
