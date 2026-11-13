#!/bin/sh
# The setup window of `secrets setup`, the one script that runs with the owner's 1Password sign-in.
# Arguments, from the launcher: REPO_ROOT RESULT_FILE PROJECT [--import FILE[:STAGE]]...
# [--guard NAME,...]... [--renew]. Result contract: line 1 of RESULT_FILE is `ok` or
# `failed: <reason>`; each later line is a summary line (names and vaults, never a value) that
# starts with `secrets: `. The script writes RESULT_FILE.tmp and renames it, because the agent
# side polls RESULT_FILE.

w_result=${2-}
w_written=''
w_reason=''
w_op_ran=''
w_tmp=''
w_summary=''

w_write() { # LINE1: writes the result once; when its folder is gone, nobody waits for it
  [ -z "$w_written" ] || return 0
  w_written=1
  [ -n "$w_result" ] && [ -d "${w_result%/*}" ] || return 0
  { printf '%s\n%s' "$1" "$w_summary" > "$w_result.tmp" && mv -f "$w_result.tmp" "$w_result"; } 2>/dev/null
}

w_exit() {
  trap '' HUP INT TERM
  if [ -z "$w_written" ]; then
    if [ -z "$w_reason" ] && [ -n "$w_tmp" ] && [ -f "$w_tmp/reason" ]; then
      IFS= read -r w_reason < "$w_tmp/reason"
    fi
    w_reason=${w_reason%%'
'*}
    printf 'secrets: setup failed: %s\n' "${w_reason:=the setup window stopped}" >&2
    w_write "failed: $w_reason"
  fi
  if [ -n "$w_op_ran" ]; then
    if op signout >/dev/null 2>&1; then
      printf 'secrets: signed out of 1Password.\n'
    else
      printf 'secrets: op signout failed. Close this window.\n' >&2
    fi
  fi
  [ -z "$w_tmp" ] || rm -rf "$w_tmp"
}

w_fail() { # REASON
  w_reason=$1
  exit 1
}

trap w_exit EXIT
trap 'w_reason="the window was closed"; exit 129' HUP
trap 'w_reason=cancelled; exit 130' INT
trap 'w_reason=stopped; exit 143' TERM

unset OP_SERVICE_ACCOUNT_TOKEN
if [ -n "${SECRETS_OP_ACCOUNT-}" ]; then
  OP_ACCOUNT=$SECRETS_OP_ACCOUNT
  export OP_ACCOUNT
fi

w_lib=$(realpath "$0") || exit 1
# shellcheck source=../lib/common.sh
. "${w_lib%/*}/../lib/common.sh"

# The library's secrets_die, and the reason also goes to a file: inside $(...) a variable is lost.
secrets_die() {
  printf 'secrets: %s\n' "$1" >&2
  [ -z "$w_tmp" ] || { printf '%s\n' "$1" > "$w_tmp/reason"; } 2>/dev/null
  exit 1
}

w_tmp=$(mktemp -d "${TMPDIR:-/tmp}/secrets-window.XXXXXX") || w_fail 'cannot make a temp folder'

[ $# -ge 3 ] || w_fail 'the window needs REPO_ROOT RESULT_FILE PROJECT'
w_root=$1
w_project=$3
shift 3
secrets_check project "$w_project"
[ -d "$w_root" ] || w_fail "no folder $w_root"
w_specs=''
w_guards='
'
w_guarded=''
w_renew=''
while [ $# -gt 0 ]; do
  case $1 in
    --import)
      [ $# -ge 2 ] || w_fail '--import needs a file'
      case $2 in *'
'*) w_fail 'an import path cannot hold a newline' ;; esac
      w_specs="$w_specs$2
"
      shift ;;
    --guard)
      [ $# -ge 2 ] || w_fail '--guard needs names'
      w_rest=$2,
      while [ -n "$w_rest" ]; do
        secrets_check name "${w_rest%%,*}"
        w_guards="$w_guards${w_rest%%,*}
"
        w_rest=${w_rest#*,}
      done
      w_guarded=1
      shift ;;
    --renew) w_renew=1 ;;
    *) w_fail 'unknown argument' ;;
  esac
  shift
done
w_sa=$w_project-agent
[ -z "$w_renew" ] || w_sa=$w_sa-$(date +%Y%m%d%H%M)

w_note() { # TEXT: one summary line, shown now and written to the result
  printf 'secrets: %s\n' "$1"
  w_summary="${w_summary}secrets: $1
"
}

# w_specs_do CALLBACK: calls CALLBACK NAME VALUE for each entry of each import file, with w_stage
# set. CALLBACK "" runs secrets_env_check on the import files instead.
w_specs_do() {
  w_cb=$1
  IFS='
'
  set -f
  # shellcheck disable=SC2086 # one spec per line; globbing is off
  set -- $w_specs
  set +f
  unset IFS
  [ -n "$w_cb" ] || { secrets_env_check "$@"; return; }
  for w_spec do
    w_stage=$(secrets_stage_of "$w_spec") || exit 1
    secrets_env_each "$(secrets_spec_file "$w_spec")" "$w_cb"
  done
}

w_target() { # NAME: sets w_title, w_vault, w_tags and w_guard (0 or 1) for NAME in stage w_stage
  w_title=$1${w_stage:+.$w_stage}
  case $w_guards in
    *"
$1
"*) w_vault=$w_project-guarded w_tags=high-value w_guard=1 ;;
    *) w_vault=$w_project w_tags='' w_guard=0 ;;
  esac
}

w_show() { # NAME VALUE: the screen line of one entry
  w_target "$1"
  w_plan="$w_plan$1 ${2:+$w_vault/$w_title}
"
  if [ -n "$2" ]; then
    printf '  %s → %s (%s)%s\n' "$1" "$w_vault" "$w_title" "$(secrets_short_mark "$2")"
  else
    printf '  %s  (empty, skipped)\n' "$1"
  fi
}

# w_check NAME VALUE: before any write, dies when the title is in the other vault of the
# project, or twice in its own vault.
w_check() {
  w_target "$1"
  w_seen="$w_seen$1 ${2:+$w_vault/$w_title}
"
  [ -n "$2" ] || return 0
  if [ "$w_guard" = 1 ]; then
    w_other=$w_project w_theirs=$w_titles_p w_mine=$w_titles_g
  else
    w_other=$w_project-guarded w_theirs=$w_titles_g w_mine=$w_titles_p
  fi
  w_n=$(secrets_title_exists "$w_theirs" "$w_title" "$w_other") || exit 1
  [ "$w_n" = 0 ] || secrets_die "more than one item is titled $w_title in vault $w_other. Keep one."
  secrets_title_exists "$w_mine" "$w_title" "$w_vault" > /dev/null
}

w_put() { # NAME VALUE: stores one entry and sets its refs line
  if [ -z "$2" ]; then
    w_skipped="$w_skipped${w_skipped:+, }$1"
    return 0
  fi
  w_target "$1"
  case "
$w_plan" in
    *"
$1 $w_vault/$w_title
"*) ;;
    *) w_fail 'an import file changed after the screen was shown' ;;
  esac
  if [ "$w_guard" = 1 ]; then w_mine=$w_titles_g; else w_mine=$w_titles_p; fi
  w_n=$(secrets_title_exists "$w_mine" "$w_title" "$w_vault") || exit 1
  printf '%s' "$2" | secrets_item_put "$w_vault" "$w_title" "$w_tags" "$w_n" "$w_project" || exit 1
  w_file=$(secrets_refs_file "$w_stage" "$w_guard")
  secrets_refs_set "$w_root/$w_file" "$1" "$w_project" "$w_title"
  case ", $w_refs, " in *", $w_file, "*) ;; *) w_refs="$w_refs${w_refs:+, }$w_file" ;; esac
  if [ "$w_guard" = 1 ]; then
    w_stored_g="$w_stored_g${w_stored_g:+, }$w_title"
  else
    w_stored_p="$w_stored_p${w_stored_p:+, }$w_title"
  fi
}

