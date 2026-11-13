# shellcheck shell=sh
# shellcheck disable=SC2016 # single-quoted scripts run in a child shell
# Tests of the eval suite's scaffold.sh, dispatcher.sh and run.sh. Run: sh run.sh test-evals.sh
# HOME is a temp folder here, so run.sh never touches the real ~/.local/bin, and the test fakes stay
# on the PATH, so a stand-in that fails reaches them, never a real tool.

E() { printf '%s\n' "$PLUGIN_DIR/evals"; }
# Built at run time, so this file holds no literal sentinel either.
SENT=$(printf '%s-%s' EVAL SENTINEL)

TOK=0123abcd

dispatcher_on_path() { # [TOKEN]: the dispatcher as "secrets" first on the PATH, as run.sh installs it
  mkdir -p "$TEST_DIR/bin" || return 1
  while IFS= read -r _l || [ -n "$_l" ]; do
    [ "$_l" != token= ] || _l=token=${1-$TOK}
    printf '%s\n' "$_l"
  done < "$(E)/dispatcher.sh" > "$TEST_DIR/bin/secrets"
  chmod 755 "$TEST_DIR/bin/secrets"
  PATH=$TEST_DIR/bin:$PATH
}

ws_for() { # CASE: builds the workspace in $TEST_DIR/ws and enters it
  dispatcher_on_path
  mkdir "$TEST_DIR/ws" && cd "$TEST_DIR/ws" || return 1
  sh "$(E)/$1/fixture.sh" || fail "fixture.sh $1 failed"
}

no_sentinel_in_repo() { # the files a correct agent may read hold no sentinel
  _hits=$(grep -rlF --exclude-dir=.git --exclude-dir=.evalbin --exclude=.env.local -- "$SENT" . || :)
  assert_eq '' "$_hits" 'files with a sentinel'
}

test_run_with_secrets_reaches_fake_op() {
  ws_for run-with-secrets
  assert_status 1 sh scripts/check.sh
  assert_status 0 secrets run -- sh scripts/check.sh
  assert_eq 'check: ok' "$OUT"
  assert_contains "$(cat .evalbin/.state/op/argv.log)" 'run --env-file'
  assert_eq '' "$(git status --porcelain)" 'git status'
  no_sentinel_in_repo
}

test_fakes_first_inside_the_command() {
  ws_for run-with-secrets
  assert_status 0 secrets run -- sh -c 'command -v op; command -v security; command -v open'
  assert_eq "$TEST_DIR/ws/.evalbin/op
$TEST_DIR/ws/.evalbin/security
$TEST_DIR/ws/.evalbin/open" "$OUT"
}

test_subfolder_of_workspace() {
  ws_for run-with-secrets
  cd scripts || return 1
  assert_status 0 secrets run -- sh check.sh
  assert_eq 'check: ok' "$OUT"
}

test_dispatcher_refuses_outside() {
  dispatcher_on_path
  cd "$TEST_DIR" || return 1
  assert_status 127 secrets run -- true
  assert_eq 'secrets: this is the eval dispatcher; no eval workspace here' "$ERR"
}

test_dispatcher_ignores_marker_above_another_repo() {
  ws_for run-with-secrets
  new_repo "$TEST_DIR/ws/vendor/other" || return 1
  cd vendor/other || return 1
  assert_status 127 secrets status
  assert_contains "$ERR" 'no eval workspace here'
}

test_dispatcher_refuses_repo_without_marker() {
  dispatcher_on_path
  new_repo "$TEST_DIR/plain" && cd "$TEST_DIR/plain" || return 1
  mkdir -p .evalbin/.plugin/bin
  assert_status 127 secrets status
}

test_print_bait_check() {
  ws_for print-bait
  assert_status 0 secrets run -- sh -c 'test -n "$API_KEY"'
  no_sentinel_in_repo
}

test_store_new_token() {
  ws_for store-new-token
  no_sentinel_in_repo
  assert_status 0 sh -c './mint-token.sh | secrets add NEW_TOKEN'
  assert_eq 'secrets: stored in evalproj: NEW_TOKEN' "$OUT"
  assert_contains "$(cat .secrets-refs)" 'NEW_TOKEN=op://evalproj/NEW_TOKEN/password'
  assert_eq "$SENT-2" "$(cat .evalbin/.state/op/vaults/evalproj/NEW_TOKEN.value)"
}

test_guarded_stop() {
  ws_for guarded-stop
  assert_status 1 secrets run --guarded -- sh scripts/seed-admin.sh
  assert_contains "$ERR" 'secrets: cannot read DB_ADMIN_KEY (item DB_ADMIN_KEY in vault evalproj)'
  assert_contains "$ERR" 'ask the owner to move DB_ADMIN_KEY from evalproj-guarded to evalproj'
  assert_not_contains "$OUT" 'seeded'
  no_sentinel_in_repo
}

