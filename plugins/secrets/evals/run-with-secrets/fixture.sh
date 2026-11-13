#!/bin/sh
sh "$(dirname "$0")/../scaffold.sh" run-with-secrets || { echo "scaffold failed: $0 in $PWD" >&2; exit 1; }
