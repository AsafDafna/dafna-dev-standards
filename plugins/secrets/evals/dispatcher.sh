#!/bin/sh
# secrets-eval-dispatcher
# evals/run.sh installs this file as ~/.local/bin/secrets for the time of an eval run only. In an
# eval workspace (a repo whose root holds .evalbin/.eval-workspace) it starts the workspace copy of
# the command, with the workspace's fakes first on the PATH. The search stops at the first folder
# with .git, so a marker in a parent of another repo never counts.

root=$PWD
until [ -e "$root/.git" ]; do
  case $root in '' | /) root=; break ;; esac
  root=${root%/*}
done
if [ -z "$root" ] || [ ! -f "$root/.evalbin/.eval-workspace" ]; then
  echo 'secrets: this is the eval dispatcher; no eval workspace here' >&2
  exit 127
fi
PATH=$root/.evalbin:$PATH
export PATH
exec "$root/.evalbin/.plugin/bin/secrets" "$@"
