# shellcheck shell=sh
# shellcheck disable=SC2016 # env lines hold a literal $ or \ that the parser must keep or refuse
# Tests of secrets import, secrets add and the env-file parser. Run: sh run.sh test-import-add.sh

secrets() { sh "$PLUGIN_DIR/bin/secrets" "$@"; }

show() { printf '%s=[%s]\n' "$1" "$2"; }

op_log() { cat "$FAKE_OP_DIR/argv.log" 2>/dev/null; }

# stored VAULT TITLE: the stored value with an x after it, so a trailing newline shows.
stored() { cat "$FAKE_OP_DIR/vaults/$1/$2.value" && printf x; }

# ia_repo: a repo "proj" with refs X, the item X and a token that reads and writes proj.
ia_repo() {
  new_repo "$TEST_DIR/proj" || return 1
  cd "$TEST_DIR/proj" || return 1
  printf 'X=op://proj/X/password\n' > .secrets-refs
  fake_item proj X val-x
  fake_token tok proj:w
  fake_keychain op-sa-proj tok
}

test_env_parse_forms() {
  cd "$TEST_DIR" || fail cd
  printf '%s\n' '# comment' '' 'export A=1' 'B="x y"' "C='q'" 'D=a=b' 'E=' 'F=v # note' \
    '  G="p # q" # note' "I='p#q'" > .env
  _want=$(printf '%s\n' 'A=[1]' 'B=[x y]' 'C=[q]' 'D=[a=b]' 'E=[]' 'F=[v]' 'G=[p # q]' 'I=[p#q]')
  assert_status 0 secrets_env_each .env show
  assert_eq "$_want" "$OUT"
  perl -pe 's/\n/\r\n/' .env > crlf.env
  assert_status 0 secrets_env_each crlf.env show
  assert_eq "$_want" "$OUT" "CRLF"
  assert_status 0 secrets import --names-only .env
  assert_contains "$OUT" 'E  (empty, skipped)'
}

test_env_parse_dollar_dies() {
  cd "$TEST_DIR" || fail cd
  printf '%s\n' 'OK=1' 'K=a$b' > .env
  assert_status 1 secrets_env_each .env show
  assert_eq 'secrets: .env line 2: uses $ or \. Fix the line, then try again.' "$ERR"
  printf '%s\n' 'K="a\nb"' > .env
  assert_status 1 secrets_env_each .env show
  assert_eq 'secrets: .env line 1: uses $ or \. Fix the line, then try again.' "$ERR"
  printf '%s\n' 'K="a\"b"' > .env
  assert_status 1 secrets_env_each .env show
  assert_eq 'secrets: .env line 1: uses $ or \. Fix the line, then try again.' "$ERR" "an escaped quote"
  for line in "H='sq\$val'" "H='sq\\val'"; do
    printf '%s\n' 'OK=1' "$line" > .env
    assert_status 1 secrets_env_each .env show
    assert_eq 'secrets: .env line 2: uses $ or \. Fix the line, then try again.' "$ERR" "$line"
    assert_eq 'OK=[1]' "$OUT" "$line"
  done
}

test_env_parse_backtick_dies() {
  cd "$TEST_DIR" || fail cd
  printf '%s\n' 'OK=1' 'K=`bq-val`' > .env
  assert_status 1 secrets_env_each .env show
  assert_eq 'secrets: .env line 2: uses backtick quotes. Fix the line, then try again.' "$ERR"
  assert_eq 'OK=[1]' "$OUT"
}

test_env_parse_hash_dies() {
  cd "$TEST_DIR" || fail cd
  for line in 'K=abc#def' 'K=#hashval' 'K=a#b # note'; do
    printf '%s\n' 'OK=1' "$line" > .env
    assert_status 1 secrets_env_each .env show
    assert_eq 'secrets: .env line 2: uses # without quotes. Fix the line, then try again.' "$ERR" "$line"
    assert_eq 'OK=[1]' "$OUT" "$line"
  done
}

test_env_parse_multiline_dies() {
  cd "$TEST_DIR" || fail cd
  printf '%s\n' 'K="abc' 'def"' > .env
  assert_status 1 secrets_env_each .env show
  assert_eq 'secrets: .env line 1: no closing quote. Fix the line, then try again.' "$ERR"
  assert_not_contains "$OUT$ERR" abc
  printf '%s\n' "K='abc" > .env
  assert_status 1 secrets_env_each .env show
  assert_eq 'secrets: .env line 1: no closing quote. Fix the line, then try again.' "$ERR" "single quote"
}

