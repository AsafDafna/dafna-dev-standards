# open-items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Controller:** give every implementer and reviewer the Global Constraints section together with its task.

**Goal:** Turn the imported `human-in-the-loop` 0.1.8 copy in `plugins/open-items/` into the `open-items` mod the spec describes.

**Architecture:** A Claude Code hooks module (mod). Claude calls the mod's tools to add items. The mod keeps items in `$.state`, draws them in a pane and a status line, and delivers the person's answers as prompts. Work proceeds from the upstream code: rename, replace the multi-session store with a per-session one, then add kinds, grouping, the alert and steering.

**Tech Stack:** TypeScript + JSX against the Claude Code 2.1.310 mod API (`import type … from 'claude-code'`), test kit `claude-code/testing`, live render harness in Python + tmux.

**Spec:** `docs/superpowers/specs/2026-10-25-open-items-pane-design.md`. Upstream's design doc (delivery and persistence logic) is at https://github.com/tzafrir/human-in-the-loop/blob/bf8233cd24e9d038516b307f7f13e2449aba1b60/docs/DESIGN.md. The plan review's findings are folded into this revision.

**Out of this plan (done by the controller session):** the private alert hook `~/.claude/hooks/plugin-notify-macos.sh` and its `Notification` wiring on both seats (done, claude-config `c21941a`, `827767e`); the CLAUDE.md batch-rule amendment (done); the coo amendment (on PR #18); the install on both seats and Asaf's smoke test (after the PR merges).

## Global Constraints

- Plugin folder: `plugins/open-items/` in the worktree `/Users/asafdafna/dev-projects/.worktrees/dafna-dev-standards-open-items`. Run every command with absolute paths; never start a command with `cd`.
- Plugin name `open-items`, version `0.1.0`. Tools: `mcp__open-items__add_item`, `mcp__open-items__list_items`, `mcp__open-items__withdraw_item`. Command `/open-items`. Pane id `open-items`, title `Open items`. State plugin key `open-items`. The long-answer prefix stays `↳ Answer to #N:`.
- The mod runs no host command: no `$.process`, no network.
- Every `tool.call` hook matches one of the mod's own three tools.
- No file under `plugins/` may match the repo's leak gate: `grep -rniE 'asaf|nir|edut|testimony|monday|/Users/([^<]|$)|~/dev-projects|~/Downloads' <plugin folder>` prints nothing.
- Keep `LICENSE` (MIT, upstream copyright line) unchanged.
- Code comments follow the repo rules: none unless they explain a non-obvious why; when you edit a function, fix comments your change makes wrong (words like "task", "project", "other session").
- Tests never import `hooks/saved.ts` constants; they use literal keys (`session:session-1`), so a missing export fails one test, not the file.
- Each task ends with all of these green:
  - `claude plugin test /Users/asafdafna/dev-projects/.worktrees/dafna-dev-standards-open-items/plugins/open-items`: 0 fail.
  - `claude plugin validate /Users/asafdafna/dev-projects/.worktrees/dafna-dev-standards-open-items/plugins/open-items`: "Validation passed".
  - `/Users/asafdafna/dev-projects/family-agent/node_modules/.bin/tsc -p /Users/asafdafna/dev-projects/.worktrees/dafna-dev-standards-open-items/plugins/open-items`: exit 0. The types live in `.claude-plugin/types/` (gitignored). If they are missing, lay them: start `claude --plugin-dir <plugin folder>` in a detached tmux session from `/Users/asafdafna/dev-projects`, wait for `.claude-plugin/types/tsconfig.json`, kill the session.
  - From Task 2a on: the live harness, `python3 /Users/asafdafna/dev-projects/.worktrees/dafna-dev-standards-open-items/plugins/open-items/tests/live/test_pane.py`: pass. It draws the pane in a real Claude Code in tmux and calls no model.
- Commit at the end of each task with a conventional message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.

## Review Focus

1. Item text with quotes, newlines and wide characters reaches the pane, the status line and the alert text safely (`printable`, one line, clipped). Test: Task 5.
2. Section header rows at narrow inline widths: `rowsFor` must count them, or the inline pane cuts its last row. Tests: Task 4 (hard-coded rows + live `assert_fits` at 40 columns).
3. A flood of `info` items (6 or more) drops the oldest and never blocks a decision or question, nor holds back saved answers. Tests: Task 3.
4. `/clear` with an answer saved but not sent: the new session starts empty and the old key stays. A resumed session gets its open items and unsent answers back. Tests: Tasks 2a, 2b (kit + live).
5. The person answers in chat: Claude withdraws the item with reason `answered in chat`, and the pane drops it. Test: Task 3.

---

### Task 1: Rename to open-items and clean the folder

**Files:**
- Modify: `plugins/open-items/.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.tsx`, `hooks/tasks.ts`, `hooks/pane.ts`, `types/index.d.ts`, `tests/register.test.tsx`, `tests/live/test_pane.py`, `tests/live/screen.py`, `.gitignore`
- Delete: `plugins/open-items/docs/DESIGN.md`, `plugins/open-items/.claude-plugin/icon.png`
- Replace: `plugins/open-items/README.md` (one placeholder paragraph; Task 6 writes it)

**Interfaces:**
- Produces: constants `PLUGIN = 'open-items'`, `ADD = 'mcp__open-items__add_item'`, `LIST = 'mcp__open-items__list_items'`, `WITHDRAW = 'mcp__open-items__withdraw_item'`, `PANE = 'open-items'`, `PANE_TITLE = 'Open items'`; state key `'open-items'` in `PluginState`.

- [ ] **Step 1:** `plugin.json`: `name` `open-items`, `version` `0.1.0`, `description` "Claude adds the decisions, questions, actions and findings that need you to an Open items pane, so they stay visible and answerable until you resolve them.", `license` `MIT`, `types` kept; drop `author`, `displayName`, `homepage`, `repository`, `icon`, `documentationUrl`, `supportUrl`, `privacyPolicyUrl`, `keywords`. `hooks.json`: the description names Open items.
- [ ] **Step 2:** Rename identifiers and model-facing names: tools `assign_task`→`add_item`, `list_tasks`→`list_items`, `withdraw_task`→`withdraw_item`; command `my-tasks`→`open-items`; pane id and title; state key; all tool descriptions, prompt text, toasts, notices and pane copy say "item(s)" and "Open items" where they said "task(s)" and "My tasks". Kinds stay `do`/`answer`/`choose` in this task (Task 3 renames them).
- [ ] **Step 3:** Update the tests' expected strings to match. Replace the "Monday" string in `tests/live/test_pane.py` (for example "Wait for the freeze to end").
- [ ] **Step 4:** Run the leak gate (Global Constraints). Expected: no output.
- [ ] **Step 5:** Run the Global checks (test, validate, tsc). Expected: 192 pass, 0 fail; validation passed; tsc exit 0. Run the live harness once: pass.
- [ ] **Step 6:** Commit `refactor(open-items): rename from human-in-the-loop`.

### Task 2a: Add the per-session store beside the old one

The old multi-session code stays in this task; it goes in Task 2b. This keeps a green point between the two.

**Files:**
- Create: `plugins/open-items/hooks/saved.ts`
- Modify: `hooks/register.tsx`, `tests/register.test.tsx`, `tests/live/screen.py`, `tests/live/test_pane.py`

**Interfaces:**
- `hooks/saved.ts`:
  - `export const KEEP_MS = 30 * 24 * 60 * 60_000`
  - `export type Saved = { tasks: readonly Task[]; nextId: number; savedMs: number }`. `tasks` holds only `isShown` items (the store is one JSON file of 4 MiB for all keys).
  - `export function keyOf(sessionId: string): string` returns `session:<sessionId>`.
  - `export function savedIn(raw: unknown): Saved | undefined` validates the shape with upstream's `isTask` checks (moved here from `project.ts`); bad entries are skipped.
  - `export function isExpired(saved: Saved, nowMs: number): boolean` is true when `nowMs - savedMs > KEEP_MS`.
- `register.tsx`:
  - `switchTo($, sessionId: string)`: one reset used at start, after /clear and after a resume. It is upstream's root-change block (`register.tsx` in `join`, the `if (live.root !== '' && live.root !== root)` branch): empty `tasks`, `nextId` 1, `selectedId`/`editing` null, `live.drafts/closed/drawn/held` cleared, the batch timer cancelled, `isSendingAtEnd` and `isUnread` false; then `live.sessionId = sessionId`. All later writes key on `live.sessionId`.
  - `restore($)`: if `loadedFor` already equals the session id, do nothing (a code reload re-fires `session.start` with `$.state` kept). Else read `keyOf(id)`; set `tasks` and `nextId` from it; set `loadedFor`; delete keys `session:*` that `isExpired`; then `refresh($)` and `show($, false)`.
  - `persist($)`: `queued(...)` with the state read inside the queued function; callers wait through `awaited` (a slow store holds a press, prompt or tool call 5 s at most, as upstream). At `session.end`, the write races half of `next.budget.remainingMs`, as upstream's end write does.
- Live harness: `screen.py` `seed()` writes `session:<uuid>` with a `Saved` value and starts claude with `--session-id <uuid>`; `test_pane.py` drops the "from an earlier session" asserts.

- [ ] **Step 1: Port the layout tests.** The 19 `earlier([...])` tests in "long titles" seed `tasks:/repo` (the 0.1.4 layout). Rewrite `earlier()` to seed `session:session-1` with `{ tasks, nextId, savedMs }`, drop the "· from an earlier session" suffix from expectations, and recompute expected rows. Port the `keysOf` store-op check in "responding" to the new key.
- [ ] **Step 2: Write the failing tests** in `describe('saving', …)`:
  - `restores open items and unsent answers when the same session starts again`: seed `session:session-1` with one open `choose` item and one `done` item with `update: 'pending'`; start; expect `world.status` to include `1 not sent yet` and `world.opens` to have one entry.
  - `writes the session's key on every change`: add an item; expect store key `session:session-1` to hold it.
  - `saves only shown items`: deliver an answer; expect the delivered item gone from the saved value.
  - `deletes saved sessions older than 30 days at start`: seed one key with `savedMs` 31 days before `NOW`, one 1 day before; start; expect only the 1-day key.
  - `a code reload keeps newer state`: start, add an item, make the store write fail, re-fire `session.start`; expect the item still shown.
  - `a stuck store holds a tool call 5 s at most`: port upstream's test of that name from "across sessions" to the new key.
- [ ] **Step 3:** Run. Expected: the new tests fail; all old tests still pass.
- [ ] **Step 4:** Implement `saved.ts`, `switchTo`, `restore` (called at `session.start` after the tools and the command are registered) and `persist` (after every `change()` and every delivery state change). The old `join` path stays wired for now; where both would run, the new path wins.
- [ ] **Step 5:** Update the live harness seed and asserts. Run every Global check and the live harness. Expected: all pass.
- [ ] **Step 6:** Commit `feat(open-items): per-session store`.

### Task 2b: Remove the multi-session machinery

**Files:**
- Delete: `plugins/open-items/hooks/project.ts`
- Modify: `hooks/register.tsx`, `hooks/tasks.ts` (`statusOf`, `contextOf`), `hooks/pane.ts` (`ageOf`), `types/index.d.ts` (drop `TaskRef`, `Took`, the `took` state key; keep `loadedFor`), `tests/register.test.tsx`, `tests/live/test_pane.py`

**Interfaces:**
- `session.end`: reason `clear` → after `next(e)`, `switchTo($, <new id>)`; the old key (`keyOf(e.sessionId)`) stays for `claude --resume <old id>` until the 30-day cleanup. Reason `resume` → after `next(e)`, `$.clock.after(0, () => void (switchTo then restore))`. Any other reason → the end write (`persist`, raced as in 2a).
- `statusOf(shown)` loses its `elsewhere` parameter; `contextOf(shown)` loses `sessionId`; `ageOf` loses "from an earlier session".

- [ ] **Step 1: Write the failing tests:**
  - `after /clear the pane is empty and the first item is #1`: add two items, end with reason `clear`; expect `world.status` empty; add an item; expect its id 1; expect `session:session-1` still in the store.
  - `a resume into a session with no saved key shows nothing`: add an item, end with reason `resume` into `session-2` with no key; expect the pane empty and no write of the old items under `session:session-2`.
  - `a resume into a saved session restores it`: seed `session:session-2`; end with reason `resume` into it; expect its items.
- [ ] **Step 2:** Run. Expected: fail.
- [ ] **Step 3:** Delete the `across sessions` describe group (89 tests) after checking that each test it holds is either about another session, the 0.1.4 layout, or already ported in 2a. Remove from `register.tsx`: `join`, `load`, `renumber`, `withHeld`, `beat`, `sync`, `letGo`, `readProject`, `writeOwn`, `slotOf`, `slotFrom`, `clean`, `editLegacy`, `isLoaded`, the `MOVING` text and every `live.moving` check, the heartbeat, the `took` atom, and the `live` fields only they use (`root`, `joinRoot`, `heartbeat`, `elsewhere`, `floor`, `hasLegacyPeer`, `hasSlot`, `writtenMs`, `readMs`, `endedMs`, `ends`, `moving`). Keep `queued`, `awaited`, `within` and `stalled`: `persist` uses them. Keep `wake` only if delivery still calls it.
- [ ] **Step 4:** Implement the `session.end` branches above.
- [ ] **Step 5: Live check.** Seed `session:<uuid>` with one open item, start claude with `--session-id <uuid>`, expect the status line; type `/clear`; expect the status line gone. Add it to `test_pane.py` as a test.
- [ ] **Step 6:** Run every Global check and the live harness. Expected: all pass. `claude plugin validate` no longer lists `$.session.root` or `via readProject`.
- [ ] **Step 7:** Commit `refactor(open-items): drop the multi-session store`.

### Task 3: Four kinds, the recommended option and info items

**Files:**
- Modify: `types/index.d.ts`, `hooks/tasks.ts` (`KINDS`, `parseAsk`, `MAX_OPEN`, new `MAX_INFO`, new `isAsk`, `statusOf`, message and digest builders), `hooks/pane.ts` (`actionsOf`, `nameOf`, `answerPlaceholderOf`), `hooks/saved.ts` (validator accepts the new kinds, `seen`, `recommended`), `hooks/register.tsx` (tool schema, add/list/withdraw handlers, Seen press, `isAllAnswered`, the "with your other answers" text), `tests/register.test.tsx`, `tests/live/test_pane.py` (fixture kinds and buttons)

**Interfaces:**
- `export type TaskKind = 'decision' | 'question' | 'action' | 'info'`; `TaskState` gains `'seen'`; `Task` gains `recommended?: string` (equals one of `options`).
- `export const MAX_INFO = 5` in `tasks.ts`; `export function isAsk(task: Task): boolean` (open and not `info`). `isAsk` replaces `isActive` in `MAX_OPEN`, `isAllAnswered` (`turn.complete`), the "with your other answers" text and `answerPlaceholderOf`.
- `statusOf(shown)` returns `☐ 1 decision · 1 question · 1 info · /open-items`, with upstream's `· N not sent yet` before `· /open-items` when it applies; kinds with a count of 0 are left out; plurals via `plural()`, except "info", which keeps its form for any count.
- Tool schema for `add_item`: `kind` enum `['decision','question','action','info']`; `options` (2–4, decision only); `recommended` (string, decision only, must equal an option); `title`, `why` required; `done_when` optional (action only).

- [ ] **Step 1: Write the failing tests:**
  - `a decision shows its options, the recommended one marked`: add `{ kind: 'decision', options: ['Yes','Not yet'], recommended: 'Yes' }`; expect buttons `1: Yes (recommended)`, `2: Not yet` and `r: Other…`.
  - `a recommended value that is not an option is refused`: expect the tool result error naming `recommended`.
  - `an info item has one Seen button and sends nothing to Claude`: add info; press `d: Seen`; expect it gone, no `prompt.submit`, no `session.append`.
  - `info items do not count toward the cap of 5 asks`: add 5 info and 5 questions; expect all 10 accepted; a 6th question refused.
  - `a sixth info item drops the oldest`: add 6 info; expect the first gone, 5 shown.
  - `an unseen info item does not hold back saved answers at turn end`: add a question and an info item; save an answer while working; complete the turn; expect the answer sent.
  - `the status line counts by kind`: 1 decision, 2 questions, 2 info → `☐ 1 decision · 2 questions · 2 info · /open-items`.
  - `withdrawn with "answered in chat" leaves the pane`: add a question, call `withdraw_item { id, reason: 'answered in chat' }`; expect the pane empty and the toast to include the reason.
  - `a resumed decision with a recommended option comes back`: seed `session:session-1` with such a decision; start; expect the `(recommended)` button.
- [ ] **Step 2:** Run. Expected: the new tests fail.
- [ ] **Step 3:** Implement. `do`→`action`, `answer`→`question`, `choose`→`decision` everywhere, including tests and the live fixture. `info` items: `update` stays `'none'`; not in messages, digests or `prompt.context`; Seen sets state `'seen'` and removes it from `shown`. The `d` hotkey is `Seen` for info.
- [ ] **Step 4:** Run every Global check and the live harness.
- [ ] **Step 5:** Commit `feat(open-items): decision, question, action and info kinds`.

### Task 4: Group the pane by kind

**Files:**
- Modify: `hooks/register.tsx` (the `Pane` render, `reselect`), `hooks/pane.ts` (`rowsFor`, `selectedOf`, new `SECTIONS`, `groupsOf`), `tests/register.test.tsx`, `tests/live/test_pane.py`

**Interfaces:**
- `pane.ts`: `export const SECTIONS: readonly { kind: TaskKind; label: string }[] = [{ kind: 'decision', label: 'DECISIONS' }, { kind: 'question', label: 'QUESTIONS' }, { kind: 'action', label: 'ACTIONS' }, { kind: 'info', label: 'INFO' }]`; `export function groupsOf(active: readonly Task[]): { label: string; tasks: Task[] }[]` (sections in `SECTIONS` order, empty ones left out, oldest first within a section).
- Selection: the first item added still starts selected (upstream's `chosen ?? id`). When the selected item closes, `reselect` picks the first item of the first non-empty section. `selectedOf(view)` with no selection uses the same rule.
- `rowsFor` adds one row per section header and one blank row between sections.

- [ ] **Step 1: Write the failing tests:**
  - `the pane draws sections in order, empty ones left out`: add info, question, decision (in that order); expect the drawn text order `DECISIONS`, the decision, `QUESTIONS`, the question, `INFO`, the info; no `ACTIONS`.
  - `after the selected item closes, the first decision is selected`: add info, then a decision; press Seen on the info; expect the decision's action row.
  - `rows count the section headers`: three kinds, inline at 40 columns; expect `world.opens.at(-1).rows` to equal a hard-coded number (copy the pattern of the ported "long titles" tests from Task 2a, for example the one asserting rows for a long title at 40 columns).
- [ ] **Step 2:** Run. Expected: fail.
- [ ] **Step 3:** Implement. Header rows: bold, yellow. Saved (answered, not sent) rows stay below the sections, as upstream.
- [ ] **Step 4:** Add a live test drawing all four kinds at 40 and 120 columns with `assert_fits`; set the hard-coded row number in Step 1's test to what the live harness measures. Run every Global check and the live harness. Read one rendered screen to confirm the sections show.
- [ ] **Step 5:** Commit `feat(open-items): group the pane by kind`.

### Task 5: The alert

**Files:**
- Modify: `hooks/register.tsx`, `tests/register.test.tsx` (`seat()` gains a `ui.notify` hook that records `{ text, title }` into `world` and can `{ deny }`)

**Interfaces:**
- `const ALERT_QUIET_MS = 120_000`.
- `live.lastPersonMs`: set on `prompt.submit` with `e.origin.kind` `composer` or `bridge`, and on every pane button press or field submit.
- `live.alertedTurn: boolean`: set when an alert fires; reset at `turn.start` and `turn.complete` with no `agentId` (the main loop). Calls outside a turn (most kit tests) count as one turn.
- On a successful `add_item` with kind `decision`, `question` or `action`: if `!live.alertedTurn` and `now - live.lastPersonMs >= ALERT_QUIET_MS`, call `$.ui.notify(printable(title, MAX_TITLE), { title: 'Open items' })` without awaiting its result in the tool's path, catch any rejection, and set `live.alertedTurn`. Never alert for `info`.

- [ ] **Step 1: Write the failing tests:**
  - `a decision added while the person is away alerts once`: no person input for 3 minutes; add a decision then a question in one turn; expect exactly one notify, title `Open items`, text the decision's title.
  - `the next turn can alert again`: complete the turn, start another, add a question; expect a second notify.
  - `no alert for info`: add info; expect none.
  - `no alert within 2 minutes of the person's prompt`: a `composer` prompt 30 s ago; add a decision; expect none.
  - `no alert within 2 minutes of a pane press`: press Seen 30 s ago; add a question; expect none.
  - `a title with quotes and a newline reaches notify as one clipped line`: title `Merge "PR #18"\nnow?`; expect one line.
  - `a refused notify does not fail add_item`: the `ui.notify` hook returns `{ deny }`; expect the tool result to succeed.
- [ ] **Step 2:** Run. Expected: fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run every Global check and the live harness. `claude plugin validate` lists `$.ui.notify` and no `$.process`.
- [ ] **Step 5:** Commit `feat(open-items): alert on new asks while the person is away`.

### Task 6: Steering, the own-tools guard and packaging

**Files:**
- Modify: `hooks/register.tsx` (`STEERING`, tool descriptions), `tests/register.test.tsx`, `plugins/open-items/README.md`, `.claude-plugin/marketplace.json`, `CHANGELOG.md`, root `README.md`
- Create: `.github/workflows/open-items.yml`

**Interfaces:**
- `STEERING` (the `prompt.compose` section, `scope: 'session'`) is exactly these four lines:
  1. `When you need something from the user, add it with mcp__open-items__add_item so it stays in their Open items pane until they resolve it: a decision that is theirs, a question only they can answer, an action only they can do, or info they must see (a failure, a finding that changes their plan).`
  2. `Add it even when you also ask in your reply. When they answer in chat instead, withdraw the item with reason "answered in chat".`
  3. `While background agents run, add the item and write no chat text about it until the batch ends.`
  4. `If add_item fails, ask in chat.`
- `add_item`'s description keeps upstream's guidance (async vs AskUserQuestion, one item per need, imperative title, secrets) and explains the four kinds in one sentence each.

- [ ] **Step 1: Write the failing tests:**
  - `the system prompt carries the four steering lines`: compose; expect the section text to equal the four lines joined by `\n`.
  - `bare and print sessions get no section`: compose with trait `bare`, then `print`; expect no `open-items` section in either (upstream covers `print` only).
  - `every tool.call hook matches one of the mod's own tools`: import the exported `register`, call it with a recording `on` that keeps `(event, matcher)` pairs, and expect every `tool.call` matcher's `tool` to be in `[ADD, LIST, WITHDRAW]`.
- [ ] **Step 2:** Run. Expected: the first test fails.
- [ ] **Step 3:** Implement the steering and descriptions.
- [ ] **Step 4:** Packaging:
  - `plugins/open-items/README.md`, short: what it does (four kinds, pane, status line, `/open-items`); what it puts in the prompts it submits (upstream README section, adapted); the alert (`$.ui.notify` through the person's own channel, or a settings `Notification` hook with matcher `plugin_notification`); credit: "Based on human-in-the-loop by Tzafrir Rehan (MIT)."
  - `marketplace.json`: add `{ "name": "open-items", "source": "./plugins/open-items", "description": "Pane for the decisions, questions, actions and info Claude needs you to see (opt-in mod)" }`.
  - `CHANGELOG.md`: a top entry `## open-items 0.1.0 — new opt-in mod` with 3–5 lines (the fork, what was removed, what was added).
  - Root `README.md`: one line listing the plugin.
  - `.github/workflows/open-items.yml`: on `pull_request` and `push` to `main` with `paths: ['plugins/open-items/**', '.github/workflows/open-items.yml']`; Node 22; `npm install -g @anthropic-ai/claude-code@2.1.310`; `claude plugin validate plugins/open-items`; `claude plugin test plugins/open-items`. Not a required check.
- [ ] **Step 5:** CI dry run: run `claude plugin validate` and `claude plugin test` on a copy of the plugin folder without `.claude-plugin/types/`, under `env -i HOME=<temp dir> PATH=/usr/bin:/bin:/opt/homebrew/bin CLAUDE_CONFIG_DIR=<temp dir>`. Expected: both pass with no login.
- [ ] **Step 6:** Run the repo validator with the worktree as working directory: `sh -c 'cd /Users/asafdafna/dev-projects/.worktrees/dafna-dev-standards-open-items && ./scripts/validate.sh'`. Expected: `OK`. Run every Global check and the live harness.
- [ ] **Step 7:** Commit `feat(open-items): steering, own-tools guard, packaging`.
