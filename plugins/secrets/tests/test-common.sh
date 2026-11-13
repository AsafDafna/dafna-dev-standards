# shellcheck shell=sh
# lib/common.sh and the dispatcher. Run: sh run.sh test-common.sh

test_project_from_refs() {
  new_repo "$HOME/other"
  printf '%s\n' '# refs' '' 'A=op://agent-shared/A/password' 'B=op://proj/B/password' > "$HOME/other/.secrets-refs"
  assert_status 0 secrets_project "$HOME/other"
  assert_eq proj "$OUT"
  assert_status 0 secrets_refs_read "$HOME/other/.secrets-refs"
  assert_eq "$(printf 'A\tagent-shared\tA\nB\tproj\tB')" "$OUT" "refs read"
}

test_project_in_worktree_subfolder() {
  new_repo "$HOME/myproj"
  printf '%s\n' 'A=op://main-vault/A/password' > "$HOME/myproj/.secrets-refs"
  git -C "$HOME/myproj" add .secrets-refs
  git -C "$HOME/myproj" commit -q -m refs
  git -C "$HOME/myproj" worktree add -q -b feature "$HOME/wt"
  printf '%s\n' 'A=op://wt-vault/A/password' > "$HOME/wt/.secrets-refs"
  git -C "$HOME/wt" commit -q -am 'refs of the branch'
  mkdir -p "$HOME/wt/sub/dir"
  cd "$HOME/wt/sub/dir" || fail "cd"
  assert_status 0 secrets_repo_root
  assert_eq "$HOME/wt" "$OUT" "repo root"
  assert_status 0 secrets_project "$OUT"
  assert_eq wt-vault "$OUT" "project"
}

test_project_from_main_folder() {
  new_repo "$HOME/myproj"
  git -C "$HOME/myproj" worktree add -q -b feature "$HOME/x-feature"
  cd "$HOME/x-feature" || fail "cd"
  assert_status 0 secrets_project "$(secrets_repo_root)"
  assert_eq myproj "$OUT"
}

test_project_folder_not_slug() {
  new_repo "$HOME/My_Proj"
  cd "$HOME/My_Proj" || fail "cd"
  assert_status 1 secrets_project "$HOME/My_Proj"
  assert_eq 'secrets: "my_proj" is not a valid project name' "$ERR"
}

test_refs_file_names() {
  assert_eq .secrets-refs "$(secrets_refs_file '' 0)"
  assert_eq .secrets-refs.e2e "$(secrets_refs_file e2e 0)"
  assert_eq .secrets-refs.guarded "$(secrets_refs_file '' 1)"
  assert_eq .secrets-refs.e2e.guarded "$(secrets_refs_file e2e 1)"
}

test_refs_bad_line() {
  printf '%s\n' 'B=op://p/B/password' '# note' 'A=op://p/A' > "$HOME/.secrets-refs"
  assert_status 1 secrets_refs_read "$HOME/.secrets-refs"
  assert_eq 'secrets: .secrets-refs line 3 is not NAME=op://vault/title/password' "$ERR"
  assert_eq '' "$OUT" "stdout for the good line before the bad one"
}

# shellcheck disable=SC2016 # the refs lines hold a literal $, which op would expand
test_refs_strict_characters() {
  for ref in 'op://p/$T/password' 'op://$V/T/password' 'op://p/${X}/password' 'op://p/a b/password' \
    'op://p/a"b/password' "op://p'x/T/password" 'op://p/a`b/password' 'op://p/a\b/password'; do
    printf 'A=%s\n' "$ref" > "$HOME/.secrets-refs"
    assert_status 1 secrets_refs_read "$HOME/.secrets-refs"
    assert_eq 'secrets: .secrets-refs line 1 is not NAME=op://vault/title/password' "$ERR" "$ref"
  done
  printf 'A=op://p-1/My_Item.v-2/password\n' > "$HOME/.secrets-refs"
  assert_status 0 secrets_refs_read "$HOME/.secrets-refs"
}

test_reserved_names() {
  for p in agent-shared agent-tokens x-guarded; do
    assert_status 1 secrets_check project "$p"
    assert_eq "secrets: \"$p\" is not a valid project name" "$ERR"
  done
  assert_status 1 secrets_check stage guarded
  assert_eq 'secrets: "guarded" is not a valid stage name' "$ERR"
  assert_status 0 secrets_check project proj
  assert_status 0 secrets_check stage e2e
}

test_unknown_subcommand() {
  assert_status 1 "$PLUGIN_DIR/bin/secrets" frob
  assert_eq 'secrets: unknown subcommand "frob". Use: setup, run, import, add, status' "$ERR"
}
