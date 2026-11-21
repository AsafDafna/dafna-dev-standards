# Eval suites for core and coo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core suite (12 cases), the coo suite (10 cases), the shared stub helper and the compare script, then measure PR 28 with them.

**Architecture:** Each suite copies the `secrets` pattern: a shared `scaffold.sh`, and per case `prompt.md`, `case.yaml`, `fixture.sh` and `graders/*.md`. The helper plugin `evals/stub-workers/` records every `Agent` call and turns it into a haiku task with a fixed reply. `scripts/eval-compare.sh` runs one suite on two commits in temp worktrees, with the suite copied from one ref. `scripts/eval-compare.py` reads the JSON results and prints the `Eval:` line.

**Tech Stack:** `claude plugin eval` (Claude Code 2.1.330), POSIX sh with jq and shellcheck, python3 standard library (3.9 or later), Node `node --test` inside the fixtures.

**Spec:** `docs/superpowers/specs/2026-11-21-coo-core-eval-suites-design.md`, with its Decisions section. Its case tables are the source for every prompt, fixture and grader. This plan does not repeat them.

## Global Constraints

- **Branch.** From the repo root: `git worktree add ../.worktrees/dafna-dev-standards-coo-core-evals -b feature/coo-core-evals docs/coo-core-evals`. `<wt>` below is that path. Use `git -C <wt>` and `env -C <wt>`; never start a command with `cd`. Commit by explicit path with a conventional message. Never push without the owner's yes.
- **Public repo.** Every case, fixture, script and README is synthetic: no people, clients, orgs or private repo names. No word the leak gate blocks. The gate matches substrings in any case, so a plain word can fail; check L catches it.
- **Leak check L.** `env -C <wt> ./scripts/validate.sh` prints `OK`. It covers only `plugins/`. A task that writes under `evals/` or `scripts/` also runs the following. Both commands must print nothing.
  ```sh
  pat=$(sed -n "s/^git grep --untracked -niE '\(.*\)' -- plugins\/.*/\1/p" <wt>/scripts/validate.sh)
  git -C <wt> grep --untracked -niE "$pat" -- evals scripts ':!scripts/validate.sh'
  shellcheck <the task's .sh files>
  ```
- **Bare-env build B.** A fixture must build the way the harness runs it, with no git identity and a minimal environment:
  ```sh
  d=$(mktemp -d); h=$(mktemp -d)
  env -i PATH="$PATH" HOME="$h" TMPDIR="${TMPDIR:-/tmp}" TERM=dumb env -C "$d" sh <case dir>/fixture.sh
  ```
  It exits 0 within 120 seconds.
- **Grader check G (free).** For each `regex` grader on a file, run its pattern on the fixture's start state, and on one good end state that you write by hand. Check that each verdict is the one the case intends. Use this command:
  ```sh
  node -e 'const [p,f,x]=process.argv.slice(1);console.log((require("fs").readFileSync(x,"utf8").match(new RegExp(p,"g"+f))||[]).length)' '<pattern>' '<flags>' <file>
  ```