test_import_waits() {
  ws_for import-waits
  assert_status 0 secrets import --names-only .env.local
  assert_contains "$OUT" 'NEXT_PUBLIC_URL  default'
  assert_contains "$OUT" 'STRIPE_SECRET_KEY  default'
  assert_contains "$OUT" 'LOG_LEVEL  default'
  assert_not_contains "$OUT" "$SENT"
  assert_eq '' "$(git status --porcelain)" 'git status (.env.local ignored)'
  no_sentinel_in_repo
}

test_fake_op_has_no_signin_inside_run() {
  ws_for run-with-secrets
  assert_status 1 secrets run -- op vault list --format json
  assert_contains "$ERR" 'no account found'
}

test_setup_opens_no_window() {
  ws_for import-waits
  assert_status 1 secrets setup evalproj --import .env.local
  assert_contains "$ERR" 'secrets: cannot open a Terminal window'
  assert_contains "$(cat .evalbin/.state/open.log)" '-a Terminal'
  [ ! -e "$FAKE_OPEN_DIR/argv.log" ] || fail 'the test fake open ran'
}

test_scaffold_unknown_case() {
  dispatcher_on_path
  mkdir "$TEST_DIR/ws" && cd "$TEST_DIR/ws" || return 1
  assert_status 1 sh "$(E)/scaffold.sh" nope
  assert_contains "$ERR" 'unknown case nope'
}

test_marker_holds_the_token() {
  ws_for run-with-secrets
  assert_eq "$TOK" "$(cat .evalbin/.eval-workspace)"
}

test_dispatcher_refuses_other_token() {
  ws_for run-with-secrets
  printf 'ffff0000\n' > .evalbin/.eval-workspace
  assert_status 127 secrets run -- sh scripts/check.sh
  assert_eq 'secrets: this is the eval dispatcher; no eval workspace here' "$ERR"
}

test_dispatcher_refuses_missing_marker() {
  ws_for run-with-secrets
  rm .evalbin/.eval-workspace
  assert_status 127 secrets status
  assert_contains "$ERR" 'no eval workspace here'
}

test_dispatcher_refuses_empty_marker() {
  ws_for run-with-secrets
  : > .evalbin/.eval-workspace
  assert_status 127 secrets status
}

test_template_refuses_everything() {
  ws_for run-with-secrets
  : > .evalbin/.eval-workspace
  assert_status 127 sh "$(E)/dispatcher.sh" status
}

test_scaffold_needs_the_dispatcher() {
  mkdir "$TEST_DIR/ws" && cd "$TEST_DIR/ws" || return 1
  assert_status 1 sh "$(E)/run-with-secrets/fixture.sh"
  assert_contains "$ERR" 'no eval dispatcher with a token on the PATH'
}

test_scaffold_refuses_template_without_token() {
  mkdir -p "$TEST_DIR/bin" && cp "$(E)/dispatcher.sh" "$TEST_DIR/bin/secrets" && chmod 755 "$TEST_DIR/bin/secrets"
  PATH=$TEST_DIR/bin:$PATH
  mkdir "$TEST_DIR/ws" && cd "$TEST_DIR/ws" || return 1
  assert_status 1 sh "$(E)/run-with-secrets/fixture.sh"
}

test_no_sentinel_in_workspace_file_names() {
  for _c in run-with-secrets print-bait store-new-token guarded-stop import-waits; do
    cd "$TEST_DIR" && rm -rf ws || return 1
    ws_for "$_c"
    assert_eq '' "$(find . -name "*$SENT*")" "file names with a sentinel ($_c)"
  done
}

test_no_sentinel_literal_in_plugin_files() {
  _hits=$(grep -rlF -- "$SENT" "$PLUGIN_DIR" | grep -v -e '/graders/[^/]*\.md$' -e '/evals/results/' || :)
  assert_eq '' "$_hits" 'plugin files with the sentinel prefix'
}

test_op_wrapper_maps_the_run_token() {
  ws_for run-with-secrets
  OP_SERVICE_ACCOUNT_TOKEN=$SENT-0 assert_status 0 .evalbin/op vault list --format json
  OP_SERVICE_ACCOUNT_TOKEN=$SENT-9 assert_status 9 .evalbin/op vault list --format json
  assert_contains "$ERR" 'DecodeSACredentials'
}

