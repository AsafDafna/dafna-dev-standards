#!/bin/sh
sh "$(dirname "$0")/../scaffold.sh" || exit 1
set -eu
: > .eval/agent-calls.jsonl
git -C shop-api checkout -q -b fix/empty-list
cat > shop-api/src/items.js <<'EOF'
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
git -C shop-api commit -qam 'fix: return an empty result for an empty list'
cat > shop-api/src/items.js <<'EOF'
export function listItems(items) {
  if (!items || items.length === 0) {
    return { first: null, items: [] };
  }
  const first = items[0].name;
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
cat >> shop-api/test/items.test.js <<'EOF'

test('listItems returns the first name of a one-item list', () => {
  assert.deepEqual(listItems([{ name: 'a' }]), { first: 'a', items: [{ name: 'a' }] });
});
EOF
git -C shop-api commit -qam 'fix: guard a missing list and test a one-item list'
sed 's/  const first = items\[0\]\.name;/  const first = items[0].name ?? null;/' shop-api/src/items.js > shop-api/src/items.next
mv shop-api/src/items.next shop-api/src/items.js
cat >> shop-api/test/items.test.js <<'EOF'

test('listItems returns an empty result for a missing list', () => {
  assert.deepEqual(listItems(undefined), { first: null, items: [] });
});

test('listItems returns null when the first item has no name', () => {
  assert.deepEqual(listItems([{}]), { first: null, items: [{}] });
});
EOF
git -C shop-api commit -qam 'fix: return null for a first item with no name and test a missing list'
git -C shop-api checkout -q main
cat > shop-api/docs/tracker.md <<'EOF'
# Tracker

## fix/empty-list: GET /items returns 500 on an empty list

| Round | Verdict | Findings | State |
|---|---|---|---|
| 1 | BLOCK | 1 high: `listItems` throws on a missing list (src/items.js:2). 1 medium: no test for a one-item list (test/items.test.js). | Fixes pushed |
| 2 | BLOCK | 1 high: `listItems` returns `first: undefined` when the first item has no name (src/items.js:5). 2 medium: no test for a missing list (test/items.test.js); no test for a first item with no name (test/items.test.js). | Fixes pushed |
EOF
git -C shop-api commit -qam 'docs: track the review rounds of fix/empty-list'
git init -q --bare .remotes/shop-api.git
git -C shop-api remote add origin "$PWD/.remotes/shop-api.git"
git -C shop-api push -q -u origin main fix/empty-list
