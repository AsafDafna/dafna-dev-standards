# Changelog

## core 1.4.1 — test-audit: argument-blind stubs, keeper cycles

- `test-audit` SKILL.md: new junk pattern. A stub that gives one answer for
  every argument the code under test chooses (a permission check stubbed true
  or false for any capability) passes whichever capability the gate asks for;
  key one row per gate by the argument, with the deny row answering yes for
  every other value.
- `test-audit` CAMPAIGN.md step 4: a consolidation holds only if its keeper
  stays; check keeper marks across lanes in both directions, since two lanes
  naming each other's test retire both. Both found in a consumer repo's audit.

## core 1.4.0 — code-comment rule in RULES.md

- `RULES.md`: new "Code comments" section. Default to no comment; comment only
  a non-obvious why, a constraint enforced elsewhere (named), or a public API
  contract the types can't express. A why stays at one or two lines (longer
  rationale goes in a doc the comment points to). Bans banners, restating
  comments, change narration and history. Overrides the system prompt's
  "match its comment density", which kept already over-commented code growing.
  Tool-read lines and repo- or skill-required headers are exempt and still
  written. Editing a function cleans its banners and restating comments, never
  its why comments. Rules marker stays v1.0.0 (additive change).

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

## core 1.3.0 — new `test-audit` skill (test authoring gate + pruning audits)

- `test-audit`: new skill adapted from openclaw/openclaw's
  `.agents/skills/test-audit` (MIT, commit 2aed866). Authoring gate (four
  questions every new test must answer), a junk-pattern list, a retention bar,
  the evidence required before deleting a test, and a campaign mode
  (`CAMPAIGN.md`) for pruning one area's whole test surface. The
  openclaw-specific commands, `AGENTS.md` reads and review hooks are replaced
  by "read the repo's `CLAUDE.md` and test-conventions doc first", which wins
  on commands, scope and always-retained categories. Deletions need the
  user's go-ahead on the candidate list.
- `checklists/test.md` points to the new skill's authoring gate.
- Skill added to the bootstrap-repo/dedup-local-skills FIXED skill lists and
  the plugin/marketplace descriptions.

## core 1.2.1 — `migrate` creates files with the Supabase CLI

- `migrate`: new files come from `supabase migration new` (UTC stamp) instead of
  a hand-built timestamp, matching the Supabase plugin's rule; the "manually
  increment" collision advice that contradicted "never sequential" is gone.
- `migrate`: new declarative-schema branch (`supabase/schemas/`): edit the
  schema files, then generate the migration with `db schema declarative sync`
  (plus `--experimental` on the legacy migra engine), never `db diff`.

## core 1.2.0 — new `diagram-rules` skill (universal diagram rules + Hebrew/RTL)

- `diagram-rules`: new compact companion to the built-in `artifact-diagramming`
  skill for architecture, flow, sequence, state, and ER diagrams (charts and
  plots stay with `dataviz`). Distills the universal rules of
  cathrynlavery/diagram-design (MIT, commit cea465e7): complexity budget,
  anti-patterns, six connector rules, pre-output checklist. Adds theme-safe
  color (`currentColor` + tokens, no hex) and a Hebrew/RTL section (flow
  direction, base direction in SVG and HTML, `text-anchor` under rtl, mixed
  runs, Hebrew-capable fonts), with renderer-dependent points marked "verify".
- Skill added to the bootstrap-repo/dedup-local-skills FIXED skill lists and
  the plugin/marketplace descriptions.

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