w_verify() { # NAME VALUE: reads the item back as the owner and compares it with VALUE
  [ -n "$2" ] || return 0
  w_target "$1"
  if w_back=$(op read --cache=false -n "op://$w_vault/$w_title/password" 2>/dev/null && printf x) &&
    [ "${w_back%x}" = "$2" ]; then
    printf 'secrets: %s match\n' "$1"
  else
    printf 'secrets: %s mismatch\n' "$1"
    w_bad="$w_bad${w_bad:+, }$1"
  fi
}

w_has() { # VAULT: success when a vault of this name, in any letter case, exists
  case "
$w_vaults
" in *"
$1
"*) return 0 ;; esac
  return 1
}

w_vault_make() { # VAULT: creates it, unless it exists in any letter case
  w_has "$1" && return 0
  op vault create "$1" > /dev/null 2> "$w_tmp/err" ||
    secrets_op_fail "$(cat "$w_tmp/err")" "$w_project" "could not create vault $1"
  w_vaults="$w_vaults
$1"
  w_made="$w_made${w_made:+, }$1"
}

w_keychain() { # prints the token in the project's Keychain item; security exits 44 when there is none
  security find-generic-password -a secrets -s "op-sa-$w_project" -w 2>/dev/null
}

w_keychain_put() {
  printf '%s' "$w_token" | secrets_keychain_put "$w_project" ||
    w_fail "cannot write the Keychain item op-sa-$w_project"
  w_note "copied the token to the Keychain item op-sa-$w_project of this Mac"
}

