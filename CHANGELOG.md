# Changelog

## open-items 0.4.0 — side questions

- New: side questions. You leave a question for the session while Claude
  works, and a helper answers it in its own item, so Claude goes on with its
  task. Ask in the new Side question field at the end of the pane's list, or
  with `/side <question>`. `/side #N <text>` follows up on side question #N,
  and `/side` alone opens the pane on the field. `/side` and `/open-items` run
  at once, also while Claude works, and `/open-items` opens the pane also when
  it holds nothing.
- The helper: the mod registers the agent type `open-items:helper` and starts
  one helper for each side question, one at a time in a session. It has only
  Read, Grep and Glob, runs on Opus at medium effort with a limit of 20 turns,
  keeps CLAUDE.md, and is hidden from the main model. At 10 minutes the mod
  stops it with `TaskStop` and says so in the item. A follow-up wakes the same
  helper. A new helper's prompt holds a summary of the conversation (the first
  prompt and the latest messages, text only) and the paths of the conversation
  file and of a log of the session's side questions, which the mod writes in
  the scratchpad.
- Notes and questions for Claude: a helper's note rides your next typed prompt
  and starts no turn. A helper's question goes when Claude's turn ends; in a
  live chat or after Esc it rides your next typed prompt instead. Both reach
  Claude as quoted data, marked as the helper's words. The question asks
  Claude to answer in the item with `reply_item` and to change nothing.
- Side questions have their own section, SIDE QUESTIONS. Only Done closes one:
  `close_item` refuses the kind, `add_item` cannot make one, and there is no
  Later. They are not counted in the status line or the reminder line and set
  off no alert. The mod's helpers are not background work for the live-chat
  gate, and a side question sent from the pane is not an input for it.
- Quota guard, where the account has a five-hour usage window: one alert per
  window at 70%, and a hold at 85%. A held side question is saved, but no
  helper starts and no question goes to Claude on its own until a later
  reading is under 85% or the window resets. A question that waits still
  rides your next typed prompt, as a note does. An account with no five-hour
  window gets neither.
- Hand-off: `handoff_items` and `take_items` move open side questions with
  their threads. A helper that still works is stopped. In the new session, a
  question with no answer yet goes to a new helper, and so does a follow-up;
  a new helper can search the old conversation file.
- Every kind of item: a blank row separates the messages of a thread, and each
  head names its speaker (You, Claude or Helper) in bold, in its own color,
  with the age dim. A dim line under your newest reply shows whether it went
  out: "Waiting to send", "Sent · Claude reads it at its next step" or
  "✓ Claude has it". In a side question it says "✓ The helper has it".
- The `↳ Answer to #N:` bridge leaves side questions out: the mod drops such a
  prompt, and the drop's reason points to `/side #N`.
- CI: the Claude Code pin moves from 2.1.310 to 2.1.331. Tested on Claude
  Code 2.1.331.
- Update every install before the first side question: 0.3.0 drops a saved
  item of a kind it does not know, so a take there loses side questions.

## core 1.11.1, coo 1.0.11 — RULES.md back under its size cap; review points on 1.11.0

- RULES.md: about 840 → 790 tokens (648 → 608 words), under the ~800 cap.
  Shorter wording in Workflow, Git, Code comments and Logs; the second "real
  failure" clause and the repo-specific "Docs-only PRs skip CI" line are gone.
- RULES.md: a plan step the user approved counts as one of their decisions, so
  a brief does not mark it as a proposal.
- review-fundamentals.md: a new mechanism may be proposed when nothing smaller
  closes the failure, as RULES.md says.
- coo: a non-blocking finding outside the PR gets a tracker row or is dropped
  in one line; briefs mark additions as a "proposal", the RULES.md word.

## core 1.11.0 — build what the ask names; fix findings with the smallest change

- RULES.md: a new "Proportion" section. The ask is the user's words, their
  decisions and the repo's rules; a brief, spec, plan or review is not. Build
  what the ask names and put other needs in the report as a question with
  its size. A brief quotes the ask and marks the lead's additions. Fix a
  finding with the smallest change; a new mechanism only when nothing
  smaller works, said in one line. Always fix a real failure. Never add to a
  part that an earlier review fix added. Sizes are given as before → after.
- review-fundamentals.md: a "Review against the ask" block before the output
  format. The reviewer reviews the whole artifact against the ask in every
  round, ties each finding to a line of the ask or a failure, proposes the
  smallest change or a removal, ends with a "Cut" list, and keeps review
  notes out of the artifact.
