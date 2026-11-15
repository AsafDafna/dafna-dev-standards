# shellcheck shell=sh
# shellcheck disable=SC2016 # single-quoted scripts run in a child shell, which expands them
# Tests of secrets status. Run: sh run.sh test-status.sh

secrets() { sh "$PLUGIN_DIR/bin/secrets" "$@"; }

# status_repo: a repo "proj" with ref A (item A exists), a token that reads proj and
# agent-shared, and a shell that is not Terminal.app.
status_repo() {
  TERM_PROGRAM=xterm
  export TERM_PROGRAM
  new_repo "$TEST_DIR/proj" || return 1
  cd "$TEST_DIR/proj" || return 1
  printf 'A=op://proj/A/password\n' > .secrets-refs
  fake_item proj A v1
  fake_item agent-shared S v2
  fake_token tok proj agent-shared
  fake_keychain op-sa-proj tok
}

test_status_all_good() {
  status_repo
  assert_status 0 secrets status
  assert_contains "$OUT" 'secrets: A readable'
  assert_contains "$OUT" 'agent-shared readable'
}

test_status_op_version() {
  status_repo
  FAKE_OP_VERSION=2.41.9
  export FAKE_OP_VERSION
  assert_status 1 secrets status
  assert_contains "$OUT" 'FAIL: op 2.41.9'
  for _v in 2.42.0 2.100.0; do
    FAKE_OP_VERSION=$_v
    assert_status 0 secrets status
    assert_contains "$OUT" "ok: op $_v"
  done
}

test_status_two_op_copies() {
  status_repo
  mkdir "$TEST_DIR/other" || return 1
  printf '#!/bin/sh\nexit 0\n' > "$TEST_DIR/other/op"
  chmod +x "$TEST_DIR/other/op"
  PATH=$PATH:$TEST_DIR/other
  export PATH
  assert_status 1 secrets status
  assert_contains "$OUT" 'FAIL: more than one op on the PATH'
  assert_contains "$OUT" "$PLUGIN_DIR/tests/fakes/op"
  assert_contains "$OUT" "$TEST_DIR/other/op"
}

test_status_host_permission() {
  status_repo
  mkdir -p "$HOME/Library/Group Containers/2BUA8C4S2C.com.1password" || return 1
  assert_status 1 secrets status
  assert_contains "$OUT" 'FAIL: this app can list the 1Password Group Containers folder'
  chmod 000 "$HOME/Library/Group Containers/2BUA8C4S2C.com.1password"
  assert_status 0 secrets status
  assert_contains "$OUT" 'ok: this app cannot list the 1Password Group Containers folder'
}

test_status_terminal_app_skips_host_check() {
  status_repo
  mkdir -p "$HOME/Library/Group Containers/2BUA8C4S2C.com.1password" || return 1
  TERM_PROGRAM=Apple_Terminal
  assert_status 0 secrets status
  assert_not_contains "$OUT" 'FAIL'
}

test_status_names_only() {
  status_repo
  fake_item proj A SENTINEL-7f3a
  fake_item proj H SENTINEL-7f3a high-value
  printf 'G=op://proj-guarded/G/password\n' > .secrets-refs.guarded
  assert_status 0 secrets status
  assert_contains "$OUT" 'A readable'
  assert_not_contains "$OUT" SENTINEL
  assert_not_contains "$ERR" SENTINEL
  _log=$(cat "$FAKE_OP_DIR/argv.log")
  case "
$_log" in
    *'
read '* | *'
run '* | *'
item get'*) fail "op read a value: $_log" ;;
  esac
}

test_status_missing_and_guarded() {
  status_repo
  printf 'B=op://proj/B/password\n' >> .secrets-refs
  printf 'G=op://proj-guarded/G/password\n' > .secrets-refs.guarded
  assert_status 1 secrets status
  assert_contains "$OUT" 'secrets: A readable'
  assert_contains "$OUT" 'secrets: B MISSING'
  assert_contains "$OUT" 'secrets: G waits in proj-guarded'
}

test_status_title_case() {
  status_repo
  printf 'A=op://proj/a/password\n' > .secrets-refs
  assert_status 0 secrets status
  assert_contains "$OUT" 'secrets: A readable'
}

test_status_duplicate_title() {
  status_repo
  fake_item proj A v1 '' 2
  assert_status 1 secrets status
  assert_contains "$OUT" 'more than one item is titled A in vault proj'
}

test_status_guarded_moved() {
  status_repo
  printf 'G=op://proj-guarded/G/password\n' > .secrets-refs.guarded
  fake_item proj G v3
  assert_status 0 secrets status
  assert_contains "$OUT" 'secrets: G open to agents'
}

test_status_high_value_open() {
  status_repo
  fake_item proj G v3 high-value
  assert_status 0 secrets status
  assert_contains "$OUT" 'high-value: G open to agents'
  assert_not_contains "$OUT" 'high-value: A'
}

test_status_no_token() {
  status_repo
  rm "$FAKE_SEC_DIR/items/op-sa-proj"
  assert_status 1 secrets status
  assert_contains "$OUT" 'FAIL: no token for proj on this Mac. Run: secrets setup proj'
  assert_contains "$OUT" 'ok: op 2.42.0'
  assert_contains "$OUT" 'ok: one op on the PATH'
  assert_contains "$OUT" 'not checked'
  assert_not_contains "$OUT" 'A readable'
}

test_status_unreadable_shared_vault() {
  status_repo
  fake_token tok proj
  assert_status 1 secrets status
  assert_contains "$OUT" 'secrets: A readable'
  assert_contains "$OUT" 'FAIL: cannot list vault agent-shared'
}

test_status_every_line_has_prefix() {
  status_repo
  printf 'B=op://proj/B/password\n' >> .secrets-refs
  assert_status 1 secrets status
  _bad=$(printf '%s\n' "$OUT" | grep -vc '^secrets: ')
  assert_eq 0 "$_bad"
}

test_status_token_not_in_temp_files() {
  status_repo
  fake_keychain op-sa-proj SENTINEL-TOKEN-9c1d
  fake_token SENTINEL-TOKEN-9c1d proj agent-shared
  mkdir "$TEST_DIR/bin" || return 1
  cat > "$TEST_DIR/bin/cat" <<'EOF'
#!/bin/sh
for f in "$TMPDIR"/secrets-status.*/*; do
  [ -f "$f" ] && /bin/cat "$f" >> "$TEST_DIR/seen.log"
done
exec /bin/cat "$@"
EOF
  chmod +x "$TEST_DIR/bin/cat"
  PATH=$TEST_DIR/bin:$PATH
  export PATH
  assert_status 0 secrets status
  assert_contains "$OUT" 'ok: the Keychain item op-sa-proj holds a token'
  _seen=''
  [ ! -f "$TEST_DIR/seen.log" ] || _seen=$(cat "$TEST_DIR/seen.log")
  assert_not_contains "$_seen" SENTINEL-TOKEN-9c1d
}
