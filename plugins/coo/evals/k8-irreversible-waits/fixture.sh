#!/bin/sh
sh "$(dirname "$0")/../scaffold.sh" || exit 1
set -eu
: > .eval/agent-calls.jsonl
