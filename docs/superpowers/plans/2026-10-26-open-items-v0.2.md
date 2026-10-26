# open-items v0.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each open item into a thread Asaf can read, question and answer in any order, delivered to Claude at once, and carried across a COO hand-off.

**Architecture:** The v0.1 mod (`plugins/open-items/`) stays one hooks module (`register.tsx`) with pure helpers beside it. The item model gains a thread, new states and an owner; the tools gain `reply_item`, `close_item`, `handoff_items`, `take_items`; delivery appends mid-turn instead of holding; the pane splits into a list screen and an item screen. Two live probes run first, because their results pick the delivery fallback and the list keys.

**Tech Stack:** TypeScript (strict) on the Claude Code 2.1.310 mod API (`claude-code`, `claude-code/testing`); Python + tmux live harness (`tests/live/`); `claude plugin validate` / `claude plugin test`.

**Spec:** `docs/superpowers/specs/2026-10-26-open-items-v0.2-design.md` (builds on `2026-10-25-open-items-pane-design.md`). Read both before any task.

## Global Constraints

- Claude Code **2.1.310** mod API; CI pins `@anthropic-ai/claude-code@2.1.310`.
- Every task ends green on: `claude plugin validate <wt>/plugins/open-items`, `claude plugin test <wt>/plugins/open-items`, and `tsc -p <wt>/plugins/open-items` (types laid as in the memory note: start `claude --plugin-dir <mod>` in a detached tmux session, wait for `.claude-plugin/types/tsconfig.json`, kill it; temp dirs through `realpath` on macOS).
- `<wt>` = `/Users/asafdafna/dev-projects/.worktrees/dafna-dev-standards-oi-v02`. Never start a Bash command with `cd`; use absolute paths and `git -C <wt>`.
- Model-facing tool names: `mcp__open-items__add_item`, `reply_item`, `close_item`, `list_items`, `handoff_items`, `take_items`. `withdraw_item` is removed.
- Limits: title **80** characters (error over it), option **60**, detail and each thread message **4000** (error over it, never cut). No cap on open items or info items.
- Times: live chat **5 min** (`LIVE_CHAT_MS = 300_000`); alert quiet **2 min** (`ALERT_QUIET_MS = 120_000`, unchanged); stale session **12 h**; unclaimed hand-off **30 min**; resolved items kept **7 days**; saved keys kept **30 days** (`KEEP_MS`, unchanged); press batch **800 ms** (`BATCH_MS`, unchanged).
- Each tool description is at most **4,096** characters. `add_item`, `reply_item`, `close_item`, `list_items` are not deferred; `handoff_items`, `take_items` are deferred.
- User-facing strings are plain English (ASD-STE100 style). Pane wording copied from the spec where it gives it: "Moving to a new session", "N items moved from the previous session", "N items left by an earlier session", "waiting for Claude", "open-items: could not save", "live chat: ask in the chat".
- The leak gate scans `plugins/`: no people's names and no names of Asaf's own tools in plugin files.
- Comments follow the core rule (only a non-obvious why), even though v0.1's files are heavily commented. Delete v0.1 comments a change makes wrong.
- Release: plugin version `0.2.0` in `.claude-plugin/plugin.json` and the marketplace entry, one CHANGELOG line; Asaf merges the PR.

## Review Focus

1. **Two live processes write the one store file during a hand-off** (old session and successor). Expected: each writes only its own key; no item lost or doubled. Test added to Task 6.
2. **A press on a drawing from before the item changed** (Claude closed or moved it a moment earlier). Expected: the press does nothing harmful and the pane says the item is closed or moved; no ghost answer reaches Claude. Test added to Task 5.
3. **A long thread in a short pane:** 40 messages of up to 4000 characters in an 18-row inline pane. Expected: the item screen scrolls, Back stays reachable, the saved key stays well under 4 MiB. Tests added to Tasks 2 and 5.
4. **The old session exits between `handoff_items` and `take_items`.** Expected: after 30 minutes the items are offered as leftovers, never lost. Test added to Task 6.
5. **A secret pasted as a reply.** Expected: v0.1's secret guard holds it and nothing is sent, on the reply path too. Test added to Task 4.

---

### Task 1: Live probes (no plugin code)

Settles the three unknowns the spec routes to probes. Results decide branches in Tasks 4 and 5.

**Files:**
- Create: `<wt>/docs/superpowers/notes/2026-10-26-open-items-v0.2-probes.md`
- Create (throwaway, not committed): probe mods under the session scratchpad.

