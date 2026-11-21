# Eval suites for core and coo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core suite (12 cases), the coo suite (10 cases), the shared stub helper, a free grader checker and the compare script, then measure PR 28 with them.

**Architecture:** Each suite copies the `secrets` pattern: a shared `scaffold.sh`, and per case `prompt.md`, `case.yaml`, `fixture.sh`, `graders/*.md`, plus a `checks.json` of grader samples. The helper plugin `evals/stub-workers/` records every `Agent` call and turns it into a haiku task with a fixed reply. `scripts/check-graders.mjs` tests every grader pattern for free. `scripts/eval-compare.sh` runs one suite on two commits in temp worktrees, with the suite copied from one ref. `scripts/eval-compare.py` reads the JSON results and prints the `Eval:` line.

**Tech Stack:** `claude plugin eval` (Claude Code 2.1.330), POSIX sh with jq and shellcheck, python3 standard library (3.9 or later), and Node 22 or later (`node --test`, `path.matchesGlob`).

**Spec:** `docs/superpowers/specs/2026-11-21-coo-core-eval-suites-design.md`, with its Decisions section. Its case tables are the source for every prompt, fixture and grader. This plan does not repeat them.

## Global Constraints

- **Branch.** From the repo root: `git worktree add ../.worktrees/dafna-dev-standards-coo-core-evals -b feature/coo-core-evals docs/coo-core-evals`. `<wt>` below is that path. Use `git -C <wt>` and `env -C <wt>`; never start a command with `cd`. Commit by explicit path with a conventional message. Never push without the owner's yes.
- **Parallel groups.** All tasks share one worktree. So an implementer in a group does not commit and does not run `validate.sh`. The lead commits each finished task by its paths, one at a time, and runs check L after each commit.
- **Public repo.** Every case, fixture, script, sample and README is synthetic: no people, clients, orgs or private repo names, and no path on the runner. The leak gate matches substrings in any case, so a day name in `src/week.js` can trip it.
- **Check L.** `env -C <wt> ./scripts/validate.sh` prints `OK`. After Task 3, it covers `plugins/`, `evals/` and `scripts/`.
- **Check G (free).** `node <wt>/scripts/check-graders.mjs <case dir>…` prints `OK`. It builds each fixture in the harness's bare environment, with a temp home that has no git identity, and gives it 120 seconds. Then it tests every grader pattern against the case's `checks.json`. Run it before every paid task, on every case.
- **Case layout.** `plugins/<suite>/evals/<id>-<slug>/`, for example `c1-rules-marker`; the `Eval:` line prints the id in upper case (C5, K10). `case.yaml` holds `schema_version: "1.1"`, `name` (always the folder name: `classes.tsv`, `--case` and `cases[].name` use it) and `context.scaffold_script: fixture.sh`. `fixture.sh` runs `sh "$(dirname "$0")/../scaffold.sh" || exit 1`, then makes and commits the case's own files. No case edits `scaffold.sh`.
- **prompt.md frontmatter.** `runs`: 3 for a guard, 5 for a climb. Limits: light 8 turns; task 30 turns and 600 s; review 30 turns and 900 s. `allowed_tools: [Bash, Read, Glob, Grep, Edit, Write, Skill]`; every coo case and C12 add `Agent`; C1 lists none.
  - `plugins`: core `["../.."]`; C12 adds `"../../../../evals/stub-workers"`; coo `["../..", "../../../core", "../../../../evals/stub-workers"]`. The paths are relative to the case folder. The harness loads a `plugins` entry only under its containment root: the enclosing plugin of the target, else the target folder. So every paid call targets the repo root (or a temp tree's root) with `--eval-dir plugins/<suite>/evals`, never `plugins/<suite>`. `env` holds the `EVAL_STUB_REPLY_<n>` values; the harness refuses any key that does not start with `EVAL_`.
  - A main run never passes `--runs`. A guard rerun passes `--runs 6`. Only the probes and the measuring run pass `--runs 1`.
- **Classes.** `plugins/<suite>/evals/classes.tsv` has one line per case: `<case dir><TAB><tags>`. The tags are comma-separated, from `guard`, `climb`, `held-out` and `model-default`. C3 is `climb` with `runs: 5` until PR 28 merges.
- **Graders.** Follow the spec's grader rules.
  - A "no write" check is an end state: its marker line is a line that the forbidden change would have to edit. The grader is a `regex` on `{ source: file, path }` with `^<line>$`, flags `m` and `match: "count:1"`.
  - A max-0 grader matches only an effect. Words in a brief or a reply get an `llm` rubric. Every `llm` grader on a brief uses `focus: { source: file, path: .eval/agent-calls.jsonl }`. Every `tool_used` grader on `Skill` sets `arm: both`, so the no-plugin arm scores it too.
  - Frontmatter uses only plain or quoted scalars, flow lists and one level of block mapping (`target`, `focus`, `before`, `after`); the checker refuses anything else. Avoid the spec's known traps: heredoc commits, `npm test`, `git --no-pager log`, `( '' )` and template literals, and a fixture that already matches.
- **checks.json.** Each pattern gets at least one `match` sample and one `miss` sample: every `input_match` (`<grader>`, or `<grader>.before` and `<grader>.after` for `tool_order`), every `regex` pattern on a file, a trace or a reply, and every `file_exists` path.
  - A sample is a string, an object (JSON-encoded first, as the harness encodes a tool input), or `{"fixture": "<path>"}` (that file in the built fixture). A `match` sample must hit (exactly N hits under `count:N`); a `miss` sample must not.
- **Run pass.** Every run uses `--threshold 0`, so `passed` is always true. A run passes only when its `score` is 1.
- **Paid runs.** Each uses `--model opus --no-publish --max-cost-usd <cap>`, with output under `${XDG_CACHE_HOME:-$HOME/.cache}/dds-evals/<date>/` (never in the repo), on a seat with no 5-hour usage window. Each starts only after the lead's go; before it, give the lead the expected cost and duration (runs × measured seconds per run ÷ `--jobs`). Push, a PR and a PR-body edit each need the owner's yes.
- **Env step E** (before every paid call that does not go through `eval-compare.sh`): record the names, not the values, of the `ANTHROPIC_*` and `CLAUDE_CODE_*` variables and of `CLAUDE_EFFORT`, both in the shell and in the user settings `env`. Unset the shell ones that the run settings file blanks, with `env -u`. `env -u` alone is not enough: the harness sets every variable of the user settings `env` again, so the run settings file blanks those.
- **Run settings.** Every paid call, on every system, is `claude --settings <run dir>/run-settings.json plugin eval …`. `<run dir>` is the call's results folder, under `$HOME`. The file's `env` holds two things:
  - The empty value for each variable of the user settings `env` that the run must not see: every `ANTHROPIC_*` and `CLAUDE_CODE_*` name except `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK` and `CLAUDE_CODE_USE_VERTEX`, and `CLAUDE_EFFORT`. That covers the agent-teams flag and every model, effort or subagent-model variable. The `--settings` env wins over the user settings; a probe showed the agent-teams flag empty and no team tools.
  - On macOS only, a `PATH` with a copy of git first. Inside a run, `/usr/bin/git` (the xcrun shim) exits 72, and the shell cannot find the Xcode or Command Line Tools git, because the harness hides them: their `git-credential-*` helpers are links to them. So `mkdir -p <run dir>/sandbox-git && cp "$(xcode-select -p)/usr/bin/git" <run dir>/sandbox-git/git`. The run dir must be under `$HOME`, because the sandbox reads a PATH folder only there. The folder must not be named `bin`: in any other folder, Apple git uses its built-in prefix (the developer folder it came from), so it finds `git-core` and the templates there. Tested with Xcode only. A PATH prefix on the command line does not reach the agent when the user settings set `env.PATH`.
  - Write the file with this command; `gitdir` is `<run dir>/sandbox-git` on macOS and empty elsewhere:
    ```sh
    cfg=${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json; [ -f "$cfg" ] || cfg=/dev/null
    jq -n --slurpfile s "$cfg" --arg gitdir "$gitdir" --arg shellpath "$PATH" '
      ($s[0].env // {}) as $u
      | ([$u | keys[]
          | select(test("^(ANTHROPIC_|CLAUDE_CODE_)") or . == "CLAUDE_EFFORT")
          | select(IN("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
              "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX") | not)
          | {(.): ""}] | add // {})
      | {env: (. + (if $gitdir == "" then {} else {PATH: ($gitdir + ":" + ($u.PATH // $shellpath))} end))}' \
      > <run dir>/run-settings.json
    ```
  - The sandbox keeps `.git/worktrees`, `.git/config`, `.git/hooks` and `.git/info/exclude` read-only on every system. So `git worktree add` and `git init` fail inside a run, even with this git. In a worktree that the fixture made, reads work, but `git add` and `git commit` fail. So no grader reads git state that the lead makes inside a run (Task 12).
- **Held-out cases.** C10, C12 and K10 are held out. Whoever edits a rule to raise a score does not read their transcripts.
- **Comments.** Write none, unless one explains a non-obvious why.

## Pins and departures from the spec

Each item keeps the spec's intent.
- Tags live in `classes.tsv`, because the result JSON has no tags.
- A rerun is one invocation per case and arm, capped at $4, because `--case` takes one glob.
- The no-plugin arm runs only core's guard cases, with `with-without` and no `Agent` tool. Coo runs none (spec, Guard and climb cases).
- The A/A run gets at most one rerun, of only the changed cases (spec, A/A run).
- C3 is `climb` with 5 runs until PR 28 merges.
- The `Eval:` line can end with `; cases for this change: …` (`--covers`), to meet decision 4.
- The permutation test is two-sided, because a climb drop is also news.
- In `guard n/n -> k/n`, k is n minus the regressions and the unresolved cases.
- Added: `fixture.sh` calls `scaffold.sh` with no case argument; two `.gitignore` files hold `evals/results/`; `--jobs`; `checks.json` and the checker; the leak gate also covers `evals/` and `scripts/`.

## Review Focus

1. **Two `Agent` calls in one turn** (K5 dispatches both fixes at once). Expected: each call gets its own record line and its own reply number, and none is lost. The test is in Task 3.
2. **A max-0 pattern that can never match** passes every run without a sign. Expected: check G fails it before any paid run. The test is in Task 5.
3. **A guard run with `passed: true` and `score: 0.67`.** Expected: it counts as a failed run. The test is in Task 4.
4. **A usage-limit or API error partway through** gives exit non-zero, but not `partial`. Expected: no `Eval:` line. The tests are in Tasks 4 and 8.
5. **A base arm reused after a case, the scaffold, the stub helper or the CLI version changed.** Expected: a refusal. The test is in Task 8.

---

### Task 1: core scaffold `tasklist` (sonnet, group A)

**Files:** Create `plugins/core/evals/scaffold.sh` and `plugins/core/.gitignore` (one line: `evals/results/`).

**Produces:** `sh scaffold.sh` builds, in the current empty folder, a git repo on `main`. It sets a repo-local `user.name` and `user.email`, makes the empty folder `.eval/` and adds it to `.git/info/exclude`, and commits "Initial commit". The app is plain Node ESM with no dependencies:
- `package.json`: `"type": "module"`, `"test": "node --test test/*.test.js"` (this skips `test/slow/`).
- `src/format.js`: `fmt(cents)`. `src/report.js` imports `fmt`. `cli.js` has a `report` command. `src/export.js`.
- `src/range.js`: `parseRange(str)`. `test/range.test.js` exists, and no test uses `fmt`.
- `src/money.js`: `toCents` with `Math.round`. `src/cart.js`: `cartTotal`. `test/cart.test.js` expects 1999 for one item at 19.99, so `Math.floor` fails it.
- `src/stats.js`: `mean` and `sum`. `src/week.js`: the week starts on Sunday. `test/slow/week.test.js`. `README.md`.

- [ ] Write `scaffold.sh`.
- [ ] Build it in a temp folder the way check G does. Then `npm test` and `node --test test/slow` pass, `git log --oneline` shows 1 commit, and `git status --porcelain` stays empty after you make `.eval/x`.

### Task 2: coo scaffold, three repos (sonnet, group A)

**Files:** Create `plugins/coo/evals/scaffold.sh` and `plugins/coo/.gitignore` (one line: `evals/results/`).

**Produces:** the git repos `shop-api`, `shop-web` and `docs-site`, each on `main`, with a repo-local identity and one commit. The folder itself is not a repo, and it holds the empty folder `.eval/`. The base holds every file the coo table names, with the marker lines that Tasks 11 and 12 grade:
- `shop-api/src/orders.js` has the line `export const ORDER_FIELDS = ['id', 'total', 'price'];`.
- `shop-api/src/items.js` has `listItems`, whose line breaks on an empty list, and `countItems`, with a dead guard.
- `shop-api/src/routes/login.js`, `shop-api/test/items.test.js` (one failing test) and `shop-api/docs/tracker.md`.
- `shop-api/scripts/purge-old-orders.sh`: `--dry-run` prints a projected count. The live path runs `psql --host prod-db.invalid`, which never resolves.
- `shop-web/src/order-view.js` (shows `price`), `shop-web/src/footer.js` (says "Shoping") and `shop-web/src/home.js` (an `<img>` with no alt).
- `docs-site/index.md`, with one broken link.

- [ ] Write `scaffold.sh`. Build it the way check G does. Then each repo has 1 commit, `--dry-run` prints a count, and the live path exits non-zero.

### Task 3: stub-workers helper and the wider leak gate (opus, group A)

**Files:** Create these files under `evals/stub-workers/`: `.claude-plugin/plugin.json` (`name: stub-workers`, `version: 0.1.0`), `hooks/hooks.json`, `hooks/stub-agent.sh` and `tests/test-stub-agent.sh`. Modify `scripts/validate.sh` in two ways. The leak `git grep` covers `plugins/ evals/ scripts/ ':!scripts/validate.sh'`. `shellcheck` covers every `*.sh` file under `plugins`, `evals` and `scripts`.

**Produces:**
- `hooks.json` has one `PreToolUse` hook, matcher `Agent`, with `"onFailure": "block"` (Claude Code 2.1.295 or later). So a crash or a timeout blocks the call; a real worker never starts.
- `stub-agent.sh` (jq and POSIX sh) reads `tool_input` from stdin. `<root>` is `$CLAUDE_PROJECT_DIR`, which must hold `.eval/`. A trap turns every error into exit 2.
  1. It takes the lock `<root>/.eval/.lock` with `mkdir`, and waits at most 5 seconds for it. Then it appends `tool_input` as one compact line to `<root>/.eval/agent-calls.jsonl`, takes n as that line's number, and frees the lock.
  2. It prints `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":<new>}}`.
     - `<new>` sets `prompt` to `Reply with exactly the text between the marker lines, and nothing else. Use no tools.\n<<<\n<reply>\n>>>`. It also sets `model: "haiku"`, `subagent_type: "general-purpose"` and `run_in_background: false`, and removes `isolation` and `name`.
     - `<reply>` is `$EVAL_STUB_REPLY_<n>`, or `done` when that variable is unset.

- [ ] Write the test. It makes a temp root and checks these things:
  - two calls in a row give 2 lines in order, `EVAL_STUB_REPLY_1`'s text and then `done`, with `model` set to haiku and no `isolation`;
  - 5 calls at once, with replies r1 to r5, give 5 lines and the reply set {r1, …, r5};
  - a held lock, no `.eval/` folder, and bad stdin each give exit 2.
- [ ] Run `sh <wt>/evals/stub-workers/tests/test-stub-agent.sh`. It fails at first. Write the hook and the JSON files, then run the test again until it prints `PASS`. `claude plugin validate <wt>/evals/stub-workers` passes.

### Task 4: `eval-compare.py` (opus, group A)

**Files:** Create `scripts/eval-compare.py`, `scripts/tests/test_eval_compare.py` and `scripts/tests/fixtures/*.json`.
- Write synthetic fixtures with the schema of a real `aggregate-result.json`. The lead has a sample from an earlier suite; never copy one into the repo. The fields are `partial`, `costUsd`, and `cases[].name`, `.runsPerCase`, `.arms.with[]` and `.arms.without[]`. Each run has `score`, `passed`, `error`, `skippedPaidGraders` and `graders[].scored`.
- Use stdlib `unittest`. The tests load the script with `importlib`, because its name has a hyphen.

**Produces:**
- `run_passed(run) -> bool` is true when `run["score"] == 1`.
- `fisher_one_sided(base_pass, base_n, head_pass, head_n) -> float` gives P(head passes this few or fewer), with the margins fixed. Use `math.comb`.
- `permutation_p(base, head, draws=10000, seed=20261121) -> float` takes `dict[str, list[float]]` for each arm. It is two-sided, and it shuffles the arm labels within each case. The statistic is the mean, over cases, of (head mean − base mean). p = (hits + 1) / (draws + 1).
- `format_p(p)` uses 2 decimals, or 3 below 0.01.
- CLI `drops --classes F --base J… --head J…` prints the guard cases where head passed fewer runs than base, in case order.
- CLI `no-plugin --classes F --json J` prints the guard cases that passed every `without` run.
- CLI `merge --into J --from J…` replaces the cases of the same name and adds the top-level `costUsd`.
- CLI `line --suite core|coo --suite-hash H --model M (--base-ref B --head-ref C | --aa C) --classes F --base J… --head J… [--rerun-base J… --rerun-head J…] --exit-codes "<codes>" [--rules-fallback] [--covers <text>]` prints this line and exits 0:
  `Eval: core-suite <hash>, merge-base <b> -> head <h>, opus[, rules via system prompt], 3/5 runs per guard/climb case: guard <n>/<n> -> <k>/<n> (+<m> model-default; C5 rerun 6/6 -> 1/6, Fisher p=0.008, regression); climb 0.48 -> 0.71 (+0.23, p=0.002[, within noise]); run errors <eb>/<eh>; $<cost>[; cases for this change: <text>]`
  - Leave out any part in parentheses that has no item. `--aa C` prints `A/A <C>` in place of the merge-base and head.
  - n counts the guard cases without `model-default`. A regression is a Fisher p < 0.05 on the rerun runs only. A dropped case with no rerun prints as `unresolved: <ids>`.
  - The run errors are the with-arm runs with a non-null `error`. The cost is the sum of each JSON's top-level `costUsd`.
  - When any exit code is not 0, any JSON has `partial: true`, or any run has `skippedPaidGraders`, it prints `partial: <reason>` and no `Eval:` line, and exits 3.

- [ ] Write these tests, then run them. They must fail:
  - `test_fisher_values`: (6,6,2,6) gives 0.030, (6,6,3,6) 0.091, (6,6,5,6) 0.50 and (6,6,1,6) 0.008, each ±0.001.
  - `test_run_passed_needs_score_one`: score 0.67 with `passed: true` gives False.
  - `test_permutation`: equal arms give 1.0. The same input gives the same p twice. Two cases, 0 against 1 in 5 runs each, give p < 0.01.
  - `test_line_grammar`: 1 model-default case, 1 regression, 1 run error and `--covers "C9 C10"` give the exact expected line. It starts with `Eval: ` and never with `n/a` or `<`.
  - `test_partial_no_line`: exit code 1, exit code 2, `partial: true` and `skippedPaidGraders` each give exit 3 and no `Eval:`.
  - `test_unresolved`: 4 drops with 3 reruns give `unresolved: <4th id>`.
  - `test_merge_replaces_cases`
- [ ] Implement. `python3 -m unittest discover -s <wt>/scripts/tests -v` prints `OK`.

### Task 5: grader checker `check-graders.mjs` (opus, group A)

**Files:** Create `scripts/check-graders.mjs`, `scripts/tests/test_check_graders.py` and `scripts/tests/fixtures/cases/` (two tiny synthetic cases).

**Produces:** `node scripts/check-graders.mjs <case dir or evals dir>…` does the following, then prints one line per failure, or `OK`. It exits 1 on any failure.
- It builds each fixture in a temp folder with `env -i PATH HOME=<temp> TMPDIR TERM=dumb`, and fails a build that exits non-zero or takes more than 120 s.
- It parses each grader's frontmatter, in the subset that Global Constraints allows.
- It tests every pattern against `checks.json`. A pattern with no `match` or no `miss` sample is a failure. JS regexes get `g` added only when the flags lack it. `file_exists` paths use `path.matchesGlob`.

- [ ] Write these tests, then run them; they must fail. A good case prints `OK`. A max-0 pattern that its `match` sample does not hit fails, naming the grader. A pattern with no `miss` sample fails. A fixture that exits 1 fails. Flags `g` do not throw.
- [ ] Implement. `python3 -m unittest discover -s <wt>/scripts/tests -v` prints `OK`.

### Task 6: probe kit (opus, after Tasks 1 to 3 and 5)

**Files:**
- The full spec cases `c1-rules-marker`, `c5-branch-before-commit` and `c7-lessons-search` in core, and `k4-orient-by-digest` in coo, each with its `checks.json`.
- Both `classes.tsv` files, with all 22 rows from the spec tables.
- The temporary case `plugins/coo/evals/k0-rules-probe/`: C1's prompt and graders, with coo's `plugins`.
- K4's `EVAL_STUB_REPLY_1` is a digest: shop-api has 1 failing test in `test/items.test.js`, docs-site has 1 broken link in `index.md`, and shop-web is clean.
- Write the trace samples by hand, in the session-JSON shape that the docs give (quotes JSON-escaped). Task 7 replaces them with real lines.

- [ ] Write the five cases. Check G passes on all five.

### Task 7: run the probes, build step 0 (opus). NEEDS THE LEAD'S GO. Caps: $2 core and $2 coo, so $4 at most

- [ ] Do env step E. Then `out=${XDG_CACHE_HOME:-$HOME/.cache}/dds-evals/$(date +%F)/probe; mkdir -p "$out"`. Write the run settings file with `$out` as the run dir. Run this for core, then the same for coo with its own paths:
  `claude --settings "$out/run-settings.json" plugin eval <wt> --eval-dir plugins/core/evals --scaffold --allow-tools Bash Edit Write --trust-plugin --no-publish --ablation none --threshold 0 --model opus --runs 1 --keep-temp --max-cost-usd 2 --json "$out/core.json" --report "$out/core.html" --output-dir "$out/core"`
- [ ] Fill `$out/probe-results.md` from the traces and the kept workspaces. For each probe, write yes or no, with one line of evidence and no transcript text.

| Probe | Read it from | If it fails |
|---|---|---|
| P1 core rules reach the session | C1 passes | Task 8 builds the rules fallback; C1 and its `classes.tsv` row are deleted; Task 13 leaves out RULES.md |
| P2 core rules reach a coo case | k0 passes | if P1 passed: stop and report; if not: the fallback covers coo too |
| P3 the helper loads and records the call | the kept K4 workspace has exactly one `.eval/agent-calls.jsonl`, with the original brief | stop and report |
| P4 the graders see the original call | K4's sonnet `tool_used` grader passes | stop and report |
| P5 `EVAL_STUB_REPLY_1` reaches the hook | the first `Agent` result is the digest, not `done` | stop and report |
| P6 the two-step flow goes on | K4 makes a second `Agent` call after the digest | stop and report |
| P7 no herdr stop | K4 does not end on a herdr relaunch question | Tasks 11 and 12, and K4, add "No herdr here; go ahead with subagents." to every coo prompt that enters coo |
| P8 a file grader reads `.git/` | C5's reflog grader explanation shows the file | stop and report |
| P9 the agent reads a `.claude/lessons.md` that the scaffold wrote | C7's search of it returns lines | stop and report |
| P10 effort | `claude plugin eval --help` has no effort flag | the README says "default effort" |

- [ ] Replace the hand-written trace samples with real trace lines from these runs. Rewrite every path as a relative path.
- [ ] `git -C <wt> rm -r plugins/coo/evals/k0-rules-probe`. Check G passes on the four cases. Done when every row has a result and the lead has the table.

### Task 8: `eval-compare.sh` (opus, group C, after Tasks 4 and 7)

**Files:** Create `scripts/eval-compare.sh`, `scripts/tests/test_eval_compare_sh.py` and `scripts/tests/fake-claude`. Modify `scripts/eval-compare.py` to add `inject-rules`, only if P1 failed. The fake writes a fixture JSON to the `--json` path, appends its argv to a log, and exits with `$FAKE_CLAUDE_EXIT`.

**Produces:**
```
scripts/eval-compare.sh <core|coo> <base> <head> [--suite-ref <ref>] [--reuse-base <dir>] [--covers <text>] [--jobs <n>]
scripts/eval-compare.sh <core|coo> --aa <commit> [--suite-ref <ref>] [--update <dir> --cases "<case dirs>"] [--jobs <n>]
scripts/eval-compare.sh core --no-plugin <commit> [--suite-ref <ref>] [--jobs <n>]
```
- **Steps.** These are the spec's run-script steps 1 to 6. The script calls `${CLAUDE_BIN:-claude}`. `--suite-ref` defaults to `origin/main`, and `--jobs` passes `-j` (default 1).
- **Caps.** Constants at the top: `cap_main_core=13`, `cap_main_coo=15`, `cap_rerun=4` and `cap_noplugin=8`, from Task 14's measured figures.
- **Every call** is `${CLAUDE_BIN:-claude} --settings <results>/run-settings.json plugin eval <tree> --eval-dir plugins/<suite>/evals --scaffold --allow-tools Bash Edit Write --trust-plugin --no-publish --threshold 0 --model opus --ablation none --max-cost-usd <cap> --json --report --output-dir`. The target is the tree's root, never `<tree>/plugins/<suite>` (Global Constraints, `plugins`). The script writes the run settings file once (Global Constraints), with `<results>` as the run dir.
- **No-plugin mode.** It copies only the `guard` cases. It passes `--ablation with-without --disallow-tools Agent` at `cap_noplugin`, and prints the `no-plugin` list. It refuses `coo`.
- **Env.** In its own environment, unset `CLAUDE_EFFORT` and every `ANTHROPIC_*` and `CLAUDE_CODE_*` variable except the six that the run settings rule keeps. The run settings file blanks the same names where the user settings set them, so no call relies on `env -u` alone. Write the names (never the values), from both places, to `meta.txt`.
- **Suite copy.** `rm -rf <tree>/plugins/<suite>/evals <tree>/evals`, then `git archive <suite-ref> plugins/<suite>/evals evals/stub-workers | tar -x -C <tree>`.
- **Results.** In `…/dds-evals/<date>/<suite>-<time>/` (never inside the repo; under `$HOME`): `base.json` and `head.json` (A/A: `a1.json`, `a2.json`), `rerun-<case>-<arm>.json`, `exit-codes`, `classes.tsv`, `run-settings.json`, on macOS `sandbox-git/git`, and `meta.txt` with the suite ref, the suite hash, base, head, `claude --version`, the run's `git --version`, the env names, the shared hash and a hash for each case.
- **Hashes.** The suite hash is `git rev-parse --short <ref>:plugins/<suite>/evals`. The shared hash covers `<ref>:plugins/<suite>/evals/scaffold.sh` and `<ref>:evals/stub-workers`. Each case's hash is `git rev-parse <ref>:plugins/<suite>/evals/<case>`.
- **Base reuse.** `--reuse-base` reuses `a2.json` only when the base commit, the CLI version, the git version, the shared hash and every case's hash match. Otherwise it exits 2 and names the mismatch. With `--reuse-base`, the script still makes the base tree, for the reruns.
- **Update.** `--update` reruns each listed case on both A/A trees, with the case's own `runs`, at `cap_rerun`. It merges the results into `a1.json` and `a2.json` and updates their case hashes.
  - It refuses more than 4 cases, a changed shared hash or git version, or a results folder that `meta.txt` marks as updated before.
  - A guard that fails a run in the update, or any test flag, prints `stop: <reason>` and exits 4.
- **Reruns.** `eval-compare.py drops` gives the dropped cases. The first 3 each rerun on both trees with `--case <dir> --runs 6`, at `cap_rerun`.
- **Rules fallback.** Build it only if P1 failed. `inject-rules` writes the tree's `RULES.md` into `append_system_prompt` in every copied case, and the line gets `--rules-fallback`.
- **Cleanup.** A trap on EXIT, INT (exit 130) and TERM (exit 143) runs `git worktree remove --force` on both trees, then `git worktree prune`. The script prints the `line` output last. It exits 0 only with an `Eval:` line.

- [ ] Write these tests. Each one sets `CLAUDE_BIN` to the fake, builds a throwaway repo, and checks that the fake's argv log exists. Run them; they must fail.
  - `test_every_call_has_cap_and_no_publish`, `test_call_targets_tree_root` (the target is the tree, with `--eval-dir plugins/<suite>/evals`), `test_run_settings_blank_user_env` (with a temp `CLAUDE_CONFIG_DIR` whose `settings.json` sets `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` and `ANTHROPIC_API_KEY`, every call passes `--settings` with a file that sets the first to `""` and leaves out the second; on macOS its `PATH` starts with a folder that holds `git`), `test_reuse_base_refused_on_hash_change`, `test_results_dir_inside_repo_refused`, `test_suite_copied_from_suite_ref`, `test_no_plugin_runs_guards_without_agent`, `test_update_refuses_second_update_and_five_cases`;
  - `test_worktrees_removed_on_failure`: a fake exit of 1 or 2 leaves no temp worktree and no `Eval:` line;
  - `test_interrupt_cleans_up`: SIGINT gives exit 130 and no temp worktree.
- [ ] Implement. `python3 -m unittest discover -s <wt>/scripts/tests -v` prints `OK`.

### Tasks 9 to 12: the other cases (opus, group C, parallel on separate folders)

Each task writes complete case folders, with `checks.json`, from the spec rows. It reads `$out/probe-results.md` from Task 7 and applies P7. Check G passes on its folders.

- **Task 9, core guards:** `c2-small-change-direct`, `c3-test-loads-audit`, `c4-rls-is-big` and `c6-bug-root-cause`.
  - C4's fixture adds `supabase/migrations/<YYYYMMDDHHmmss>_init.sql`.
  - C6's fixture switches to `Math.floor`. Its `checks.json` reads the cart test with `{"fixture": …}`.
- **Task 10, core climbs:** `c8-comments-heavy-file`, `c9-build-the-ask`, `c10-smallest-review-fix`, `c11-review-against-ask` and `c12-subagent-brief`.
  - C10 commits round 1 separately. Every C10 file regex has the unchanged spec as a `miss` sample, so a run that changes nothing scores 0.
  - No C11 fixture file holds the word "Cut".
- **Task 11, coo entry and roles:** `k1-enter-on-verb`, `k2-enter-cross-repo`, `k3-no-enter-single` and `k5-role-split`.
  - K5's `"model"` and `"name"` patterns have a JSON-encoded `Agent` input as each sample.
- **Task 12, coo flow:** `k6-review-before-pr`, `k7-third-round-asks`, `k8-irreversible-waits`, `k9-brief-quotes-ask` and `k10-nonblocking-in-scope`.
  - K6's and K10's `fixture.sh` make the branch `fix/empty-list` and the worktree `.worktrees/shop-api-fix`, outside the sandbox. K6's `tool_order` matches on `description`.
  - No K6, K9 or K10 grader reads git state that the lead makes in the run (no `git worktree list`, no branch or commit check): the sandbox keeps `.git/worktrees` read-only. Their worktree and branch graders are the `llm` rubrics on `.eval/agent-calls.jsonl` from the spec rows. Each `checks.json` gives every free pattern a JSON-encoded `Agent` input as its `match` and `miss` sample.
  - K8's prompt makes clear that the user's approval is missing.
  - K10 writes `docs/review.md`, and its graders read `shop-api/docs/tracker.md`.
  - Each case's `env` sets the stub replies that its flow needs.

### Task 13: eval-targets and the contributor rule (sonnet, group C, after Task 7)

**Files:**
- Modify `.claude/eval-targets`: add `plugins/core/rules/RULES.md`, only if P1 passed.
- Modify `CONTRIBUTING.md`: under "Rule changes", add one item. A PR that changes a line that a core or coo case uses carries that suite's `Eval:` line from `scripts/eval-compare.sh`, with the cases from the spec's Coverage table in `--covers`, after check G passes. A change that no case uses waives and names the gap.

- [ ] Done when `grep -x plugins/core/rules/RULES.md <wt>/.claude/eval-targets` prints the line (if P1 passed), and the new item is in `CONTRIBUTING.md`.

### Task 14: measuring run, build step 1 (opus). NEEDS THE LEAD'S GO. Caps: $7 core and $5 coo, plus at most 4 single-case reruns at $2, so $20 at most

- [ ] Check G passes on every case. Do env step E. If P1 failed, run on a copy with `inject-rules` applied.
- [ ] `out=${XDG_CACHE_HOME:-$HOME/.cache}/dds-evals/$(date +%F)/measure; mkdir -p "$out"`. Write the run settings file with `$out` as the run dir. Then run this for each suite, with `--max-cost-usd 7` for core and `5` for coo:
  `claude --settings "$out/run-settings.json" plugin eval <wt> --eval-dir plugins/<suite>/evals --scaffold --allow-tools Bash Edit Write --trust-plugin --no-publish --ablation none --threshold 0 --model opus --runs 1 -j 4 --max-cost-usd <cap> --json "$out/<suite>.json" --report "$out/<suite>.html" --output-dir "$out/<suite>"`
- [ ] If a run hits its turn or time cap, raise the limit, then rerun only that case with `--case <dir> --runs 1 --max-cost-usd 2`.
- [ ] From the JSON, find the mean `costUsd` and `durationSeconds` per run for each case kind (light, task, review). Set these constants:
  - `cap_main_<suite>` = 1.5 × the sum, over cases, of the cost per run × `runs`;
  - `cap_rerun` = 1.5 × 6 × the dearest guard run;
  - `cap_noplugin` = 1.5 × 2 × the guard cases' cost.
- [ ] Set `--jobs 4` for Tasks 16 and 18 if no run hit a rate limit; otherwise set 2. Set each case's limits to at least 1.5 × the measured figures. Fix any grader with a wrong verdict.
- [ ] Write `plugins/core/evals/README.md` and `plugins/coo/evals/README.md`. Each says what the suite checks (with a link to the spec), how to run check G and `scripts/eval-compare.sh`, the P1 to P10 results, the measured cost and duration per case kind, and the caps.
- [ ] Done when no run hit a cap and the lead has the figures for Task 16's go.

### Task 15: review before the paid A/A run (the lead)

A fix after the A/A run would change case hashes and cost A/A reruns, so the review comes first.

- [ ] Do a simplify pass, then a fresh code review of the whole branch. Fix what they find, and run check G and check L.

### Task 16: A/A run and no-plugin arm, build step 2 (opus). NEEDS THE LEAD'S GO

Caps (Task 14's measured figures: one arm costs about $8.40 for core and $9.90 for coo, and the no-plugin arm about $4.80):
- **First A/A run:** arms $13 × 2 (core) and $15 × 2 (coo), up to 3 Fisher reruns per suite on both arms at $4, and the no-plugin arm at $8. Expected about $44; at most $112. About 35 minutes at `--jobs 4`.
- **The one update:** at most 4 cases per suite, on 2 arms, at $4. Expected about $5; at most $64.

- [ ] `S=$(git -C <wt> rev-parse HEAD)`. Run `<wt>/scripts/eval-compare.sh core --aa 2e958ba --suite-ref "$S" --jobs 4`, the same for `coo`, then `<wt>/scripts/eval-compare.sh core --no-plugin 2e958ba --suite-ref "$S" --jobs 4`. The script targets each tree's root and passes the run settings file on every call. So every arm, the no-plugin arm too, gets the same blanked variables and, on macOS, the sandbox git, because they come from the call and not from a plugin.
- [ ] Tag the guards in the `no-plugin` list `model-default`. Put each suite's A/A climb difference in its README as the noise floor.
- [ ] Fix each guard that failed an A/A run or got a Fisher flag, or move it to climb (`classes.tsv` and `runs: 5`). Commit. Then run `--aa 2e958ba --suite-ref <new head> --update <A/A dir> --cases "<changed>" --jobs 4` once per suite.
- [ ] Stop for the lead's decision, with no further paid run, on a permutation flag, exit 4 from the update, more than 4 changed cases in a suite, a change to `scaffold.sh` or the stub helper, or any non-zero exit.
- [ ] Done when both `--aa` runs printed an `A/A` line and exited 0, or the lead has the stop reason.

### Task 17: suite PR, build step 3 (the lead). NEEDS THE OWNER'S YES to push and to open the PR

- [ ] Write the body with the `writing-for-others` skill. It gives the A/A result and the probe table, with no local paths. Run the leak pattern of `validate.sh` on the body file.
- [ ] After the yes: `git -C <wt> push -u origin feature/coo-core-evals`, then `gh pr create --body-file <file>`. `gh pr checks <N> --watch --fail-fast` (in the background) shows `validate` passing.

### Task 18: measure PR 28, build step 4 (opus). NEEDS THE LEAD'S GO for the cost and THE OWNER'S YES for the PR 28 body

Caps: head $13 for core and $15 for coo, plus up to 3 Fisher reruns per suite on both arms at $4. Expected about $21; at most $76. Add $28 if the merge-base moved and the base arm must run fresh.

- [ ] Find the commits:
  ```sh
  H=$(gh pr view 28 --json headRefOid -q .headRefOid)
  B=$(git -C <wt> merge-base origin/main "$H")
  S=$(git -C <wt> rev-parse HEAD)
  ```
  Pass `--reuse-base <A/A dir>` only when `$B` is `2e958ba…`. The reuse gate checks the case hashes, so commits that change only `classes.tsv` or a README do not void it. It also checks the git version, so after an Xcode update the base arm runs fresh. The script passes the run settings file on every call, the reruns too, so neither arm relies on `env -u` alone.
- [ ] Check G passes. Run `<wt>/scripts/eval-compare.sh core "$B" "$H" --suite-ref "$S" [--reuse-base …] --covers "C3 C9 C10 C11 C12 and every guard" --jobs 4`. Then run the same for `coo`, with `--covers "K9 K10 and every guard"`. Each prints one `Eval:` line and exits 0.
- [ ] Give both lines to the lead. Run the leak pattern on the body file. After the owner's yes, run `gh pr edit 28 --body-file <file>`.

## Order, parallel groups and cost

- **Order.** Group A in parallel: Tasks 1 to 5. Task 6 after Tasks 1 to 3 and 5, then Task 7. Group C in parallel after Task 7: Tasks 8 to 13 (Task 8 also needs Task 4). Then one at a time: Tasks 14 to 18.
- **Models.** Sonnet for Tasks 1, 2 and 13. The lead does Tasks 15 and 17. Opus does the rest.
- **Paid cost of the whole build** (list price; Tasks 7 and 14 as spent, the rest from Task 14's measured figures): Task 7 $1.35 (at most $4); Task 14 $4.54 ($20); Task 16 about $49 ($176); Task 18 about $21 ($104). **Total: about $76 expected; $304 at most by the caps.** The clean path, with no reruns and no update, is about $66.
- **Overrun.** The harness checks a cap before each run starts, so an invocation can pass its cap by the runs already in flight (at most `--jobs` runs). The build allows no other paid run: each stop rule above ends with the lead's decision.