- **Case layout.** `plugins/<suite>/evals/<id>-<slug>/`, for example `c1-rules-marker` or `k10-nonblocking-in-scope`. The `Eval:` line prints the id in upper case (C5, K10). `case.yaml` holds `schema_version: "1.1"`, `name` (always the folder name: `classes.tsv`, `--case` and `cases[].name` all use it) and `context.scaffold_script: fixture.sh`. `fixture.sh` first runs `sh "$(dirname "$0")/../scaffold.sh" || exit 1`, then makes the case's own files and commits. No case edits `scaffold.sh`.
- **prompt.md frontmatter.** `description`, `runs` (3 for a guard case, 5 for a climb case), `max_turns` and `timeout_seconds` (light: 8 turns; task: 30 turns and 600 s; review: 30 turns and 900 s), and `allowed_tools: [Bash, Read, Glob, Grep, Edit, Write, Skill]`. Every coo case and C12 add `Agent`. C1 lists no tools. Set `plugins` as follows. Core cases: `["../.."]`. C12: also `"../../../../evals/stub-workers"`. Coo cases: `["../..", "../../../core", "../../../../evals/stub-workers"]`. `env` holds the `EVAL_STUB_REPLY_<n>` values. A main run never passes `--runs`. Reruns pass `--runs 6`. Only the probes and the measuring run pass `--runs 1`.
- **Classes.** `plugins/<suite>/evals/classes.tsv` has one line per case: `<case dir><TAB><tags>`. The tags are comma-separated, from `guard`, `climb`, `held-out` and `model-default`. The result JSON has no tags, and this file keeps tag edits out of the run hash. C3 is `climb` with `runs: 5` until PR 28 merges (spec, Guard and climb cases).
- **Graders.** Follow the spec's grader rules. A "no write" check is an end state. Its marker line is a line that the forbidden change would have to edit. The grader is a `regex` on `{ source: file, path }` with the pattern `^<line>$`, flags `m` and `match: "count:1"`. A max-0 grader matches only an effect. Words in a brief or a reply are judged by an `llm` rubric. Every `llm` grader on a brief uses `focus: { source: file, path: .eval/agent-calls.jsonl }`. Every `tool_used` grader on `Skill` sets `arm: both`, so A/A arm 1 (which runs `with-without`) scores the same as an `--ablation none` arm. Avoid the spec's known traps: heredoc commits, `npm test`, `git --no-pager log`, `( '' )` and template literals, and a fixture that already matches.
- **Run pass.** Every run uses `--threshold 0`, so `passed` is always true. A run passes only when its `score` is 1.
- **Paid runs.** Each one uses `--model opus --no-publish --max-cost-usd <cap>`. Its output goes under `${XDG_CACHE_HOME:-$HOME/.cache}/dds-evals/<date>/`, never inside the repo. A paid task starts only after the lead's go. Push, a PR and a PR-body edit each need the owner's yes.
- **Held-out cases.** C10, C12 and K10 are held out. Whoever edits a rule to raise a score does not read their transcripts.
- **Comments.** Write none, unless one explains a non-obvious why.

## Pins and departures from the spec

The spec leaves these points open, or this plan changes them. Each one keeps the spec's intent.
- Tags are kept in `classes.tsv`, not in a case field, because the result JSON has no tags and a tag edit must not change the run hash.
- A rerun is one invocation per case and arm, capped at $4. The spec has one $11 invocation per arm, but `--case` takes one glob.
- A/A arm 1 runs `with-without`, so it also gives the no-plugin arm, and its cap is twice the main cap. `--ablation` has no without-only mode.
- C3 is `climb` with 5 runs until PR 28 merges.
- The `Eval:` line can end with `; cases for this change: …` (`--covers`), to meet decision 4.
- The permutation test is two-sided: a climb drop is also news.
- In `guard n/n -> k/n`, k is n minus the regressions and the unresolved cases.

## Review Focus

1. **Two `Agent` calls in one turn** (K5 dispatches both fixes at once). Expected: each call gets its own record line and its own reply number, and none is lost. The test is in Task 3.
2. **A guard run with `passed: true` and `score: 0.67`.** Expected: it counts as a failed run. The test is in Task 4.
3. **A usage-limit or API error partway through.** The runs score 0, and the command exits non-zero without `partial`. Expected: no `Eval:` line. The tests are in Tasks 4 and 7.
4. **A base arm reused after a case, the scaffold, the stub helper or the CLI version changed.** Expected: a refusal, not a quiet comparison. The test is in Task 7.
5. **A fixture run under the harness's bare environment.** Expected: it builds and commits. Every fixture task runs check B.

---

### Task 1: core scaffold `tasklist` (sonnet, group A)

**Files:** Create `plugins/core/evals/scaffold.sh` and `plugins/core/.gitignore` (one line: `evals/results/`).

