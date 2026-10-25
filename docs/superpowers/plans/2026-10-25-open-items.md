# open-items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the imported `human-in-the-loop` 0.1.8 copy in `plugins/open-items/` into the `open-items` mod the spec describes.

**Architecture:** A Claude Code hooks module (mod). Claude calls the mod's tools to add items. The mod keeps items in `$.state`, draws them in a pane and a status line, and delivers the person's answers as prompts. Work proceeds from the upstream code: rename, remove the multi-session machinery, then add kinds, grouping, the alert and steering.

**Tech Stack:** TypeScript + JSX against the Claude Code 2.1.310 mod API (`import type … from 'claude-code'`), test kit `claude-code/testing`.

**Spec:** `docs/superpowers/specs/2026-10-25-open-items-pane-design.md`. Upstream's design doc (delivery and persistence logic) is at `/private/tmp/claude-501/-Users-asafdafna-dev-projects/5c7cde45-e78a-47fb-a6ac-8def80cf620a/scratchpad/hitl-src/repo/docs/DESIGN.md`.

## Global Constraints

- Plugin folder: `plugins/open-items/` in the worktree `/Users/asafdafna/dev-projects/.worktrees/dafna-dev-standards-open-items`. Run every command with absolute paths; never start a command with `cd`.
- Plugin name `open-items`, version `0.1.0`. Tools: `mcp__open-items__add_item`, `mcp__open-items__list_items`, `mcp__open-items__withdraw_item`. Command `/open-items`. Pane id `open-items`, title `Open items`. State plugin key `open-items`.
- The mod runs no host command: no `$.process`, no network.
- Every `tool.call` hook matches one of the mod's own three tools.
- No file under `plugins/` may match the repo's leak gate: `asaf|nir|edut|testimony|monday|/Users/…|~/dev-projects|~/Downloads` (case-insensitive).
- Keep `LICENSE` (MIT, upstream copyright line) unchanged.
- Code comments follow the repo rules: none unless they explain a non-obvious why; when you edit a function, fix comments your change makes wrong (names like "task", "project", "other session").
- Each task ends with all three green:
  - `claude plugin test /Users/asafdafna/dev-projects/.worktrees/dafna-dev-standards-open-items/plugins/open-items`: 0 fail.
  - `claude plugin validate /Users/asafdafna/dev-projects/.worktrees/dafna-dev-standards-open-items/plugins/open-items`: "Validation passed".
  - `/Users/asafdafna/dev-projects/family-agent/node_modules/.bin/tsc -p /Users/asafdafna/dev-projects/.worktrees/dafna-dev-standards-open-items/plugins/open-items`: exit 0. The types are laid in `.claude-plugin/types/` (gitignored). If they are missing, lay them: start `claude --plugin-dir <plugin folder>` in a detached tmux session, wait for `.claude-plugin/types/tsconfig.json`, kill the session.
- Commit at the end of each task with a conventional message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.

## Review Focus

1. Item text with quotes, newlines and wide characters reaches the pane, the status line and the alert text safely (`printable`, one line, clipped).
2. Section header rows at narrow inline widths: `rowsFor` must count them, or the inline pane cuts its last row.
3. A flood of `info` items (6 or more) drops the oldest and never blocks a decision or question.
4. `/clear` with an answer saved but not sent: the items go. A resumed session gets its open items and unsent answers back.
5. The person answers in chat: Claude withdraws the item with reason `answered in chat`, and the pane drops it.

Each line has its test in the owning task below.

---

### Task 1: Rename to open-items and clean the folder

**Files:**
- Modify: `plugins/open-items/.claude-plugin/plugin.json`, `hooks/register.tsx`, `hooks/tasks.ts`, `hooks/pane.ts`, `types/index.d.ts`, `tests/register.test.tsx`, `tests/live/test_pane.py`, `tests/live/screen.py`, `.gitignore`
- Delete: `plugins/open-items/docs/DESIGN.md`, `plugins/open-items/.claude-plugin/icon.png`
- Replace: `plugins/open-items/README.md` (one placeholder paragraph; Task 7 writes it)