test_env_parse_cr_dies() {
  cd "$TEST_DIR" || fail cd
  for line in 'A=crval1\r\r\n' 'A=crval2\rB=crval3\r' '# note\rA=crval4\r'; do
    printf 'OK=1\n%b' "$line" > .env
    assert_status 1 secrets_env_each .env show
    assert_eq 'secrets: .env line 2: has a CR character. Fix the line, then try again.' "$ERR" "$line"
    assert_eq 'OK=[1]' "$OUT" "$line"
  done
}

test_env_parse_bad_name() {
  cd "$TEST_DIR" || fail cd
  printf '1BAD=x\n' > .env
  assert_status 1 secrets_env_each .env show
  assert_eq 'secrets: .env line 1: bad name. Fix the line, then try again.' "$ERR"
}

test_env_parse_no_equals_dies() {
  cd "$TEST_DIR" || fail cd
  printf 'A=1\nRAWSECRET123\n' > .env
  assert_status 1 secrets_env_each .env show
  assert_eq 'secrets: .env line 2: bad name. Fix the line, then try again.' "$ERR"
  assert_not_contains "$OUT$ERR" RAWSECRET123
}

test_env_parse_text_after_quote_dies() {
  cd "$TEST_DIR" || fail cd
  for line in "K='x'y" 'K="x" "y"' "K='it's'"; do
    printf '%s\n' "$line" > .env
    assert_status 1 secrets_env_each .env show
    assert_eq 'secrets: .env line 1: no closing quote. Fix the line, then try again.' "$ERR" "$line"
  done
}

test_env_repeated_name() {
  ia_repo
  printf 'A=val-1\n' > .env
  printf 'A=val-2\n' > .env.local
  assert_status 1 secrets import .env .env.local
  assert_eq 'secrets: A is in .env and .env.local for the same stage. Keep one.' "$ERR"
  assert_eq '' "$(op_log)" "op calls"
}

test_stage_of() {
  assert_status 0 secrets_stage_of .env.e2e
  assert_eq e2e "$OUT"
  assert_status 0 secrets_stage_of sub/.env.e2e
  assert_eq e2e "$OUT" "in a folder"
  assert_status 0 secrets_stage_of .env.local
  assert_eq '' "$OUT"
  assert_status 0 secrets_stage_of .env
  assert_eq '' "$OUT" ".env"
  assert_status 0 secrets_stage_of x.env:ci
  assert_eq ci "$OUT"
  assert_status 1 secrets_stage_of :guarded
  assert_eq 'secrets: "guarded" is not a valid stage name' "$ERR"
}

test_names_only() {
  cd "$TEST_DIR" || fail cd
  printf 'A=val-a-long\nB=\n' > .env
  printf 'C=val-c-long\n' > .env.e2e
  assert_status 0 secrets import --names-only .env .env.e2e
  assert_eq "$(printf '%s\n' 'A  default' 'B  (empty, skipped)' 'C  e2e')" "$OUT"
  assert_not_contains "$OUT$ERR" val-
  assert_eq '' "$(op_log)" "op calls"
}

test_names_only_marks_short() {
  cd "$TEST_DIR" || fail cd
  printf 'LOG_LEVEL=info\nKEY=12345678\n' > .env
  assert_status 0 secrets import --names-only .env
  assert_eq "$(printf '%s\n' 'LOG_LEVEL  default  (short value: masked in all output)' 'KEY  default')" "$OUT"
  assert_not_contains "$OUT" info
  assert_eq '  (short value: masked in all output)' "$(secrets_short_mark x)" "1 character"
  assert_eq '' "$(secrets_short_mark '')" "empty"
}

test_import_creates_items_and_refs() {
  ia_repo
  printf 'A=val-a\nC=\nB=val-b\n' > .env.e2e
  assert_status 0 secrets import .env.e2e
  assert_eq val-ax "$(stored proj A.e2e)"
  assert_eq val-bx "$(stored proj B.e2e)"
  [ ! -e "$FAKE_OP_DIR/vaults/proj/C.e2e.value" ] || fail "an item for the empty C"
  assert_eq "$(printf '%s\n' 'A=op://proj/A.e2e/password' 'B=op://proj/B.e2e/password')" "$(cat .secrets-refs.e2e)"
  assert_eq 'X=op://proj/X/password' "$(cat .secrets-refs)" "default refs unchanged"
  assert_eq 'secrets: stored in proj: A.e2e, B.e2e. Skipped (empty value): C' "$OUT"
}

