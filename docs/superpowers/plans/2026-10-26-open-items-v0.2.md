# open-items v0.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each open item into a thread Asaf can read, question and answer in any order, delivered to Claude at once, and carried across a COO hand-off.

**Architecture:** The v0.1 mod (`plugins/open-items/`) stays one hooks module (`register.tsx`) with pure helpers beside it. The item model gains a thread, new states and an owner; the tools gain `reply_item`, `close_item`, `handoff_items`, `take_items`; delivery appends mid-turn instead of holding; the pane splits into a list screen and an item screen. Live probes run first, because their results pick the delivery fallback and the list keys.

**Tech Stack:** TypeScript (strict) on the Claude Code 2.1.310 mod API (`claude-code`, `claude-code/testing`); Python + tmux live harness (`tests/live/`); `claude plugin validate` / `claude plugin test`.

**Spec:** `docs/superpowers/specs/2026-10-26-open-items-v0.2-design.md` (builds on `2026-10-25-open-items-pane-design.md`). Read both before any task.

## Global Constraints

- Claude Code **2.1.310** mod API; CI pins `@anthropic-ai/claude-code@2.1.310`.
- `<wt>` = `/Users/asafdafna/dev-projects/.worktrees/dafna-dev-standards-oi-v02`. Never start a Bash command with `cd`; use absolute paths and `git -C <wt>`.
- Every task ends green on `claude plugin validate <wt>/plugins/open-items`, `claude plugin test <wt>/plugins/open-items`, and `tsc -p <wt>/plugins/open-items`. Types are laid by starting `claude --plugin-dir <wt>/plugins/open-items` in a detached tmux session, waiting for `.claude-plugin/types/tsconfig.json`, and killing it (temp dirs through `realpath` on macOS).
- Model-facing tool names: `mcp__open-items__add_item`, `reply_item`, `close_item`, `list_items`, `handoff_items`, `take_items`. `withdraw_item` is removed. Every `tool.call` hook matches one of these six (no hook on Bash or any other tool).
- Limits: title **80** characters; option **60**; detail, `done_when` and each thread message **4000**. Over a limit the tool returns an error; nothing is ever cut. No cap on open items or info items.
- Times: live chat **5 min** (`LIVE_CHAT_MS = 300_000`); alert quiet **2 min** (`ALERT_QUIET_MS`, unchanged); stale session **12 h**; unclaimed hand-off **30 min**; resolved items kept **7 days**; saved keys kept **30 days** (`KEEP_MS`, unchanged); press batch **800 ms** (`BATCH_MS`, unchanged).
- Each tool description is at most **4,096** characters. `add_item`, `reply_item`, `close_item`, `list_items` are not deferred; `handoff_items`, `take_items` are deferred.
- Pane wording from the spec, verbatim: "Moving to a new session", "N items moved from the previous session", "N items left by an earlier session", "waiting for Claude", "open-items: could not save", "live chat: ask in the chat". Other user-facing strings are plain English (ASD-STE100 style).
- The leak gate scans `plugins/`: no people's names and no names of Asaf's own tools in plugin files.
- Comments follow the core rule (only a non-obvious why), though v0.1's files are heavily commented. Delete v0.1 comments a change makes wrong.
- Release: plugin version `0.2.0` in `plugins/open-items/.claude-plugin/plugin.json`, one CHANGELOG line. `marketplace.json` entries carry no version; do not add one. Asaf merges the PR.

## Decisions made in planning (recorded in the spec)

- Hand-off writes: a take writes only the successor's key, which records the code it took; the old session reads the other keys for its code and then shows its items as moved.
- Number collision on take: keep the number when free, else the next free number, with an old-to-new map in the take result.
- No background-shell signal: the live-chat gate fails open (adds the item, and the result says it looks like a live chat).
- `close_item resolved` is allowed only when the thread holds a message from Asaf.
- Option hotkeys 1–4 on the item screen stay (Decided 4 bans typing item numbers, not option keys).
- "Claude is working" for delivery uses main-loop turn events only (`turn.start` / `turn.complete` with no `agentId`), not the band's `isWorking`.

## Press, state and thread event (used by Tasks 2–6)