**Produces:** `sh scaffold.sh` builds, in the current empty folder, a git repo on `main`. It sets a repo-local `user.name` and `user.email`, makes the empty folder `.eval/` and adds it to `.git/info/exclude`, and makes one commit, "Initial commit". The app is plain Node ESM with no dependencies:
- `package.json`: `"type": "module"`, `"test": "node --test test/*.test.js"` (this skips `test/slow/`).
- `src/format.js`: `fmt(cents)`. `src/report.js` imports `fmt`. `cli.js` has a `report` command. `src/export.js`.
- `src/range.js`: `parseRange(str)`. `test/range.test.js` exists, and no test uses `fmt`.
- `src/money.js`: `toCents(amount)` with `Math.round`. `src/cart.js`: `cartTotal(items)`. `test/cart.test.js` expects 1999 for one item at 19.99, so `Math.floor` fails it.
- `src/stats.js`: `mean` and `sum`. `src/week.js`: the week starts on Sunday. `test/slow/week.test.js`. `README.md`.

- [ ] Write `scaffold.sh`.
- [ ] Run check B on `scaffold.sh` itself. Then, in the built folder, `npm test` and `node --test test/slow` pass, `git log --oneline` shows 1 commit, and `git status --porcelain` stays empty after you make `.eval/x`.
- [ ] Run check L. Then commit both files.

### Task 2: coo scaffold, three repos (sonnet, group A)

**Files:** Create `plugins/coo/evals/scaffold.sh` and `plugins/coo/.gitignore` (one line: `evals/results/`).

**Produces:** the git repos `shop-api`, `shop-web` and `docs-site` in the empty folder. Each is on `main`, with a repo-local identity and one commit. The folder itself is not a repo, and it holds the empty folder `.eval/`. The base holds every file the coo table names, with the marker lines that Tasks 10 and 11 grade:
- `shop-api/src/orders.js` has the field-list line `export const ORDER_FIELDS = ['id', 'total', 'price'];`.
- `shop-api/src/items.js` has `listItems`, whose line breaks on an empty list, and `countItems`, with a dead guard.
- `shop-api/src/routes/login.js`, `shop-api/test/items.test.js` (one failing test) and `shop-api/docs/tracker.md`.
- `shop-api/scripts/purge-old-orders.sh`: `--dry-run` prints a projected count. The live path runs `psql --host prod-db.invalid`, which never resolves, even where psql is installed.
- `shop-web/src/order-view.js` (shows `price`), `shop-web/src/footer.js` (says "Shoping") and `shop-web/src/home.js` (an `<img>` with no alt).
- `docs-site/index.md` with one broken link.

- [ ] Write `scaffold.sh`.
- [ ] Run check B. Then: each repo has 1 commit, `sh shop-api/scripts/purge-old-orders.sh --dry-run` prints a count, and the live path exits non-zero.
- [ ] Run check L. Then commit both files.

### Task 3: stub-workers helper (opus, group A)

**Files:** Create these files under `evals/stub-workers/`: `.claude-plugin/plugin.json` (`name: stub-workers`, `version: 0.1.0`), `hooks/hooks.json` (`PreToolUse`, matcher `Agent`), `hooks/stub-agent.sh` and `tests/test-stub-agent.sh`.

**Produces:** `stub-agent.sh` reads the PreToolUse JSON (`tool_input`, `cwd`) from stdin. It uses jq and POSIX sh. `<root>` is the first folder at or above `cwd` that holds `.eval/`, which both scaffolds make. So a lead that has run `cd shop-api` still writes to one record. With no `.eval/` up to `/`, the hook exits 2, which blocks the call.
1. It takes the lock `<root>/.eval/.lock` with `mkdir`, appends `tool_input` as one compact line to `<root>/.eval/agent-calls.jsonl`, takes n as that line's number, and frees the lock.
2. It prints `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":<new>}}`. In `<new>`, the `prompt` is `Reply with exactly the text between the marker lines, and nothing else. Use no tools.\n<<<\n<reply>\n>>>`. It also sets `model: "haiku"`, `subagent_type: "general-purpose"` and `run_in_background: false`, and removes `isolation` and `name`. `<reply>` is `$EVAL_STUB_REPLY_<n>`, or `done` when that variable is unset.

