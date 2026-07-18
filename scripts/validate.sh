#!/bin/sh
# CI + local validation for the marketplace. Fails on first error.
set -e
jq . .claude-plugin/marketplace.json >/dev/null
for p in plugins/*/.claude-plugin/plugin.json; do jq . "$p" >/dev/null; done
for h in plugins/*/hooks/hooks.json; do [ -f "$h" ] && jq . "$h" >/dev/null; done
find plugins -name '*.sh' -exec shellcheck {} +
[ "$(wc -l < plugins/core/rules/RULES.md)" -le 60 ]
head -1 plugins/core/rules/RULES.md | grep -q '^\[dafna-core rules v'
for s in plugins/*/skills/*/SKILL.md; do
  head -1 "$s" | grep -qx -- '---' || { echo "missing frontmatter: $s"; exit 1; }
  grep -q '^description: Use when' "$s" || { echo "description must start 'Use when': $s"; exit 1; }
  dlen=$(grep '^description:' "$s" | head -1 | wc -c)
  [ "$dlen" -le 1024 ] || { echo "description over 1024 chars: $s"; exit 1; }
done
rc=0
grep -rniE 'asaf|nir|edut|testimony|monday|/Users/|~/dev-projects|~/Downloads' plugins/ || rc=$?
if [ "$rc" -eq 0 ]; then
  echo "LEAK in plugins/"; exit 1
elif [ "$rc" -ne 1 ]; then
  echo "leak-gate grep error"; exit 1
fi
echo OK
