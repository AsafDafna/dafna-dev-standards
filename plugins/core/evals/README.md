# Eval suite of the `core` plugin

Twelve cases run an agent with the core plugin on a small synthetic Node app (`tasklist`). Six guard cases check hard rules that hold today: the rules marker reaches the session (C1), small work goes straight to code (C2), an RLS change gets design first (C4), no commit on `main` (C5), a bug gets its root cause (C6), and `lessons.md` is searched, not read whole (C7). Six climb cases check judgment calls with headroom: test-audit before a test (C3), no comments in a heavily commented file (C8), build what the ask names (C9), the smallest review fix (C10), a review against the ask with a Cut list (C11), and a subagent brief that quotes the ask (C12). C10 and C12 are held out: whoever edits a rule to raise a score does not read their transcripts.

The design, with every case's prompt, fixture and graders, is in the [spec](../../../docs/superpowers/specs/2026-11-21-coo-core-eval-suites-design.md). `classes.tsv` holds each case's tags.

## Check the graders (free)

```sh
node scripts/check-graders.mjs plugins/core/evals
```

It builds every fixture in a bare environment and tests every grader pattern against the case's `checks.json`. It prints `OK`. Run it after any change to a case and before every paid run.

## Measure a change

```sh
scripts/eval-compare.sh core <base> <head> --suite-ref <ref> --jobs 4 --covers "<cases>"
scripts/eval-compare.sh core --aa <commit> --suite-ref <ref> --jobs 4
scripts/eval-compare.sh core --no-plugin <commit> --suite-ref <ref> --jobs 4
```

The script copies the suite from `--suite-ref` into temp worktrees of both commits, runs each arm on opus, reruns dropped guards 6 times, and prints one `Eval:` line. It writes results under `${XDG_CACHE_HOME:-$HOME/.cache}/dds-evals/`, never in the repo. The harness deletes each run's temp folder, trace included, when the run ends; the result JSON keeps only the grader explanations and evidence. To see why a run failed, rerun its case with `claude plugin eval … --case <dir> --keep-temp`. The measuring runs of both suites used `--jobs 4`: 22 runs, 4 at a time, and no rate-limit refusal.

## What the probes showed (build step 0)

| Probe | Result |
|---|---|
| P1 the core rules reach the session | yes: C1 quotes the marker with no tool call |
| P2 the core rules reach a coo case | yes |
| P3 the stub helper loads and records each `Agent` call | yes |
| P4 the graders see the original call | yes: the call record holds the lead's own brief and model |
| P5 `EVAL_STUB_REPLY_<n>` reaches the hook | yes |
| P6 the flow goes on after a stub reply | yes |
| P7 coo does not stop for herdr | yes |
| P8 a file grader reads `.git/` | yes |
| P9 the agent reads a `.claude/lessons.md` that the scaffold wrote | yes |
| P10 effort can be set | no: runs use the default effort |

On macOS, git runs inside the eval sandbox only from a copy of the git binary first on `PATH`; the run settings file that `eval-compare.sh` writes does this.

## Cost and duration (build step 1)

One run of each case on opus, at list price, with the judge calls included. Claude Code 2.1.330.

| Case kind | Cases | Cost per run | Seconds per run |
|---|---|---|---|
| Light | C1, C2, C3 | $0.14 | 19 |
| Task | C4 to C9, C12 | $0.16 | 30 |
| Review | C10, C11 | $0.23 | 50 |

One arm (3 runs per guard, 5 per climb, 48 runs) costs about $8.40. No run came near its turn or time limit.

Caps in `scripts/eval-compare.sh`, each 1.5 times the measured figure:

| Cap | Value | Basis |
|---|---|---|
| `cap_main_core` | $13 | one arm, $8.40 |
| `cap_rerun` | $4 | 6 runs of the dearest guard run in either suite, $0.34 |
| `cap_noplugin` | $8 | the guard cases on two arms, $4.82 |

The harness checks a cap before each run starts, so an invocation can pass its cap by the runs in flight (at most `--jobs`).

## A/A run and no-plugin arm (build step 2)

Two arms on the same commit (`2e958ba`) gave the same result. Every guard passed every run. Each climb case scored the same on all 10 runs: C3 1.00, C8 1.00, C9 0.67, C10 0.40, C11 0.50 and C12 0.25. So the A/A climb difference was 0.00. That is not a noise floor: every climb case was pinned at base, so it shows nothing about how much a changed head varies, and the permutation p is the test that counts. One arm cost about $8.80 and took about 5 minutes at `--jobs 4`.

Without the plugin, C2, C6 and C7 passed every run, so they are tagged `model-default` and the `Eval:` line counts them apart. C1, C4 and C5 failed without the plugin, so they measure the plugin. The no-plugin arm cost $4.95.