- RULES.md: a new "Tests" section. Load the `test-audit` skill before you
  add or change a test, and name it in every brief for a subagent that
  writes or reviews tests. The subagent scope line includes Tests.

## coo 1.0.10 — briefs quote the ask; non-blocking fixes stay in scope

- SKILL.md: every brief quotes the ask word for word and marks the lead's
  additions.
- orchestration.md, adversarial review: a non-blocking finding is fixed on
  the branch only when it is inside the PR's scope and small; any other gets
  a tracker row.

## open-items 0.3.0 — an item screen that is easy to read

- The item screen has a new look. A header box holds the kind, the number, the
  age and the title. Each option of a decision is a box with its note, and the
  recommended one shows `★ recommended`. Claude's detail and replies show as
  Markdown.
- `add_item` has two new fields. `ask` is one line under 150 characters and
  shows first, in the kind's color. `option_notes` is one note per option, one
  line under 120 characters each. A new decision needs both. `option_notes` is
  refused on the other kinds. `reply_item` accepts both.
- Items saved before 0.3 keep plain text in the new frame. `reply_item` can
  give an older decision option notes, and they stay plain text.
- In Claude's Markdown on a new item, a link written as `[text](target)` whose
  target is not `https:` shows as plain text. A target that starts with a
  scheme, such as `http:`, shows as `text (target)`. A target with no scheme,
  such as a path, keeps its brackets and gains a space: `[text] (target)`. So
  does a `[` right after a letter, a digit or a closing bracket, as in code.
  An address written out in full stays as written, so its whole target shows.
- The detail of an item can be about 5 sentences or a short list. It was about
  3 sentences with the options. The ask and the option notes do not count.
- Width: `Ctrl+X ←` and `Ctrl+X →` make the pane wider or narrower by 4 columns,
  up to 45% of the window, while the pane has the keyboard and not inside the
  reply field. You can also drag the edge. One width is kept for every plugin
  pane.

## core 1.10.0 — review rounds stop at two; skill text matches the lean rules

- spec-review and plan-review (review-fundamentals.md): after two rounds, stop
  and ask the user before a third, with the open findings as a count; stop and
  ask too when the doc grew by more than 25% since the first round. The full
  findings go to a file outside the repo; the chat gets the critical and high
  findings, a count of the rest and the path. Phase 2 applies a clear low or
  nit fix directly and asks only where the user decides. The confirm question
  for the found doc is gone: the skill names the file and reviews it.
- checklists: the reply names only skipped, n/a or blocked items. The plan
  checklist's spec step is for big or risky work only. Review and security
  findings are one line each; the review summary loses "positive
  observations"; the handoff template no longer restates completed work.
- test-audit: the handoff report goes into the PR body or a file; the chat
  reply stays short.
- migrate: check the repo's own rules before a push, because many repos push
  migrations only through CI; use the repo's type-generation script when it
  has one. "IMPORTANT" and "Never auto-" lines are plain sentences.
- bootstrap-repo: the step that printed an enable block for the unpublished
  supabase/nextjs plugins is gone. The collision lists of bootstrap-repo and
  dedup-local-skills now include `secrets`.
- Descriptions of checklists, dev-env-setup, diagram-rules, lessons-log,
  migrate, plan-review, spec-review and test-audit are 300 characters or less,
  so a `skillListingMaxDescChars: 300` cap no longer cuts their triggers.

## coo 1.0.9 — two review rounds, then ask

- orchestration.md, adversarial review: after two review rounds, do not start
  a third on your own; give the open findings as a count and ask.
- The description is 300 characters or less and keeps "Not for single-repo
  single-task work".

## secrets 0.2.1 — shorter description

- The description is 300 characters or less and keeps the rule to load the
  skill before a command that prints, creates or needs a secret.

## core 1.9.0 — lean rules; search the lessons log, log sparingly

- RULES.md: "Workflow gates" becomes "Workflow", in plain sentences. The
  full process (brainstorming, spec, spec-review, plan, plan-review, subagent
  implementers, code review) now applies to big or risky work only: a new
  feature, a database or RLS change, auth or permissions, payments, a bulk or
  irreversible action on production data, or work across repos. Other work
  goes straight to code plus the quality gates. When the size is unclear,
  the task counts as small; when it may touch production data, auth, RLS or
  payments, it counts as big. This replaces the "3+ steps" and "3+ files"
  triggers. Every dispatch passes `model:`. The step that states the execution mode out loud
  is gone.
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