**Interfaces:**
- Produces: constants `PLUGIN = 'open-items'`, `ADD = 'mcp__open-items__add_item'`, `LIST = 'mcp__open-items__list_items'`, `WITHDRAW = 'mcp__open-items__withdraw_item'`, `PANE = 'open-items'`, `PANE_TITLE = 'Open items'`; state key `'open-items'` in `PluginState`; long-answer prefix `↳ Answer to #N:` unchanged.

- [ ] **Step 1:** `plugin.json`: `name` `open-items`, `version` `0.1.0`, `description` "Claude adds the decisions, questions, actions and findings that need you to an Open items pane, so they stay visible and answerable until you resolve them.", `author` unchanged, `license` `MIT`; drop `displayName`, `homepage`, `repository`, `icon`, `documentationUrl`, `supportUrl`, `privacyPolicyUrl`, `keywords`. Keep `types`.
- [ ] **Step 2:** Rename identifiers and model-facing names: tools `assign_task`→`add_item`, `list_tasks`→`list_items`, `withdraw_task`→`withdraw_item`; command `my-tasks`→`open-items`; pane title; state key; all tool descriptions, prompt text, toasts, notices and pane copy say "item(s)" and "Open items" where they said "task(s)" and "My tasks". Kinds stay `do`/`answer`/`choose` in this task (Task 3 renames them).
- [ ] **Step 3:** Update the tests' expected strings to match. Replace both "Monday" strings in `tests/live/test_pane.py` (for example "Wait for the freeze to end").
- [ ] **Step 4:** Run the leak gate: `grep -rniE 'asaf|nir|edut|testimony|monday|/Users/([^<]|$)|~/dev-projects|~/Downloads' /Users/asafdafna/dev-projects/.worktrees/dafna-dev-standards-open-items/plugins/open-items`. Expected: no output.
- [ ] **Step 5:** Run the three Global checks. Expected: 192 pass, 0 fail; validation passed; tsc exit 0.
- [ ] **Step 6:** Commit `refactor(open-items): rename from human-in-the-loop`.

### Task 2: Replace the multi-session machinery with a per-session store

**Files:**
- Delete: `plugins/open-items/hooks/project.ts`
- Create: `plugins/open-items/hooks/saved.ts`
- Modify: `hooks/register.tsx`, `hooks/tasks.ts` (`statusOf`, `contextOf`), `hooks/pane.ts` (`ageOf` "from an earlier session"), `types/index.d.ts` (drop `TaskRef`, `Took`, the `took` and `loadedFor` state keys if nothing else reads them), `tests/register.test.tsx`

**Interfaces:**
- Produces in `hooks/saved.ts`:
  - `export const KEEP_MS = 30 * 24 * 60 * 60_000`
  - `export type Saved = { tasks: readonly Task[]; nextId: number; savedMs: number }`
  - `export function keyOf(sessionId: string): string` returns `session:<sessionId>`.
  - `export function savedIn(raw: unknown): Saved | undefined` validates shape (reuse upstream `isTask` checks); bad entries are skipped.
  - `export function isExpired(saved: Saved, nowMs: number): boolean` is true when `nowMs - savedMs > KEEP_MS`.
- Produces in `register.tsx`: `restore($)` (read `keyOf(id)`, set `tasks` and `nextId`, then delete expired keys), `persist($)` (write after every change made through `change()` and every delivery state change).

- [ ] **Step 1: Write the failing tests** in a new `describe('saving', …)` group:
  - `restores open items and unsent answers when the same session starts again`: seed `$.store` with `keyOf(sessionId)` holding one open `choose` item and one `done` item with `update: 'pending'`; start the session; expect both in the pane and the status line `… 1 not sent yet …`.
  - `drops every item on /clear`: add an item, answer it with Save for later, end the session with reason `clear`; expect the pane empty and the key deleted.
  - `deletes saved sessions older than 30 days at start`: seed one key with `savedMs` 31 days ago and one 1 day ago; start; expect only the 1-day key.
  - `writes the session's key on every change`: add an item; expect `$.store` key `session:<id>` to hold it.