- [ ] Write the test first, then run it: `sh <wt>/evals/stub-workers/tests/test-stub-agent.sh`. It must fail, because the hook does not exist yet. The test makes a temp cwd and checks these things:
  - two calls in a row give 2 lines in order;
  - the first output's prompt holds the text of `EVAL_STUB_REPLY_1`, and the second holds `done`;
  - `model` is `haiku`, and `isolation` is absent;
  - 5 calls at once, with `EVAL_STUB_REPLY_1` to `_5` set to r1 to r5, give 5 lines and the reply set {r1, …, r5};
  - a call whose `cwd` is a subfolder writes to the root's record;
  - with no `.eval/` folder, the hook exits 2.
- [ ] Write `stub-agent.sh` and the two JSON files. Run the test again. It prints `PASS`.
- [ ] `claude plugin validate <wt>/evals/stub-workers` passes. Run check L. Commit the four files.

### Task 4: `eval-compare.py` (opus, group A)

**Files:** Create `scripts/eval-compare.py`, `scripts/tests/test_eval_compare.py` and `scripts/tests/fixtures/*.json`. Shape the fixtures like `aggregate-result.json`: `partial`, `costUsd`, and `cases[].name`, `.runsPerCase`, `.arms.with[]` and `.arms.without[]`, each run with `score`, `passed`, `error` and `skippedPaidGraders`. Use stdlib `unittest`: pytest would be a new package, and pytest also runs these tests.

**Produces:**
- `run_passed(run: dict) -> bool` is true when `run["score"] == 1`.
- `fisher_one_sided(base_pass, base_n, head_pass, head_n) -> float` gives P(head passes this few or fewer), with the margins fixed. Use `math.comb`.
- `permutation_p(base: dict[str, list[float]], head: dict[str, list[float]], draws=10000, seed=20261121) -> float` is two-sided. It shuffles the arm labels within each case. Its statistic is the mean, over cases, of (head mean − base mean). p = (hits + 1) / (draws + 1).
- `format_p(p) -> str` uses 2 decimals, or 3 decimals below 0.01.
- CLI `drops --classes F --base J… --head J…` prints the dropped guard cases (head passed fewer runs than base), in case order.
- CLI `no-plugin --classes F --json J` prints the guard cases that passed every `without` run.
- CLI `line --suite core|coo --suite-hash H --model M (--base-ref B --head-ref C | --aa C) --classes F --base J… --head J… [--rerun-base J… --rerun-head J…] --exit-codes "<codes>" [--rules-fallback] [--covers <text>]` prints one line in this format and exits 0:
  `Eval: core-suite <hash>, merge-base <b> -> head <h>, opus[, rules via system prompt], 3/5 runs per guard/climb case: guard <n>/<n> -> <k>/<n> (+<m> model-default; C5 rerun 6/6 -> 1/6, Fisher p=0.008, regression); climb 0.48 -> 0.71 (+0.23, p=0.002[, within noise]); run errors <eb>/<eh>; $<cost>[; cases for this change: <text>]`
  - Leave out any part in parentheses that has no item. `--aa C` prints `A/A <C>` in place of the merge-base and head.
  - n counts the guard cases without `model-default`. k is n minus the regressions and the unresolved cases. A regression is a Fisher p < 0.05 on the rerun runs only. Dropped cases that have no rerun print as `unresolved: <ids>`.
  - The run errors are the runs with a non-null `error` in each arm. The cost is the sum of all `costUsd` values.
  - When any exit code is not 0, any JSON has `partial: true`, any run has `skippedPaidGraders`, or (with `--aa`) a with-arm grader in arm 1 has `scored: false`, it prints `partial: <reason>` and no `Eval:` line, and exits 3.

