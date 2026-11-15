# shellcheck shell=sh
# Shared functions of the secrets command. Results go to stdout. A failure prints one
# "secrets: ..." line to stderr and exits 1; inside $(...) that exit ends only the
# subshell, so call a printing function as `x=$(f) || exit 1`.

secrets_tab=$(printf '\t')
secrets_cr=$(printf '\r')

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

# secrets_path_ok PATH: success when PATH holds only A-Z a-z 0-9 . _ / @ + = , ~ - and single
# spaces, and no part of it starts or ends with a space. The setup screen prints such paths, and
# any other character could draw a false line there. The C locale reads each byte as one character.
secrets_path_ok() {
  (
    LC_ALL=C
    case $1 in
      '' | *[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._/@+=,~\ -]* | \
        *'  '* | ' '* | *' ' | *' /'* | *'/ '*) exit 1 ;;
    esac
  )
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
    case $_rr_vault in
      '' | *[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-]*) _rr_ok='' ;;
    esac
    case $_rr_title in
      '' | *[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-]*) _rr_ok='' ;;
    esac
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
  _tk_rc=$?
  case $_tk_rc in
    0 | 44) ;;
    *) secrets_die "cannot read the Keychain item op-sa-$1 (security exit $_tk_rc)" ;;
  esac
  [ -n "$_tk_value" ] || secrets_die "no token for $1 on this Mac. Run: secrets setup $1"
  printf '%s\n' "$_tk_value"
}

# secrets_keychain_put PROJECT: reads the token on stdin. It goes to security on stdin
# as well (security -i), so it never shows in a process list. The stderr of security is dropped:
# it is not proven to leave out the command line, which holds the token.
secrets_keychain_put() {
  secrets_check project "$1"
  _kp_token=$(cat)
  case $_kp_token in
    '' | *[[:space:]\"\'\\]*) secrets_die "the token for $1 is empty or has a space, a quote or a backslash" ;;
  esac
  printf 'add-generic-password -U -a secrets -s op-sa-%s -w %s\n' "$1" "$_kp_token" | security -i >/dev/null 2>&1
}

# secrets_op_fail STDERR PROJECT [TEXT]: dies with the failure line for this op error text.
# An error with no known pattern gives "op failed: TEXT", or op's first line without TEXT.
secrets_op_fail() {
  case $1 in
    *'connection refused'* | *'dial tcp'* | *'no such host'* | *'i/o timeout'*)
      secrets_die '1Password is not reachable. Check the network, then try again.' ;;
    *'(429)'* | *'Too Many Requests'*)
      secrets_die 'the 1Password request limit is reached. Wait, then try again.' ;;
    *DecodeSACredentials* | *'(401)'* | *Unauthorized*)
      secrets_die "the token for $2 does not work. Run: secrets setup $2, with --renew if the owner revoked it" ;;
  esac
  [ -z "${3-}" ] || secrets_die "op failed: $3"
  _of_line=${1%%'
'*}
  case $_of_line in
    '[ERROR] '[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9]' '[0-9][0-9]:[0-9][0-9]:[0-9][0-9]' '*)
      _of_line=${_of_line#'[ERROR] '????/??/??' '??:??:??' '} ;;
  esac
  secrets_die "op failed: $_of_line"
}

# secrets_titles VAULT [PROJECT [TAG]]: one title per line, with the sign-in this process has.
# TAG lists only the items with that tag. The invalid-token line names PROJECT (default VAULT);
# pass it when VAULT is agent-shared. Callers run it inside read loops, so op gets no stdin.
secrets_titles() {
  _ti_err=$(mktemp "${TMPDIR:-/tmp}/secrets-titles.XXXXXX") || secrets_die "cannot make a temp file in ${TMPDIR:-/tmp}"
  _ti_json=$(op item list --vault "$1" ${3:+--tags "$3"} --format json --cache=false 2>"$_ti_err" </dev/null)
  _ti_rc=$?
  _ti_msg=$(cat "$_ti_err")
  rm -f "$_ti_err"
  [ "$_ti_rc" -eq 0 ] || secrets_op_fail "$_ti_msg" "${2:-$1}"
  printf '%s\n' "$_ti_json" | jq -r '.[].title'
}

