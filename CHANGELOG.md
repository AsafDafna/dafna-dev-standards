# Changelog

## core 1.2.0 — spec + plan PR and an explicit go-ahead before the build

- `RULES.md` workflow gates: the spec and the plan ship as a docs-only PR before
  the build, and the build starts only on the user's explicit go-ahead on the
  final plan; a handoff saying "then build" does not count. Written down after
  an edut-app session (2026-09-24, calendar series anchor) went from plan
  review straight into the build with both documents on one local machine: the
  practice existed (edut-app #489, #627) but no rule said so, and the
  execution-mode gate's "after a plan is approved" never named who approves.

## core 1.1.0 — new `migrate` skill (Supabase migration workflow)

- `migrate`: new skill orchestrating the full Supabase migration lifecycle —
  detect local-first vs remote-only project mode, create the migration file
  (real timestamp, header comment, `WITH CHECK` reminder), validate SQL before
  push (RLS completeness, idempotency guards, `auth.users` trigger warnings),
  push with confirmation, and post-push steps (type generation, drift/repair
  handling). Includes the migration-timestamp-ordering guidance (a stamp is
  not a reservation — the base branch's head at merge time decides acceptance,
  not the authoring clock) and a known-gotchas table. Ported from a personal
  skill at Nir's request (Slack, 2026-08-08); genericized to any Supabase repo
  — no hardcoded project paths or lint-script names, phrased as "if the repo
  has a migration-order lint" instead.
- Skill added to the bootstrap-repo/dedup-local-skills FIXED skill lists and
  the plugin/marketplace descriptions.

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