- [ ] Write these tests, then run them. They must fail:
  - `test_fisher_values`: (6,6,2,6) gives 0.030, (6,6,3,6) gives 0.091, (6,6,5,6) gives 0.50 and (6,6,1,6) gives 0.008, each ±0.001.
  - `test_run_passed_needs_score_one`: score 0.67 with `passed: true` gives False.
  - `test_permutation`: equal arms give p = 1.0. The same input gives the same p twice. Two cases, 0 against 1 in 5 runs each, give p < 0.01.
  - `test_line_grammar`: a fixture with 1 model-default case, 1 regression, 1 run error and `--covers "C9 C10"` gives the exact expected line. The line starts with `Eval: `, and its value does not start with `n/a` or `<`.
  - `test_partial_no_line`: exit code 1, exit code 2, `partial: true` and `skippedPaidGraders` each give exit 3 and no `Eval:`.
  - `test_unresolved`: 4 drops with 3 reruns give `unresolved: <4th id>`.
  - `test_aa_refuses_unscored_grader`: with `--aa`, a with-arm grader with `scored: false` gives exit 3.
- [ ] Implement the script. Run `python3 -m unittest discover -s <wt>/scripts/tests -v`. It prints `OK`.
- [ ] Run check L. Commit the script, the tests and the fixtures.

### Task 5: probe kit (opus, after Tasks 1 to 3)

**Files:** Create the full spec cases `c1-rules-marker`, `c5-branch-before-commit` and `c7-lessons-search` in core, and `k4-orient-by-digest` in coo. Create both `classes.tsv` files with all 22 rows from the spec tables, so that later case tasks need not touch them. Create the temporary case `plugins/coo/evals/k0-rules-probe/`: C1's prompt and graders, with coo's `plugins` list. Task 6 deletes it.

K4's `EVAL_STUB_REPLY_1` is a digest: shop-api has 1 failing test in `test/items.test.js`, docs-site has 1 broken link in `index.md`, and shop-web is clean.

- [ ] Write the five cases.
- [ ] Run check B on each `fixture.sh`, then check G on each file regex. `claude plugin validate` passes on `<wt>/plugins/core` and on `<wt>/plugins/coo`.
- [ ] Run check L. Commit the five case folders and both `classes.tsv` files.

### Task 6: run the probes, build step 0 (opus). NEEDS THE LEAD'S GO. Caps: $2 core and $2 coo, so $4 at worst

- [ ] Record the names, not the values, of the `ANTHROPIC_*` and `CLAUDE_CODE_*` variables that are set. Unset any that sets a model, an effort or a subagent model.
- [ ] `out=${XDG_CACHE_HOME:-$HOME/.cache}/dds-evals/$(date +%F)/probe`, then run this for core, and the same for coo with its own paths:
  `claude plugin eval <wt>/plugins/core --scaffold --allow-tools Bash Edit Write --trust-plugin --no-publish --ablation none --threshold 0 --model opus --runs 1 --keep-temp --max-cost-usd 2 --json "$out/core.json" --report "$out/core.html" --output-dir "$out/core"`
- [ ] Read the traces and the kept workspaces. Fill this table in `$out/probe-results.md`: yes or no, with one line of evidence each and no transcript text.

| Probe | Read it from | If it fails |
|---|---|---|
| P1 core rules reach the session | C1 passes | Task 7 builds the rules fallback; C1 and its `classes.tsv` row are deleted; Task 12 does not add RULES.md |
| P2 core rules reach a coo case | k0 passes | stop and report |
| P3 the helper loads and writes the call record | the kept K4 workspace has exactly one `agent-calls.jsonl`, at `.eval/`, with the original brief | stop and report |
| P4 the graders see the original call | K4's sonnet `tool_used` grader passes | stop and report |
| P5 `EVAL_STUB_REPLY_1` reaches the hook | the first Agent result is the digest, not `done` | stop and report |
| P6 the two-step flow goes on | K4 makes a second `Agent` call after the digest | stop and report |
| P7 no herdr stop | K4 does not end on a herdr relaunch question | add "No herdr here; go ahead with subagents." to K4 and to every coo prompt that enters coo |
| P8 a file grader reads `.git/` | C5's reflog grader explanation shows the file | stop and report |
| P9 the agent reads a `.claude/lessons.md` that the scaffold wrote | C7's search of it returns lines | stop and report |
| P10 effort | `claude plugin eval --help` has no effort flag | the README says "default effort" |