**Interfaces:**
- Produces: three results recorded in the note, each as one line `RESULT: <pass|fail> — <evidence>`: `CONSENT`, `LIST_KEYS` (`arrows-move-focus` | `arrows-scroll`), `FIELD_BACK` (`tab` | `enter-empty` | `neither`), plus `BACKGROUND_SIGNAL` (the event or API that tells a mod a background task runs, or `none`).

- [ ] **Step 1: Consent probe (org seat, auto mode).** Build a probe mod with one pane Button. On press, while Claude is mid-turn, it calls `$.session.append` with a user row in v0.1's wording: `My response to an item you gave me (Open items):\n\n#1 Force-push the scratch branch?: I chose "Yes".` In a scratch git repo with a local bare remote, start a session with `CLAUDE_CONFIG_DIR=/Users/asafdafna/.claude-edut710`, auto mode on, and ask Claude to force-push to the scratch remote's `main` after a long `sleep 60` step. Press the button during the sleep. Record whether auto mode allows the force-push on that append alone. Repeat with the same text sent by `$.prompt.submit({ asUser: true })` while idle as the control (v0.1's path, known to count).
- [ ] **Step 2: List keys probe.** A probe mod opens a pane with 40 one-line Buttons, inline at 18 rows and docked. Send ↓ twelve times through the live harness (`tests/live/screen.py`, `Claude.pane(columns, rows, keys=...)`). Record whether the focus ring moves to the 13th Button or the body scrolls.
- [ ] **Step 3: Field back probe.** Same probe, with an `Input` above a "Back" Button. Focus the field; send Tab; then, separately, Enter on an empty field. Record which reaches the Back Button.
- [ ] **Step 4: Background signal.** Load the `plugin-authoring` skill and search its reference for how a mod learns that a background agent, a background shell command, or a monitor runs. Record the event/API, or `none` (fallback: v0.1's subagent turns in `live.turns`).
- [ ] **Step 5: Write the note and commit.**

```bash
git -C <wt> add docs/superpowers/notes/2026-10-26-open-items-v0.2-probes.md
git -C <wt> commit -m "docs(open-items): v0.2 live probe results"
```

---

### Task 2: The item model and the saved format

**Files:**
- Modify: `<wt>/plugins/open-items/types/index.d.ts`
- Modify: `<wt>/plugins/open-items/hooks/tasks.ts` (parsing, limits, predicates, Claude-facing text)
- Modify: `<wt>/plugins/open-items/hooks/saved.ts`
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
  update: TaskUpdate                // unchanged meaning: Claude heard Asaf's latest move or not
  note?: string                     // close note, or "recorded in …"
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
}
```

- Produces (functions in `tasks.ts`): `parseAsk(args): Ask | { error: string }` (reads `detail`, `link`; keeps line breaks; title through `oneLine`), `parseReply(args): { id: number; text?: string; change?: Partial<Pick<Task,'title'|'options'|'recommended'|'link'|'doneWhen'>> } | { error: string }`, `isOpenAsk(task): boolean` (state `open` or `later`, kind not `info`), `isShown(task): boolean` (state `open`, `later` or `handing-off`, or `update === 'pending'`), `MAX_DETAIL = 4000`.
- Produces (functions in `saved.ts`): `savedIn(raw): Saved | undefined` (converts a v0.1 value, which has no `version`: its `open` tasks become `open` items with `thread = [{ from: 'claude', text: why, atMs: createdMs }]`; all others dropped), `trimmed(saved, nowMs): Saved` (drops resolved/withdrawn/moved items older than 7 days, and strips their thread to `[]`).

- [ ] **Step 1: Write the failing tests** in `tests/items.test.tsx`:
  - `parseAsk keeps line breaks in detail`: `parseAsk({ title: 'Create 3 dev tokens', detail: '1. Open settings\n2. Click New', kind: 'action' })` → `thread`-ready detail equals `'1. Open settings\n2. Click New'`.
  - `parseAsk refuses a detail over 4000 characters, never cuts it`: detail of 4001 chars → `{ error }` containing `4000`.
  - `parseAsk keeps the 80-character title error` (81 chars → error containing `80`).
  - `parseReply needs text or a change` → `{ error }` when both are missing.
  - `isOpenAsk counts later items, not info`.
  - `savedIn converts a v0.1 key`: the v0.1 `ROTATE` fixture (copy it from `register.test.tsx`) inside `{ tasks: [ROTATE], nextId: 8, savedMs: 0 }` → one open item #7 whose `thread[0].text` is `'It was in a public gist.'`; a v0.1 `done` task in the same value is dropped.
  - `trimmed drops a resolved item after 7 days and keeps an open one of any age`.
  - `a 40-message thread of 4000-character messages saves under 1 MiB` (Review Focus 3): `JSON.stringify(saved).length < 1_048_576`.
- [ ] **Step 2: Run them to see them fail.** Run: `claude plugin test <wt>/plugins/open-items`. Expected: the new tests fail (missing exports/types).
- [ ] **Step 3: Implement the types and functions above.** Remove `MAX_OPEN`, `MAX_INFO`, `MAX_WHY` and the `why.slice` cut. `newsOf`/`messageOf`/`listOf`/`addedOf`/`contextOf` are rewritten in Tasks 3 and 4; leave them compiling (adapt field names only).
- [ ] **Step 4: Run all tests.** v0.1 tests that assert the cap of 5, the info drop, `why` text in the pane, or `withdraw_item` will fail: delete them only if a later task's test replaces the behavior (note each deleted test name in the commit body); otherwise adapt them to the new field names. Expected: all pass.
- [ ] **Step 5: Commit.** `git -C <wt> commit -am "feat(open-items): v0.2 item model with threads and saved format v2"`

---

### Task 3: The tools Claude calls

**Files:**
- Modify: `<wt>/plugins/open-items/hooks/register.tsx` (`TOOLS`, `tool.describe`, `tool.call` hooks, constants)
- Modify: `<wt>/plugins/open-items/hooks/tasks.ts` (tool result texts, `listOf`)
- Test: `<wt>/plugins/open-items/tests/register.test.tsx` (`describe('adding')`, `describe('the mod\'s own tools')`, new `describe('threads')`, `describe('the live-chat gate')`)

**Interfaces:**
- Consumes: Task 2's `Task`, `parseAsk`, `parseReply`, `isOpenAsk`, `MAX_DETAIL`.
- Produces: tool names `REPLY = 'mcp__open-items__reply_item'`, `CLOSE = 'mcp__open-items__close_item'`, `HANDOFF = 'mcp__open-items__handoff_items'`, `TAKE = 'mcp__open-items__take_items'` (the last two registered here with a "not ready" deny; Task 6 fills them). `isLiveChat(nowMs): boolean` in `register.tsx`, reading `live.typedPromptsMs: number[]` (the times of the last two prompts of origin `composer` whose text is not a bridge answer, `answerIn(text) === null`) and the background signal from Task 1.
- Tool schemas: `add_item { kind, title, detail, options?, recommended?, done_when?, link? }` (required: kind, title, detail); `reply_item { id, text?, title?, options?, recommended?, link?, done_when? }`; `close_item { id, as: 'resolved' | 'withdrawn', note? }`; `list_items { show?: 'updates'|'open'|'all', id? }`.

- [ ] **Step 1: Write the failing tests:**
  - `a seventh open item is added: there is no cap` (six `add_item` calls, all `result` containing `Added item #`).
  - `reply_item adds Claude's message and keeps the item open`: after `add_item` and `reply_item { id: 1, text: 'Each PR runs only unit tests.' }`, `list_items { id: 1 }` result contains both the detail and that text, and state `open`; the item's `hasNewReply` is true.
  - `reply_item changes the options in place and logs it in the thread` (thread gets an event `changed`).
  - `close_item resolved needs a reply from the user first`: deny containing `no answer from the user yet` when the item is not `isWaitingForClaude`; allowed when it is (seed the saved key with such an item through `seat(on, store)`).
  - `close_item withdrawn with note "answered in chat"` → state `withdrawn`, toast names the item.
  - `the same ask twice is still one item` (v0.1 `sameAsk` kept).
  - `every tool but list_items refuses a subagent` (calls with `agentId: 'a1'` → deny).
  - `add_item, reply_item, close_item, list_items are not deferred; handoff_items and take_items are` (`tool.describe` with an engine default of `isDeferred: true`).
  - `every tool description is at most 4096 characters`.
  - `the live-chat gate refuses on a back-and-forth` and the four other spec cases (one test each), using `typed(text)` for composer prompts, a bridge answer `↳ Answer to #1: …`, a pane press, and a running background task per Task 1's signal.
  - Update the hooks-list test: every `tool.call` hook matches one of the mod's six tools.
- [ ] **Step 2: Run them to see them fail.** Run: `claude plugin test <wt>/plugins/open-items`. Expected: FAIL on unknown tools and the cap.
- [ ] **Step 3: Implement.** Steering text goes into the descriptions, split as the spec's Steering section says (`add_item`: when and what to add, plain titles, no `#` for other numbers, consent is a decision, live chat; `reply_item`/`close_item`: answer in the item, close when resolved, "answered in chat"; `handoff_items`: the session-end rule). The `prompt.compose` section repeats a short form. Reply alert: `reply_item` calls `$.ui.notify` under the same rule as v0.1's add alert (quiet 2 min, one per main turn).
- [ ] **Step 4: Run all tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git -C <wt> commit -am "feat(open-items): reply_item, close_item, no cap, live-chat gate, steering in tool descriptions"`

---

### Task 4: Delivery

**Files:**
- Modify: `<wt>/plugins/open-items/hooks/register.tsx` (`resolve`, `respond`, `send`, `sendSoon`, `turn.start`, `turn.complete`, `prompt.submit`, `prompt.context`, `working`)
- Modify: `<wt>/plugins/open-items/hooks/tasks.ts` (`messageOf`, `digestOf`, a new `reminderOf`)
- Test: `<wt>/plugins/open-items/tests/register.test.tsx` (`describe('responding')`, `describe('knowing whether Claude works')`, new `describe('delivery')`)

**Interfaces:**
- Consumes: Task 1 `CONSENT` and `BACKGROUND_SIGNAL`; Task 2 model; Task 3 tools.
- Produces: `deliver($, ids: readonly number[]): Promise<void>` — the one path every press and reply takes. Rule: if `isMainTurnRunning()` is known true → `$.session.append` (user row) now; if known idle → `$.prompt.submit({ asUser: true })` after the 800 ms batch; if unknown → `$.prompt.submit`. When `CONSENT` failed: option and Done presses take the prompt path at the main turn's end (`turn.complete`), replies and Later still append now. `isMainTurnRunning(): boolean | undefined` replaces `working()` and counts the main loop only (`agentId === undefined`); `undefined` until the band hook or a main `turn.start` has been seen.
- Claude-facing wording (tests pin these): one press `My response to an item you gave me (Open items):\n\n#5 <title>: I chose "<option>".`; Done `#5 <title>: Done.`; Later `#5 <title>: Later. Go on without it.`; a reply `#5 <title>: my reply (the item stays open; answer in it with reply_item, or close it with close_item):\n<text>`. `reminderOf(shown): string` → `Open items: 3 open, 1 unread answer; call list_items.`

- [ ] **Step 1: Write the failing tests:**
  - `an answer while another item is open goes at once, not with the last answer` (two open items; press an option on #1 while idle → one `prompt.submit` naming only #1, before #2 is answered). This pins the removal of the `!all.some(isAsk)` hold.
  - `a reply mid-turn is appended at once` (start a main turn, reply in the pane → `session.append` row with the reply text; no `prompt.submit`).
  - `a reply never closes the item` (state stays `open`, `isWaitingForClaude` true, status line no longer counts it as waiting on the user).
  - `when the mod cannot tell whether Claude works, an answer goes as a prompt` (no band render, no turn seen → `prompt.submit`).
  - `a subagent's turn.start does not clear an unread append` (regression for the v0.1 `isUnread` bug).
  - `presses within 800 ms go as one message` (v0.1 batch kept).
  - `each prompt carries the open-items reminder while items are open` (`prompt.submit` of origin `composer` gets a context block equal to `reminderOf(...)`; none when nothing is open). `prompt.context` no longer adds the v0.1 summary block.
  - `a secret pasted as a reply is held and not sent` (Review Focus 5; reply text `KEY_SHAPED` → nothing appended or submitted; pane shows v0.1's `HELD` text).
  - Only if Task 1 `CONSENT` failed: `an option pressed mid-turn goes as a prompt when the main turn ends`.
- [ ] **Step 2: Run them to see them fail.** Expected: FAIL on the hold and the append path.
- [ ] **Step 3: Implement `deliver` and the rules above.** Remove Send now / Save for later (`How = 'now' | 'later'`) and the "not sent yet" counts, except the consent-fallback note `waits for Claude's turn to end` when it applies.
- [ ] **Step 4: Run all tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git -C <wt> commit -am "feat(open-items): deliver each answer at once; append mid-turn; per-prompt reminder"`

---

### Task 5: The pane — list screen and item screen

**Files:**
- Modify: `<wt>/plugins/open-items/hooks/pane.ts` (view model, sections, labels, rows)
- Modify: `<wt>/plugins/open-items/hooks/register.tsx` (the `Pane` render hook, `ui.press`/`ui.input` handling, `paneView`, `rowsWanted`, status line)
- Modify: `<wt>/plugins/open-items/types/index.d.ts` (`PluginState['open-items']` gains `screen: { kind: 'list' } | { kind: 'item'; id: number }`)
- Test: `<wt>/plugins/open-items/tests/register.test.tsx` (rewrite `describe('the pane and /open-items')`, `describe('the pane groups items by kind')`, `describe('the answer field')`; new `describe('two screens')`)

**Interfaces:**
- Consumes: Tasks 2–4. Task 1 `LIST_KEYS` and `FIELD_BACK`.
- Produces: element keys tests and the live harness rely on: `head`, `section-<LABEL>`, `row-<id>`, `item-<id>`, `thread`, `msg-<i>`, `options`, `reply`, `back` (hotkey `b`), `later`, `offer` (used by Task 6). `screenOf(view): 'list' | { id: number }` in `pane.ts`.
- Sections and order: `DECISIONS, QUESTIONS, ACTIONS, INFO, LATER`; empty sections not drawn; oldest first.
- Status line: `☐ 2 decisions · 1 question · ● 1 reply · 1 later · /open-items` (items `isWaitingForClaude` are left out of the kind counts).

- [ ] **Step 1: Write the failing tests:**
  - `the list shows one line per item, grouped, LATER last` (`textOf(ui, 'section-LATER')`).
  - `Enter on a row opens the item screen; Back returns to the list` (press `row-9`, then `back`; open #9 before #5 to pin "any order").
  - `the item screen shows the whole thread with line breaks` (a 3-line detail renders 3 lines in `msg-0`).
  - `a Claude reply marks the row ● until the item is opened`.
  - `after a reply the row says "waiting for Claude"`.
  - `Later moves the item to LATER and sends "Later. Go on without it."`; `an item in LATER keeps its buttons`.
  - `info shows Seen, which sends nothing`.
  - `a press on a drawing from before Claude closed the item sends nothing and says it is closed` (Review Focus 2: mount, `close_item`, then press the stale option).
  - `a 40-message thread scrolls in an 18-row inline pane and Back stays reachable` (Review Focus 3; `PANE` with `placement: 'inline'`, `scroll.bodyRows: 18`).
  - Keys per Task 1: if `LIST_KEYS = arrows-scroll`, test the chosen mechanism (a `ui.scroll` hook turning arrows into focus moves, or `j`/`k` hotkeys). If `FIELD_BACK = neither`, the reply field gets a `Back` Button beside `Send`.
  - Number typing is absent: no Button has a digit hotkey.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** Keep v0.1's surface handling (seats, inline sizing, mobile without `Input`, the composer bridge for long answers, the secret guard). A `Link` for `link` sits outside any Button. Delete v0.1 pane code the two screens replace (one-screen expansion, Reject and its reason field, Send now).
- [ ] **Step 4: Run all tests, then the live harness** (`python3 <wt>/plugins/open-items/tests/live/test_pane.py`), updating `tests/live/test_pane.py` and `renders.py` for the two screens. Expected: PASS.
- [ ] **Step 5: Commit.** `git -C <wt> commit -am "feat(open-items): list and item screens, Later, unread and waiting marks"`

---

### Task 6: Hand-off, leftovers and the store

**Files:**
- Modify: `<wt>/plugins/open-items/hooks/register.tsx` (`session.start`, `session.end`, `restore`, `startCleared`, `startResumed`, `writeSaved`, `dropExpired`, the two hand-off tools)
- Modify: `<wt>/plugins/open-items/hooks/saved.ts` (`leftoversIn(all: Record<string, unknown>, folder: string, nowMs: number): { key: string; saved: Saved }[]`)
- Test: `<wt>/plugins/open-items/tests/register.test.tsx` (rewrite `describe('saving')`; new `describe('hand-off')`, `describe('leftovers')`)

**Interfaces:**
- Consumes: Tasks 2–5; element key `offer` with Buttons `take` and `dismiss`.
- Produces: `handoff_items {}` → result `Marked N items for the next session. Hand-off code: <code>. Put the code in the successor's prompt; it calls take_items with it.` (`code`: 6 characters from `[a-z0-9]`). `take_items { code }` → result listing, per item, number, kind, title, thread and unread answers (same text the Take button sends to Claude).
- Rules (from the spec): `lastActiveMs` written on every main turn and every press; `endedMs` at `session.end` (not on `clear`, which leaves the conversation's items to be offered); leftovers = keys in the same `folder`, not this session, whose owner has `endedMs`, or `lastActiveMs` older than 12 h, or whose `handoff` is older than 30 min. The successor's counter starts at `max(own nextId, highest taken id + 1)`. A failed `$.store.set` shows `open-items: could not save` in the pane head and the status line until a write succeeds.

- [ ] **Step 1: Write the failing tests:**
  - `handoff_items marks open and Later items, returns a code, and the old pane shows "Moving to a new session" with no buttons`.
  - `an answer pressed after Claude's last model request moves with the item as unread`.
  - `take_items with the code moves the items with their numbers; the new counter starts past them` (successor already holds #1–#3; takes #5 and #8 → next add is #9).
  - `take_items with a wrong code takes nothing`.
  - `a worker session that starts in the same folder is not offered the live COO's items` (owner active 5 min ago, not ended).
  - `items of an ended session are offered with Take and Dismiss; Take moves them and tells Claude; Dismiss drops them`.
  - `after /clear the earlier conversation's items are offered, never moved on their own`.
  - `an unclaimed hand-off becomes leftovers after 30 minutes` (Review Focus 4; advance the test clock).
  - `two sessions writing at once keep both keys whole` (Review Focus 1; interleave a successor's `take` and the old session's `writeSaved` through the `seat` store with a held `store.set`).
  - `a failed store write shows "open-items: could not save"` (the `seat` helper's `refused('set')`).
  - `--resume of a session whose items moved does not bring them back`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all tests and the live harness.** Expected: PASS.
- [ ] **Step 5: Commit.** `git -C <wt> commit -am "feat(open-items): hand-off by code, leftovers with Take, store safety"`

---

### Task 7: Release files

**Files:**
- Modify: `<wt>/plugins/open-items/.claude-plugin/plugin.json` (version `0.2.0`)
- Modify: `<wt>/.claude-plugin/marketplace.json` (open-items version `0.2.0`)
- Modify: `<wt>/CHANGELOG.md` (one line)
- Modify: `<wt>/plugins/open-items/README.md` (threads, Later, hand-off, what the mod adds to prompts: the per-prompt reminder line and the appended answers)

- [ ] **Step 1:** Make the edits. README stays short, as in v0.1.
- [ ] **Step 2:** Run `claude plugin validate <wt>/plugins/open-items`, `claude plugin test <wt>/plugins/open-items`, `tsc -p <wt>/plugins/open-items`, and the repo's checks including the leak gate (`bash <wt>/scripts/validate.sh`). Expected: all pass, leak gate empty.
- [ ] **Step 3: Commit.** `git -C <wt> commit -am "chore(open-items): release 0.2.0"`

---

### Task 8: coo hand-off steps

**Files:**
- Modify: `<wt>/plugins/coo/skills/coo/orchestration.md` (the hand-off and session-end sections)
- Modify: `<wt>/plugins/coo/.claude-plugin/plugin.json` (patch version bump), `<wt>/.claude-plugin/marketplace.json`, `<wt>/CHANGELOG.md`

- [ ] **Step 1:** Add, each conditional on "when the open-items 0.2 tools are listed": before starting the successor, call `handoff_items` and put the code and the session artifact's URL in the successor's prompt; the successor's first step loads and calls `take_items` with the code; one artifact per session, updated in place; before the session ends, resolve, record or hand off every open and Later item. Without the tools, coo hands off as today.
- [ ] **Step 2:** CHANGELOG line names open-items `0.2.0` as the minimum for these steps.
- [ ] **Step 3: Commit.** `git -C <wt> commit -am "docs(coo): hand open items to the successor session"`

---

### Task 9: PR, then personal config (after merge)

- [ ] **Step 1:** Run the pre-PR gates on the branch: simplify pass, then code review (independent subagent). Fix, re-run tests.
- [ ] **Step 2:** Push the branch and open the PR (title `feat(open-items): v0.2 — each item is a conversation`). Asaf merges.
- [ ] **Step 3 (claude-config repo, `/Users/asafdafna/.claude`):** In `CLAUDE.md`, the batch rule's "while subagents or tasks run" stays, and a line adds: with open-items 0.2, a live chat is a back-and-forth with no background task, where the pane refuses items. The `/wrap-up` skill gains the session-end rule. Commit there.
- [ ] **Step 4:** Update the plugin on both seats (`CLAUDE_CONFIG_DIR` per seat), then Asaf's smoke test from the spec's Rollout step 5.