- [ ] **Step 2:** Run the tests. Expected: the 4 new tests fail.
- [ ] **Step 3:** Delete the `across sessions` describe group and every other test that needs a second session, legacy 0.1.4 values or the "in another session" status.
- [ ] **Step 4:** Remove from `register.tsx`: `join`, `load`, `renumber`, `withHeld`, `beat`, `sync`, `letGo`, `readProject`, `writeOwn`, `slotOf`, `slotFrom`, `clean`, `editLegacy`, `isLoaded`, the `MOVING` text and every `live.moving` check, the heartbeat, and the `live` fields only they use (`root`, `joinRoot`, `heartbeat`, `elsewhere`, `floor`, `hasLegacyPeer`, `hasSlot`, `writtenMs`, `readMs`, `endedMs`, `ends`, `moving`, and `queue`/`stalled`/`within`/`awaited` if nothing else needs them). Keep `wake` only if delivery needs it.
- [ ] **Step 5:** Implement `saved.ts`, `restore` at `session.start`, `persist` after changes, and `session.end`: reason `clear` → empty `tasks`, delete the key; reason `resume` → after `next(e)`, `$.clock.after(0, () => void restore($))`; any other reason → `persist`. `statusOf(shown)` loses its `elsewhere` parameter.
- [ ] **Step 6:** Run the three Global checks. Expected: 0 fail (the count drops by the deleted group, plus 4); validation passed; tsc exit 0. `claude plugin validate` no longer lists `$.store.keys` via `readProject` or `$.session.root`.
- [ ] **Step 7:** Commit `refactor(open-items): keep items per session, drop the multi-session store`.

### Task 3: Four kinds, the recommended option and info items

**Files:**
- Modify: `types/index.d.ts`, `hooks/tasks.ts` (`KINDS`, `parseAsk`, `MAX_OPEN`, new `MAX_INFO`, `statusOf`, message and digest builders), `hooks/pane.ts` (`actionsOf`, `nameOf`), `hooks/register.tsx` (tool schema, add/list/withdraw handlers, Seen press), `tests/register.test.tsx`

**Interfaces:**
- Produces: `export type TaskKind = 'decision' | 'question' | 'action' | 'info'`; `TaskState` gains `'seen'`; `Task` gains `recommended?: string` (equals one of `options`); `export const MAX_INFO = 5` in `tasks.ts`; `statusOf(shown)` returns `☐ 1 decision · 1 question · 1 info · /open-items`, with upstream's `· N not sent yet` before `· /open-items` when it applies, kinds with a count of 0 left out, plural forms via `plural()`.
- Tool schema for `add_item`: `kind` enum `['decision','question','action','info']`; `options` (2–4, decision only); `recommended` (string, decision only, must equal an option); `title`, `why` required; `done_when` optional (action only).

- [ ] **Step 1: Write the failing tests:**
  - `a decision shows its options, the recommended one marked`: add `{ kind: 'decision', options: ['Yes','Not yet'], recommended: 'Yes' }`; expect buttons `1: Yes (recommended)` and `2: Not yet`, and `r: Other…`.
  - `a recommended value that is not an option is refused`: expect the tool result error naming `recommended`.
  - `an info item has one Seen button and sends nothing to Claude`: add info; press `d: Seen`; expect the item gone, no `prompt.submit`, no `session.append`.
  - `info items do not count toward the cap of 5 asks`: add 5 info and 5 questions; expect all 10 accepted; a 6th question refused.
  - `a sixth info item drops the oldest`: add 6 info; expect the first gone, 5 shown.
  - `the status line counts by kind`: 1 decision, 2 questions, 1 info → `☐ 1 decision · 2 questions · 1 info · /open-items`.
  - `withdrawn with "answered in chat" leaves the pane`: add a question, call `withdraw_item { id, reason: 'answered in chat' }`; expect the pane empty and the toast to include the reason.