- [ ] `git -C <wt> rm -r plugins/coo/evals/k0-rules-probe`. Run check L. Commit that, plus any grader fixes the probes showed. Done when every row has a result and the lead has the table.

### Task 7: `eval-compare.sh` (opus, group C, after Tasks 4 and 6)

**Files:** Create `scripts/eval-compare.sh`, `scripts/tests/test_eval_compare_sh.py` and `scripts/tests/fake-claude`. The fake writes a fixture JSON to the `--json` path, logs its argv, and exits with `$FAKE_CLAUDE_EXIT`.

**Produces:**
```
scripts/eval-compare.sh <core|coo> <base> <head> [--suite-ref <ref>] [--reuse-base <results dir>] [--covers <text>] [--jobs <n>]
scripts/eval-compare.sh <core|coo> --aa <commit> [--suite-ref <ref>] [--no-plugin-arm] [--jobs <n>]
```
- The steps are the spec's run script, steps 1 to 6. `--suite-ref` defaults to `origin/main`, and `--jobs` passes `-j` (default 1).
- The caps are constants at the top: `cap_main_core=26`, `cap_main_coo=17` and `cap_rerun=4`. Task 13 resets them.
- Every call passes `--scaffold --allow-tools Bash Edit Write --trust-plugin --no-publish --threshold 0 --model opus --max-cost-usd <cap> --json --report --output-dir`. The ablation is `none`. A/A arm 1 with `--no-plugin-arm` uses `with-without`, with 2 × the main cap.
- **Env.** Unset every `ANTHROPIC_*` and `CLAUDE_CODE_*` variable except `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK` and `CLAUDE_CODE_USE_VERTEX`. Write the names kept and cleared (never the values) to `meta.txt`.
- **Suite copy.** `rm -rf <tree>/plugins/<suite>/evals <tree>/evals`, then `git archive <suite-ref> plugins/<suite>/evals evals/stub-workers | tar -x -C <tree>`.
- **Results.** They go in `${XDG_CACHE_HOME:-$HOME/.cache}/dds-evals/<date>/<suite>-<time>/`:
  - `base.json` and `head.json` (for an A/A run, `a1.json` and `a2.json`), and `rerun-<case>-<arm>.json`;
  - `exit-codes` and `classes.tsv` (taken from the suite ref);
  - `meta.txt`: the suite-ref commit, the suite hash, the run hash, the base and the head, the model, `claude --version` and the env names.
  - The script refuses a results folder inside the repo.
- **Hashes.** The suite hash is `git rev-parse --short <suite-ref>:plugins/<suite>/evals`. For the run hash, take `git ls-tree -r <suite-ref> -- plugins/<suite>/evals evals/stub-workers`, drop the `classes.tsv` and `README.md` lines, and pipe the rest to `git hash-object --stdin`.
- **Base reuse.** `--reuse-base` reuses `a2.json` only when the base commit, the run hash and the CLI version all match. Otherwise the script exits 2 and names the mismatch.
- **Reruns.** `eval-compare.py drops` gives the dropped cases. The first 3 each rerun on both trees with `--case <dir> --runs 6 --max-cost-usd $cap_rerun`. With `--reuse-base`, the script still makes the base tree, for the reruns.
- **Rules fallback.** Build it only if P1 failed. Write the tree's `RULES.md` into `append_system_prompt` in every copied case (add a python subcommand `inject-rules` for this), and pass `--rules-fallback`.
- **Cleanup.** A trap on EXIT, INT (exit 130) and TERM (exit 143) runs `git worktree remove --force` on both trees, then `git worktree prune`. The script prints the `line` output last, and exits 0 only with an `Eval:` line.

- [ ] Write these tests, then run them. They must fail. Each test builds a throwaway repo with two commits and a copy of the script:
  - `test_every_call_has_cap_and_no_publish`
  - `test_worktrees_removed_on_failure`: a fake exit of 2 or 1 leaves no temp worktree and no `Eval:` line.
  - `test_interrupt_cleans_up`: SIGINT gives exit 130 and no temp worktree.
  - `test_reuse_base_refused_on_hash_change`
  - `test_results_dir_inside_repo_refused`
  - `test_suite_copied_from_suite_ref`