w_plan=''
w_specs_do ''
printf 'secrets setup for project %s\n' "$w_project"
[ -z "${SECRETS_OP_ACCOUNT-}" ] || printf '  1Password account: %s\n' "$SECRETS_OP_ACCOUNT"
printf '  Vaults, each created if missing: agent-tokens, agent-shared, %s%s\n' "$w_project" \
  "${w_guarded:+, $w_project-guarded}"
if [ -n "$w_renew" ]; then
  printf '  New service account: %s\n' "$w_sa"
else
  printf '  Service account, created if agent-tokens has no item %s: %s\n' "$w_project" "$w_sa"
fi
if [ -n "$w_specs" ]; then
  printf '  Secrets, as NAME → vault (item title):\n'
  w_specs_do w_show
fi
printf 'Press Enter to sign in to 1Password with Touch ID, or Ctrl-C to cancel. '
IFS= read -r w_answer || w_fail cancelled
[ -d "${w_result%/*}" ] || w_fail 'the agent stopped waiting'

w_op_ran=1
w_json=$(op vault list --format json 2> "$w_tmp/err") || {
  w_err=$(cat "$w_tmp/err")
  case $w_err in
    *'no account found'*)
      w_note 'turn on these two settings, then start the setup again:'
      w_note '  1Password app > Settings > Developer: "Integrate with 1Password CLI"'
      w_note '  System Settings > Privacy & Security > Files & Folders > Terminal: "Data shared by 1Password and affiliated apps"'
      [ -z "${SECRETS_OP_ACCOUNT-}" ] ||
        w_note "If both are on, check that SECRETS_OP_ACCOUNT ($SECRETS_OP_ACCOUNT) names an account of this Mac."
      w_fail 'no account found' ;;
  esac
  secrets_op_fail "$w_err" "$w_project"
}
w_vaults=$(printf '%s' "$w_json" | jq -r '.[].name | ascii_downcase') || w_fail 'cannot read the vault list'
if [ -z "${SECRETS_OP_ACCOUNT-}" ]; then
  w_json=$(op account list --format json 2> "$w_tmp/err") || secrets_op_fail "$(cat "$w_tmp/err")" "$w_project"
  w_n=$(printf '%s' "$w_json" | jq length)
  case $w_n in '' | *[!0123456789]*) w_fail 'cannot read the account list' ;; esac
  if [ "$w_n" -gt 1 ]; then
    w_note "1Password has $w_n accounts on this Mac. Set SECRETS_OP_ACCOUNT for this window to the account for secrets, then start the setup again."
    w_fail 'set SECRETS_OP_ACCOUNT'
  fi
fi