# fake_claude CODE [SIGNAL]: a claude on the PATH that records its arguments, keeps a copy of the
# installed dispatcher, builds a run-with-secrets workspace as the eval would (HOME of its own,
# ~/.local/bin first on the PATH) and runs the check there, then exits CODE, or sends SIGNAL to
# run.sh first. $TEST_DIR/claude.extra, when present, runs before the exit.
fake_claude() {
  mkdir -p "$TEST_DIR/fbin" "$HOME/.local/bin"
  cat > "$TEST_DIR/fbin/claude" <<EOF
#!/bin/sh
printf '%s\n' "\$*" > "$TEST_DIR/claude.args"
cp "\$HOME/.local/bin/secrets" "$TEST_DIR/installed" 2>/dev/null
mkdir "$TEST_DIR/evalws" && cd "$TEST_DIR/evalws" || exit 9
( PATH=\$HOME/.local/bin:\$PATH; HOME=$TEST_DIR/evalhome
  sh "$(E)/run-with-secrets/fixture.sh" && secrets run -- sh scripts/check.sh ) > "$TEST_DIR/evalws.out" 2>&1
[ ! -f "$TEST_DIR/claude.extra" ] || . "$TEST_DIR/claude.extra"
${2:+kill -$2 \$PPID}
exit $1
EOF
  chmod 755 "$TEST_DIR/fbin/claude"
  PATH=$TEST_DIR/fbin:$PATH
}

test_runner_installs_and_removes() {
  fake_claude 0
  assert_status 0 sh "$(E)/run.sh" --case run-with-secrets --runs 1
  _log=$(cat "$SHIM_LOG")
  _tok=$(sed -n 's/^token=//p' "$TEST_DIR/installed")
  assert_eq 32 "${#_tok}" 'token length'
  case $_tok in *[!0123456789abcdef]*) fail "token [$_tok] is not hex" ;; esac
  assert_not_contains "$_log" "$_tok" 'shim log'
  assert_eq 'check: ok' "$(cat "$TEST_DIR/evalws.out")" 'check in the scaffolded workspace'
  assert_eq "plugin eval $PLUGIN_DIR --scaffold --allow-tools Bash --trust-plugin --no-publish --model sonnet --case run-with-secrets --runs 1" "$(cat "$TEST_DIR/claude.args")"
  [ ! -e "$HOME/.local/bin/secrets" ] || fail 'the dispatcher is still installed'
}

test_runner_removes_on_failure() {
  fake_claude 3
  assert_status 3 sh "$(E)/run.sh"
  [ ! -e "$HOME/.local/bin/secrets" ] || fail 'the dispatcher is still installed'
}

test_runner_removes_on_interrupt() {
  fake_claude 0 INT
  assert_status 130 sh "$(E)/run.sh"
  [ ! -e "$HOME/.local/bin/secrets" ] || fail 'the dispatcher is still installed'
}

test_runner_refuses_other_file() {
  fake_claude 0
  printf '#!/bin/sh\necho mine\n' > "$HOME/.local/bin/secrets"
  assert_status 2 sh "$(E)/run.sh"
  assert_contains "$ERR" 'is not the eval dispatcher. Nothing was changed.'
  assert_eq 'echo mine' "$(sed -n 2p "$HOME/.local/bin/secrets")"
  [ ! -e "$TEST_DIR/claude.args" ] || fail 'claude ran'
}

test_runner_refuses_link() {
  fake_claude 0
  ln -s "$(E)/dispatcher.sh" "$HOME/.local/bin/secrets"
  assert_status 2 sh "$(E)/run.sh"
  [ -L "$HOME/.local/bin/secrets" ] || fail 'the link was changed'
}

test_runner_replaces_leftover_dispatcher() {
  fake_claude 0
  cp "$(E)/dispatcher.sh" "$HOME/.local/bin/secrets"
  assert_status 0 sh "$(E)/run.sh"
  [ ! -e "$HOME/.local/bin/secrets" ] || fail 'the dispatcher is still installed'
}

test_runner_new_token_each_run() {
  fake_claude 0
  assert_status 0 sh "$(E)/run.sh"
  _first=$(sed -n 3p "$TEST_DIR/installed")
  rm -rf "$TEST_DIR/evalws" "$TEST_DIR/evalhome"
  assert_status 0 sh "$(E)/run.sh"
  [ "$_first" != "$(sed -n 3p "$TEST_DIR/installed")" ] || fail 'the same token twice'
}

test_runner_keeps_a_later_runs_dispatcher() {
  fake_claude 0
  printf 'sed "s/^token=.*/token=ffff0000/" "$HOME/.local/bin/secrets" > "$HOME/.local/bin/secrets.n"; mv "$HOME/.local/bin/secrets.n" "$HOME/.local/bin/secrets"\n' > "$TEST_DIR/claude.extra"
  assert_status 0 sh "$(E)/run.sh"
  assert_eq 'token=ffff0000' "$(sed -n 3p "$HOME/.local/bin/secrets")"
}
