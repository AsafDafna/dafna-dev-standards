#!/bin/sh
set -eu
mkdir -p src
printf '%s\n' 'export const LIMIT = 3;' 'export const NAME = "app";' > src/app.js