- [ ] Implement the script. `python3 -m unittest discover -s <wt>/scripts/tests -v` prints `OK`. Run check L. Commit the three files.

### Tasks 8 to 11: the other cases (opus, group C, parallel on separate folders)

Each task writes complete case folders from the spec rows. Then it runs check B on every `fixture.sh`, check G on every file regex, `claude plugin validate` on its plugin, and check L. It commits only its own folders.

- **Task 8, core guards:** `c2-small-change-direct`, `c3-test-loads-audit`, `c4-rls-is-big` and `c6-bug-root-cause`.
  - C4's fixture adds `supabase/migrations/<YYYYMMDDHHmmss>_init.sql`.
  - C6's fixture switches `toCents` to `Math.floor`. Check B also shows that `npm test` fails on the cart test.
- **Task 9, core climbs:** `c8-comments-heavy-file`, `c9-build-the-ask`, `c10-smallest-review-fix`, `c11-review-against-ask` and `c12-subagent-brief`.
  - The C10 fixture commits round 1 as a separate commit.
  - Check G on C10 shows 0 matches on the unchanged spec, so a run that changes nothing scores 0.
  - In the built C11 workspace, `grep -rw Cut` prints nothing.
- **Task 10, coo entry and roles:** `k1-enter-on-verb`, `k2-enter-cross-repo`, `k3-no-enter-single` and `k5-role-split`.
  - K5's graders on `"model"` and `"name"` match the JSON-encoded input.
- **Task 11, coo flow:** `k6-review-before-pr`, `k7-third-round-asks`, `k8-irreversible-waits`, `k9-brief-quotes-ask` and `k10-nonblocking-in-scope`.
  - K6 and K10 make the branch `fix/empty-list` and the worktree `.worktrees/shop-api-fix`.
  - K6's `tool_order` matches on `description`.
  - K8's prompt makes clear that the user's approval is missing.
  - K10 writes its notes to `docs/review.md`, and its graders read `shop-api/docs/tracker.md`.
  - Each case's `env` sets the stub replies that its flow needs.

### Task 12: eval-targets and the contributor rule (sonnet, group C, after Task 6)

**Files:** Modify `.claude/eval-targets`: add `plugins/core/rules/RULES.md`, only if P1 passed. Modify `CONTRIBUTING.md`: under "Rule changes", add one item. A PR that changes a line that a core or coo case uses carries that suite's `Eval:` line from `scripts/eval-compare.sh`. A change that no case uses waives and names the gap. The PR author takes the cases from the spec's Coverage table and passes them with `--covers`.

- [ ] Make both edits, run check L, and commit both files.

### Task 13: measuring run, build step 1 (opus). NEEDS THE LEAD'S GO. Caps: $7 core and $5 coo, so $12 at worst

- [ ] Run Task 6's command for each suite with no `--keep-temp`. Use `--max-cost-usd 7` for core and `--max-cost-usd 5` for coo, and write to `.../dds-evals/<date>/measure`.
- [ ] From the JSON, find the mean `costUsd` per run for each case kind (light, task, review). Set the constants in `eval-compare.sh`:
  - `cap_main_<suite>` = 1.5 × the sum, over cases, of the cost per run × `runs`;
  - `cap_rerun` = 1.5 × 6 × the dearest guard run.
- [ ] Set each case's `max_turns` and `timeout_seconds` to at least 1.5 × the measured figures. Fix any grader that gave a wrong verdict; its explanation shows this.
- [ ] Write `plugins/core/evals/README.md` and `plugins/coo/evals/README.md`. Each says what the suite checks (with a link to the spec), how to run `scripts/eval-compare.sh`, the P1 to P10 results in one line each, the measured cost per case kind, and the caps.
- [ ] Run check L. Commit. Done when no run hit a turn or time cap, and the lead has the measured costs and the new caps for the go of Task 15.

