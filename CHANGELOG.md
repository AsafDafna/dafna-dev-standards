# Changelog

## coo 1.0.3 — model tier per dispatch rule

- `coo`: SKILL.md + orchestration.md now require an explicit `model:` on every
  subagent dispatch, stated in the dispatch line, with a default tier map
  (haiku for read-only lookups/fix-ups/polls, sonnet for digests/dry-runs/
  simplify/docs/small diffs, frontier only for migration/RPC/engine/live-path
  work and its reviewer). Motivated by a 2026-09-19 recurrence where every
  subagent in a root /coo session inherited the orchestrator's frontier tier
  — including a read-only digest, a simplify pass, and a comment-only
  fix-up batch — on an org seat with a hard-stop quota. Folds the reviewer's
  prior "Model-match" sentence into a single cross-referenced rule.
- `coo`: (2026-09-20) split the former single frontier tier into `opus`
  (liberal default for real work) and `fable` (Mythos-class reserve for
  migration/RPC/sync-engine/live-path work and irreversible data ops); they
  are not interchangeable, and opus can be used far more freely than fable.

## core 1.0.1 — WSL VM sizing, freeze forensics, Optimus GPU section

- `dev-env-setup`: new `windows-wsl.md` §9 on sizing the WSL2 VM, from a
  2026-07-26 incident where a 6GB cap let one 2.87GB `node` process exhaust the
  VM; with swap available the kernel reclaimed forever instead of OOM-killing,
  freezing everything with no `dmesg` line. Covers the small-swap rationale and
  bounding Node.
- `dev-env-setup`: `devenv` no longer pins software rendering. It probes for a
  usable d3d12 device at launch and falls back to llvmpipe only when no GPU
  answers, recording the choice in `launch.log`. Measured over identical output,
  llvmpipe cost 156% of a core against d3d12's 32% — ~4.5x — but pinning the GPU
  unconditionally reproduces the blank-window failure whenever Optimus has
  powered the adapter down, hence the probe. Adds a `mesa-utils-extra` dependency.
- `dev-env-setup`: new §8 on forcing the NVIDIA GPU on Optimus laptops, including
  the Windows High-performance setting that keeps the adapter awake so the
  launcher's probe succeeds.
- `dev-env-setup`: new Appendix E — a boot-started health sampler for
  diagnosing freezes after the fact, plus five gotcha rows including the
  blank-window failure, the benign `GtkRevealer` warning, and the finding that
  `/proc/pressure/io` is unreliable on WSL2 (~25× overstated, measured).

## coo 1.0.2 — never-name dispatch rule made explicit

- `coo`: SKILL.md + orchestration.md now state the dispatch rule as a hard negative:
  never pass `name:` on a bounded dispatch — background ≠ named (un-named background
  subagents still notify on completion); `name:` adds only SendMessage addressability
  plus idle-notification noise. Motivated by a 2026-07-22 recurrence in edut-app
  where the rule was in context and still rationalized around.

## core 1.0.0 / coo 1.0.0 — initial release

- `core`: SessionStart-injected RULES.md (workflow gates, git conventions,
  CI-minute economy, pre-merge gates, lessons/decision-log pointers).
- `core`: `lessons-log`, `spec-review`, `plan-review`, `checklists`,
  `dev-env-setup` skills.
- `core`: `/bootstrap-repo` and `/dedup-local-skills` commands.
- `coo`: Chief-of-Staff orchestrator mode (user-level opt-in).