test_import_replaces() {
  ia_repo
  printf '%s\n' '# refs' 'X=op://proj/X/password' 'A=op://agent-shared/A/password' 'Z=op://proj/Z/password' > .secrets-refs
  printf 'A=one\n' > .env
  assert_status 0 secrets import .env
  printf 'A=two\n' > .env
  assert_status 0 secrets import .env
  assert_eq twox "$(stored proj A)"
  [ ! -f "$FAKE_OP_DIR/vaults/proj/A.copies" ] || fail "a second item titled A"
  assert_contains "$(op_log)" 'item edit A --vault proj'
  assert_eq "$(printf '%s\n' '# refs' 'X=op://proj/X/password' 'A=op://proj/A/password' 'Z=op://proj/Z/password')" \
    "$(cat .secrets-refs)" "refs line replaced in place"
}

test_import_add_replace_title_case() {
  ia_repo
  fake_item proj api_key val-old
  printf 'API_KEY=val-new\n' > .env
  assert_status 0 secrets import .env
  assert_contains "$(op_log)" 'item edit API_KEY --vault proj' "import"
  printf v2 > "$TEST_DIR/in"
  assert_status 0 secrets add API_KEY < "$TEST_DIR/in"
  assert_eq 2 "$(op_log | grep -c '^item edit API_KEY --vault proj')" "add"
  assert_not_contains "$(op_log)" 'item create' "a second item"
  assert_eq v2x "$(stored proj api_key)"
}

test_import_add_refuse_guarded_title_case() {
  ia_repo
  printf 'G=op://proj/a.e2e/password\nH=op://proj/t/password\n' > .secrets-refs.guarded
  printf 'A=val-a\n' > .env.e2e
  assert_status 1 secrets import .env.e2e
  assert_eq 'secrets: A is a guarded secret. Ask the owner to change it in 1Password.' "$ERR" "import"
  printf v > "$TEST_DIR/in"
  assert_status 1 secrets add T < "$TEST_DIR/in"
  assert_eq 'secrets: T is a guarded secret. Ask the owner to change it in 1Password.' "$ERR" "add"
  assert_eq '' "$(op_log)" "op calls"
}

test_import_refuses_guarded_name() {
  ia_repo
  printf 'A=op://proj/A/password\n' > .secrets-refs.guarded
  printf 'B=val-b\nA=val-a\n' > .env
  assert_status 1 secrets import .env
  assert_eq 'secrets: A is a guarded secret. Ask the owner to change it in 1Password.' "$ERR"
  assert_eq '' "$(op_log)" "op calls"
}

test_import_refuses_guarded_title() {
  ia_repo
  printf 'G=op://proj/A.e2e/password\n' > .secrets-refs.guarded
  printf 'A=val-a\n' > .env.e2e
  assert_status 1 secrets import .env.e2e
  assert_eq 'secrets: A is a guarded secret. Ask the owner to change it in 1Password.' "$ERR"
  assert_eq '' "$(op_log)" "op calls"
}

test_import_cap() {
  ia_repo
  _i=1
  while [ "$_i" -le 51 ]; do printf 'N%s=value-%s\n' "$_i" "$_i"; _i=$((_i + 1)); done > .env
  assert_status 1 secrets import .env
  assert_eq 'secrets: .env has 51 names. import takes at most 50; use secrets setup --import.' "$ERR"
  assert_not_contains "$(op_log)" 'item create'
  # 50 values and one empty one pass the cap, so the next check (the token) stops the import.
  printf 'N1=\n' > .env.e2e
  _i=2
  while [ "$_i" -le 51 ]; do printf 'N%s=value-%s\n' "$_i" "$_i"; _i=$((_i + 1)); done >> .env.e2e
  rm "$FAKE_SEC_DIR/items/op-sa-proj"
  assert_status 1 secrets import .env.e2e
  assert_eq 'secrets: no token for proj on this Mac. Run: secrets setup proj' "$ERR" "50 values"
}

test_item_put_tags_on_replace() {
  fake_item proj A old-a high-value
  fake_item proj B old-b
  printf new-a > "$TEST_DIR/in"
  assert_status 0 secrets_item_put proj A '' 1 < "$TEST_DIR/in"
  assert_eq new-ax "$(stored proj A)"
  assert_eq high-value "$(cat "$FAKE_OP_DIR/vaults/proj/A.tags")" "a replace without TAGS keeps the tag"
  assert_contains "$(op_log)" 'item edit A --vault proj'
  assert_not_contains "$(op_log)" '--tags'
  printf new-b > "$TEST_DIR/in"
  assert_status 0 secrets_item_put proj B high-value 1 < "$TEST_DIR/in"
  assert_eq new-bx "$(stored proj B)"
  assert_eq high-value "$(cat "$FAKE_OP_DIR/vaults/proj/B.tags")" "a replace with TAGS sets the tag"
  assert_contains "$(op_log)" 'item edit B --vault proj --tags high-value'
}

