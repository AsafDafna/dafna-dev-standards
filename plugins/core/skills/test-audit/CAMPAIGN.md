# Test-pruning campaign

Campaign mode prunes one area's whole test surface in one PR: one domain module,
one feature, or one route group. The value bar, retention bar, candidate
evidence, and validation in [SKILL.md](SKILL.md) apply to every lane. This file
adds the order of work. Each step ends on its completion criterion; don't start
the next step early.

## 1. Baseline

Record the area's test and test-support line counts, and every test file's
pass/fail state at a pinned default-branch SHA. Keep baseline failures in their
own list: they are more often real bugs than stale tests.

Done when every in-scope test file has a recorded baseline result.

## 2. Lanes and inventory

Split the surface into **lanes** along production boundaries, not file-name
prefixes (for example: data access, business rules, server actions, UI,
background jobs, shared helpers, test harness). Include the area's cases in
shared suites, such as a central integration or end-to-end directory.

Done when every test file the area owns belongs to exactly one lane.

## 3. Read-only ledger per lane

Give each lane to its own read-only agent. The agent reads every assigned test
in full, including parameter tables, plus the production code it covers, its
entry points, callers, history, and CI routing. Each test declaration goes into
a written **ledger** with one mark. An `it.each` is one declaration unless its
rows need different marks; then mark each row.

- `R`: retain, naming the contract and the bug it catches; a retained test that
  only moves to a better-named file stays `R` with the move noted;
- `F`: retain the contract but repair the assertion, such as a vacuous negative
  that passes when only one of several items is missing;
- `C`: consolidate, naming the suite that absorbs the assertion: a sibling table
  case, a stronger boundary suite, or a shared owner elsewhere;
- `D`: delete, naming the proof that remains, or why no contract exists.

Judge a test by its assertions, not its name.

Done when every declaration in the lane has a mark and an evidence line.

## 4. Layer plan per lane

Treat the ledger as input, not as the edit list. A second read-only pass,
starting from the ledger, looks for the redundant **layer**: several suites
replaying the same shared logic through one mock, next to a stronger suite that
exercises it for real. Name the **keeper** suite for each contract. Prefer the
real boundary (a real database, a fake network) over a mocked collaborator.
Correct any ledger errors this pass finds.

A `C` holds only if its keeper stays. Check every keeper's own mark in every
lane, in both directions: two lanes that name each other's test as the keeper
retire both.

Done when each lane plan names its retired files, its keeper per contract, the
assertions to carry into keepers, and the test-only production seams unlocked.

Show the user the lane plans before step 5.

## 5. Cutover

Edit lane by lane. Route changes to shared harnesses and support files through
one agent. With each lane, remove the test-only production seams it unlocks:
injection parameters, getters, reset exports, and indirection layers. Register
moved suites in CI routing and any test inventories. Record durable
test-ownership rules for the area in the repo's test-conventions doc, drawn from
mistakes this campaign actually found.

Done when every lane plan is applied and each lane's keepers pass.

## 6. Preservation review

Before claiming completion, have independent reviewers compare the deleted
coverage against the keepers, one reviewer per boundary group. They look for
contracts that lost their only proof, and for new assertions that can't fail,
such as a rejection the production code never reaches.

For each restored contract, make one deliberate **mutation** of the production
code and confirm the keeper goes red. Then restore the source byte for byte.

Done when every reported gap is restored or rejected with source evidence, and
every restored contract has a caught mutation.

## 7. Product defects

A baseline failure that survives into a keeper is a bug report. Fix it in the
production code as a separate commit, and prove it through the real user flow,
with a **control** run that reverts the fix and shows the old behavior. Record
unrelated product discrepancies you find as follow-ups instead of fixing them in
the campaign.

Done when each fixed defect has a failing control and a passing candidate on the
same harness.

## 8. Reconcile and hand off

Campaigns outlive many default-branch commits. Merge the default branch rather
than rebasing a long campaign. When the default branch modified a file the
campaign deleted, keep the deletion, port the new contract into the keeper, and
confirm every new regression it added still has a home. Rerun the whole area's
suite on the merged head.

Expect review tooling to see a truncated file list on a diff this large.

Hand off with the [SKILL.md](SKILL.md) report, plus:

- baseline and final test/support line counts, with production counted
  separately;
- lanes, retired layers, and keepers;
- preservation gaps found and their mutations;
- product defects with control and candidate proof.
