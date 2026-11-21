#!/bin/sh
# Runs one eval suite on two commits in temp worktrees, with the suite copied from one ref,
# and prints the Eval: line from scripts/eval-compare.py. Exit codes: 0 with an Eval: line
# (or the no-plugin list), 2 a refusal, 3 a partial run, 4 a stop after an update,
# 130 and 143 an interrupt.
set -u

cap_main_core=13
cap_main_coo=15
cap_rerun=4
cap_noplugin=8

# The run settings file blanks the same names that this script unsets in its own environment.
keep_env='ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL CLAUDE_CODE_OAUTH_TOKEN CLAUDE_CODE_USE_BEDROCK CLAUDE_CODE_USE_VERTEX'
extra_env='CLAUDE_EFFORT MAX_THINKING_TOKENS DISABLE_INTERLEAVED_THINKING'

usage() {
  cat >&2 <<'EOF'
usage: eval-compare.sh <core|coo> <base> <head> [--suite-ref <ref>] [--reuse-base <dir>] [--covers <text>] [--jobs <n>]
       eval-compare.sh <core|coo> --aa <commit> [--suite-ref <ref>] [--update <dir> --cases "<case dirs>"] [--jobs <n>]
       eval-compare.sh core --no-plugin <commit> [--suite-ref <ref>] [--jobs <n>]
EOF
  exit 2
}
say() { echo "eval-compare: $*" >&2; }
die() { say "$*"; exit 2; }
in_list() { case " $1 " in *" $2 "*) ;; *) return 1 ;; esac; } # <space-separated list> <word>

child=
tree_names=
trees=
# shellcheck disable=SC2317,SC2329 # the traps below call it
cleanup() {
  if [ -n "$child" ]; then
    kill -TERM "$child" 2>/dev/null
    wait "$child" 2>/dev/null
    child=
  fi
  for _t in $tree_names; do
    git -C "$repo" worktree remove --force "$trees/$_t" >/dev/null 2>&1 || rm -rf "${trees:?}/$_t"
  done
  if [ -n "$tree_names" ]; then
    rmdir "$trees" 2>/dev/null
    git -C "$repo" worktree prune >/dev/null 2>&1
  fi
  tree_names=
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

[ $# -ge 1 ] || usage
suite=$1
shift
case $suite in core | coo) ;; *) usage ;; esac
mode=main base='' head='' commit='' suite_ref=origin/main reuse='' covers='' jobs=1 update='' cases='' cases_given=''
while [ $# -gt 0 ]; do
  case $1 in
    --aa | --no-plugin | --suite-ref | --reuse-base | --covers | --jobs | --update | --cases)
      [ $# -ge 2 ] || die "$1 needs a value"
      case $1 in
        --aa) [ "$mode" = main ] || usage; mode=aa commit=$2 ;;
        --no-plugin) [ "$mode" = main ] || usage; mode=no-plugin commit=$2 ;;
        --suite-ref) suite_ref=$2 ;;
        --reuse-base) reuse=$2 ;;
        --covers) covers=$2 ;;
        --jobs) jobs=$2 ;;
        --update) update=$2 ;;
        --cases) cases=$2 cases_given=1 ;;
      esac
      shift 2
      ;;
    -*) usage ;;
    *)
      if [ -z "$base" ]; then base=$1; elif [ -z "$head" ]; then head=$1; else usage; fi
      shift
      ;;
  esac
done
case $mode in
  main)
    if [ -z "$head" ] || [ -n "$update$cases_given" ]; then usage; fi
    ;;
  aa)
    [ -z "$base$reuse$covers" ] || usage
    if [ -n "$update" ] && [ -z "$cases_given" ]; then die "--update needs --cases"; fi
    if [ -z "$update" ] && [ -n "$cases_given" ]; then die "--cases needs --update"; fi
    ;;
  no-plugin)
    [ "$suite" = core ] || die "the no-plugin arm runs only for core"
    [ -z "$base$reuse$covers$update$cases_given" ] || usage
    ;;
esac
case $jobs in '' | *[!0-9]*) die "--jobs takes a number from 1 to 8" ;; esac
[ "$jobs" -ge 1 ] && [ "$jobs" -le 8 ] || die "--jobs takes a number from 1 to 8"
case $suite in core) cap_main=$cap_main_core ;; coo) cap_main=$cap_main_coo ;; esac