test_item_put_names_project() {
  mkdir -p "$FAKE_OP_DIR/vaults/agent-tokens"
  printf v > "$TEST_DIR/in"
  export OP_SERVICE_ACCOUNT_TOKEN=ops_unknown
  assert_status 1 secrets_item_put agent-tokens proj '' 0 proj < "$TEST_DIR/in"
  assert_eq 'secrets: the token for proj does not work. Run: secrets setup proj, with --renew if the owner revoked it' "$ERR"
  assert_status 1 secrets_item_put agent-tokens proj '' 0 < "$TEST_DIR/in"
  assert_contains "$ERR" 'the token for agent-tokens does not work' "PROJECT defaults to VAULT"
}

test_import_add_duplicate_title() {
  ia_repo
  fake_item proj A val-old '' 2
  printf 'B=val-b\nA=val-a\n' > .env
  assert_status 1 secrets import .env
  assert_eq 'secrets: more than one item is titled A in vault proj. Keep one.' "$ERR"
  printf v > "$TEST_DIR/in"
  assert_status 1 secrets add A < "$TEST_DIR/in"
  assert_eq 'secrets: more than one item is titled A in vault proj. Keep one.' "$ERR" "add"
  assert_not_contains "$(op_log)" 'item create'
  assert_not_contains "$(op_log)" 'item edit'
}

test_add_stdin() {
  ia_repo
  printf v2 > "$TEST_DIR/in"
  assert_status 0 secrets add TOKEN_X < "$TEST_DIR/in"
  assert_eq v2x "$(stored proj TOKEN_X)"
  assert_eq "$(printf '%s\n' 'X=op://proj/X/password' 'TOKEN_X=op://proj/TOKEN_X/password')" "$(cat .secrets-refs)"
  assert_eq 'secrets: stored in proj: TOKEN_X' "$OUT"
  printf 'v3\n\n' | secrets add TOKEN_X > /dev/null || fail "add from a pipe"
  assert_eq v3x "$(stored proj TOKEN_X)" "trailing newlines stripped"
  [ ! -f "$FAKE_OP_DIR/vaults/proj/TOKEN_X.copies" ] || fail "a second item titled TOKEN_X"
}

test_add_stage() {
  ia_repo
  printf v2 > "$TEST_DIR/in"
  assert_status 0 secrets add TOKEN_X --stage e2e < "$TEST_DIR/in"
  assert_eq v2x "$(stored proj TOKEN_X.e2e)"
  assert_eq 'TOKEN_X=op://proj/TOKEN_X.e2e/password' "$(cat .secrets-refs.e2e)"
  assert_eq 'X=op://proj/X/password' "$(cat .secrets-refs)" "default refs unchanged"
}

test_add_empty_refused() {
  ia_repo
  assert_status 1 secrets add TOKEN_X < /dev/null
  assert_eq 'secrets: the value for TOKEN_X is empty. Nothing was stored.' "$ERR"
  printf '\n\n' > "$TEST_DIR/in"
  assert_status 1 secrets add TOKEN_X < "$TEST_DIR/in"
  assert_eq 'secrets: the value for TOKEN_X is empty. Nothing was stored.' "$ERR" "only newlines"
  assert_not_contains "$(op_log)" 'item '
  assert_eq 'X=op://proj/X/password' "$(cat .secrets-refs)" "refs unchanged"
}

test_add_refuses_guarded_name() {
  ia_repo
  printf 'G=op://proj/G/password\n' > .secrets-refs.guarded
  printf v > "$TEST_DIR/in"
  assert_status 1 secrets add G < "$TEST_DIR/in"
  assert_eq 'secrets: G is a guarded secret. Ask the owner to change it in 1Password.' "$ERR"
  printf 'H=op://proj/H.e2e/password\n' > .secrets-refs.e2e.guarded
  assert_status 1 secrets add H --stage e2e < "$TEST_DIR/in"
  assert_eq 'secrets: H is a guarded secret. Ask the owner to change it in 1Password.' "$ERR" "stage file"
  assert_eq '' "$(op_log)" "op calls"
}