w_tok_n=0
if w_has agent-tokens; then
  w_titles=$(secrets_titles agent-tokens "$w_project") || exit 1
  w_tok_n=$(secrets_title_exists "$w_titles" "$w_project" agent-tokens) || exit 1
fi
if w_has "$w_project" && [ "$w_tok_n" = 0 ]; then
  printf 'secrets: a vault named %s, in some letter case, exists, and agent-tokens has no item %s.\n' \
    "$w_project" "$w_project"
  printf 'Type yes to give service account %s read and write access to that vault: ' "$w_sa"
  IFS= read -r w_answer || w_answer=''
  [ "$w_answer" = yes ] || w_fail 'vault exists'
fi

w_made=''
w_vault_make agent-tokens
w_vault_make agent-shared
w_vault_make "$w_project"
[ -z "$w_guarded" ] || w_vault_make "$w_project-guarded"
[ -z "$w_made" ] || w_note "created vaults: $w_made"

if [ "$w_tok_n" = 0 ] || [ -n "$w_renew" ]; then
  w_token=$(op service-account create "$w_sa" --vault "$w_project:read_items,write_items" \
    --vault agent-shared:read_items --raw 2> "$w_tmp/err") ||
    secrets_op_fail "$(cat "$w_tmp/err")" "$w_project" "could not create service account $w_sa"
  w_stored=''
  if [ -n "$w_token" ]; then
    for w_try in 1 2; do
      [ "$w_try" = 1 ] || sleep 2
      if printf '%s' "$w_token" | secrets_item_put agent-tokens "$w_project" '' "$w_tok_n" "$w_project"; then
        w_stored=1
        break
      fi
    done
  fi
  if [ -z "$w_stored" ]; then
    w_note "service account $w_sa has no stored token. Delete $w_sa on 1password.com, then start the setup again."
    w_fail 'token not stored'
  fi
  rm -f "$w_tmp/reason"
  w_note "created service account $w_sa, with its token in agent-tokens"
  w_keychain_put
else
  w_token=$(op read --cache=false "op://agent-tokens/$w_project/password" 2> "$w_tmp/err") ||
    secrets_op_fail "$(cat "$w_tmp/err")" "$w_project" "could not read item $w_project in vault agent-tokens"
  [ -n "$w_token" ] || w_fail "item $w_project in vault agent-tokens is empty"
  w_kc=$(w_keychain)
  w_rc=$?
  case $w_rc in
    0 | 44) ;;
    *) secrets_die "cannot read the Keychain item op-sa-$w_project (security exit $w_rc)" ;;
  esac
  [ "$w_kc" = "$w_token" ] || w_keychain_put
fi

if [ -n "$w_specs" ]; then
  w_titles_p=$(secrets_titles "$w_project") || exit 1
  w_titles_g=''
  if w_has "$w_project-guarded"; then
    w_titles_g=$(secrets_titles "$w_project-guarded" "$w_project") || exit 1
  fi
  w_specs_do ''
  w_seen=''
  w_specs_do w_check
  [ "$w_seen" = "$w_plan" ] || w_fail 'an import file changed after the screen was shown'
  w_stored_p=''
  w_stored_g=''
  w_skipped=''
  w_refs=''
  w_specs_do w_put
  [ -z "$w_stored_p" ] || w_note "stored in $w_project: $w_stored_p"
  [ -z "$w_stored_g" ] || w_note "stored in $w_project-guarded, with tag high-value: $w_stored_g"
  [ -z "$w_skipped" ] || w_note "skipped (empty value): $w_skipped"
  [ -z "$w_refs" ] || w_note "wrote $w_refs"
fi

w_bad=''
w_specs_do w_verify
w_kc=$(w_keychain) || w_kc=''
[ "$w_kc" = "$w_token" ] || w_fail 'keychain mismatch'
printf 'secrets: keychain match\n'
if [ -n "$w_bad" ]; then
  w_note "mismatch: $w_bad"
  w_fail mismatch
fi
[ -z "$w_specs" ] || w_note 'read back: every stored value matches'
w_write ok
printf 'secrets: setup done.\n'