### Task 14: review before the paid A/A (the lead)

A fix after the A/A run would change the run hash and cost a second A/A run, so the review comes first.

- [ ] Do a simplify pass, then a fresh code review of the whole branch. Fix what they find, run check L and commit.

### Task 15: A/A run and no-plugin arm, build step 2 (opus). NEEDS THE LEAD'S GO. Caps: these are the spec figures; Task 13 may replace them

- **Core:** arm 1 (two arms) $52, arm 2 $26, and up to 6 reruns at $4 each.
- **Coo:** arm 1 $34, arm 2 $17, and up to 6 reruns at $4 each.
- **Total:** about $84 expected, $177 at worst.

- [ ] Set `S=$(git -C <wt> rev-parse HEAD)`. Run `<wt>/scripts/eval-compare.sh core --aa 2e958ba --suite-ref "$S" --no-plugin-arm`, then the same for `coo`. In the no-plugin arm, the stub helper may be absent too, so coo leads may start real workers there. The cap bounds this.
- [ ] Fix each guard that failed any A/A run, or move it to climb (`classes.tsv` and `runs: 5`). Tag the guards in the `no-plugin` list `model-default`. Put each suite's A/A climb difference in its README as the noise floor.
- [ ] If a Fisher or permutation test flags the A/A, rerun it once, with a new go and the same caps. If it flags a second time, fix the suite.
- [ ] If any file that counts in the run hash changed, rerun the A/A once, with a new go and the same caps. Task 16's body and Task 17's base must match the suite commit.
- [ ] Run check L. Commit `classes.tsv`, the READMEs and the fixes.

### Task 16: suite PR, build step 3 (the lead). NEEDS THE OWNER'S YES to push and to open the PR

- [ ] After the yes: `git -C <wt> push -u origin feature/coo-core-evals`. Then `gh pr create`, with a body written with the `writing-for-others` skill that gives the A/A result and the probe table.
- [ ] `gh pr checks <N> --watch --fail-fast` (in the background) shows `validate` passing.

### Task 17: measure PR 28, build step 4 (opus). NEEDS THE LEAD'S GO for the cost and THE OWNER'S YES for the PR 28 body

- **Core:** head $26, plus up to 6 reruns at $4 each.
- **Coo:** head $17, plus up to 6 reruns at $4 each.
- **Total:** $91 at worst. With no base reuse, add $43.

- [ ] Set `S=$(git -C <wt> rev-parse HEAD)`, the suite branch head. `--reuse-base` is gated by the run hash, not by the suite hash, so Task 15's commits of `classes.tsv` and the READMEs do not void the A/A arm.
- [ ] Check that `gh pr view 28 --json headRefOid` still gives `e7bdc90…`, and that `git merge-base origin/main e7bdc90` is still `2e958ba…`. If either moved, drop `--reuse-base`. The base arm then runs fresh.
- [ ] Run `<wt>/scripts/eval-compare.sh core 2e958ba e7bdc90 --suite-ref "$S" --reuse-base <core A/A results dir> --covers "C3 C9 C10 C11 C12 and every guard"`, then the same for `coo` with `--covers "K9 K10 and every guard"` (spec, What the first run tells about PR 28). Each prints one `Eval:` line and exits 0.
- [ ] Give both lines to the lead. After the owner's yes, add them to PR 28's body with `gh pr edit 28 --body-file <file>`.

## Order and parallel groups

- **Group A**, in parallel: Tasks 1, 2, 3 and 4.
- Task 5 comes after Tasks 1 to 3. Task 6 (needs a go) comes after Task 5.
- **Group C**, in parallel after Task 6: Tasks 7, 8, 9, 10, 11 and 12. Task 7 also needs Task 4.
- Then, one at a time: Task 13 (go), Task 14 (review), Task 15 (go), Task 16 (owner's yes) and Task 17 (go, then the owner's yes).
- **Models:** sonnet for Tasks 1, 2 and 12. The lead does Tasks 14 and 16. Opus does the rest.