# secrets_spec_file SPEC: the FILE part of FILE[:STAGE].
secrets_spec_file() {
  printf '%s\n' "${1%:*}"
}

# secrets_stage_of SPEC: STAGE when SPEC is FILE:STAGE, else <x> for a file named .env.<x>,
# else "" (the default stage, also for .env.local).
secrets_stage_of() {
  case $1 in
    *:*) _so_stage=${1##*:} ;;
    *)
      _so_stage=${1##*/}
      case $_so_stage in
        .env.local) _so_stage='' ;;
        .env.?*) _so_stage=${_so_stage#.env.} ;;
        *) _so_stage='' ;;
      esac
      [ -n "$_so_stage" ] || { echo; return 0; } ;;
  esac
  secrets_check stage "$_so_stage"
  printf '%s\n' "$_so_stage"
}

secrets_env_bad() { # REASON: for the line of secrets_env_each that it reads now
  secrets_die "$_ee_file line $_ee_n: $1. Fix the line, then try again."
}

# secrets_env_each FILE CALLBACK: calls CALLBACK NAME VALUE for each entry of the env file,
# with VALUE "" for an empty one. CALLBACK must be a shell function, so that the value is in no
# argv. A line it cannot parse dies before its callback runs; earlier lines had theirs.
secrets_env_each() {
  _ee_file=$1
  [ -f "$_ee_file" ] && [ -r "$_ee_file" ] || secrets_die "cannot read $_ee_file"
  _ee_n=0
  # The file is on fd 3, so that a program the callback starts cannot read the rest of it.
  while IFS= read -r _ee_line <&3 || [ -n "$_ee_line" ]; do
    _ee_n=$((_ee_n + 1))
    _ee_line=${_ee_line%"$secrets_cr"}
    # Before the comment test: in a file with CR-only line ends, one "line" holds several.
    case $_ee_line in *"$secrets_cr"*) secrets_env_bad 'has a CR character' ;; esac
    _ee_line=${_ee_line#"${_ee_line%%[![:blank:]]*}"}
    case $_ee_line in '' | '#'*) continue ;; esac
    case $_ee_line in
      export[[:blank:]]*)
        _ee_line=${_ee_line#export}
        _ee_line=${_ee_line#"${_ee_line%%[![:blank:]]*}"} ;;
    esac
    case $_ee_line in *=*) ;; *) secrets_env_bad 'bad name' ;; esac
    _ee_name=${_ee_line%%=*}
    secrets_valid name "$_ee_name" || secrets_env_bad 'bad name'
    _ee_raw=${_ee_line#*=}
    _ee_val=${_ee_raw#"${_ee_raw%%[![:blank:]]*}"}
    _ee_q=''
    case $_ee_val in
      \'*) _ee_q=\' ;;
      \"*) _ee_q=\" ;;
      \`*) secrets_env_bad 'uses backtick quotes' ;;
    esac
    if [ -n "$_ee_q" ]; then
      _ee_rest=${_ee_val#?}
      case $_ee_rest in *"$_ee_q"*) ;; *) secrets_env_bad 'no closing quote' ;; esac
      _ee_val=${_ee_rest%%"$_ee_q"*}
      _ee_rest=${_ee_rest#*"$_ee_q"}
      _ee_rest=${_ee_rest#"${_ee_rest%%[![:blank:]]*}"}
    else
      _ee_rest=''
      _ee_val=${_ee_raw%%[[:blank:]]#*}
      _ee_val=${_ee_val#"${_ee_val%%[![:blank:]]*}"}
      _ee_val=${_ee_val%"${_ee_val##*[![:blank:]]}"}
      case $_ee_val in *'#'*) secrets_env_bad 'uses # without quotes' ;; esac
    fi
    case $_ee_val in *'$'* | *\\*) secrets_env_bad "uses \$ or \\" ;; esac
    case $_ee_rest in '' | '#'*) ;; *) secrets_env_bad 'no closing quote' ;; esac
    "$2" "$_ee_name" "$_ee_val"
  done 3< "$_ee_file"
}

# secrets_env_check SPEC...: parses each env file, and dies when one NAME comes twice for
# one stage, in one file or across files.
secrets_env_check() {
  _ec_seen=''
  for _ec_spec do
    _ec_file=$(secrets_spec_file "$_ec_spec")
    _ec_stage=$(secrets_stage_of "$_ec_spec") || exit 1
    secrets_env_each "$_ec_file" secrets_env_seen
  done
}

secrets_env_seen() { # NAME VALUE: the callback of secrets_env_check
  _es_key="
$_ec_stage$secrets_tab$1$secrets_tab"
  case $_ec_seen in
    *"$_es_key"*)
      _es_first=${_ec_seen#*"$_es_key"}
      secrets_die "$1 is in ${_es_first%%'
'*} and $_ec_file for the same stage. Keep one." ;;
  esac
  _ec_seen=$_ec_seen$_es_key$_ec_file
}

# secrets_short_mark VALUE: op run masks every match of a value in the output, and a short
# value such as "info" also matches ordinary words, so a value of 1 to 7 characters gets this mark.
secrets_short_mark() {
  [ "${#1}" -lt 1 ] || [ "${#1}" -gt 7 ] || printf '  (short value: masked in all output)'
}

# secrets_title_count TITLE: the number of stdin lines equal to TITLE without case, as op matches
# a title. The C locale folds A-Z only, so the result does not depend on the locale.
secrets_title_count() {
  LC_ALL=C grep -Fixc -- "$1"
}

# secrets_title_exists TITLES TITLE VAULT: prints 1 when TITLES holds TITLE once, 0 when not,
# and dies when it holds TITLE more than once.
secrets_title_exists() {
  _te_n=$(printf '%s\n' "$1" | secrets_title_count "$2")
  [ "$_te_n" -le 1 ] || secrets_die "more than one item is titled $2 in vault $3. Keep one."
  printf '%s\n' "$_te_n"
}

# secrets_item_put VAULT TITLE TAGS EXISTS [PROJECT]: stores stdin, as it is, as the password of
# item TITLE. EXISTS 0 creates the item, 1 replaces its value. TAGS "" sets no tag. The
# invalid-token line names PROJECT (default VAULT); pass it when VAULT is agent-tokens or agent-shared.
secrets_item_put() {
  _ip_vault=$1
  _ip_title=$2
  _ip_project=${5:-$1}
  if [ "$4" = 1 ]; then
    set -- item edit "$2" --vault "$1" ${3:+--tags "$3"}
  else
    set -- item create --vault "$1" ${3:+--tags "$3"} -
  fi
  # op prints the stored item, value included, on stdout. Its error text is not proven free
  # of the value either, so an unknown write error gets a fixed line.
  _ip_err=$(jq -Rsc --arg title "$_ip_title" '{title: $title, category: "PASSWORD",
      fields: [{id: "password", type: "CONCEALED", purpose: "PASSWORD", label: "password", value: .}]}' |
    op "$@" 2>&1 >/dev/null) ||
    secrets_op_fail "$_ip_err" "$_ip_project" "could not write item $_ip_title in vault $_ip_vault"
}

# secrets_refs_set FILE NAME VAULT TITLE: puts the line for NAME in place of its old line,
# else at the end. The other lines keep their order.
secrets_refs_set() {
  _rs_new="$2=op://$3/$4/password"
  _rs_out=''
  _rs_done=''
  if [ -f "$1" ]; then
    while IFS= read -r _rs_line || [ -n "$_rs_line" ]; do
      case $_rs_line in
        "$2="*)
          [ -z "$_rs_done" ] || continue
          _rs_line=$_rs_new
          _rs_done=1 ;;
      esac
      _rs_out="$_rs_out$_rs_line
"
    done < "$1"
  fi
  [ -n "$_rs_done" ] || _rs_out="$_rs_out$_rs_new
"
  printf '%s' "$_rs_out" > "$1" || secrets_die "cannot write $1"
}

# secrets_refs_unset FILE NAME: removes the lines for NAME. The other lines keep their order.
# It writes FILE in every case, so a missing FILE is created empty.
secrets_refs_unset() {
  _rn_out=''
  if [ -f "$1" ]; then
    while IFS= read -r _rn_line || [ -n "$_rn_line" ]; do
      case $_rn_line in "$2="*) continue ;; esac
      _rn_out="$_rn_out$_rn_line
"
    done < "$1"
  fi
  printf '%s' "$_rn_out" > "$1" || secrets_die "cannot write $1"
}
