#!/bin/sh
# Test runner: sh run.sh [test-file...]  (default: every test-*.sh in this folder)
# Each test_* function runs in its own subshell, with a new HOME, TMPDIR, fake state
# and logs, and a PATH of only the shims, the fakes and the system folders.
#
# A test sees: PLUGIN_DIR, TEST_DIR (its own scratch folder), FAKE_OP_DIR, FAKE_SEC_DIR,
# FAKE_OPEN_DIR, SHIM_LOG, the library functions, and the helpers below.

SYS_PATH=/usr/bin:/bin:/usr/sbin:/sbin
PATH=$SYS_PATH
case $0 in */*) here=${0%/*} ;; *) here=. ;; esac
TESTS=$(cd "$here" && pwd -P) || exit 2
PLUGIN_DIR=${TESTS%/*}

for tool in git jq perl realpath; do
  command -v "$tool" >/dev/null || { printf 'run.sh: %s is not in %s\n' "$tool" "$SYS_PATH" >&2; exit 2; }
done

unset OP_SERVICE_ACCOUNT_TOKEN XDG_CONFIG_HOME GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_CONFIG_GLOBAL
for v in $(env | sed -n 's/^\(FAKE_[A-Za-z0-9_]*\)=.*/\1/p; s/^\(SECRETS_[A-Za-z0-9_]*\)=.*/\1/p'); do
  unset "$v"
done

fail() {
  [ -s "$TEST_DIR/fail" ] || printf '%s\n' "$*" > "$TEST_DIR/fail"
  exit 1
}

assert_eq() { # EXPECTED ACTUAL [WHAT]
  [ "$2" = "$1" ] || fail "${3:+$3: }expected [$1], got [$2]"
}

assert_contains() { # TEXT PART [WHAT]
  case $1 in *"$2"*) ;; *) fail "${3:+$3: }[$1] does not contain [$2]" ;; esac
}

assert_not_contains() { # TEXT PART [WHAT]
  case $1 in *"$2"*) fail "${3:+$3: }[$1] contains [$2]" ;; esac
}

# assert_status EXPECTED CMD...: runs CMD in a subshell (a library function may exit),
# with this function's stdin, and sets OUT and ERR to its stdout and stderr.
assert_status() {
  _as_want=$1
  shift
  ("$@") >"$TEST_DIR/out" 2>"$TEST_DIR/err"
  _as_got=$?
  # shellcheck disable=SC2034 # the test files read OUT
  OUT=$(cat "$TEST_DIR/out")
  ERR=$(cat "$TEST_DIR/err")
  [ "$_as_got" = "$_as_want" ] || fail "exit $_as_got, expected $_as_want: $*${ERR:+ (stderr: $ERR)}"
}

# fake_item VAULT TITLE VALUE [TAGS] [COPIES]: seeds the fake op state. COPIES > 1 makes
# that many items with this title, as two creates of one title do in the real op.
fake_item() {
  mkdir -p "$FAKE_OP_DIR/vaults/$1" || return 1
  printf '%s' "$3" > "$FAKE_OP_DIR/vaults/$1/$2.value"
  [ -z "${4-}" ] || printf '%s\n' "$4" > "$FAKE_OP_DIR/vaults/$1/$2.tags"
  [ "${5:-1}" -le 1 ] || printf '%s\n' "$5" > "$FAKE_OP_DIR/vaults/$1/$2.copies"
}

fake_token() { # TOKEN VAULT[:w]...
  _ft_token=$1
  shift
  mkdir -p "$FAKE_OP_DIR/tokens" && printf '%s\n' "$@" > "$FAKE_OP_DIR/tokens/$_ft_token"
}

fake_keychain() { # SERVICE PASSWORD
  mkdir -p "$FAKE_SEC_DIR/items" && printf '%s' "$2" > "$FAKE_SEC_DIR/items/$1"
}

new_repo() { # DIR: a git repo on branch main with one empty commit
  git init -q -b main "$1" && git -C "$1" commit -q --allow-empty -m init
}

test_names() {
  while IFS= read -r _tn_line || [ -n "$_tn_line" ]; do
    case $_tn_line in
      test_*'()'*)
        _tn_name=${_tn_line%%'('*}
        printf '%s\n' "${_tn_name%% *}"
        ;;
    esac
  done < "$1"
}

run_test() { # FILE NAME
  total=$((total + 1))
  base=$(mktemp -d "${TMPDIR:-/tmp}/secrets-test.XXXXXX") && base=$(cd "$base" && pwd -P) || exit 2
  mkdir "$base/home" "$base/tmp" "$base/op" "$base/sec" "$base/open" || exit 2
  (
    TEST_DIR=$base
    HOME=$base/home
    TMPDIR=$base/tmp
    FAKE_OP_DIR=$base/op
    FAKE_SEC_DIR=$base/sec
    FAKE_OPEN_DIR=$base/open
    SHIM_LOG=$base/shim.log
    PATH=$TESTS/shims:$TESTS/fakes:$SYS_PATH
    GIT_AUTHOR_NAME=secrets-test
    GIT_AUTHOR_EMAIL=secrets-test@example.invalid
    GIT_COMMITTER_NAME=secrets-test
    GIT_COMMITTER_EMAIL=secrets-test@example.invalid
    export TEST_DIR HOME TMPDIR FAKE_OP_DIR FAKE_SEC_DIR FAKE_OPEN_DIR SHIM_LOG PATH PLUGIN_DIR \
      GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL
    _rt_name=$2
    cd "$HOME" || exit 2
    if [ -f "$PLUGIN_DIR/lib/common.sh" ]; then
      # shellcheck source=../lib/common.sh
      . "$PLUGIN_DIR/lib/common.sh"
    fi
    # shellcheck source=/dev/null # the test file is chosen at run time
    . "$1"
    "$_rt_name"
  ) </dev/null >"$base/output" 2>&1
  st=$?
  reason=
  [ ! -s "$base/fail" ] || reason=$(cat "$base/fail")
  if [ "$st" -eq 0 ] && [ -z "$reason" ]; then
    printf 'PASS %s\n' "$2"
  else
    failed=$((failed + 1))
    printf 'FAIL %s: %s\n' "$2" "${reason:-exit $st}"
    [ ! -s "$base/output" ] || sed 's/^/    | /' "$base/output"
  fi
  chmod -R u+rwx "$base" 2>/dev/null
  rm -rf "$base"
}

[ $# -gt 0 ] || set -- "$TESTS"/test-*.sh
total=0
failed=0
for file in "$@"; do
  case $file in */*) ;; *) file=$TESTS/$file ;; esac
  [ -f "$file" ] || { printf 'run.sh: no test file %s\n' "$file" >&2; exit 2; }
  for name in $(test_names "$file"); do
    run_test "$file" "$name"
  done
done
if [ "$failed" -eq 0 ]; then
  printf 'ALL PASS (%s tests)\n' "$total"
else
  printf '%s FAILED\n' "$failed"
  exit 1
fi
