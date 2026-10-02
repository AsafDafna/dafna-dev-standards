---
name: test-audit
description: Use when writing, changing, reviewing, or sweeping tests — the authoring gate every new or changed test must pass, plus the audit workflow for low-value, implementation-coupled, or duplicative tests and the test-only production seams they keep alive. Also use when the user says "test audit", "audit the tests", "prune tests", "is this test worth it", or asks for a test-pruning campaign on one area.
---

# Test Audit

Three modes, one value bar. **Authoring mode** gates every new or changed test at
write time. **Audit mode** runs focused sweeps of tests that re-assert source,
duplicate stronger proof, couple behavior to implementation, or keep test-only
production seams alive. **Campaign mode** prunes one whole area's test surface
(every test file one module or feature owns); before starting one, read
[CAMPAIGN.md](CAMPAIGN.md). Optimize for confidence, not deletion count.

## Repo conventions come first

Before any mode, read the repo's `CLAUDE.md` files (root and any scoped ones) and
the test-conventions doc they point to. The repo's doc wins over this skill on:
test commands, which suites need local services, which paths are out of scope
(for example code already scheduled for removal), which test categories are
always retained, and how review and PRs land. If the repo has no such doc, ask
the user for the test commands before running anything.

## Authoring gate

Before adding any test, answer four questions. A missing answer means don't add
it yet:

1. What observable behavior, invariant, or independent contract does it protect?
2. What credible regression makes it fail?
3. Why doesn't existing coverage already catch that failure? Each contract has
   one primary test owner at the strongest boundary. Another layer needs its own
   distinct risk, such as a transport or lifecycle failure the owner can't reach.
   Prefer extending a table-driven case or shared fixture over a near-duplicate
   test, and consolidate duplicated setup in the same change.
4. Does it need a production seam (export, flag, wrapper, injection hook) that no
   production caller needs? If yes, move the test to the real boundary instead.

Then check the test against every [junk pattern](#junk-patterns). A match fails
the gate unless the [retention bar](#retention-bar) names the contract it
independently guards. A test that would break under behavior-preserving
refactoring asserts implementation, not behavior; rewrite it at the owning
boundary before landing it.

Bug regression tests must fail on the pre-fix code for the intended reason and
pass after the fix at the owning boundary. A regression test that never
demonstrably failed proves the mock, not the fix. One regression at the owning
boundary covers the bug; don't replay the same scenario at every layer it
crosses.

## Junk patterns

The shared checklist for all modes. The authoring gate rejects a new test that
matches one; audits hunt for existing tests that do.

- assertion-free coverage probes, and test files with no runtime tests left;
- self-comparisons and identity copiers;
- copied fixtures, inventories, manifests, or export lists;
- exact source, import, or string greps;
- private predicate or call-shape tests duplicated at real boundaries;
- duplicate invocations of the same contract;
- per-caller replays of a shared helper's behavior;
- tests whose only purpose is preserving test-only exports, globals, or wrappers;
- dead production code whose only callers are tests;
- expected values produced by the helper or renderer under test;
- mocks that implement the asserted behavior, or answer the same whatever they
  are asked: one identical mock standing in for different APIs, or a gate none
  of whose admit or deny tests keys its check by the argument the code under
  test chooses (a permission check stubbed `true` or `false` for any capability
  passes whichever capability the gate asks for). Key at least one test per gate: admit
  says yes only to the values the gate accepts, deny says yes to every other
  value (a deny keyed only to the accepted value, saying no there and falling
  back to the mock's falsy default for every other value, is constant too, so it
  cannot catch a wrong argument either);
- fixtures that supply the result, ordering, or callback the code under test
  should produce, or persistence asserted against a store the path never writes;
- capability or permission tests that restate declared flags instead of
  exercising the access the flag grants or denies;
- negative controls that pass for an unrelated reason, such as a denial from a
  different guard or a rejection the production path never reaches;
- names or fixtures that promise more than the input exercises.

## Value bar

Tests justify their maintenance cost by protecting behavior, a credible
regression, or an independently meaningful contract. In an audit, an existing
test that must change for behavior-preserving source reorganization is suspect,
not automatically deletable; the authoring gate still rejects new ones.

Before judging a candidate, read the complete test and the production code it
covers, its entry point, callers, callees, sibling implementations, overlapping
tests, CI routing, and relevant git history. When the test claims
dependency-backed behavior, read the dependency's source or types directly.

## Discovery

Keep discovery read-only and report evidence before editing. For broad scope,
split it into lanes along the repo's production boundaries (domain modules,
routes/UI, scripts and tooling) plus one cross-cutting pattern sweep, and give
each lane to a read-only subagent when available.

Outside campaign mode, prefer a few high-confidence candidates over a large
speculative inventory. Hunt for the [junk patterns](#junk-patterns).

## Retention bar

Keep a test when it independently enforces a public API, protocol, config,
database migration, schema, storage, security (auth, access policies, grants),
platform, default, package, release, or architecture contract. Also keep:

- call ordering when order is observable behavior;
- regressions with a credible failure mode;
- source inspection when it is the cheapest independent guard: it fails when the
  contract changes (the user-facing key, byte, or path) and survives an
  identifier-only refactor. A source grep pinning a variable name fails that
  test; look for a render- or call-level replacement before keeping it;
- a retained test that fails on the baseline: treat it as a possible product
  bug, reproduce it, and fix the production code rather than deleting the test.

Static or slow is not a reason to delete. A test that resembles implementation
may still be the independent contract; prove otherwise before removing it.

## Candidate evidence

Record every field below before editing. A missing field means the candidate
isn't ready for deletion:

- exact test name and location;
- what failure it can actually detect;
- non-test callers of the covered production or support seam;
- the stronger proof that remains at the owning boundary, or why none is needed;
- relevant history and why the test or seam exists;
- production or test-support code the deletion unlocks;
- risk and the focused validation command.

Present the candidate list to the user and get their go-ahead before deleting.

## Edit shape

Choose one coherent batch at one owning boundary. Delete obsolete test-only
exports, globals, wrappers, and dead production paths instead of preserving
aliases. Move retained regressions to their canonical owners. Consolidate
repeated package or dependency assertions into one generic contract.

Prefer net-negative production lines. Don't add replacement tests that restate
the same implementation, and don't turn uncertain candidates into cleanup to
raise the deletion count.

## Validation

Never edit source or tests while a test runner is running in the same checkout.

1. Run the smallest owner and sibling tests with the repo's test command,
   filtered to those paths.
2. For removed source greps or plan assertions, run the executable script or
   dry-run that owns the real contract.
3. Run the repo's formatter and linter on the changed files, then
   `git diff --check`.
4. Run the full gate the repo requires for the change (typecheck, unit, and any
   integration suite the touched code is covered by).
5. Inspect `git diff --numstat`; report production and tooling lines separately
   from tests and test support.
6. After the final edits, run the repo's review step.

## Landing and continuation

Commit, push, open a PR, or land only when authorized, following the repo's PR
workflow. Land one coherent PR at a time; after it lands, refresh from the
current default branch and rerun read-only discovery for the next
high-confidence batch.

## Handoff

Report:

- root cause and the low-value categories removed;
- production simplifications;
- retained false positives and why they remain valuable;
- focused and full proof actually run;
- production versus test line counts;
- PR and merge state;
- named follow-ups.

---

Adapted from `openclaw/openclaw` `.agents/skills/test-audit` (MIT License,
Copyright (c) 2026 OpenClaw Foundation), at commit 2aed866.