- [ ] **Step 2:** Run. Expected: the new tests fail.
- [ ] **Step 3:** Implement. `do`→`action`, `answer`→`question`, `choose`→`decision` everywhere, including tests. `info` items: never counted in `MAX_OPEN`; `update` stays `'none'`; not in messages, digests or `prompt.context`; Seen sets state `'seen'` and removes it from `shown`. The `d` hotkey is `Seen` for info.
- [ ] **Step 4:** Run the three Global checks. Expected: 0 fail.
- [ ] **Step 5:** Commit `feat(open-items): decision, question, action and info kinds`.

### Task 4: Group the pane by kind

**Files:**
- Modify: `hooks/register.tsx` (the `Pane` render), `hooks/pane.ts` (`rowsFor`, `selectedOf`), `tests/register.test.tsx`, `tests/live/test_pane.py` (fixture with all four kinds)

**Interfaces:**
- Produces in `pane.ts`: `export const SECTIONS: readonly { kind: TaskKind; label: string }[] = [{ kind: 'decision', label: 'DECISIONS' }, { kind: 'question', label: 'QUESTIONS' }, { kind: 'action', label: 'ACTIONS' }, { kind: 'info', label: 'INFO' }]`; `export function groupsOf(active: readonly Task[]): { label: string; tasks: Task[] }[]` (sections in `SECTIONS` order, empty ones left out, oldest first).
- `selectedOf(view)`: with no selection, the first item of the first non-empty section.

- [ ] **Step 1: Write the failing tests:**
  - `the pane draws sections in order, empty ones left out`: add info, question, decision (in that order); expect the tree text order `DECISIONS`, the decision, `QUESTIONS`, the question, `INFO`, the info; no `ACTIONS`.
  - `the first decision starts selected`: same items; expect the decision's action row shown.
  - `rows count the section headers at 40 columns inline`: three kinds, inline at 40 columns; expect the rows asked for equal the tree's drawn rows (use upstream's row-count test pattern).
- [ ] **Step 2:** Run. Expected: fail.
- [ ] **Step 3:** Implement. Header rows: bold, yellow; one blank row between sections. Saved (answered, not sent) rows stay below the sections, as upstream.
- [ ] **Step 4:** Run the three Global checks, then the live harness: `python3 /Users/asafdafna/dev-projects/.worktrees/dafna-dev-standards-open-items/plugins/open-items/tests/live/test_pane.py`. Expected: pass at its narrow and wide widths. Read one rendered screen to confirm the sections show.
- [ ] **Step 5:** Commit `feat(open-items): group the pane by kind`.

### Task 5: The alert

**Files:**
- Modify: `hooks/register.tsx`, `tests/register.test.tsx`

**Interfaces:**
- Produces: `const ALERT_QUIET_MS = 120_000`; `live.lastPersonMs` (set on `prompt.submit` with `e.origin.kind === 'person'` and on every pane button press or field submit); `live.alertedTurn` (the turn id or counter that already alerted).
- On a successful `add_item` with kind `decision`, `question` or `action`: if this turn has not alerted and `now - live.lastPersonMs >= ALERT_QUIET_MS`, call `$.ui.notify(printable(title, MAX_TITLE), { title: 'Open items' })` and mark the turn alerted. Ignore its result and any rejection. Never alert for `info`.

- [ ] **Step 1: Write the failing tests:**
  - `a decision added while the person is away alerts once`: no person input for 3 minutes; add a decision then a question in the same turn; expect exactly one `ui.notify` with title `Open items` and the decision's title.
  - `no alert for info`: add info; expect no `ui.notify`.
  - `no alert within 2 minutes of the person's prompt`: person prompt 30 s ago; add a decision; expect no `ui.notify`.
  - `no alert within 2 minutes of a pane press`: press Seen 30 s ago; add a question; expect none.
  - `a title with quotes and a newline reaches notify as one clipped line`: title `Merge "PR #18"\nnow?`; expect the notify text on one line.
  - `a rejected notify does not fail add_item`: make `ui.notify` reject; expect the tool result to succeed.
