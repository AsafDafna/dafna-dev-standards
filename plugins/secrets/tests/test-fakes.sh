# shellcheck shell=sh
# shellcheck disable=SC2016 # single-quoted scripts run in a child shell, which expands them
# Self-checks of the fakes and shims, and of the library functions that call them.
# Run: sh run.sh test-fakes.sh

template() { # TITLE VALUE: the item JSON that op item create and op item edit read on stdin
  printf '%s' "$2" | jq -Rsc --arg title "$1" '{title: $title, category: "PASSWORD",
    fields: [{id: "password", type: "CONCEALED", purpose: "PASSWORD", label: "password", value: .}]}'
}

names_of() { printf '%s' "$1" | jq -r '[.[].name] | sort | join(" ")'; }

test_fake_op_token_scope() {
  fake_item proj A val-a
  fake_item agent-shared S val-s
  fake_item other O val-o
  fake_token tok1 proj:w agent-shared
  assert_status 0 op vault list --format json
  assert_eq 'agent-shared other proj' "$(names_of "$OUT")" "owner"
  export OP_SERVICE_ACCOUNT_TOKEN=tok1
  assert_status 0 op vault list --format json
  assert_eq 'agent-shared proj' "$(names_of "$OUT")" "token"
  assert_status 1 op item list --vault other --format json
  assert_eq "[ERROR] 2026/01/01 00:00:00 \"other\" isn't a vault in this account. Specify the vault with its ID or name." "$ERR"
  template N val-n > "$TEST_DIR/in.json"
  assert_status 1 op item create --vault agent-shared - < "$TEST_DIR/in.json"
  assert_eq '[ERROR] 2026/01/01 00:00:00 unable to process line 1: Permission: (101) You do not have permission to perform this action' "$ERR"
  assert_status 0 op item create --vault proj - < "$TEST_DIR/in.json"
  export OP_SERVICE_ACCOUNT_TOKEN=ops_unknown
  assert_status 9 op vault list
  assert_eq "[ERROR] 2026/01/01 00:00:00 failed to DecodeSACredentials: invalid character '\\u008a' looking for beginning of value" "$ERR"
}

test_fake_op_vault_case() {
  fake_item Proj A val-a
  fake_token tok1 PROJ
  assert_status 0 op read op://proj/A/password
  assert_eq val-a "$OUT"
  export OP_SERVICE_ACCOUNT_TOKEN=tok1
  assert_status 0 op item list --vault pRoJ --format json
  assert_eq A "$(printf '%s' "$OUT" | jq -r '.[].title')"
  assert_status 0 op vault get proj --format json
  assert_eq Proj "$(printf '%s' "$OUT" | jq -r .name)"
}

test_fake_op_service_account() {
  assert_status 0 op vault create proj
  assert_status 0 op vault create agent-shared
  assert_status 0 op service-account create proj-agent --vault proj:read_items,write_items \
    --vault agent-shared:read_items --raw
  assert_eq ops_fake_proj-agent "$OUT"
  template N val-n > "$TEST_DIR/in.json"
  export OP_SERVICE_ACCOUNT_TOKEN=ops_fake_proj-agent
  assert_status 0 op item create --vault proj - < "$TEST_DIR/in.json"
  assert_status 1 op item create --vault agent-shared - < "$TEST_DIR/in.json"
  assert_contains "$ERR" 'Permission: (101)'
  assert_status 1 op service-account create other-agent --vault proj:read_items --raw
  unset OP_SERVICE_ACCOUNT_TOKEN
  export FAKE_OP_ACCOUNTS=2
  assert_status 0 op account list --format json
  assert_eq 2 "$(printf '%s' "$OUT" | jq length)" "accounts"
}