| Asaf does | Item state | Thread entry | Sent to Claude |
|---|---|---|---|
| presses an option (decision) | `resolved` | event `chose`, text = option | yes |
| presses Done (action) | `resolved` | event `done` | yes |
| presses Seen (info) | `resolved` | event `seen` | no |
| presses Later | `later` | event `later` | yes ("Later. Go on without it.") |
| sends a reply (field or composer bridge) | unchanged (`open` or `later`) | user message; `isWaitingForClaude = true` | yes |
| presses Take / Dismiss on leftovers | moved here / dropped | event `took` on each taken item | Take: yes; Dismiss: no |

## v0.1 tests: which task rewrites or deletes each `describe` in `tests/register.test.tsx`

| v0.1 describe | Task |
|---|---|
| `adding`, `the system prompt`, `the mod's own tools`, `the alert` | 3 |
| `responding`, `long answers in the prompt box`, `knowing whether Claude works` | 4 (Reject and Send now tests deleted) |
| `the four kinds` | 2 (states), 5b (buttons) |
| `the pane and /open-items`, `the pane groups items by kind`, `long titles` (one-screen row counts deleted, replaced by the new screens' counts) | 5a |
| `the answer field` | 5b |
| `saving` | 2 (format), 6 (hand-off, leftovers) |
| `the README example` | 7 |

A task deletes a v0.1 test only when it rewrites that behavior or the spec removes it, and names each deleted test in its commit body.

## Review Focus

1. **Two live processes and one store file during a hand-off.** Expected: each writes only its own key; no item lost or doubled. Test in Task 6.
2. **A press on a drawing from before the item changed** (Claude closed it, or it moved). Expected: nothing reaches Claude, and the pane says the item is closed or moved. Tests in Tasks 5b and 6.
3. **A long thread in a short pane:** 40 messages of up to 4000 characters, inline at 18 rows. Expected: rows asked never exceed 18, Back stays a Button with hotkey `b`, the item scrolls in the live harness, and the key saves under 1 MiB. Tests in Tasks 2, 5b and 5c.
4. **The old session exits between `handoff_items` and `take_items`.** Expected: after 30 minutes the items are offered as leftovers, never lost. Test in Task 6.
5. **A secret pasted as a reply** (pane field or composer bridge). Expected: v0.1's secret guard holds it; nothing is sent. Test in Task 4.

Accepted risk: the 4 MiB limit is on the whole store file across sessions; only one key's size is tested. A failed write is never silent (Task 6), which is the guard.

---

### Task 1: Live probes (no plugin code)

**Files:**
- Create: `<wt>/docs/superpowers/notes/2026-10-26-open-items-v0.2-probes.md`
- Throwaway probe mods live in the session scratchpad, not in the repo.

**Interfaces:**
- Produces five lines in the note, each `<NAME>: <value> — <evidence>`: `CONSENT: pass|fail`, `LIST_KEYS: arrows-move-focus | scroll-hook-works | scroll-hook-fails`, `FIELD_BACK: tab | enter-empty | neither`, `BACKGROUND_SIGNAL: <event or API> | none`, `MAIN_TURN_EVENTS: complete | gaps`.

- [ ] **Step 1: Consent probe.** Drive a real session in tmux with `CLAUDE_CONFIG_DIR=/Users/asafdafna/.claude-edut710` and auto mode on, in a scratch git repo whose `origin` is a local bare repo. The prompt states the goal and forbids the destructive step without approval: "Make origin/main match my local main, whose history I rewrote. Do not run anything destructive until I approve it." Runs:
  1. **Negative control:** no approval is ever sent. When Claude tries `git push --force`, auto mode must block it. If it does not block, pick another destructive action on the scratch remote that it does block, and record which.
  2. **Append:** a fresh session; while Claude runs a `sleep 60` step it was asked to run first, a probe mod appends with `$.session.append` a user row in v0.1's wording: `My response to an item you gave me (Open items):\n\n#1 Force-push to the scratch remote?: I chose "Yes".` Record whether the force-push then passes.
  3. **Prompt control:** the same row sent by `$.prompt.submit({ asUser: true })` while Claude is idle (v0.1's path). It should pass.
  `CONSENT` is `pass` when run 2 passes and run 1 was blocked.
- [ ] **Step 2: List keys.** On v0.1 open-items, seed 40 items with `tests/live/screen.py` (`Claude.seed`, then `Claude.pane(columns, rows, keys=...)`), inline at 18 rows and docked; each unselected row is a Button. Send ↓ twelve times. If focus moves to the 13th row: `arrows-move-focus`. If the body scrolls instead, add a `ui.scroll` hook in a scratch copy that turns an arrow move into a focus move, and record whether that works.
- [ ] **Step 3: Field back.** Same setup, with an item's answer field open above its buttons. Send Tab; then, separately, Enter on the empty field. Record which reaches a Button.
- [ ] **Step 4: Signals.** Load the `plugin-authoring` skill and find how a mod learns that a background agent, a background shell command, or a monitor runs (`BACKGROUND_SIGNAL`). In the Step 1 session, log every `turn.start`/`turn.complete` with no `agentId`, and check that each main turn, including those a subagent hand-back starts, has both (`MAIN_TURN_EVENTS`).
- [ ] **Step 5: Write the note and commit.** `git -C <wt> add docs/superpowers/notes/2026-10-26-open-items-v0.2-probes.md && git -C <wt> commit -m "docs(open-items): v0.2 live probe results"`

If `LIST_KEYS` is `scroll-hook-fails`, stop and ask Asaf before Task 5a: the fallback (letter hotkeys to move) conflicts with his ↑↓ decision.

---

### Task 2: The item model, its migration, and the saved format

**Files:**
- Modify: `<wt>/plugins/open-items/types/index.d.ts`
- Modify: `<wt>/plugins/open-items/hooks/tasks.ts`, `hooks/saved.ts`, `hooks/pane.ts` (field reads only)
- Modify: `<wt>/plugins/open-items/hooks/register.tsx` (`resolve`, `respond`, `isRepeatOf`, `markSeen`, the `withdraw_item` handler, the Reject button and reason field)
- Create: `<wt>/plugins/open-items/tests/items.test.tsx`

**Interfaces:**
- Produces (types):

```ts
export type ItemState = 'open' | 'later' | 'resolved' | 'withdrawn' | 'handing-off' | 'moved'
export type ThreadEvent = 'chose' | 'done' | 'seen' | 'later' | 'changed' | 'took'
export type Message = { from: 'claude' | 'user'; text: string; atMs: number; event?: ThreadEvent }
export type Task = {
  id: number
  kind: TaskKind
  title: string
  thread: readonly Message[]        // thread[0] is the detail, from Claude
  doneWhen?: string
  options?: readonly string[]
  recommended?: string
  link?: string
  state: ItemState
  isWaitingForClaude: boolean       // Asaf replied; Claude has not replied or closed
  hasNewReply: boolean              // Claude replied; Asaf has not opened the item
  update: TaskUpdate                // unchanged: whether Claude heard Asaf's latest move
  note?: string                     // close note, "recorded in …", or "was #5 in the previous session"
  createdMs: number
  updatedMs: number
}
export type Saved = {
  version: 2
  tasks: readonly Task[]
  nextId: number
  savedMs: number
  lastActiveMs: number
  endedMs?: number
  folder: string                    // read once at session start
  handoff?: { code: string; atMs: number }
  taken: readonly { code: string; fromKey: string; ids: readonly { was: number; now: number }[] }[]
}
```

- Produces (functions): in `tasks.ts`, `parseAsk(args): Ask | { error: string }` (reads `detail`, `done_when`, `link`; detail and `done_when` keep line breaks; title and options through `oneLine`), `parseReply(args): { id: number; text?: string; change?: Partial<Pick<Task, 'title' | 'options' | 'recommended' | 'link' | 'doneWhen'>> } | { error: string }`, `isOpenAsk(task)` (state `open` or `later`, kind not `info`), `isShown(task)` (state `open`, `later` or `handing-off`, or `update === 'pending'`), `MAX_DETAIL = 4000`. In `saved.ts`, `savedIn(raw): Saved | undefined` and `trimmed(saved, nowMs): Saved`.
- Rules: `savedIn` converts a v0.1 value (no `version`): its `open` tasks become `open` items with `thread = [{ from: 'claude', text: why, atMs: createdMs }]`, others dropped; defaults `folder: ''` (so only `--resume` brings them back), `lastActiveMs: savedMs`, `taken: []`. `trimmed` strips the thread of a resolved, withdrawn or moved item to `[]` once its `update` is not `pending`, and drops it 7 days after `updatedMs`; open and Later items stay whole at any age.
- Presses map to states and thread entries as in the table above. The Reject button and its reason field are removed (the spec has no Reject).

- [ ] **Step 1: Write the failing tests** in `tests/items.test.tsx`:
  - `parseAsk keeps line breaks in detail and done_when` (`'1. Open settings\n2. Click New'` survives both).
  - `parseAsk refuses a detail or done_when over 4000 characters` (4001 → error containing `4000`; nothing cut).
  - `parseAsk keeps the 80-character title error`.
  - `parseReply needs text or a change`.
  - `isOpenAsk counts later items, not info`.
  - `savedIn converts a v0.1 key` (the v0.1 `ROTATE` fixture from `register.test.tsx` in `{ tasks: [ROTATE, <a done task>], nextId: 8, savedMs: 0 }` → one open #7, `thread[0].text === 'It was in a public gist.'`, `folder === ''`).
  - `trimmed keeps a resolved item's thread while its update is pending, strips it once delivered, drops it after 7 days, and keeps an open one of any age`.
  - `a 40-message thread of 4000-character messages saves under 1 MiB`.
  - In `register.test.tsx`, `the four kinds`: each press sets the state and thread event from the table.
- [ ] **Step 2: Run them to see them fail.** `claude plugin test <wt>/plugins/open-items` → the new tests fail.
- [ ] **Step 3: Implement** the types, functions and the register.tsx migration so the one-screen v0.1 pane keeps working on the new model (it draws `thread[0]` where it drew `why`). Remove `MAX_OPEN`, `MAX_INFO`, `MAX_WHY` and every `slice` cut.
- [ ] **Step 4: Run all tests.** Expected: PASS. Reject tests are deleted and named in the commit body. A cap test that cannot pass on the new model is marked `test.skip` with the comment `// Task 3`; Task 3 rewrites it.
- [ ] **Step 5: Commit.** `git -C <wt> commit -am "feat(open-items): v0.2 item model with threads; saved format v2"`

---

### Task 3: The tools Claude calls

**Files:**
- Modify: `<wt>/plugins/open-items/hooks/register.tsx` (`TOOLS`, `tool.describe`, `tool.call` hooks, `prompt.compose`, alert)
- Modify: `<wt>/plugins/open-items/hooks/tasks.ts` (tool result texts, `listOf`)
- Test: `<wt>/plugins/open-items/tests/register.test.tsx` (the describes Task 3 owns, plus new `threads` and `the live-chat gate`)

**Interfaces:**
- Consumes: Task 2 model and functions; Task 1 `BACKGROUND_SIGNAL`.
- Produces: constants `REPLY`, `CLOSE`, `HANDOFF`, `TAKE` (`mcp__open-items__…`); `HANDOFF` and `TAKE` registered with a deny `Not ready yet.` until Task 6. `live.inputs: { kind: 'typed' | 'bridge' | 'press'; atMs: number }[]` (last two kept; `typed` = `prompt.submit` origin `composer` with `answerIn(text) === null`; `bridge` = a composer prompt that is a bridge answer; `press` = any pane press). `isLiveChat(nowMs): boolean | 'unknown'`: true when both inputs are `typed`, the latest within 5 min, and no background task runs; `'unknown'` when `BACKGROUND_SIGNAL` is `none` and the other conditions hold.
- Schemas: `add_item { kind, title, detail, options?, recommended?, done_when?, link? }` (required kind, title, detail); `reply_item { id, text?, title?, options?, recommended?, link?, done_when? }`; `close_item { id, as: 'resolved' | 'withdrawn', note? }`; `list_items { show?: 'updates' | 'open' | 'all', id? }` (lists state, `hasNewReply`, `isWaitingForClaude`, the thread's last 3 messages; `id` gives the whole thread).
- Gate results: `true` → deny `live chat: ask in the chat`; `'unknown'` → add the item, and the result ends with `This looks like a live chat: if the user is here and replying, withdraw it with close_item and ask in the chat.`

- [ ] **Step 1: Write the failing tests:**
  - `a seventh open item is added: there is no cap`.
  - `reply_item adds Claude's message, keeps the item open, and marks it hasNewReply`.
  - `reply_item changes the options in place and logs a changed event`.
  - `close_item resolved is refused until the thread holds a message from the user` (deny contains `no answer from the user yet`; then seed the saved key through `seat(on, store)` with a user message in the thread → allowed).
  - `close_item withdrawn with note "answered in chat"` (state `withdrawn`; toast names the item).
  - `the same ask twice is still one item`.
  - `every tool but list_items refuses a subagent`.
  - `add_item, reply_item, close_item, list_items are not deferred; handoff_items and take_items are`.
  - `every tool description is at most 4096 characters`.
  - `add_item's description carries the live-chat rule and the session-end rule` (one `toContain` per rule: `live chat`, `Before the session ends`).
  - Live-chat gate, one test per spec case: brainstorm second typed prompt → refused; COO first turn → allowed; press then add → allowed; two bridge answers → allowed; two typed prompts while a background shell command runs → allowed (or, with `BACKGROUND_SIGNAL: none`, added with the live-chat note); typed, press, typed → allowed.
  - `a Claude reply alerts like a new item` (`world.notifies` gets one entry; none when Asaf pressed within 2 min).
  - Hooks-list test: every `tool.call` hook matches one of the six tools.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** Steering goes into the descriptions as the spec's Steering section lists: `add_item` gets the adding rules, plain titles, no `#` for other numbers, consent-is-a-decision, live chat, and the session-end rule; `reply_item` and `close_item` get the thread and closing rules and "answered in chat"; `handoff_items` says how to pass the code. `prompt.compose` keeps a short copy.
- [ ] **Step 4: Run all tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git -C <wt> commit -am "feat(open-items): reply_item, close_item, no cap, live-chat gate, steering in tool descriptions"`

---

### Task 4: Delivery

**Files:**
- Modify: `<wt>/plugins/open-items/hooks/register.tsx` (`resolve`, `respond`, `send`, `sendSoon`, `answer`, `longAnswer`, `turn.start`, `turn.step`, `turn.complete`, `prompt.submit`, `prompt.context`, `working`)
- Modify: `<wt>/plugins/open-items/hooks/tasks.ts` (`messageOf`, `digestOf`, new `reminderOf`)
- Test: `<wt>/plugins/open-items/tests/register.test.tsx` (the describes Task 4 owns, plus new `delivery`)

**Interfaces:**
- Consumes: Task 1 `CONSENT`, `MAIN_TURN_EVENTS`; Tasks 2–3.
- Produces: `deliver($, ids: readonly number[]): Promise<void>`, the one path every press and reply takes after the 800 ms batch. `isMainTurnRunning(): boolean | undefined` replaces `working()`: true between a `turn.start` and `turn.complete` with no `agentId`, false after `turn.complete`, `undefined` before the first main turn event. Rule: true → `$.session.append` now and set `live.unreadAppend = ids`; false → `$.prompt.submit({ asUser: true })`; `undefined` → `$.prompt.submit`. The next main `turn.step` clears `live.unreadAppend`; at main `turn.complete`, a non-empty `live.unreadAppend` triggers v0.1's wake-up prompt. Only a main `turn.start`/`turn.step` touches it (fixes v0.1's subagent `isUnread` bug). If `CONSENT` is `fail`: option and Done presses wait for main `turn.complete` and go as a prompt; replies and Later still append.
- A composer-bridge answer (`↳ Answer to #N:`) becomes a reply: the item stays open, `isWaitingForClaude` true.
- Wording (tests pin it): option `My response to an item you gave me (Open items):\n\n#5 <title>: I chose "<option>".`; Done `#5 <title>: Done.`; Later `#5 <title>: Later. Go on without it.`; reply `#5 <title>: my reply (the item stays open; answer in it with reply_item, or close it with close_item):\n<text>`. `reminderOf(shown)` → `Open items: 3 open, 1 unread answer; call list_items.`

- [ ] **Step 1: Write the failing tests:**
  - `an answer while another item is open goes at once` (two open items; press an option on #1 while idle → one `prompt.submit` naming only #1).
  - `a reply mid-turn is appended at once` (main `turn.start`, then reply → one `session.append`; no `prompt.submit`).
  - `an appended answer still unread at the main turn's end wakes Claude`.
  - `a subagent's turn.start does not clear an unread append`.
  - `a reply never closes the item` (state `open`, `isWaitingForClaude` true).
  - `a composer-bridge answer is a reply and keeps the item open`.
  - `before any main turn event, an answer goes as a prompt`.
  - `presses within 800 ms go as one message`.
  - `every prompt not of the mod's own origin carries the reminder while items are open` (composer prompt and subagent hand-back prompt both get `reminderOf(...)`; none when nothing is open; `prompt.context` adds no summary block).
  - `a secret pasted as a reply is held and not sent`, for the pane field and for the composer bridge.
  - Only if `CONSENT` is `fail`: `an option pressed mid-turn goes as a prompt when the main turn ends`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** Remove the open-asks hold (`!all.some(isAsk)`), Send now / Save for later (`How` keeps `'auto'` only), and the "not sent yet" counts. Keep the consent-fallback note `waits for Claude's turn to end` only when `CONSENT` is `fail`.
- [ ] **Step 4: Run all tests.** Expected: PASS.
- [ ] **Step 5: Checkpoint.** Run the live harness (`python3 <wt>/plugins/open-items/tests/live/test_pane.py`) on the one-screen pane: delivery is fixed before the pane rewrite. Expected: PASS.
- [ ] **Step 6: Commit.** `git -C <wt> commit -am "feat(open-items): deliver each answer at once; bridge answers are replies; per-prompt reminder"`

---

### Task 5a: The list screen and the status line

**Files:**
- Modify: `<wt>/plugins/open-items/hooks/pane.ts`, `hooks/register.tsx` (the `Pane` render hook, `paneView`, `rowsWanted`, status line), `types/index.d.ts` (`PluginState['open-items']` gains `screen: { kind: 'list' } | { kind: 'item'; id: number }`)
- Test: `<wt>/plugins/open-items/tests/register.test.tsx` (the describes Task 5a owns, plus new `the list screen`)

**Interfaces:**
- Consumes: Tasks 2–4; Task 1 `LIST_KEYS`.
- Produces: element keys `head`, `section-<LABEL>`, `row-<id>`; `screenOf(view): 'list' | { id: number }` in `pane.ts`; `rowsFor` for the list screen. Sections `DECISIONS, QUESTIONS, ACTIONS, INFO, LATER`, empty ones not drawn, oldest first. Row marks: `●` when `hasNewReply`, `⋯ waiting for Claude` when `isWaitingForClaude`. Status line `☐ 2 decisions · 1 question · ● 1 reply · 1 later · /open-items`, with `isWaitingForClaude` items out of the kind counts.

- [ ] **Step 1: Write the failing tests:** `the list shows one line per item, grouped, LATER last`; `a row with a new Claude reply shows ●`; `a row after Asaf's reply shows "waiting for Claude" and leaves the status count`; `Enter on row-9 opens item 9 before item 5` (state `screen` becomes `{ kind: 'item', id: 9 }`); `rows asked for the list never exceed 18 inline`; if `LIST_KEYS` is `scroll-hook-works`: `an arrow move in a long list moves focus to the next row` (the `ui.scroll` hook).
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** Keep v0.1's surface handling (seats, inline sizing, two clients, mobile without `Input`).
- [ ] **Step 4: Run all tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git -C <wt> commit -am "feat(open-items): list screen and status line"`

### Task 5b: The item screen, the thread and the reply field

**Files:**
- Modify: `<wt>/plugins/open-items/hooks/pane.ts`, `hooks/register.tsx`
- Test: `<wt>/plugins/open-items/tests/register.test.tsx` (`the answer field`, the button part of `the four kinds`, new `the item screen`)

**Interfaces:**
- Consumes: Task 5a `screenOf`, `screen` state; Task 1 `FIELD_BACK`.
- Produces: element keys `item-<id>`, `thread`, `msg-<i>`, `options`, `later`, `back` (hotkey `b`), `reply-<id>` (the field, keyed per item as v0.1's `fieldKeyOf` does). Option Buttons keep hotkeys `1`–`4`. A `Link` for `link` sits outside every Button. If `FIELD_BACK` is `neither`, the reply field gets a `Back` Button beside `Send`.

- [ ] **Step 1: Write the failing tests:** `the item screen shows the whole thread with line breaks` (a 3-line detail gives 3 lines in `msg-0`); `opening an item clears its ●`; `Back returns to the list`; `buttons by kind: options + Later for a decision, Done + Later for an action, Seen for info`; `an item in LATER keeps its buttons`; `a press on a drawing from before Claude closed the item sends nothing and says it is closed`; `a 40-message thread inline at 18 rows asks for at most 18 rows and keeps the back Button with hotkey b`; `the reply field is keyed per item, so a draft never lands in another item's field`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** Delete the v0.1 one-screen expansion code that the two screens replace.
- [ ] **Step 4: Run all tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git -C <wt> commit -am "feat(open-items): item screen with thread, reply field and Later"`

### Task 5c: The live harness for two screens

**Files:**
- Modify: `<wt>/plugins/open-items/tests/live/test_pane.py`, `tests/live/renders.py`, `tests/live/screen.py` (seed v2 items)

- [ ] **Step 1:** Update `Claude.seed` to write `version: 2` items. Add live tests: open an item with Enter, go back with `b`; a 40-message thread scrolls inline at 18 rows and docked; the reply field reaches Back by the key `FIELD_BACK` found.
- [ ] **Step 2:** Run `python3 <wt>/plugins/open-items/tests/live/test_pane.py`. Expected: PASS.
- [ ] **Step 3: Commit.** `git -C <wt> commit -am "test(open-items): live harness for the two screens"`

---

### Task 6: Hand-off, leftovers and the store

**Files:**
- Modify: `<wt>/plugins/open-items/hooks/register.tsx` (`session.start`, `session.end`, `restore`, `startCleared`, `startResumed`, `writeSaved`, `dropExpired`, the hand-off tools, the `offer` element)
- Modify: `<wt>/plugins/open-items/hooks/saved.ts` (`leftoversIn`, `takenCodes`)
- Test: `<wt>/plugins/open-items/tests/register.test.tsx` (`saving` hand-off part; new `hand-off`, `leftovers`)

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces: `leftoversIn(all: Record<string, unknown>, folder: string, ownKey: string, nowMs: number): { key: string; saved: Saved }[]`; `takenCodes(all): Set<string>`. `handoff_items {}` → `Marked N items for the next session. Hand-off code: <code>. Put the code in the successor's prompt; it calls take_items with it.` (`code`: 6 characters from `[a-z0-9]`). `take_items { code }` → per item: number (with `was #N` when renumbered), kind, title, whole thread, unread answers; the Take button sends Claude the same text. Element `offer` with Buttons `take` and `dismiss`.
- Rules:
  - `handoff_items` sets the open and Later items to `handing-off`, saves `handoff: { code, atMs }`, and moves along any item in `live.unreadAppend` with its answer marked unread.
  - `take_items` / Take writes only the taking session's key: the items (renumbered on collision), `taken` += `{ code, fromKey, ids }`, and `nextId` past the highest number held.
  - Every session, at each main turn, press and write, reads `takenCodes` of the other keys; its `handing-off` items whose code was taken become `moved` (pane: "moved to a new session", no buttons). Until then the pane shows them read-only as "Moving to a new session".
  - `lastActiveMs` is written on every main turn and press; `endedMs` at `session.end` for every reason, `clear` included. `--resume` clears `endedMs` and writes `lastActiveMs`.
  - Leftovers for a session in folder F: keys of other sessions with `folder === F` whose items are open, Later or `handing-off`, never with a code in `takenCodes`, and whose owner has `endedMs`, or `lastActiveMs` older than 12 h, or a `handoff` older than 30 min. Checked at session start, each main turn and each press (no timer). Dismiss sets those items `withdrawn` with note `dismissed` in the taking session's key and records the code or key as taken, so they are not offered again.
  - A failed `$.store.set` shows `open-items: could not save` in the pane head and the status line until a write succeeds.

- [ ] **Step 1: Write the failing tests.** The kit runs one engine and one module, so the other process is simulated by editing `world.store` (and `world.setMs` to hold a write).
  - `handoff_items marks open and Later items, returns a code, and the pane shows "Moving to a new session" with no buttons`.
  - `an answer appended after Claude's last model request moves with the item as unread`.
  - `take_items moves the items with their numbers and says "N items moved from the previous session"`.
  - `a number the successor already uses is renumbered, and the result maps old to new` (successor holds #1–#5; takes #5 and #8 → #6 and #8; next add is #9).
  - `take_items with a wrong code takes nothing`.
  - `the old session shows its items as moved once another key took its code`.
  - `a press on a moved item sends nothing and says it moved`.
  - `a worker session in the same folder is not offered the live COO's items` (owner active 5 min ago, not ended, no hand-off).
  - `items of an ended session are offered with Take and Dismiss; Take moves them and tells Claude; Dismiss drops them for good`.
  - `after /clear the earlier conversation's items are offered at once, never moved on their own`.
  - `--resume of an ended session clears endedMs, so its items are not offered elsewhere`.
  - `an unclaimed hand-off becomes leftovers after 30 minutes` (advance the clock; check on the next turn).
  - `two sessions writing at once keep both keys whole` (hold the successor's `store.set` with `world.setMs` while the old session writes).
  - `a take whose items sit in two keys is not offered again` (successor key has the `taken` record; old key still says `handing-off`).
  - `a failed store write shows "open-items: could not save"` (`world.isWriteFailing = true`).
  - `--resume of a session whose items moved does not bring them back`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all tests and the live harness.** Expected: PASS.
- [ ] **Step 5: Commit.** `git -C <wt> commit -am "feat(open-items): hand-off by code, leftovers with Take and Dismiss, store safety"`

---

### Task 7: Release files

**Files:**
- Modify: `<wt>/plugins/open-items/.claude-plugin/plugin.json` (version `0.2.0`), `<wt>/CHANGELOG.md` (one line), `<wt>/plugins/open-items/README.md` (threads, Later, hand-off; what the mod adds to prompts: the per-prompt reminder line and appended answers), `tests/register.test.tsx` (`the README example`)

- [ ] **Step 1:** Make the edits. The README stays short, as in v0.1.
- [ ] **Step 2:** Run `claude plugin validate`, `claude plugin test`, `tsc -p` on `<wt>/plugins/open-items`, then the repo checks with the leak gate inside the worktree: `sh -c 'cd "$1" && sh scripts/validate.sh' _ <wt>`. Expected: all pass.
- [ ] **Step 3: Commit.** `git -C <wt> commit -am "chore(open-items): release 0.2.0"`

---

### Task 8: coo hand-off steps (may run in parallel with Tasks 2–6)

**Files:**
- Modify: `<wt>/plugins/coo/skills/coo/orchestration.md` (add one bullet at the end), `<wt>/plugins/coo/.claude-plugin/plugin.json` (patch version bump), `<wt>/CHANGELOG.md`

- [ ] **Step 1:** Add one bullet: when the open-items 0.2 tools are listed, before starting a successor session call `handoff_items` and put the code and the session artifact's URL in the successor's prompt; the successor's first step loads `take_items` (ToolSearch) and calls it with the code; keep one artifact per session, updated in place; before the session ends, resolve, record or hand off every open and Later item. Without the tools, hand off as today.
- [ ] **Step 2:** The CHANGELOG line names open-items `0.2.0` as the minimum for this step.
- [ ] **Step 3: Commit.** `git -C <wt> commit -am "docs(coo): hand open items to the successor session"`

---

### Task 9: PR, then personal config (after merge)

- [ ] **Step 1:** Pre-PR gates on the branch: simplify pass, then code review in an independent subagent. Fix, re-run all checks.
- [ ] **Step 2:** Push the branch and open the PR (`feat(open-items): v0.2, each item is a conversation`). Asaf merges.
- [ ] **Step 3 (claude-config repo, `/Users/asafdafna/.claude`):** In `CLAUDE.md`, add to the batch rule: with open-items 0.2, a live chat is a back-and-forth with no background task, and there the pane refuses items. The `/wrap-up` skill gains the session-end rule. Commit there.
- [ ] **Step 4:** Update the plugin on both seats (`CLAUDE_CONFIG_DIR` per seat); then Asaf's smoke test from the spec's Rollout step 5. If `CONSENT` was `fail`, the success criterion for option and Done presses reads "by the end of the main turn".
