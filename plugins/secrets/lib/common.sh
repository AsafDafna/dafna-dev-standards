# shellcheck shell=sh
# Shared functions of the secrets command. Results go to stdout. A failure prints one
# "secrets: ..." line to stderr and exits 1; inside $(...) that exit ends only the
# subshell, so call a printing function as `x=$(f) || exit 1`.

secrets_tab=$(printf '\t')

secrets_die() {
  printf 'secrets: %s\n' "$1" >&2
  exit 1
}

secrets_lower() {
  printf '%s' "$1" | LC_ALL=C tr '[:upper:]' '[:lower:]'
}

secrets_repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || printf '%s\n' "$PWD"
}

# The folder name of the main checkout, also inside a git worktree.
secrets_main_name() {
  if _mn_dir=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null); then
    _mn_dir=${_mn_dir%/}
    _mn_dir=${_mn_dir%/*}
  else
    _mn_dir=$PWD
  fi
  _mn_name=$(secrets_lower "${_mn_dir##*/}")
  secrets_check project "$_mn_name"
  printf '%s\n' "$_mn_name"
}

# secrets_valid KIND VALUE: success when VALUE is a valid KIND (project, stage or name).
# The letter lists are spelled out: a range such as [a-z] can follow the locale.
secrets_valid() {
  case $1:${2-} in
    project:agent-tokens | project:agent-shared | project:*-guarded | stage:guarded) return 1 ;;
    project:* | stage:*)
      case ${2-} in
        '' | [!abcdefghijklmnopqrstuvwxyz0123456789]* | *[!abcdefghijklmnopqrstuvwxyz0123456789-]*) return 1 ;;
      esac ;;
    name:*)
      case ${2-} in
        '' | [!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_]* | \
          *[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_]*) return 1 ;;
      esac ;;
    *) return 1 ;;
  esac
}

secrets_check() {
  secrets_valid "$1" "${2-}" && return 0
  _ck_kind=$1
  [ "$_ck_kind" != name ] || _ck_kind=secret
  secrets_die "\"${2-}\" is not a valid $_ck_kind name"
}

secrets_refs_file() { # STAGE ("" = default) GUARDED (0 or 1)
  _rf_name=.secrets-refs
  [ -z "$1" ] || _rf_name=$_rf_name.$1
  [ "$2" != 1 ] || _rf_name=$_rf_name.guarded
  printf '%s\n' "$_rf_name"
}

# secrets_refs_read FILE: prints NAME<TAB>VAULT<TAB>TITLE per ref. It prints nothing
# when a line is bad, so a caller never acts on half a file.
secrets_refs_read() {
  if [ ! -f "$1" ]; then
    case $1 in */*) _rr_dir=${1%/*} ;; *) _rr_dir=$PWD ;; esac
    secrets_die "no ${1##*/} in $_rr_dir"
  fi
  _rr_out=''
  _rr_n=0
  while IFS= read -r _rr_line || [ -n "$_rr_line" ]; do
    _rr_n=$((_rr_n + 1))
    _rr_trim=${_rr_line#"${_rr_line%%[![:blank:]]*}"}
    case $_rr_trim in '' | '#'*) continue ;; esac
    _rr_name=${_rr_line%%=*}
    _rr_ref=${_rr_line#*=}
    _rr_path=${_rr_ref#op://}
    _rr_path=${_rr_path%/password}
    _rr_vault=${_rr_path%%/*}
    _rr_title=${_rr_path#*/}
    _rr_ok=1
    case $_rr_ref in op://*/*/password) ;; *) _rr_ok='' ;; esac
    case $_rr_path in /* | */ | */*/*) _rr_ok='' ;; esac
    case $_rr_line in *"$secrets_tab"*) _rr_ok='' ;; esac
    secrets_valid name "$_rr_name" || _rr_ok=''
    [ -n "$_rr_ok" ] || secrets_die "${1##*/} line $_rr_n is not NAME=op://vault/title/password"
    _rr_out=$_rr_out$_rr_name$secrets_tab$_rr_vault$secrets_tab$_rr_title'
'
  done < "$1"
  printf '%s' "$_rr_out"
}

# secrets_project ROOT: the project vault named in the refs files, else the main checkout name.
secrets_project() {
  for _pj_file in "$1/.secrets-refs" "$1"/.secrets-refs.*; do
    [ -f "$_pj_file" ] || continue
    _pj_refs=$(secrets_refs_read "$_pj_file") || exit 1
    while IFS=$secrets_tab read -r _ _pj_vault _; do
      [ -n "$_pj_vault" ] || continue
      _pj_vault=$(secrets_lower "$_pj_vault")
      [ "$_pj_vault" != agent-shared ] || continue
      secrets_check project "$_pj_vault"
      printf '%s\n' "$_pj_vault"
      return 0
    done <<EOF
$_pj_refs
EOF
  done
  secrets_main_name
}

secrets_token() { # PROJECT
  _tk_value=$(security find-generic-password -a secrets -s "op-sa-$1" -w 2>/dev/null)
  [ -n "$_tk_value" ] || secrets_die "no token for $1 on this Mac. Run: secrets setup $1"
  printf '%s\n' "$_tk_value"
}

# secrets_keychain_put PROJECT: reads the token on stdin. It goes to security on stdin
# as well (security -i), so it never shows in a process list.
secrets_keychain_put() {
  secrets_check project "$1"
  _kp_token=$(cat)
  case $_kp_token in
    '' | *[[:space:]\"\'\\]*) secrets_die "the token for $1 is empty or has a space, a quote or a backslash" ;;
  esac
  printf 'add-generic-password -U -a secrets -s op-sa-%s -w %s\n' "$1" "$_kp_token" | security -i >/dev/null
}

# secrets_op_fail STDERR PROJECT: dies with the failure line for this op error text.
secrets_op_fail() {
  case $1 in
    *'connection refused'* | *'dial tcp'* | *'no such host'* | *'i/o timeout'*)
      secrets_die '1Password is not reachable. Check the network, then try again.' ;;
    *'(429)'* | *'Too Many Requests'*)
      secrets_die 'the 1Password request limit is reached. Wait, then try again.' ;;
    *DecodeSACredentials* | *'(401)'* | *Unauthorized*)
      secrets_die "the token for $2 does not work. Run: secrets setup $2, with --renew if the owner revoked it" ;;
  esac
  _of_line=${1%%'
'*}
  case $_of_line in
    '[ERROR] '[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9]' '[0-9][0-9]:[0-9][0-9]:[0-9][0-9]' '*)
      _of_line=${_of_line#'[ERROR] '????/??/??' '??:??:??' '} ;;
  esac
  secrets_die "op failed: $_of_line"
}

# secrets_titles VAULT: one title per line, with the sign-in this process has. Set
# secrets_proj to the project first: the invalid-token line names it, and VAULT can be
# agent-shared.
secrets_titles() {
  _ti_err=$(mktemp) || secrets_die "cannot make a temp file in ${TMPDIR:-/tmp}"
  _ti_json=$(op item list --vault "$1" --format json 2>"$_ti_err")
  _ti_rc=$?
  _ti_msg=$(cat "$_ti_err")
  rm -f "$_ti_err"
  [ "$_ti_rc" -eq 0 ] || secrets_op_fail "$_ti_msg" "${secrets_proj:-$1}"
  printf '%s\n' "$_ti_json" | jq -r '.[].title'
}
