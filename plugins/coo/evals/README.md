# Eval suite of the `coo` plugin

Ten cases run a lead with the coo and core plugins in a folder of three synthetic repos (`shop-api`, `shop-web` and `docs-site`). Eight guard cases check hard rules: coo loads on an explicit verb (K1) and on a cross-repo ask (K2), and not for a one-repo task (K3); orientation goes to one digest subagent on sonnet (K4); the lead writes no code, passes `model` and no `name` (K5); a simplify pass and a hostile review run before the PR (K6); after two review rounds the lead asks (K7); and a prod write waits for the user (K8). Two climb cases check PR 28's coo lines: a brief quotes the ask and marks the lead's additions (K9), and a non-blocking fix stays inside the PR's scope (K10). K10 is held out: whoever edits a rule to raise a score does not read its transcripts.

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

The script copies the suite and the stub helper from `--suite-ref` into temp worktrees of both commits, runs each arm on opus, reruns dropped guards 6 times, and prints one `Eval:` line. It writes results under `${XDG_CACHE_HOME:-$HOME/.cache}/dds-evals/`, never in the repo. Coo runs no no-plugin arm: without the plugins the stub is absent too. The measuring runs of both suites used `--jobs 4`: 22 runs, 4 at a time, and no rate-limit refusal.

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

One arm (3 runs per guard, 5 per climb, 34 runs) costs about $8.70. K3 used 9 turns, so its limit is now 14.

Caps in `scripts/eval-compare.sh`, each 1.5 times the measured figure:

| Cap | Value | Basis |
|---|---|---|
| `cap_main_coo` | $14 | one arm, $8.71 |
| `cap_rerun` | $4 | 6 runs of the dearest guard run (K4), $0.34 |

The harness checks a cap before each run starts, so an invocation can pass its cap by the runs in flight (at most `--jobs`).
