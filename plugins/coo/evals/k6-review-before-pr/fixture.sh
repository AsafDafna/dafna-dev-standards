#!/bin/sh
sh "$(dirname "$0")/../scaffold.sh" || exit 1
set -eu
git -C shop-api worktree add -q -b fix/empty-list ../.worktrees/shop-api-fix
cat > .worktrees/shop-api-fix/src/items.js <<'EOF'
export function listItems(items) {
  const first = items.length > 0 ? items[0].name : null;
  return { first, items };
}

export function countItems(items) {
  if (!items) {
    return 0;
  }
  if (items === undefined) {
    return 0;
  }
  return items.length;
}
EOF
git -C .worktrees/shop-api-fix commit -qam 'fix: return an empty result for an empty list'