- [ ] **Step 2:** Run. Expected: fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the three Global checks. `claude plugin validate` lists `$.ui.notify` and no `$.process`.
- [ ] **Step 5:** Commit `feat(open-items): alert on new asks while the person is away`.

### Task 6: Steering text and the own-tools guard

**Files:**
- Modify: `hooks/register.tsx` (`STEERING`, tool descriptions), `tests/register.test.tsx`

**Interfaces:**
- `STEERING` (the `prompt.compose` section, `scope: 'session'`) is exactly these four lines:
  1. `When you need something from the user, add it with mcp__open-items__add_item so it stays in their Open items pane until they resolve it: a decision that is theirs, a question only they can answer, an action only they can do, or info they must see (a failure, a finding that changes their plan).`
  2. `Add it even when you also ask in your reply. When they answer in chat instead, withdraw the item with reason "answered in chat".`
  3. `While background agents run, add the item and write no chat text about it until the batch ends.`
  4. `If add_item fails, ask in chat.`
- `add_item`'s description keeps upstream's guidance (async vs AskUserQuestion, one item per need, imperative title, secrets) with the four kinds explained in one sentence each.

- [ ] **Step 1: Write the failing tests:**
  - `the system prompt carries the four steering lines`: compose; expect the section text equal to the four lines joined by `\n`.
  - `every tool.call hook matches one of the mod's own tools`: read the hook registrations the test kit exposes (or, if it exposes none, scan `hooks/register.tsx` source for `on('tool.call'`) and expect each matcher's `tool` in `[ADD, LIST, WITHDRAW]`.
  - Keep upstream's test that `print` and `bare` sessions get no section.
- [ ] **Step 2:** Run. Expected: the first test fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the three Global checks.
- [ ] **Step 5:** Commit `feat(open-items): steering for the four kinds and the batch rule`.

### Task 7: Package and ship files

**Files:**
- Modify: `plugins/open-items/README.md`, `.claude-plugin/marketplace.json`, `CHANGELOG.md`, `README.md` (repo root: one line listing the plugin)
- Create: `.github/workflows/open-items.yml`

- [ ] **Step 1:** `plugins/open-items/README.md`, short: what it does (four kinds, pane, status line, `/open-items`); what it puts in the prompts it submits (upstream README section, adapted); the alert (`$.ui.notify`, through the person's own channel or a `Notification` hook with matcher `plugin_notification`); a credit line: "Based on human-in-the-loop by Tzafrir Rehan (MIT)."
- [ ] **Step 2:** `marketplace.json`: add `{ "name": "open-items", "source": "./plugins/open-items", "description": "Pane for the decisions, questions, actions and info Claude needs you to see (opt-in mod)" }`.
- [ ] **Step 3:** `CHANGELOG.md`: a top entry `## open-items 0.1.0 — new opt-in mod` with 3–5 lines: the fork, what was removed, what was added.
- [ ] **Step 4:** `.github/workflows/open-items.yml`: on `pull_request` and `push` to `main` with `paths: ['plugins/open-items/**', '.github/workflows/open-items.yml']`; Node 22; `npm install -g @anthropic-ai/claude-code@2.1.310`; `claude plugin validate plugins/open-items`; `claude plugin test plugins/open-items`. Not a required check.
- [ ] **Step 5:** Run `/Users/asafdafna/dev-projects/.worktrees/dafna-dev-standards-open-items/scripts/validate.sh` from the worktree root (`sh -c` with the worktree as working directory, or `git -C` where it applies). Expected: `OK`. Run the three Global checks.
- [ ] **Step 6:** Commit `chore(open-items): README, marketplace entry, changelog, CI`.
