# Changelog

## core 1.9.0 — lean rules; search the lessons log, log sparingly

- RULES.md: "Workflow gates" becomes "Workflow", in plain sentences. The
  3-files-or-migration rule for subagent implementers stays; the step that
  states the execution mode out loud is gone.
- RULES.md Logs: lessons.md holds project gotchas and validated patterns.
  Search it for your topic; do not read it whole. "Corrections go to
  lessons.md" is gone: corrections about how the assistant works belong in
  the user's own rules. The 2+ repos promotion line moves to the skill.
- RULES.md: "Code comments" and "Secrets" lose "Never" wording, with no
  change of meaning. 49 lines become 40.
- The SubagentStart sentence names the new lines, and gives subagents the
  "Search that file for your topic" sentence too.
- lessons-log: no trigger on every correction or praise. Search before a
  task instead of a whole-file read at session start. Log sparingly, one
  entry per subject; update an existing entry before you add one, unless
  the file's header says to add lines only at the end.

## coo 1.0.8 — chat rules leave; briefs and reports in plain rules

- Batched reporting is gone: the rule to end turns with no text while agents
  run, the recap format and the "Decisions needed" block. The user's own
  rules own how to report. The open-items pane routing is left to the
  `add_item` tool description.
- SKILL.md, Briefs and reports: brief each subagent with the objective, the
  output format, the boundaries and the files to read; ask for a short
  result plus a file path. A subagent report is input for the lead: check
  the claims that matter, then write the outcome first. Ask the user's
  questions plainly, one at a time.
- The copies of the brief anatomy, the `name:` rule, the wait-output command
  and human-in-the-loop now live in one place each. The question format
  copy is gone; the irreversibility gate and supervised irreversible
  operations stay.
- Fixes: the hostile review runs before every PR (SKILL.md said "merge");
  the implementer gates end before the PR (the checklist said "PR via gh");
  pointers to "execution-mode gate", "Model per dispatch", the root
  "Session Protocol" and the usage-limit rule are gone or renamed. "Say it
  out loud" becomes "name it in the dispatch description".

## open-items 0.2.3 — shorter tool descriptions

- `add_item`: "Write no chat text about the item until the batch ends"
  becomes "Do not repeat the item in the chat". The other lines are shorter,
  with the same mechanics: 2,109 characters become 1,913.
- `reply_item`, `close_item` and `list_items`: plainer, shorter wording.

## core 1.8.0 — model per dispatch; one Quality gates section

- RULES.md workflow gates: new line "Model per dispatch". Pick the model that
  fits the job, and do not just inherit yours. Lighter models for mechanical
  work, opus for real work, Fable only when opus fell short.
- RULES.md: "CI-minute economy" and "Pre-merge gates" merge into one "Quality
  gates" section. Every rule is kept.
- RULES.md: "Code comments" is trimmed to keep the file under the 60-line cap.
- The SubagentStart sentence names "Quality gates" in place of the two old
  sections, and gives subagents the "Model per dispatch" line too.

## coo 1.0.7 — model choice moves to core; no review skip; small findings near the change

- orchestration.md, Model tier per dispatch: the four-tier map is gone. The
  bullet points to the core line "Model per dispatch". `model:` stays explicit
  on every dispatch.
- orchestration.md, Adversarial review: fix a finding on the branch when the
  fix is small and close to the PR's change, even outside its first scope. A
  larger or more distant fix, or one that needs a decision, a migration or
  another owner, gets a tracker row.
- orchestration.md, Adversarial review: no skip. Every PR gets the simplify
  pass and the hostile review; the two skips for small or config diffs are
  gone.

## open-items 0.2.2 — short asks to the pane while background work runs

- `add_item` description: while background agents, shell commands or
  monitors run, add an item only for a short ask (about 3 sentences with its
  options). A longer ask waits for the chat recap when the batch ends.
- When no background work runs, Claude asks in the chat. The live-chat gate
  itself is unchanged.

## coo 1.0.6 — short questions mid-batch, herdr wait-output

- orchestration.md, Batched reporting: a short question or decision goes to
  the open-items pane at once; a longer one waits for the phase recap. An
  answer to the user may go out during a batch. An
  "out loud" line goes in the turn that starts the work, or in the tool call's
  description during a batch.
- orchestration.md and SKILL.md: completion waits use `herdr pane wait-output`
  with an anchored marker regex. `herdr wait` does not exist. In a Herdr app
  terminal, the `herdr` commands do not reach the app; use `hc` there.
- SKILL.md: the message gate before a user-visible message follows the
  batched-reporting rule.

## core 1.7.1 — plan files for subagent work

- RULES.md workflow gates: plan non-trivial tasks (3+ steps); a multi-task plan
  for subagents is a writing-plans file, not plan mode.

## secrets 0.2.0 — `-C DIR` for another repo

- `secrets -C DIR SUBCOMMAND ...` runs any subcommand as if it started in DIR,
  as `git -C` does. The repo of DIR gives the refs files, the vault and the
  token. `run` starts CMD in DIR. A relative FILE of `import` or
  `setup --import` starts from DIR.
