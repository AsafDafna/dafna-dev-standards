#!/bin/sh
# secrets-eval-dispatcher
token=
# evals/run.sh installs this file as ~/.local/bin/secrets for one eval run, with a new random token
# on the line above. It starts the workspace copy of the command, with the workspace's fakes first
# on the PATH, only in a repo whose root holds .evalbin/.eval-workspace with exactly that token:
# scaffold.sh writes it for the workspaces of this run. The search stops at the first folder that
# holds .git, so a marker in a parent of another repo never counts.

root=$PWD
until [ -e "$root/.git" ]; do
  case $root in '' | /) root=; break ;; esac
  root=${root%/*}
done
mark=
[ -z "$root" ] || mark=$(cat "$root/.evalbin/.eval-workspace" 2>/dev/null)
if [ -z "$token" ] || [ "$mark" != "$token" ]; then
  echo 'secrets: this is the eval dispatcher; no eval workspace here' >&2
  exit 127
fi
PATH=$root/.evalbin:$PATH
export PATH
exec "$root/.evalbin/.plugin/bin/secrets" "$@"