test_add_refuses_guarded_title() {
  ia_repo
  printf 'G=op://Proj/T/password\nS=op://agent-shared/U/password\n' > .secrets-refs.guarded
  printf v > "$TEST_DIR/in"
  assert_status 1 secrets add T < "$TEST_DIR/in"
  assert_eq 'secrets: T is a guarded secret. Ask the owner to change it in 1Password.' "$ERR"
  assert_eq '' "$(op_log)" "op calls"
  assert_status 0 secrets add U < "$TEST_DIR/in"
  assert_eq vx "$(stored proj U)" "a guarded ref in another vault does not block"
}

test_write_error_hides_op_text() {
  ia_repo
  printf SENTINEL-7f3a > "$TEST_DIR/in"
  export FAKE_OP_FAIL=stdin FAKE_OP_FAIL_MATCH='item create'
  assert_status 1 secrets add T < "$TEST_DIR/in"
  assert_eq 'secrets: op failed: could not write item T in vault proj' "$ERR"
  assert_not_contains "$OUT$ERR" SENTINEL-7f3a
}

test_add_no_refs_uses_main_name() {
  new_repo "$TEST_DIR/myproj"
  git -C "$TEST_DIR/myproj" worktree add -q -b feature "$TEST_DIR/x-feature"
  cd "$TEST_DIR/x-feature" || fail cd
  mkdir -p "$FAKE_OP_DIR/vaults/myproj"
  fake_token tok myproj:w
  fake_keychain op-sa-myproj tok
  printf v > "$TEST_DIR/in"
  assert_status 0 secrets add K < "$TEST_DIR/in"
  assert_eq 'K=op://myproj/K/password' "$(cat .secrets-refs)"
  assert_eq vx "$(stored myproj K)"
}

test_trace_prints_no_value() {
  ia_repo
  fake_keychain op-sa-proj SENTINEL-TOKEN-9c1d
  fake_token SENTINEL-TOKEN-9c1d proj:w
  printf 'S=SENTINEL-7f3a\n' > .env
  printf SENTINEL-7f3a > "$TEST_DIR/in"
  _all=''
  assert_status 0 sh -x "$PLUGIN_DIR/bin/secrets" add T < "$TEST_DIR/in"
  _first=$ERR
  _all=$_all$OUT$ERR
  assert_status 0 sh -x "$PLUGIN_DIR/bin/secrets" import .env
  _all=$_all$OUT$ERR
  assert_status 0 sh -x "$PLUGIN_DIR/bin/secrets" import --names-only .env
  _all=$_all$OUT$ERR
  assert_status 0 env SHELLOPTS=xtrace sh "$PLUGIN_DIR/bin/secrets" add T < "$TEST_DIR/in"
  _all=$_all$OUT$ERR
  assert_status 0 env SHELLOPTS=xtrace sh "$PLUGIN_DIR/bin/secrets" import .env
  _all=$_all$OUT$ERR
  assert_status 0 env SHELLOPTS=xtrace sh "$PLUGIN_DIR/bin/secrets" import --names-only .env
  _all=$_all$OUT$ERR
  assert_eq SENTINEL-7f3ax "$(stored proj T)" "add"
  assert_not_contains "$_all" SENTINEL-7f3a "a value"
  assert_not_contains "$_all" SENTINEL-TOKEN-9c1d "the token"
  assert_contains "$_first" "+ set +x" "the trace was on"
}

test_values_never_leak() {
  ia_repo
  printf 'S=SENTINEL-7f3a\n' > .env
  printf SENTINEL-7f3a > "$TEST_DIR/in"
  assert_status 0 secrets import --names-only .env
  assert_eq 'S  default' "$OUT" "names-only"
  _all=$OUT$ERR
  assert_status 0 secrets import .env
  assert_eq SENTINEL-7f3ax "$(stored proj S)" "import"
  _all=$_all$OUT$ERR
  assert_status 0 secrets add T < "$TEST_DIR/in"
  assert_eq SENTINEL-7f3ax "$(stored proj T)" "add"
  _all=$_all$OUT$ERR
  assert_status 0 secrets run -- true
  _all=$_all$OUT$ERR
  assert_not_contains "$_all" SENTINEL-7f3a "stdout and stderr"
  assert_contains "$(cat "$SHIM_LOG")" 'jq -Rsc --arg title S ' "the shim log"
  for _f in "$FAKE_OP_DIR/argv.log" "$FAKE_SEC_DIR/argv.log" "$SHIM_LOG"; do
    [ -s "$_f" ] || fail "$_f is empty"
    assert_not_contains "$(cat "$_f")" SENTINEL-7f3a "$_f"
  done
}