test_fake_op_items() {
  template A val-one > "$TEST_DIR/one.json"
  template A val-two > "$TEST_DIR/two.json"
  assert_status 0 op vault create proj
  assert_status 0 op item create --vault proj --tags high-value - < "$TEST_DIR/one.json"
  assert_contains "$OUT" '"value": "val-one"' "create prints the value, as the real JSON output does"
  fake_item proj C val-c
  assert_status 0 op item list --vault proj --format json
  assert_eq 'A 1 high-value|C 1 ' "$(printf '%s' "$OUT" | jq -r '[.[] | "\(.title) \(.version) \(.tags // [] | join(","))"] | join("|")')"
  assert_not_contains "$OUT" val- "list holds no value"
  assert_status 0 op item list --vault proj --tags high-value --format json
  assert_eq A "$(printf '%s' "$OUT" | jq -r '.[].title')" "--tags"
  assert_status 0 op item edit A --vault proj < "$TEST_DIR/two.json"
  assert_status 0 op item list --vault proj --format json
  assert_eq 'A 2' "$(printf '%s' "$OUT" | jq -r '.[] | select(.title == "A") | "\(.title) \(.version)"')" "edit"
  assert_status 0 op read op://proj/A/password
  assert_eq val-two "$OUT"
  assert_status 0 op item create --vault proj - < "$TEST_DIR/one.json"
  assert_status 0 op item list --vault proj --format json
  assert_eq 2 "$(printf '%s' "$OUT" | jq '[.[] | select(.title == "A")] | length')" "a second create of one title"
  assert_status 1 op item edit A --vault proj < "$TEST_DIR/two.json"
  assert_contains "$ERR" 'More than one item matches "A". Try again and specify the item by its ID: '
  assert_status 0 op item delete C --vault proj
  assert_status 1 op read op://proj/C/password
  assert_eq "[ERROR] 2026/01/01 00:00:00 could not read secret 'op://proj/C/password': could not get item proj/C: \"C\" isn't an item in the \"proj\" vault. Specify the item with its UUID, name, or domain." "$ERR"
}

test_fake_op_run_stops_on_bad_ref() {
  fake_item proj A val-a
  fake_item proj D val-d '' 2
  printf '%s\n' 'A=op://proj/A/password' 'M=op://proj/M/password' > "$HOME/missing.env"
  assert_status 1 op run --env-file "$HOME/missing.env" -- sh -c ': > "$1"' sh "$HOME/started"
  assert_eq '[ERROR] 2026/01/01 00:00:00 could not resolve item UUID for item M: could not find item M in vault vault-proj' "$ERR"
  [ ! -e "$HOME/started" ] || fail "run started CMD despite a missing item"
  printf '%s\n' 'D=op://proj/D/password' > "$HOME/dup.env"
  assert_status 1 op run --env-file "$HOME/dup.env" -- sh -c ': > "$1"' sh "$HOME/started"
  assert_eq "$(printf '%s\n\t%s\n\t%s' \
    '[ERROR] 2026/01/01 00:00:00 could not resolve item UUID for item D: More than one item matches "D". Try again and specify the item by its ID: ' \
    '* for the item "D" in vault proj: item-proj-D-1' '* for the item "D" in vault proj: item-proj-D-2')" "$ERR"
  [ ! -e "$HOME/started" ] || fail "run started CMD despite a duplicate item"
}

test_fake_op_run_env_and_exit_codes() {
  fake_item proj A 'val a'
  fake_token tok1 proj
  printf '%s\n' '# names' '' 'A=op://proj/A/password' 'P=plain' > "$HOME/one.env"
  printf '%s\n' 'B=op://PROJ/A/password' > "$HOME/two.env"
  printf 'in\n' > "$TEST_DIR/stdin"
  export OP_SERVICE_ACCOUNT_TOKEN=tok1
  assert_status 0 op run --env-file "$HOME/one.env" --env-file "$HOME/two.env" -- sh -c \
    'test "$A" = "val a" && test "$P" = plain && test "$B" = "val a" && test "$OP_SERVICE_ACCOUNT_TOKEN" = tok1'
  assert_status 0 op run --env-file "$HOME/one.env" -- sh -c 'read -r x && test "$x" = in' < "$TEST_DIR/stdin"
  assert_status 7 op run --env-file "$HOME/one.env" -- sh -c 'exit 7'
  assert_status 130 op run --env-file "$HOME/one.env" -- sh -c 'exit 130'
  assert_status 255 op run --env-file "$HOME/one.env" -- sh -c 'kill -TERM $$'
}

test_fake_op_fail_knobs() {
  fake_item proj A val-a
  printf '%s\n' 'A=op://proj/A/password' > "$HOME/a.env"
  export FAKE_OP_FAIL=unreachable
  assert_status 1 op item list --vault proj
  assert_eq '[ERROR] 2026/01/01 00:00:00 Get "/api/v2/account/keysets": proxyconnect tcp: dial tcp 127.0.0.1:9: connect: connection refused' "$ERR"
  assert_status 1 op run --env-file "$HOME/a.env" -- true
  assert_contains "$ERR" '00:00:00 error initializing client: Get "/api/v2/account/keysets"'
  assert_status 0 op --version
  assert_eq 2.42.0 "$OUT"
  export FAKE_OP_FAIL=ratelimit
  assert_status 1 op vault list
  assert_contains "$ERR" '00:00:00 (429) Too Many Requests: '
  unset FAKE_OP_FAIL
  export FAKE_OP_FAIL_MATCH=agent-tokens
  assert_status 0 op item list --vault proj
  assert_status 1 op item list --vault agent-tokens
  assert_contains "$ERR" 'connection refused'
  assert_contains "$(cat "$FAKE_OP_DIR/argv.log")" 'item list --vault agent-tokens' "argv.log"
}

test_fake_security() {
  printf '%s\n' 'add-generic-password -U -a secrets -s op-sa-proj -w "tok-1"' > "$TEST_DIR/in"
  assert_status 0 security -i < "$TEST_DIR/in"
  assert_status 0 security find-generic-password -a secrets -s op-sa-proj -w
  assert_eq tok-1 "$OUT"
  assert_not_contains "$(cat "$FAKE_SEC_DIR/argv.log")" tok-1 "argv.log"
  assert_status 45 security add-generic-password -a secrets -s op-sa-proj -w x
  assert_status 44 security find-generic-password -a secrets -s op-sa-none -w
  assert_eq 'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.' "$ERR"
}

test_fake_open() {
  printf '%s\n' '#!/bin/sh' 'pwd > "$HOME/where"' 'echo window text' \
    'if IFS= read -r a; then printf "%s|" "$a" > "$HOME/got"; else printf EOF > "$HOME/got"; fi' > "$TEST_DIR/w.command"
  chmod 600 "$TEST_DIR/w.command"
  assert_status 1 open -a Terminal "$TEST_DIR/w.command"
  [ ! -e "$HOME/where" ] || fail "open ran a file without the execute bit"
  chmod 700 "$TEST_DIR/w.command"
  assert_status 0 open -a Terminal "$TEST_DIR/w.command"
  assert_eq '' "$OUT" "the window output does not reach the caller"
  assert_eq "$HOME" "$(cat "$HOME/where")" "the window starts in HOME"
  assert_eq '|' "$(cat "$HOME/got")" "default stdin: one empty line"
  assert_eq 'window text' "$(cat "$FAKE_OPEN_DIR/window.log")"
  export FAKE_OPEN_STDIN='yes
'
  assert_status 0 open -a Terminal "$TEST_DIR/w.command"
  assert_eq 'yes|' "$(cat "$HOME/got")"
  export FAKE_OPEN_STDIN=''
  assert_status 0 open -a Terminal "$TEST_DIR/w.command"
  assert_eq EOF "$(cat "$HOME/got")" "empty FAKE_OPEN_STDIN"
  rm "$HOME/got"
  export FAKE_OPEN_MODE=ignore
  assert_status 0 open -a Terminal "$TEST_DIR/w.command"
  [ ! -e "$HOME/got" ] || fail "ignore mode ran the file"
  assert_eq 5 "$(wc -l < "$FAKE_OPEN_DIR/argv.log" | tr -d ' ')" "argv.log lines"
}

test_shims_log_only_the_caller() {
  assert_eq "$PLUGIN_DIR/tests/shims:$PLUGIN_DIR/tests/fakes:/usr/bin:/bin:/usr/sbin:/sbin" "$PATH" "test PATH"
  assert_eq '{"a":1}' "$(printf '{"a": 1}' | jq -c .)"
  assert_eq axc "$(printf abc | sed s/b/x/)"
  fake_item proj A val-a
  op item list --vault proj > /dev/null
  assert_eq "$(printf '%s\n' 'jq -c .' 'sed s/b/x/')" "$(cat "$SHIM_LOG")" "SHIM_LOG"
}

test_titles_maps_op_errors() {
  fake_item proj A val-a
  fake_item proj B.e2e val-b
  mkdir -p "$FAKE_OP_DIR/vaults/agent-shared"
  fake_token tok1 proj:w agent-shared
  export OP_SERVICE_ACCOUNT_TOKEN=tok1
  # shellcheck disable=SC2034 # secrets_titles reads it
  secrets_proj=proj
  assert_status 0 secrets_titles proj
  assert_eq "$(printf 'A\nB.e2e')" "$OUT"
  assert_status 0 secrets_titles agent-shared
  assert_eq '' "$OUT" "an empty vault"
  assert_status 1 secrets_titles nope
  assert_eq "secrets: op failed: \"nope\" isn't a vault in this account. Specify the vault with its ID or name." "$ERR"
  export FAKE_OP_FAIL=unreachable
  assert_status 1 secrets_titles proj
  assert_eq 'secrets: 1Password is not reachable. Check the network, then try again.' "$ERR"
  export FAKE_OP_FAIL=ratelimit
  assert_status 1 secrets_titles proj
  assert_eq 'secrets: the 1Password request limit is reached. Wait, then try again.' "$ERR"
  unset FAKE_OP_FAIL
  export OP_SERVICE_ACCOUNT_TOKEN=ops_unknown
  assert_status 1 secrets_titles agent-shared
  assert_eq 'secrets: the token for proj does not work. Run: secrets setup proj, with --renew if the owner revoked it' "$ERR"
}

test_token_keychain_round_trip() {
  assert_status 1 secrets_token proj
  assert_eq 'secrets: no token for proj on this Mac. Run: secrets setup proj' "$ERR"
  printf 'ops_tok+/=-1\n' > "$TEST_DIR/token"
  assert_status 0 secrets_keychain_put proj < "$TEST_DIR/token"
  assert_status 0 secrets_token proj
  assert_eq 'ops_tok+/=-1' "$OUT"
  printf 'ops_new' > "$TEST_DIR/token"
  assert_status 0 secrets_keychain_put proj < "$TEST_DIR/token"
  assert_status 0 secrets_token proj
  assert_eq ops_new "$OUT" "replaced"
  assert_not_contains "$(cat "$FAKE_SEC_DIR/argv.log")" ops_ "the token in an argument"
  printf 'ops_a b' > "$TEST_DIR/token"
  assert_status 1 secrets_keychain_put proj < "$TEST_DIR/token"
  assert_eq 'secrets: the token for proj is empty or has a space, a quote or a backslash' "$ERR"
  assert_status 1 secrets_keychain_put My_Proj < "$TEST_DIR/token"
  assert_eq 'secrets: "My_Proj" is not a valid project name' "$ERR"
}