here=$(cd "$(dirname "$0")" && pwd -P) || exit 2
py=$here/eval-compare.py
claude=${CLAUDE_BIN:-claude}
repo=$(git -C "$here" rev-parse --show-toplevel 2>/dev/null) || die "$here is not in a git repo"
repo=$(cd "$repo" && pwd -P) || exit 2
main_checkout=$(cd "$repo" && cd "$(git rev-parse --git-common-dir)/.." && pwd -P) || exit 2

words() { tr '\n' ' ' | sed 's/ *$//'; }
family_names() {
  awk -v extra="$extra_env" 'BEGIN {
    n = split(extra, x, " "); for (i = 1; i <= n; i++) e[x[i]] = 1
    for (k in ENVIRON) if (k ~ /^(ANTHROPIC_|CLAUDE_CODE_)/ || (k in e)) print k
  }' | sort | words
}
shell_names=$(family_names)
unset_names=
for _n in $shell_names; do
  in_list "$keep_env" "$_n" && continue
  unset "$_n" 2>/dev/null || die "cannot unset $_n"
  unset_names="$unset_names $_n"
done
unset_names=${unset_names# }

cfg=${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json
[ -f "$cfg" ] || cfg=/dev/null
user_names=$(jq -r --arg extra "$extra_env" '(.env // {}) | keys[]
  | select(test("^(ANTHROPIC_|CLAUDE_CODE_)") or IN($extra | split(" ")[]))' "$cfg" | sort | words) ||
  die "cannot read $cfg"

resolve() {
  git -C "$repo" rev-parse --verify --quiet "$1^{commit}" || { say "not a commit: $1"; return 1; }
}
short() { git -C "$repo" rev-parse --short "$1"; }

suite_sha=$(resolve "$suite_ref") || exit 2
evals_path=plugins/$suite/evals
suite_hash=$(git -C "$repo" rev-parse --short "$suite_sha:$evals_path" 2>/dev/null) ||
  die "$suite_ref has no $evals_path"
scaffold_id=$(git -C "$repo" rev-parse --verify --quiet "$suite_sha:$evals_path/scaffold.sh") ||
  die "$suite_ref has no $evals_path/scaffold.sh"
stub_id=$(git -C "$repo" rev-parse --verify --quiet "$suite_sha:evals/stub-workers") ||
  die "$suite_ref has no evals/stub-workers"
shared_hash=$(printf '%s\n%s\n' "$scaffold_id" "$stub_id" | git -C "$repo" hash-object --stdin) || exit 2

case_names=
for _n in $(git -C "$repo" ls-tree -d --name-only "$suite_sha:$evals_path"); do
  if git -C "$repo" cat-file -e "$suite_sha:$evals_path/$_n/case.yaml" 2>/dev/null ||
    git -C "$repo" cat-file -e "$suite_sha:$evals_path/$_n/prompt.md" 2>/dev/null; then
    case_names="$case_names $_n"
  fi
done
classes=$(git -C "$repo" show "$suite_sha:$evals_path/classes.tsv" 2>/dev/null) ||
  die "$suite_ref has no $evals_path/classes.tsv"
rows=$(printf '%s\n' "$classes" | awk -F '\t' 'NF && $1 !~ /^#/ { gsub(/[ \r]/, "", $1); print $1 }' | tr '\n' ' ')
missing='' norow=''
for _n in $rows; do in_list "$case_names" "$_n" || missing="$missing $_n"; done
for _n in $case_names; do in_list "$rows" "$_n" || norow="$norow $_n"; done
[ -z "$missing$norow" ] ||
  die "classes.tsv and the case folders at $suite_ref differ:${missing:+ no folder for$missing;}${norow:+ no classes.tsv row for$norow}"
guards=$(printf '%s\n' "$classes" | awk -F '\t' '{
  gsub(/[ \r]/, ""); m = split($2, t, ",")
  for (i = 1; i <= m; i++) if (t[i] == "guard") { print $1; break }
}' | tr '\n' ' ')

case_hash() { git -C "$repo" rev-parse "$suite_sha:$evals_path/$1"; }

case $mode in
  main)
    base_sha=$(resolve "$base") || exit 2
    head_sha=$(resolve "$head") || exit 2
    ;;
  *)
    base_sha=$(resolve "$commit") || exit 2
    head_sha=$base_sha
    ;;
esac

claude_version=$("$claude" --version) || die "$claude --version failed"
claude_version=$(printf '%s\n' "$claude_version" | head -n 1)
git_src=
if [ "$(uname -s)" = Darwin ]; then
  # Inside a run /usr/bin/git is the xcrun shim, which fails; a copy of the real binary works.
  _dev=$(xcode-select -p 2>/dev/null) || die "xcode-select -p failed; the run needs a copy of git"
  git_src=$_dev/usr/bin/git
  [ -x "$git_src" ] || die "no git at $git_src to copy for the run"
  git_version=$("$git_src" --version) || die "$git_src --version failed"
else
  git_version=$(git --version) || die "git --version failed"
fi

physical() {
  _p=$1 _rest=
  case $_p in /*) ;; *) _p=$PWD/$_p ;; esac
  while [ ! -d "$_p" ]; do
    _rest=/${_p##*/}$_rest
    _p=${_p%/*}
    [ -n "$_p" ] || _p=/
  done
  _p=$(cd "$_p" && pwd -P) || return 1
  [ "$_p" != / ] || _p=
  printf '%s%s\n' "$_p" "$_rest"
}
check_location() {
  _home=$(cd "$HOME" && pwd -P) || die "cannot read \$HOME"
  _where=$(physical "$1") || die "cannot resolve $1"
  case $_where/ in "$_home"/?*) ;; *) die "results folder $_where is not under \$HOME, and the run reads its git copy only there" ;; esac
  for _r in "$repo" "$main_checkout"; do
    case $_where/ in "$_r"/*) die "results folder $_where is inside the repo $_r" ;; esac
  done
}

meta_get() {
  awk -v k="$2" 'index($0, k "=") == 1 { print substr($0, length(k) + 2); exit }' "$1/meta.txt"
}
meta_set() {
  awk -v k="$2" -v v="$3" '
    index($0, k "=") == 1 { if (!done) print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }' "$1/meta.txt" >"$1/meta.txt.tmp" && mv "$1/meta.txt.tmp" "$1/meta.txt"
}
all_zero() { [ -f "$1/exit-codes" ] && awk '$1 != 0 { bad = 1 } END { exit bad }' "$1/exit-codes"; }
complete_json() {
  jq -e '(.partial != true) and ([.cases[]?.arms[]?[]? | .skippedPaidGraders == true] | any | not)' "$1" >/dev/null 2>&1
}
# Sets added, removed and changed to the case names that differ from <dir>'s meta.txt.
case_drift() {
  added='' removed='' changed=''
  for _n in $case_names; do
    _old=$(meta_get "$1" "case.$_n")
    if [ -z "$_old" ]; then
      added="$added $_n"
    elif [ "$_old" != "$(case_hash "$_n")" ]; then
      changed="$changed $_n"
    fi
  done
  _old_names=$(awk -F '=' 'index($0, "case.") == 1 { print substr($1, 6) }' "$1/meta.txt")
  for _n in $_old_names; do
    in_list "$case_names" "$_n" || removed="$removed $_n"
  done
}
same_setup() { # <dir>: prints a "; reason" for each of the CLI, the git and the shared files that differs from <dir>
  _why=
  [ "$(meta_get "$1" claude-version)" = "$claude_version" ] ||
    _why="$_why; claude version $(meta_get "$1" claude-version) -> $claude_version"
  [ "$(meta_get "$1" git-version)" = "$git_version" ] ||
    _why="$_why; git version $(meta_get "$1" git-version) -> $git_version"
  [ "$(meta_get "$1" shared-hash)" = "$shared_hash" ] ||
    _why="$_why; shared hash (scaffold.sh or evals/stub-workers) changed"
  printf '%s' "$_why"
}
aa_folder() { # <dir>
  [ -f "$1/meta.txt" ] && [ -f "$1/a1.json" ] && [ -f "$1/a2.json" ] || die "$1 is not an A/A results folder"
  [ "$(meta_get "$1" mode)" = aa ] || die "$1 is not an A/A results folder"
  [ "$(meta_get "$1" suite)" = "$suite" ] || die "$1 holds the $(meta_get "$1" suite) suite, not $suite"
  all_zero "$1" || die "an A/A call in $1 did not exit 0"
  if ! complete_json "$1/a1.json" || ! complete_json "$1/a2.json"; then die "the A/A results in $1 are partial"; fi
}

if [ "$mode" = aa ] && [ -n "$update" ]; then
  [ -d "$update" ] || die "no results folder $update"
  results=$(cd "$update" && pwd -P) || exit 2
  check_location "$results"
  aa_folder "$results"
  [ -z "$(meta_get "$results" updated)" ] || die "$results was updated before; the build allows one update"
  [ "$(meta_get "$results" base)" = "$base_sha" ] || die "$results is an A/A run of $(meta_get "$results" base), not $base_sha"
  _count=0 update_cases=
  for _c in $cases; do
    _count=$((_count + 1))
    update_cases="$update_cases $_c"
  done
  update_cases=${update_cases# }
  [ "$_count" -ge 1 ] || die "--cases names no case"
  [ "$_count" -le 4 ] || die "--cases names $_count cases; an update takes at most 4"
  for _c in $update_cases; do
    in_list "$case_names" "$_c" || die "no case $_c at $suite_ref"
  done
  why=$(same_setup "$results")
  case_drift "$results"
  [ -z "$added$removed" ] || why="$why; cases added:${added:- none}, removed:${removed:- none}"
  for _n in $changed; do
    in_list "$update_cases" "$_n" || why="$why; case $_n changed but is not in --cases"
  done
  [ -z "$why" ] || die "cannot update $results${why}"
else
  if [ -n "$reuse" ]; then
    [ -d "$reuse" ] || die "no results folder $reuse"
    reuse=$(cd "$reuse" && pwd -P) || exit 2
    aa_folder "$reuse"
    why=$(same_setup "$reuse")
    [ "$(meta_get "$reuse" base)" = "$base_sha" ] ||
      why="$why; base commit $(meta_get "$reuse" base) -> $base_sha"
    case_drift "$reuse"
    [ -z "$added" ] || why="$why; cases added:$added"
    [ -z "$removed" ] || why="$why; cases removed:$removed"
    [ -z "$changed" ] || why="$why; cases changed:$changed"
    [ -z "$why" ] || die "cannot reuse the base arm of $reuse${why}"
  fi
  day=${XDG_CACHE_HOME:-$HOME/.cache}/dds-evals/$(date +%F)
  stamp=$suite-$(date +%H%M%S)
  results=$day/$stamp
  _i=1
  while [ -e "$results" ]; do
    _i=$((_i + 1))
    results=$day/$stamp-$_i
  done
  check_location "$results"
  mkdir -p "$day" || die "cannot make $day"
  mkdir "$results" || die "cannot make $results"
  results=$(cd "$results" && pwd -P) || exit 2
fi
say "results: $results"

gitdir=
if [ -n "$git_src" ]; then
  # Not named bin: from any other folder, Apple git finds git-core through its built-in prefix.
  gitdir=$results/sandbox-git
  mkdir -p "$gitdir" || die "cannot make $gitdir"
  cp "$git_src" "$gitdir/git" || die "cannot copy git to $gitdir"
fi
jq -n --slurpfile s "$cfg" --arg keep "$keep_env" --arg extra "$extra_env" \
  --arg gitdir "$gitdir" --arg shellpath "$PATH" '
  ($s[0].env // {}) as $u
  | ($keep | split(" ")) as $k
  | ($extra | split(" ")) as $x
  | ([$u | keys[]
      | select((test("^(ANTHROPIC_|CLAUDE_CODE_)") or IN($x[])) and (IN($k[]) | not))
      | {(.): ""}] | add // {})
  | {env: (. + (if $gitdir == "" then {} else {PATH: ($gitdir + ":" + ($u.PATH // $shellpath))} end))}' \
  >"$results/run-settings.json" || die "cannot write $results/run-settings.json"
blanked=$(jq -r '.env | to_entries[] | select(.value == "") | .key' "$results/run-settings.json" | sort | words)

if [ -z "$update" ]; then
  {
    echo "mode=$mode"
    echo "suite=$suite"
    echo "suite-ref=$suite_ref"
    echo "suite-sha=$suite_sha"
    echo "suite-hash=$suite_hash"
    echo "base=$base_sha"
    echo "head=$head_sha"
    echo "claude-version=$claude_version"
    echo "git-version=$git_version"
    echo "shared-hash=$shared_hash"
    for _n in $case_names; do echo "case.$_n=$(case_hash "$_n")"; done
    echo "env-shell=$shell_names"
    echo "env-unset=$unset_names"
    echo "env-user-settings=$user_names"
    echo "env-blanked=$blanked"
    [ -z "$reuse" ] || echo "reused-base=$reuse"
  } >"$results/meta.txt"
fi

trees=$results/trees
add_tree() { # <name> <commit>
  tree_names="$tree_names $1"
  git -C "$repo" worktree add --detach "$trees/$1" "$2" >/dev/null 2>&1 || die "git worktree add failed for $1"
  rm -rf "${trees:?}/$1/plugins/$suite/evals" "${trees:?}/$1/evals"
  git -C "$repo" archive "$suite_sha" "$evals_path" evals/stub-workers | tar -x -C "$trees/$1"
  [ -f "$trees/$1/$evals_path/scaffold.sh" ] && [ -d "$trees/$1/evals/stub-workers" ] ||
    die "the suite copy into $1 failed"
}

codes_file=$results/exit-codes
if [ -n "$update" ]; then
  # A failed update merged nothing, so a retry starts its own list of codes.
  codes_file=$results/update-exit-codes
  : >"$codes_file"
fi
run_eval() { # <tree> <result name> <cap> <ablation> [options...]
  _tree=$trees/$1 _name=$2 _cap=$3 _ablation=$4
  shift 4
  say "running $_name (log: $results/$_name.log)"
  "$claude" --settings "$results/run-settings.json" plugin eval "$_tree" \
    --eval-dir "$evals_path" --scaffold --allow-tools Bash Edit Write --trust-plugin --no-publish \
    --threshold 0 --model opus --ablation "$_ablation" --max-cost-usd "$_cap" -j "$jobs" \
    --json "$results/$_name.json" --report "$results/$_name.html" --output-dir "$results/$_name" \
    "$@" >"$results/$_name.log" 2>&1 &
  child=$!
  wait "$child"
  _rc=$?
  child=
  echo "$_rc $_name" >>"$codes_file"
  if [ "$_rc" -ne 0 ]; then
    echo "partial: $_name exited $_rc, so no further call ran (log: $results/$_name.log)"
    exit 3
  fi
  [ -f "$results/$_name.json" ] || { echo "partial: $_name wrote no $_name.json"; exit 3; }
}

if [ "$mode" = no-plugin ]; then
  printf '%s\n' "$classes" >"$results/classes.tsv"
  add_tree no-plugin "$base_sha"
  for _n in $case_names; do
    in_list "$guards" "$_n" || rm -rf "${trees:?}/no-plugin/$evals_path/$_n"
  done
  run_eval no-plugin no-plugin "$cap_noplugin" with-without --disallow-tools Agent
  complete_json "$results/no-plugin.json" || { echo "partial: no-plugin.json is partial"; exit 3; }
  say "guard cases that passed every run without the plugin:"
  python3 -B "$py" no-plugin --classes "$results/classes.tsv" --json "$results/no-plugin.json"
  exit
fi

[ -n "$update" ] || printf '%s\n' "$classes" >"$results/classes.tsv"
if [ "$mode" = main ]; then
  arm1=base arm2=head
  add_tree base "$base_sha"
  add_tree head "$head_sha"
  if [ -n "$reuse" ]; then
    cp "$reuse/a2.json" "$results/base.json" || die "cannot copy $reuse/a2.json"
    say "base arm reused from $reuse/a2.json"
  else
    run_eval base base "$cap_main" none
  fi
  run_eval head head "$cap_main" none
else
  arm1=a1 arm2=a2
  add_tree a1 "$base_sha"
  add_tree a2 "$base_sha"
fi

if [ -n "$update" ]; then
  for _c in $update_cases; do
    run_eval a1 "update-$_c-a1" "$cap_rerun" none --case "$_c"
    run_eval a2 "update-$_c-a2" "$cap_rerun" none --case "$_c"
  done
  for _c in $update_cases; do
    for _arm in a1 a2; do
      complete_json "$results/update-$_c-$_arm.json" ||
        { echo "partial: update-$_c-$_arm.json is partial; nothing was merged"; exit 3; }
    done
  done
  for _arm in a1 a2; do
    set -- merge --into "$results/$_arm.json" --from
    for _c in $update_cases; do set -- "$@" "$results/update-$_c-$_arm.json"; done
    python3 -B "$py" "$@" || die "the merge into $_arm.json failed"
  done
  # Only a merged update moves the folder to the new suite ref, so reuse checks stay true.
  meta_set "$results" suite-ref "$suite_ref"
  meta_set "$results" suite-sha "$suite_sha"
  meta_set "$results" suite-hash "$suite_hash"
  for _c in $update_cases; do meta_set "$results" "case.$_c" "$(case_hash "$_c")"; done
  meta_set "$results" update-env-blanked "$blanked"
  meta_set "$results" updated "$update_cases"
  printf '%s\n' "$classes" >"$results/classes.tsv"
elif [ "$mode" = aa ]; then
  run_eval a1 a1 "$cap_main" none
  run_eval a2 a2 "$cap_main" none
fi

if [ -z "$update" ]; then
  drops=$(python3 -B "$py" drops --classes "$results/classes.tsv" \
    --base "$results/$arm1.json" --head "$results/$arm2.json") || die "eval-compare.py drops failed"
  _i=0
  for _n in $drops; do
    _i=$((_i + 1))
    [ "$_i" -le 3 ] || break
    run_eval "$arm1" "rerun-$_n-$arm1" "$cap_rerun" none --case "$_n" --runs 6
    run_eval "$arm2" "rerun-$_n-$arm2" "$cap_rerun" none --case "$_n" --runs 6
  done
fi

set -- line --suite "$suite" --suite-hash "$suite_hash" --model opus --classes "$results/classes.tsv"
if [ "$mode" = aa ]; then
  set -- "$@" --aa "$(short "$base_sha")"
else
  set -- "$@" --base-ref "$(short "$base_sha")" --head-ref "$(short "$head_sha")"
fi
set -- "$@" --base "$results/$arm1.json" --head "$results/$arm2.json"
set -- "$@" --exit-codes "$(cat "$results/exit-codes" ${update:+"$codes_file"} | awk '{ print $1 }' | tr '\n' ' ')"
[ -z "$covers" ] || set -- "$@" --covers "$covers"
set -- "$@" --rerun-base
for _f in "$results"/rerun-*-"$arm1".json; do [ -e "$_f" ] && set -- "$@" "$_f"; done
set -- "$@" --rerun-head
for _f in "$results"/rerun-*-"$arm2".json; do [ -e "$_f" ] && set -- "$@" "$_f"; done
out=$(python3 -B "$py" "$@")
rc=$?

if [ -n "$update" ] && [ "$rc" -eq 0 ]; then
  stops=
  for _c in $update_cases; do
    in_list "$guards" "$_c" || continue
    if jq -e -s '[.[].cases[]?.arms.with[]? | .score != 1] | any' \
      "$results/update-$_c-a1.json" "$results/update-$_c-a2.json" >/dev/null; then
      stops="$stops; guard $(printf '%s' "${_c%%-*}" | tr '[:lower:]' '[:upper:]') failed a run in the update"
    fi
  done
  case $out in *", regression"*) stops="$stops; a Fisher flag" ;; esac
  case $out in *"unresolved: "*) stops="$stops; unresolved guard drops" ;; esac
  case $out in *"; climb none;"* | *"within noise"*) ;; *"; climb "*) stops="$stops; a permutation flag" ;; esac
  if [ -n "$stops" ]; then
    printf '%s\n' "$out"
    echo "stop: ${stops#; }"
    exit 4
  fi
fi
printf '%s\n' "$out"
exit "$rc"
