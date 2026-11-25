# Eval suite of the `coo` plugin

Ten cases run a lead with the coo and core plugins in a folder of three synthetic repos (`shop-api`, `shop-web` and `docs-site`). Four guard cases check hard rules: coo loads on an explicit verb (K1), and not for a one-repo task (K3); the lead writes no code, passes `model` and no `name` (K5); and a prod write waits for the user (K8). Six climb cases check rules that do not hold every time: coo loads on a cross-repo ask (K2); orientation goes to one digest subagent on sonnet first (K4); a simplify pass and a hostile review run before the PR (K6); after two review rounds the lead asks instead of starting a third (K7); a brief quotes the ask and marks the lead's additions (K9); and a non-blocking fix stays inside the PR's scope (K10). K9 and K10 test PR 28's coo lines. K10 is held out: whoever edits a rule to raise a score does not read its transcripts.

## Known rule gaps

K4 and K7 were guards. Each failed in the measuring run because of what the coo skill does today, so they are climb cases until the skill changes:

- K4: the lead sends fix briefs before the orientation digest.
- K7: the lead has a worker check whether the round-2 fixes resolved the findings, which is a third review round in substance, before it asks the user.

K2 and K6 were guards too. They failed some A/A runs (build step 2), so they are climb cases:

- K2: in 2 of 16 runs the lead did the cross-repo rename without loading coo.
- K6: in 4 of 16 runs the lead skipped the simplify pass or the review. Part of this comes from the stub: its replies go by call number, so when the lead sends a digest first, the digest gets the reply meant for the simplify pass, and the lead then skips that pass. A stub that picks the reply by the call's description would remove this.

Workers are stubs. The helper plugin `evals/stub-workers/` records each `Agent` call in `.eval/agent-calls.jsonl` and turns it into a haiku task that returns the case's `EVAL_STUB_REPLY_<n>`. So the graders judge the lead's calls and replies, never a worker's work.

The design, with every case's prompt, fixture and graders, is in the [spec](../../../docs/superpowers/specs/2026-11-21-coo-core-eval-suites-design.md). `classes.tsv` holds each case's tags.

## Check the graders (free)

```sh
node scripts/check-graders.mjs plugins/coo/evals
```

It builds every fixture in a bare environment and tests every grader pattern against the case's `checks.json`. It prints `OK`. Run it after any change to a case and before every paid run.

## Measure a change

```sh
scripts/eval-compare.sh coo <base> <head> --suite-ref <ref> --jobs 4 --covers "<cases>"
scripts/eval-compare.sh coo --aa <commit> --suite-ref <ref> --jobs 4
```

The script copies the suite and the stub helper from `--suite-ref` into temp worktrees of both commits, runs each arm on opus, reruns dropped guards 6 times, and prints one `Eval:` line. It writes results under `${XDG_CACHE_HOME:-$HOME/.cache}/dds-evals/`, never in the repo. The harness deletes each run's temp folder, trace included, when the run ends; the result JSON keeps only the grader explanations and evidence. To see why a run failed, rerun its case with `claude plugin eval … --case <dir> --keep-temp`. Coo runs no no-plugin arm: without the plugins the stub is absent too. The measuring runs of both suites used `--jobs 4`: 22 runs, 4 at a time, and no rate-limit refusal.

## What the probes showed (build step 0)

| Probe | Result |
|---|---|
| P1 the core rules reach the session | yes |
| P2 the core rules reach a coo case | yes: a coo case with core in `plugins` quotes the marker |
| P3 the stub helper loads and records each `Agent` call | yes |
| P4 the graders see the original call | yes: the call record and the trace hold the lead's own brief and model |
| P5 `EVAL_STUB_REPLY_<n>` reaches the hook | yes |
| P6 the flow goes on after a stub reply | yes |
| P7 coo does not stop for herdr | yes: with `HERDR_ENV` unset, the lead uses subagents |
| P8 a file grader reads `.git/` | yes |
| P9 the agent reads a `.claude/lessons.md` that the scaffold wrote | yes |
| P10 effort can be set | no: runs use the default effort |

Two limits of the sandbox shape these cases. It keeps `.git/worktrees` read-only, so no grader reads a worktree, branch or commit that the lead makes in a run; K6, K9 and K10 judge them through the briefs in the call record. A stub reply shows 0 tool uses, so a lead may distrust it and dispatch again; each case scripts a reply for every call it expects.

## Cost and duration (build step 1)

One run of each case on opus, at list price, with the judge calls included. Claude Code 2.1.330.

| Case kind | Cases | Cost per run | Seconds per run |
|---|---|---|---|
| Light | K1, K2, K3 | $0.19 | 34 |
| Task | K4 to K10 | $0.28 | 69 |

One arm (3 runs per guard, 5 per climb, 38 runs) costs about $9.90, with K4 and K7 as climb cases. K3 used 9 turns, so its limit is now 14. K9's task changed after this run (its first task was login work, which core's rules send to the full process), so its figure comes from the old task.

Caps in `scripts/eval-compare.sh`, each 1.5 times the measured figure:

| Cap | Value | Basis |
|---|---|---|
| `cap_main_coo` | $15 | one arm, $9.89 |
| `cap_rerun` | $4 | 6 runs of the dearest guard run in either suite (K5), $0.34 |

The harness checks a cap before each run starts, so an invocation can pass its cap by the runs in flight (at most `--jobs`).

## A/A run (build step 2)

Two arms on the same commit (`2e958ba`), after the update that moved K2 and K6 (the line's cost after an update is the folder's total): every guard passed every run, and the climb mean went 0.72 -> 0.69 (-0.03, p=0.61). Before the update, with four climb cases, it went 0.58 -> 0.65 (+0.07, p=0.17). So a climb difference of up to about 0.07 is noise. K4, K6 and K7 vary the most between runs. One arm cost about $10.70 and took about 10 minutes at `--jobs 4`.