- A missing or empty DIR, or a path that is not a folder, stops the command
  before any 1Password or Keychain call.
- The guard hook asks for `secrets -C DIR run --guarded` too. A `--` after
  `run` no longer ends its match, because a DIR can hold the words `run --`.
- README and skill: the option and one line on cross-repo use.

## secrets 0.1.0 — new opt-in plugin

- New plugin `secrets`: one command for secrets from 1Password, for people and
  agents. Subcommands: `setup`, `run`, `import`, `add`, `status`.
- A guarded secret loads only with `secrets run --guarded`. The plugin ships a
  `PreToolUse` hook that makes Claude Code ask the owner before such a command.
  A project has one vault. A guard name is a line in a guarded refs file, and
  its item carries the tag `high-value`. The guard is a Claude Code rule, not a
  1Password lock; the README states the limit.
- A `secrets` skill tells agents how to use it and what each failure line means.
- macOS only, needs `jq`. The README covers the machine setup and the link
  command.

## core 1.7.0 — Secrets rule line

- RULES.md: new "Secrets" section. In a repo with a `.secrets-refs` file,
  commands that need a secret run through `secrets run`, and no secret value is
  printed.
- The SubagentStart sentence names Secrets among the rules that apply to
  subagents.

## open-items 0.2.1 — shorter tool descriptions, no system-prompt copy

- Shorter descriptions for `add_item`, `reply_item`, `close_item` and
  `list_items`: each rule is written once, where Claude acts on it. About 640
  fewer tokens per session, counting the removed system-prompt copy.
- The mod adds no section to the system prompt. The tool descriptions carry
  the rules on every seat.
- The rules are unchanged.

## coo 1.0.5 — hand open items to the successor session

- `coo` orchestration.md: new hand-off bullet. With the `open-items` tools
  listed (0.2.0 or later is the minimum), the session calls `handoff_items`
  before it starts a successor and puts the code and the artifact URL in the
  successor's prompt; the successor calls `take_items` first. Before the
  session ends, every open and Later item is resolved, recorded or handed off.

## open-items 0.2.0 — threads, Later, hand-off

- Each item is a thread: Claude answers inside it with `reply_item`, and a
  reply never closes the item. `close_item` replaces `withdraw_item`.
- New: a Later button, a list screen and an item screen, no cap on open items,
  and no silent cut of long text.
- Each answer goes to Claude at once; the mod adds it to a running turn.
- Hand-off by code with `handoff_items` and `take_items`; leftover items of an
  ended session are offered with Take and Dismiss.
- Removed: Reject, `withdraw_item`, the cap of 5, Send now and Save for later.

## open-items 0.1.0 — new opt-in mod

- Fork of human-in-the-loop (Tzafrir Rehan, MIT), renamed to Open items.
- Removed: the per-project store and the project-wide task list.
- Added: a per-session store, four kinds (decision, question, action, info), a
  pane grouped by kind, an alert through `$.ui.notify`, and four steering lines.
- The mod runs no host command; every `tool.call` hook matches its own tools.

## coo 1.0.4 — batched reporting holds questions until the recap

- `coo` orchestration.md: the batched-reporting rule allowed a mid-batch
  message when "a decision is actually needed", and questions went out
  through that gap and scrolled away under later hand-backs. Now questions,
  decisions and failures wait for the phase recap, which ends with a
  "Decisions needed:" block of every open question. Only a question that
  blocks all remaining work ends the phase early. With the `open-items`
  tools listed, held items go to its pane at once. Motivated by a 2026-10-24
  recurrence across several sessions.

## core 1.6.0 — rules reach subagents (SubagentStart hook)

- `hooks.json`: new SubagentStart hook runs `session-rules.sh subagent`, which
  injects RULES.md (or the missing-file marker) into every subagent as JSON
  `additionalContext`; SubagentStart ignores plain stdout. A scope line after
  the rules leaves Workflow gates (except Bugs), CI-minute economy, Pre-merge
  gates and Logs to the main session. No git-drift briefing for subagents.
  Subagents never receive SessionStart output, so implementer and reviewer
  subagents worked without the shared rules (seen as subagent-written SQL
  breaking the code-comment rules, unflagged by subagent reviewers). The JSON
  escaping uses POSIX `tr`/`sed`/`awk` in the C locale: no jq on WSL, so no
  interpreter dependency. Rules marker stays v1.0.0.

## core 1.5.0 — test-audit: argument-blind gate mocks, keeper marks

- `test-audit` SKILL.md: the "mocks" junk pattern now covers a gate none of
  whose tests keys its check by the argument the code chooses (a permission
  check stubbed true or false for any capability). Key at least one test per gate:
  admit says yes only to accepted values, deny says yes to every other value.
- `test-audit` CAMPAIGN.md step 4: a `C` holds only if its keeper suite is
  marked `R` or `F`, or sits outside the area untouched (two lanes naming each other's suite retire both); the
  step's done-criterion now requires it. Both found in a consumer repo's audit.

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
