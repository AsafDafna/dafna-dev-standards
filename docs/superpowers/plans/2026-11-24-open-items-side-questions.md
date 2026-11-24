# open-items 0.4 (side questions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user leaves a side question in the Open items pane or with `/side`; a helper agent that the mod registers answers it inside the item, and the main session hears of it only through a note on the user's next typed prompt or a question when its turn ends. Two thread changes ship with it for every kind: colored speaker heads with a blank row, and a "sent" line under the user's newest reply.

**Architecture:** A behavior-unchanged split of `hooks/register.tsx` comes first, so new code lives in its own files with no import cycle. A fifth kind, `side`, carries a `side` record on the item. Pure builders live in `hooks/side.ts`, and the `$`-calling runtime (agent type, queue, spawn and resume, consumed report, stop, messages to main, quota) in `hooks/helper.ts`. `pane.ts` and `register.tsx` draw the section, the field and the side item screen.

**Tech Stack:** TypeScript hooks module for Claude Code 2.1.331 (no DOM, no Node), JSX against `h`, the engine's test kit (`claude plugin test`), the Python tmux harness in `tests/live/`.

**Spec:** `docs/superpowers/specs/2026-11-21-open-items-side-questions-design.md` (approved). Read it before any task. The probe results: `docs/superpowers/notes/2026-11-21-open-items-side-questions-probes.md`. The earlier specs it builds on: `2026-10-26-open-items-v0.2-design.md` and `2026-11-20-open-items-pane-look-design.md`.

## Global Constraints

- Work in the worktree `/Users/asafdafna/dev-projects/.worktrees/dafna-dev-standards-side-questions-build`, branch `feature/open-items-side-questions`. Use absolute paths, and never start a command with `cd`. Below, `<wt>` is that worktree and `<plugin>` is `<wt>/plugins/open-items`.
- After every task, `claude plugin test <plugin>` passes (309 tests before Task 1) and `claude plugin validate <plugin>` passes. Validate reports type errors as warnings: add none in `hooks/` or in a new test file. Build agent rows for `world.agents` with `as AgentInfo`.
- Commit each task: `git -C <wt> add <files>`, then `git -C <wt> commit -m "<message>"`. Use conventional commits. Commit locally only, and never push.
- Use no new packages. File names are kebab-case.
- Code comments: none, unless a comment explains a non-obvious why in one or two lines. Delete the banners and repeating comments of every function you edit.
- Before you add or change a test, load the `core:test-audit` skill. Every test below names the behavior it protects.
- Leak gate (it also covers test names and comments, so copy no person's name from this plan into code): no file under `plugins/` may contain `asaf`, `nir` or `edut` in any case, also inside a longer word, nor `/Users/` or `~/dev-projects`. Check with `git -C <wt> grep --untracked -niE 'asaf|nir|edut|/Users/([^<]|$)|~/dev-projects' -- plugins/`. Expected: no output. Test fixtures use paths such as `/t/main.jsonl` and `/s/pad`.
- Names, verbatim from the spec: the kind is `side`, its label `SIDE QUESTION`, its section `SIDE QUESTIONS`, and the command `/side`.
- The helper is registered with `tools: ["Read", "Grep", "Glob"]`, `permissionMode: "dontAsk"`, `model: "opus"`, `effort: "medium"` and `maxTurns: 20`. It keeps CLAUDE.md, so no `omitClaudeMd`. `agent.offer` hides it from the main model.
- One helper runs at a time per session, for at most 10 minutes (`HELPER_LIMIT_MS = 600_000`).
- A side question's messages to the main session never use `asUser`. A note goes as `prompt.submit` context. A question goes as a framed plugin prompt.
- `earlierItems` saves `nextId: 3`, so a side question added after seeding the store gets #3.
- A seeded side item whose helper works needs a running agent row in `world.agents`: `{ id: helperId, type: 'open-items:helper', status: 'running' } as AgentInfo`. Without it, the start treats the helper as gone and asks again (Task 6b).
- Tests of the live-chat gate fill `world.messages` only after `start`. With rows at the start, the gate answers 'unknown', and a question goes for that reason.
- Tasks 2 to 12 name their spec section. Read that section first.
- Test kit facts found on 2.1.331. A spike in the session's scratchpad checked them.
  - A test cannot read the mod's module state, because the kit loads its own instance. Observe through stand-ins.
  - `$.agent.spawn` reaches an `on('agent.spawn', …)` stand-in with an Agent-tool-shaped `e` (`subagent_type`, `description`, `prompt`), which must return `{ model }` or `{ deny }`. Whatever it returns, the mod gets `{ model: 'inherit' }` with no `agentId`, so no unit test gets a running helper from a spawn: seed a saved side item with `side.helperId` and `side.sentMs`. A resume through `session.send` works.
  - Ops are answered with `{ value }`: `agent.register`, `session.usage`, `session.info`, `fs.write`, `session.messages`. Events are answered with their own result: `agent.spawn`, `session.send`, `tool.call` for `TaskStop`, `agent.offer`, `agent.report`.
  - An `agent.report` hook that throws is skipped, and the report goes on to the main loop. In a real session, that starts a main turn.

## Review Focus

1. **A helper's report arrives after its item is gone** (Done, `/clear`, moved). Expected: the report is consumed, main gets no turn, and nothing is written. Test in Task 6b.
2. **A helper that was stopped at 10 minutes still reports**, with `status: "stopped"` and partial text. Expected: the item has one notice and no answer. Test in Task 7.
3. **A typed prompt that carries a note is dropped by a hook beneath.** Expected: the note waits for the next typed prompt. Test in Task 8.
4. **A rate-limit reading from the wrong window:** `seven_day` at 89 with `five_hour` at 14, `seven_day` alone, or a `five_hour` reading whose `resetsAt` has passed. Expected: no alert and no hold. Test in Task 9.
5. **A side follow-up or Done goes into v0.2's delivery:** the batch, the digest, a `list_items` claim, or a prompt sent `asUser`. Expected: neither reaches main by any path. Test in Task 10b.

## Plan's calls

The spec leaves these to the builder. The task named holds the detail.

- Report markers at line start: `Question for you:`, `Note for the session:`, `Question for the session:`. They stay in the user's text, and a question for the session wins over a note (Task 5).
- The summary is the first prompt, cut at 2,000 characters, and the newest messages, text only, up to 8,000 (Task 5). The log is `<scratchpad>/open-items-side-questions.md` (Task 6b).
- SIDE QUESTIONS is the last section. A long list scrolls as today, and side rows join the arrow walk; the field does not (Task 10a).
- A follow-up typed while its own helper works waits for that helper's report, so a side question's sent line has two states (Tasks 6b and 10b).
- A failure is a dim thread event, `notice` (Task 2).
- One quota alert per window, with no quiet rule; percents round down; a question that rides a typed prompt is not held (Task 9).
- A helper's answer gives a toast, with no pane and no notify (Task 6b). Nothing on a side item counts as a press for the live-chat gate (Task 10b). A pane opened by `/open-items` or `/side` stays open until Hide (Task 10a).
- A Take tells main only of the items that are not side questions (Task 11). `close_item`'s session-end line leaves side questions out too, and `reply_item` on one takes text only (Task 12).
- The two fields' copy (Tasks 10a and 10b). The kind color is `merged`, checked live in both themes (Task 14).

Decided by the lead, where the plan touches what the spec says:

- The new-question and follow-up fields use v0.2's secret guard, with Edit and Send anyway, as the spec says. `/side` refuses a secret with a toast, as v0.2's typed bridge does.
- The held wording is split, as the spec has two wordings and wording is the builder's: `⏸ held` on the list row, `Waiting to send · usage at 86%, resumes at 20:49` on the item screen.
- Done stops a working helper where `TaskStop` is allowed (Claude's call).

## The spec's test cases and their owners

Each case has one owner. A case that a probe proved on 2.1.331 is not replayed against a stand-in. "Smoke" is the spec's Rollout step 4.

| Spec test case | Owner |
|---|---|
| Not about main's work | 6b |
| About main's work, main busy: the note rides the next typed prompt | 8 |
| About main's work, main idle: searched first | 6a (path in the prompt); smoke (the search) |
| Only main can answer | 8 and 12 |
| Not sure: asks back; the reply wakes the same helper | 6b and 10a (mark) |
| A follow-up gets main's messages since the last answer | 6b |
| A follow-up after `/clear` | 6b (send not delivered) |
| A restart or `--resume` while a helper worked | 6b (`revive`) |
| A new helper reads an earlier side question from the log | 6b (written), 6a (path); smoke (the read) |
| `↳ Answer to #N:` on a side question | 13 |
| Two typed prompts, a field question, then a helper's question | 8 and 10b |
| A refused spawn, then a follow-up tries again | 6a and 6b |
| Two side questions at once | 6b |
| A helper silent for 10 minutes | 7 |
| A note changes main's work | 5 (the copy); smoke (main's act) |
| A helper's question in a live chat or after Esc | 8 |
| Usage at 72% and at 86% | 9 |
| Done closes; `close_item` and `add_item` refuse the kind | 10b, 12 and 2 |
| The helper's `Edit`, `Bash` and `Agent` refused | probe 0.1; 6a pins the registration |
| A pane reply during a long tool call | 4; 14 (d) |
| Hand-off: moves; a new helper can search the old file | 11. Not probed: the old file's read under `dontAsk`; if refused, the helper says so |

---

### Task 1 (lead's proposal): Split register.tsx and the test world, behavior unchanged

The spec does not ask for this; Asaf's recorded follow-up does: "register.tsx is about 2,800 lines: split the live-chat gate and the hand-off code on the next edit there." Side code needs the atoms, `live` and the store plumbing without importing `register.tsx`, which would be a cycle. If the reviewer rejects this task, keep only `tests/world.tsx`; Tasks 6a to 12 then put their `$` code in `register.tsx`, and nothing else changes.

**Files:**
- Create: `<plugin>/hooks/state.ts`:
  - The constants `PLUGIN`, `PANE`, `PANE_TITLE`, `MAX_PANE_ROWS`, `LIST_SCREEN`, `STORE_WAIT_MS`, `LOADING`, `ALERT_QUIET_MS`.
  - `Seat`, `FIRST_SEAT`, `seatsWith`, `isAlike`; the eleven atoms and `Roster`; the types `Source`, `DropNote`, `Entered`, `UserInput`; and `live`.
  - Store work: `queued`, `rostered`, `awaited`, `redrawn`, `within`, `persist`, `writeSaved`, `noteSaved`, `isUnsaved`, `readAll`, `readStore`, `withOwnTaken`, `dropExpired`, `change`, `edit`, `claim`.
  - Pane plumbing: `present`, `refresh`, `hasPane`, `movedOf`, `hidePane`, `closePane`, `show`, `openAt`, `paneView`, `offeredOf`, `seated`, `fit`, `refit`, `rowsWanted`, `inlineSeats`, `ringMoved`, `settle`, `forget`, `isOpenNow`, `noteActive`.
- Create: `<plugin>/hooks/gate.ts`: `AT_WORK`, `LIVE_CHAT_MS`, `LIVE_CHAT`, `LIVE_CHAT_NOTE`, `noteInput`, `isLiveChat`, `noteStart`, `noteEnds`, `resultTextOf`.
- Create: `<plugin>/hooks/delivery.ts`: `BATCH_MS`, `WAKE_UP`, `isHeld`, `resolve`, `sendSoon`, `armBatch`, `cancelBatch`, `deliver`, `handOver`, `wakeUp`, `passOn`, `inWords`, `inDigest`, `inNews`, `giveBack`, `undelivered`.
- Create: `<plugin>/hooks/handoff.ts`:
  - `CODE_LENGTH`, `CODE_CHARS`, `CODE_SHAPE`, `STORE_DOWN`.
  - The bodies of the `HANDOFF` and `TAKE` `tool.call` hooks, as `handOffItems($: EngineInterface, e: { agentId?: string }): Promise<ToolCallResult>` and `takeItems($, e)`.
  - `scan`, `noteMoved`, `offerLeftovers`, `newCode`, `randomCode`, `handedOff`, `takeIn`, `dropOffered`, `stillOffered`, `takeLeft`, `dismissLeft`, `notOffered`, `takeBack`.
- Modify: `<plugin>/hooks/register.tsx`. It keeps:
  - `TOOLS` and the tool names, and `register`, with every `on(…)` in today's order.
  - `pickedOf`, `startCleared`, `startResumed`, `newIdAfter`, `switchTo`, `restore`, `takeUp`.
  - The pane actions: `typed`, `fieldValueOf`, `openItem`, `markRead`, `toList`, `pressOn`, `respond`, `toPromptBox`, `answerTyped`, `markSeen`, `answer`, `editHeld`, `longAnswer`, `pressed`.
- Create: `<plugin>/tests/world.tsx`. Move these out of `register.test.tsx`, exported: the six tool names, `PANE`, `DONE`, `NOW`, `KEY_SHAPED`, `seat`, `start`, `typed`, `step`, `runTasks`, `textOf`, `itemOf`, `inline`, `ringTo`, `earlierItems`, and the hand-off fixtures `OLD`, `NEW`, `OWN`, `HOUR_MS`, `CODE`, `savedItem`, `keyed`, `codeIn`, `answerOf`. Leave the rest where they are.
- Modify: `<plugin>/tests/register.test.tsx`, which now imports them.

**Interfaces:**
- Produces: the modules above, each name exported as it is defined today. The import graph has no cycle:
  - `state.ts` imports no new module.
  - `gate.ts` and `delivery.ts` import `state.ts`.
  - `handoff.ts` imports `state.ts` and `delivery.ts`.
  - `register.tsx` imports all of them.
- Later tasks add their own files that import `state.ts` and `gate.ts`, never `register.tsx`.

- [ ] **Step 1: Record the baseline.** Run `claude plugin validate <plugin> > <scratchpad>/validate-before.txt` and `claude plugin test <plugin>`. Expected: 309 pass.
- [ ] **Step 2: Move the code.** Move each function body unchanged. Change only `export` keywords and imports.
- [ ] **Step 3: Move the test world** to `tests/world.tsx`. Do not change an assertion.
- [ ] **Step 4: Verify.** `claude plugin test <plugin>`: 309 pass. Run `claude plugin validate <plugin> > <scratchpad>/validate-after.txt`. In both files, the two lines that start with `./register.tsx hooks:` must be the same. `git -C <wt> diff --stat` lists no change to `items.test.tsx` or `look.test.tsx`. Report how many changed lines are not moves (imports and `export` keywords only, from `git -C <wt> diff -M --color-moved=zebra`).
- [ ] **Step 5: Commit** the seven files: `refactor(open-items): split register.tsx into state, gate, delivery and hand-off modules`

### Task 2: The side kind in the item model and the store

**Spec:** "The side question", "Changes to earlier decisions".

**Files:**
- Modify: `<plugin>/types/index.d.ts`
- Modify: `<plugin>/hooks/tasks.ts`
- Modify: `<plugin>/hooks/saved.ts`
- Modify: `<plugin>/hooks/pane.ts`: only what the new kind needs to compile, listed below.
- Test: `<plugin>/tests/items.test.tsx`

**Interfaces:**
- Produces in `types/index.d.ts`:
  ```ts
  export type TaskKind = 'decision' | 'question' | 'action' | 'info' | 'side'
  export type ThreadEvent = 'chose' | 'done' | 'seen' | 'later' | 'changed' | 'took' | 'notice'
  export type Message = { from: 'claude' | 'user'; text: string; atMs: number; event?: ThreadEvent; author?: 'helper' }
  export type ToMain = { kind: 'note' | 'question'; text: string; atMs: number; sentMs?: number }
  export type Side = { transcripts: readonly string[]; helperId?: string; sentMs?: number; seenUuid?: string; toMain?: ToMain }
  // on Task:
  side?: Side
  ```
  - `author: 'helper'` is set only on a message from Claude that a helper wrote. When `author` is absent, the main session wrote it.
  - A `notice` event holds its line in `text`.
  - `Side.transcripts` lists the main conversation files the item was asked in, oldest first.
  - `helperId` is the agent that answered last. `sentMs` is the `atMs` of the user's newest message that a helper was given. `seenUuid` is the newest main-conversation row the helper has seen. `toMain` is a note or a question that waits for main.
- Produces in `tasks.ts`: `export function isSide(task: Task): boolean`.
- `KINDS` stays the four kinds that `add_item` takes. Do not add `side` to it. `KINDS` does three jobs: `parseAsk` accepts by it, `saved.ts` checks by it, and `waitingOf` counts by it. Only the saved check takes `side`, through its own list: `[...KINDS, 'side']`.

- [ ] **Step 1: Write the failing tests** in `items.test.tsx`, in a new `describe('side questions in the model')`:
  - `savedIn` keeps a side item whole: a helper message with `author: 'helper'`, a `notice` event, and `side` with `transcripts`, `helperId`, `sentMs`, `seenUuid` and a `toMain` question. It drops a side item whose `side.transcripts` is `[1]`, and an item with a message whose `author` is `'main'`.
  - `trimmed` on a resolved side item with `update: 'none'` keeps no `side` and no thread.
  - `parseAsk({ kind: 'side', title: 'T', detail: 'D' })` returns `kind must be "decision", "question", "action" or "info".`.
  - On an open side item, `movedBy(task, replyOf('why?'), t)` gives `isWaitingForClaude: true` and leaves `update: 'none'`. `movedBy(task, DONE, t)` gives `state: 'resolved'` and `update: 'none'`.
  - For an open side item and an open action, `reminderOf([side, action], () => false)` is `Open items: 1 open, 0 unread answers; call list_items.`.
  - `statusOf([side])` is `undefined`, and `waitingOf([side, decision]).headline` is `1 decision`.
  - `listOf([side])` holds `- The user, ` and `- The helper, `, and the notice as `- The helper could not start: x, `.
- [ ] **Step 2: Run and see them fail.** `claude plugin test <plugin>`. Expected: the new tests FAIL, but the `parseAsk` row. It passes today and guards against adding `side` to `KINDS`.
- [ ] **Step 3: Implement.**
  - `isOpenAsk` and `waitsOnUser` are false for a side item.
  - The fallback count of `waitingOf` (`⋯ N waiting for Claude`) and the unread count of `reminderOf` leave side items out.
  - `listedOf` leaves the line `The user replied and waits for you: …` off a side item: its helper answers it.
  - `movedBy` never sets `update: 'pending'` on a side item.
  - In `listedEntryOf`, a helper message is `The helper`, and a `notice` is `- <text>, <when>.`.
  - In `saved.ts`: `isMessage` takes `author` undefined or `'helper'`, `EVENTS` gets `notice`, and `isItem` checks an optional `side` of the shape above. `trimmed` drops `side` from a closed item, as it drops `options`.
  - In `pane.ts`: `KIND_LABEL.side = 'SIDE QUESTION'` and `KIND_COLOR.side = 'merged'`. `actionsOf` gives a side item only Done (`key: 'done'`, `hotkey: 'd'`), and no Later. `entryOf` draws a `notice` as `look: 'event'` with its `text` (through `printable`).
- [ ] **Step 4: Run and see them pass.** Expected: all PASS.
- [ ] **Step 5: Commit** the five files: `feat(open-items): the side kind in the item model and the store`

### Task 3: Thread heads: a blank row and a colored, bold name (Asaf 8)

**Spec:** "Decided by Asaf (2026-11-21)" 8.

**Files:**
- Modify: `<plugin>/hooks/pane.ts` (`Entry`, `entryOf`, `entriesOf`, `itemRowsOf`)
- Modify: `<plugin>/hooks/register.tsx` (the `entry` drawing in the item screen)
- Create: `<plugin>/tests/thread.test.tsx`
- Modify: `<plugin>/tests/look.test.tsx`, `<plugin>/tests/register.test.tsx`: only the assertions this task changes.

**Interfaces:**
- Produces in `pane.ts`:
  - `export type Speaker = 'You' | 'Claude' | 'Helper'`
  - `export const SPEAKER_COLOR: Record<Speaker, ThemeKey> = { You: 'ide', Claude: 'claude', Helper: 'planMode' }`
  - `Entry.head?: { who: Speaker; age: string }`.
- `entryOf` gives:
  - `You` for a message from the user;
  - `Helper` for a Claude message with `author: 'helper'`;
  - `Claude` for any other Claude message.
- Events keep their one-line text.
- Drawing:
  - A head is `<Text wrap="wrap">`, holding `<Text bold color={SPEAKER_COLOR[who]}>{who}</Text>` and then `<Text dimColor>{` · ${age}`}</Text>`.
  - The message text has no `dimColor`.
  - Every entry's first Box after the detail, and the "earlier messages" line, get `marginTop={1}`.
- `itemRowsOf` counts one more row for each entry after the detail, and one for the hidden line when it is drawn.

- [ ] **Step 1: Write the failing tests.**
  - In `thread.test.tsx`, call it `'each speaker's name is bold in its own color, its age dim, with a blank row before each message'`. On a question item with a user reply and a Claude reply:
    - The head of the user reply has a child Text `You` with `bold` and `color: 'ide'`, and a dim child ` · 2m`.
    - Claude's head has `Claude` in `claude`.
    - The message Text has no `dimColor`.
    - The Box of entry 1 has `marginTop: 1`.
  - In `look.test.tsx`: at width 76, `rowsFor` of an item with a one-line detail and two one-line replies, minus `rowsFor` of the same item with only the detail, is exactly 6: two heads, two messages and two blank rows.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** the types, the drawing and the row count above.
- [ ] **Step 4: Update the assertions this task changes, and no others.** The item-screen row counts in the `'the item screen'` tests of `register.test.tsx` take the new values. The thread test that matches `/You · 2m.*Claude · 1m/s` must still pass as it is.
- [ ] **Step 5: Run the tests and see them pass.**
- [ ] **Step 6: Commit** the five files: `feat(open-items): speaker heads in color with a blank row between messages`

### Task 4: The sent line under the user's newest reply (Asaf 9)

**Spec:** "Decided by Asaf (2026-11-21)" 9.

**Files:**
- Modify: `<plugin>/hooks/pane.ts` (`PaneView`, `sentLineOf`, `itemRowsOf`)
- Modify: `<plugin>/hooks/state.ts` (`paneView`)
- Modify: `<plugin>/hooks/delivery.ts` (`handOver`)
- Modify: `<plugin>/hooks/register.tsx` (`turn.start`, `turn.step`, `turn.complete`, item screen)
- Test: `<plugin>/tests/thread.test.tsx`

**Interfaces:**
- Produces in `pane.ts`:
  - `PaneView.unreadIds?: readonly number[]`: the items whose reply joined the running main turn as a row that no step has read yet (`live.unreadAppend`).
  - `export function sentLineOf(task: Task, view: Pick<PaneView, 'unreadIds'>): string | undefined`. It returns undefined unless `task.isWaitingForClaude`. Then:
    - `task.update === 'pending'` gives `Waiting to send`;
    - an id in `view.unreadIds` gives `Sent · Claude reads it at its next step`;
    - anything else gives `✓ Claude has it`.
  - Task 10b adds the side states.
- The line is a dim Text in a Box keyed `sent`, right after the thread's entries, with no blank row before it. `itemRowsOf` counts its rows.
- Nothing in a render's input carries `live.unreadAppend`, so the pane must be redrawn:
  - `handOver` calls `$.ui.invalidate('ui.render')` after it adds ids to `live.unreadAppend`.
  - `turn.start`, `turn.step` and `turn.complete` of the main loop call it when they clear a map that held ids.

- [ ] **Step 1: Write the failing tests** in `thread.test.tsx`, in `describe('the sent line')`:
  - `'a reply sent while Claude is idle shows that Claude has it'`. Reply in the item's field, then advance 1,000 ms. The `sent` text is `✓ Claude has it`.
  - `'a reply that joins a running turn shows it was sent, then that Claude has it after the next step'`. After `turn.start`, a reply and the batch, `sent` is `Sent · Claude reads it at its next step`. After `step($, turnId)` it is `✓ Claude has it`.
  - `'a reply whose prompt a hook beneath drops waits to send'`. With `world.refusing` set while idle, `sent` is `Waiting to send`.
  - `'Claude's answer in the thread takes the line away'`. After `reply_item` on the item, there is no `sent` element.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** the helper, the view field, the redraws and the drawing.
- [ ] **Step 4: Run and see them pass.** Update only the row counts that this line changes, in tests that leave an item waiting for Claude.
- [ ] **Step 5: Commit**: `feat(open-items): a line under the user's newest reply says whether Claude has it`

### Task 5: The side-question builders (pure)

**Spec:** "The helper", "What the main session gets", "Quota guard". Run this task in strict order, after Task 4, with no second implementer at once (the lead's decision).

**Files:**
- Create: `<plugin>/hooks/side.ts`
- Create: `<plugin>/tests/side.test.tsx`

**Interfaces:**
- Consumes: `Task`, `Side`, `ToMain`, `Message` (Task 2); `SessionMessage` and `SessionRateLimit` from `claude-code`; `MAX_TITLE`, `MAX_DETAIL` and `isSide` from `tasks.ts`; `clip` and `oneLine` from `text.ts`.
- Produces in `side.ts`:
  - `HELPER_TYPE = 'open-items:helper'`. It lives here, so `gate.ts` and `helper.ts` both import it without a cycle.
  - `MAX_SUMMARY_FIRST = 2000`, `MAX_SUMMARY = 8000`, `MAX_ROW = 2000`, `LOG_NAME = 'open-items-side-questions.md'`, `HELPER_LIMIT_MS = 600_000`, `ALERT_AT = 70`, `HOLD_AT = 85`.
  - `HELPER_PROMPT: string`, the helper's system prompt. Its text is exact:
    ```
    You answer a side question the user left for this session. The main session goes on without you. You write for the user: follow the user's reply rules in CLAUDE.md.
    - Search the main conversation file before you answer a question about the session's work. Look for every term that may hold the answer. Say what you could not find.
    - If you are not sure whether the question is about the main session's work, ask the user one short question and stop.
    - Look and report only. You have no shell. Never edit files, commit, push or send messages. Never call the advisor.
    - Put the answer first. Keep it short.
    - When your answer matters to the main session's work, add a one-line note for the main session: what it should know, and why. When only the main session can answer, add a one-line question for it instead.
    Start each of these lines with its label, at the start of a line: "Question for you:" when you ask the user back, "Note for the session:" for a note, "Question for the session:" for a question.
    ```
  - `newSideOf(id: number, text: string, atMs: number, transcript: string): Task` gives:
    - kind `side`, and title `clip(oneLine(text), MAX_TITLE)`;
    - `thread: [{ from: 'user', text, atMs }]`, `state: 'open'`, `isWaitingForClaude: true`, `hasNewReply: false`, `update: 'none'`, `isMarkdown: true`;
    - `side: { transcripts: transcript === '' ? [] : [transcript] }`.
  - `newestUserOf(task: Task): Message | undefined`: the newest user message with no `event`. The `took` event of a Take is not a message.
  - `isPending(task: Task): boolean`: an open side item whose newest user message is later than `side.sentMs` (or `sentMs` is absent).
  - `isWorking(task: Task): boolean`: an open side item where the newest user message at or before `sentMs` has no helper entry after it. A handed-off, moved or closed item never works, so it never blocks the queue. A helper entry is a Claude message or `notice` with `author: 'helper'`.
  - `reportOf(text: string): { asksUser: boolean; toMain?: { kind: 'note' | 'question'; text: string } }`. It matches the markers case-insensitively, each at the start of a line.
  - `answeredOf(task: Task, text: string, atMs: number, seenUuid?: string): Task`. It adds `{ from: 'claude', author: 'helper', text, atMs }`, sets `hasNewReply: true`, sets `side.toMain` from `reportOf` with this `atMs`, and sets `side.seenUuid`. `isWaitingForClaude` becomes `isPending` of the result.
  - `noticedOf(task: Task, line: string, atMs: number): Task`. It adds `{ from: 'claude', author: 'helper', event: 'notice', text: line, atMs }`, sets `hasNewReply: true`, and sets `isWaitingForClaude` to `isPending` of the result.
  - `sentOf(task: Task, helperId: string | undefined): Task`. It sets `side.sentMs` to the newest user message's `atMs`, and `side.helperId` when the id is given.
  - `rowsTextOf(messages: readonly SessionMessage[], max: number): string`. Lines are `User: …` and `Claude: …`. It skips messages with empty `text`, cuts each at `MAX_ROW`, and keeps the newest within `max`, oldest first.
  - `summaryOf(messages: readonly SessionMessage[]): string`. It gives `First prompt: <first user text, cut at MAX_SUMMARY_FIRST>`, then `Latest messages:` and `rowsTextOf(rest, MAX_SUMMARY)`.
  - `helperPromptOf(args: { task: Task; summary: string; current: string; log: { path?: string; text: string } }): string`. In order: `Side question #N from the user (Open items).`; the main conversation file `current`, or `This session keeps no conversation file.`; `Earlier conversation files:` with each other `side.transcripts` entry; the log path, or the log text when there is no path; `Summary of the main conversation:`; and `The side question's thread:`, a `User:`, `Helper:` or `Claude:` block per message, a notice as its text.
  - `followUpOf(task: Task, since: string): string`. It gives `Follow-up on side question #N: <newest user text>`, then `The main conversation since your last answer:` and `since` (or `nothing new`).
  - `logOf(tasks: readonly Task[]): string`. It gives `# Side questions of this session`, then for each side item `## #N <title>`, `Question: <thread[0] text>` and `Latest answer: <newest Claude message text, or "none yet">`.
  - `fiveHourOf(limits: readonly SessionRateLimit[], nowMs: number): { percent: number; resetsAtMs?: number } | undefined`. It reads the `five_hour` entry only. It returns undefined when there is none, or when the entry's `resetsAt` is at or before `nowMs`.
  - `clockOf(ms: number): string`: the local `HH:MM`, from `new Date(ms)`.
  - `noteForMain(task: Task): string`. The copy is exact:
    > ``Side question #N (Open items): <question>. The helper answered: <answer>. Why it may matter: <line>. If it changes your work, ask the user before you act: add a decision with `add_item`, or in a live chat ask in the chat.``
    - `<question>` is the newest user message.
    - `<answer>` is the newest helper message less its marker lines, cut at 2,000 characters with ` (cut: list_items with id N gives it whole)`.
    - `<line>` is the note.
  - `questionForMain(task: Task): string`. The copy is exact:
    > ``Side question #N (Open items): the helper needs you: <question>. Answer in the item with `reply_item`. Look and report only: change nothing because of this question.``
    - `<question>` is `toMain.text`: the helper's question for the session.
  - `ridingOf(tasks: readonly Task[]): { context: string; ids: number[] } | undefined`. It covers every open side item whose `toMain` has no `sentMs`: notes through `noteForMain`, questions through `questionForMain`, joined by blank lines.

- [ ] **Step 1: Write the failing tests** in `side.test.tsx`:
  - `newSideOf` of a 90-character question gives an 80-character title that ends in `…`, `thread[0].from === 'user'` and `side.transcripts === ['/t/main.jsonl']`. With `''` it gives `[]`.
  - A `reportOf` table:
    - `'A.\nQuestion for you: which one?'` gives `asksUser: true`.
    - `'A.\nnote for the session: The test is flaky.'` gives a note with `The test is flaky.`.
    - A note line and a question line give the question.
    - `'See the Note for the session: x'` (the marker in mid-line) gives neither.
  - An `isPending` and `isWorking` table over six threads:
    - asked and not sent: pending, not working;
    - sent, with no answer: working;
    - sent and answered: neither;
    - answered, then a follow-up: pending, not working.
    - sent, with no answer, but `handing-off`: neither;
    - answered, then taken with a Take (a user `took` event after the answer): neither.
  - `summaryOf`:
    - skips a user row whose `text` is `''`;
    - cuts a 2,500-character first prompt to 2,000 characters ending in `…`;
    - from twenty 1,000-character messages keeps only the newest 8,000 characters or fewer;
    - labels rows `User:` and `Claude:`.
  - `fiveHourOf` of `five_hour` at 72 with no `resetsAt` gives `{ percent: 72 }`. Tasks 6a, 6b, 9 and 11 own the other prompt, log and window cases at their boundary.
  - `clockOf(new Date(2026, 10, 24, 20, 49).getTime())` is `'20:49'`, and 9:05 gives `'09:05'`.
  - `noteForMain` and `questionForMain` of a fixture give the exact strings above, with its values filled in.
  - `ridingOf` of one side item with a note and one with a sent question gives only the first id.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** `side.ts`.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** both files: `feat(open-items): side-question prompts, summary, report markers, log and quota reading`

### Task 6a: The helper type, `/side` and a new helper

**Spec:** "The helper", "Opening and input", "How a side question flows".

**Files:**
- Create: `<plugin>/hooks/helper.ts`
- Modify: `<plugin>/hooks/state.ts`: add `pumpQueue: Promise<unknown>` to `live`.
- Modify: `<plugin>/hooks/register.tsx`:
  - In `session.start`: call `registerHelper($)`, and register `/side` with `{ name: 'side', description: 'Leave a side question for a helper; Claude goes on', argumentHint: '[#N] <question>', immediate: true }`.
  - In `register`: call `helperHooks(on)`.
- Modify: `<plugin>/tests/world.tsx`: add these stand-ins.
  - `agent.register`: records the spec in `world.registered` and answers `{ value: { agent: 'open-items:' + e.name } }`.
  - `agent.spawn`: records `{ subagentType: e.subagent_type, description, prompt }` in `world.spawns`. It answers `{ deny: world.spawnDeny }` when that is set, else `{ model: 'opus' }`.
  - `agent.offer`: answers `{ isOffered: true }` for the types the mod passes on.
  - `session.info`: answers `{ value: world.info }`. The default is `{ transcriptPath: '/t/main.jsonl', scratchpadDir: '/s/pad' }`.
  - `session.messages`: honors `e.last` and `e.after` over `world.messages`, and answers `{ deny }` for an `after` it does not hold.
- Create: `<plugin>/tests/helper.test.tsx`

**Interfaces:**
- Consumes: Task 5 (all of `side.ts`, `HELPER_TYPE` among it); `change`, `show` and `live` from `state.ts`; `looksSecret` and `MAX_DETAIL` from `tasks.ts`.
- Produces in `helper.ts`:
  - `registerHelper($): Promise<void>`. It registers `{ name: 'helper', description: 'Answers a side question the user left in the Open items pane; only the open-items mod starts it.', prompt: HELPER_PROMPT, tools: ['Read', 'Grep', 'Glob'], model: 'opus', effort: 'medium', maxTurns: 20, permissionMode: 'dontAsk' }`, and catches a failure. A spawn right after it works, also before the first main turn (probe 0.8).
  - `helperHooks(on: On): void`. It registers `agent.offer` `{ agent: HELPER_TYPE }`, which answers `{ isOffered: false }` when `e.agentId` is undefined, else `next(e)`, and `command.run` `{ command: 'side' }`. Task 6b adds `agent.report`.
  - `askNew($, text: string): Promise<boolean>`, which resolves whether it added the item, and `pump($): Promise<void>`.
- `askNew` guards, each a toast. Nothing is saved.
  - Empty text: `Type a question first.`
  - Over `MAX_DETAIL`: `Your side question is N characters, so it wasn't sent: the most is 4000.`
  - `live.loading`: `LOADING`.
  - It checks no secret: its callers do.
- `askNew` then takes the next id, as `add_item` does, and reads the transcript path from `$.session.info()`, or `''` when that fails. `change` adds `newSideOf`, then it toasts `Side question #N sent` and runs `void pump($)`.
- `pump` runs serially on `live.pumpQueue`, and takes the `isPending` items in order of their newest user message. This task builds its new-helper path:
  - Spawn `{ subagentType: HELPER_TYPE, description: 'Side question #N', prompt: helperPromptOf(…) }`. The summary comes from `$.session.messages()`. The log path is `${scratchpadDir}/${LOG_NAME}`, or the log text when there is no scratchpad.
  - A spawn that is denied, throws, or answers no `agentId` gives `noticedOf(task, 'The helper could not start: <reason>', now)`, then `sentOf(task, undefined)`, and the pump goes on to the next item. With no id, `<reason>` is `no helper id came back`.
  - Otherwise apply `sentOf(task, agentId)`.
- `command.run side`:
  - `''` runs `show($, true)` and returns `{}`.
  - Text that `looksSecret` toasts `This looks like a secret, so it wasn't sent. Put it where it belongs, then ask without it.` and returns `{}`.
  - Any other text runs `askNew`. When it added the item, return `{ text: 'A helper takes this side question (Open items); the main session goes on.', isTextDisplayOnly: true }`, else `{}`. The text holds none of the question: probe 0.7 found that the command's arguments never reach main, and that its output text does when it is answered mid-turn.
  - Task 6b adds `#N <text>`.

- [ ] **Step 1: Write the failing tests** in `helper.test.tsx`:
  - `'the helper type is registered with only Read, Grep and Glob, no permission dialogs, Opus at medium effort and a turn bound'`. `world.registered[0]` holds those fields and `maxTurns: 20`. It has no `omitClaudeMd`, and its `prompt` holds `Never call the advisor.`.
    - Retention: this pins the mod's side of the look-and-report-only grant (the spec's "Decided" items 9 and 10). The engine's refusals were proved by probe 0.1, so no unit test replays them.
  - `'the helper type is hidden from the main model, and its own runs still resume'`. `$.agent.offer` of `open-items:helper` with no `agentId` gives `{ isOffered: false }`. With `agentId: 'a1'` it is offered. `Explore` with no `agentId` is offered.
  - `'/side <question> adds a side question and asks a helper with what it needs'`.
    - `world.messages` holds a first prompt `Build the feed` and a later reply.
    - `/side what is a cursor?` answers the neutral text with `isTextDisplayOnly: true`, toasts `Side question #1 sent`, and item #1 has kind `side`.
    - `world.spawns[0]` has `subagentType: 'open-items:helper'` and `description: 'Side question #1'`. Its prompt holds `/t/main.jsonl`, `/s/pad/open-items-side-questions.md`, `Build the feed` and `what is a cursor?`.
    - The kit returns no `agentId` (Global Constraints), so do not assert what follows the spawn.
  - `'a refused start says so in the item'`. With `world.spawnDeny = 'Agents are off here.'`, the newest entry is a notice `The helper could not start: Agents are off here.`.
  - `'/side refuses a secret and an over-long question'`. A table: `KEY_SHAPED` gives the secret toast, and 4,001 characters gives the length toast. In each row no item is added and no spawn is made.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** `helper.ts`, the stand-ins and the registrations.
- [ ] **Step 4: Run and see them pass.** Validate lists `agent.offer` and `command.run{command=side}`.
- [ ] **Step 5: Commit** the five files: `feat(open-items): the helper type, and /side asks a helper`

### Task 6b: Answers, follow-ups, the queue, a restart and the log

**Spec:** "The helper", and the follow-up lines of "Claude's calls".

**Files:**
- Modify: `<plugin>/hooks/helper.ts`
- Modify: `<plugin>/hooks/state.ts`: add `stoppedHelpers: Set<string>` and `isLogFailing: boolean` to `live`.
- Modify: `<plugin>/hooks/register.tsx`: in `restore`, once `takeUp` kept items, call `revive($)`.
- Modify: `<plugin>/tests/world.tsx`: add these stand-ins.
  - `session.send`: records in `world.sends`. It answers `{ isDelivered: true }` only when `e.to` is in `world.helpers`, else `{ isDelivered: false, reason: 'No agent by that id.' }`.
  - `agent.report`: answers `{ text: e.text }` for the types the mod passes on.
  - `fs.write`: records `world.files[e.path] = e.text`, or answers `{ deny }` while `world.isFileRefused` is set.
- Test: `<plugin>/tests/helper.test.tsx`

**Interfaces:**
- Consumes: Task 6a; `edit` and `settle` from `state.ts`; `movedBy` and `replyOf` from `tasks.ts`; `AT_WORK` from `gate.ts`.
- Produces in `helper.ts`: `followUp($, id: number, text: string): Promise<boolean>` (whether it took the follow-up), `writeLog($): Promise<void>`, `revive($): Promise<void>`, and the `agent.report` hook in `helperHooks`.
- `followUp` has `askNew`'s guards, plus `#N is not an open side question.` when `#N` is not an open side item. Then it runs `edit` with `movedBy(task, replyOf(text), now)`, `settle` and `pump`.
- `pump` gets two rules:
  - It does no work while any item `isWorking`.
  - When the item has a `helperId`, it sends `followUpOf(task, since)` to it. `since` is `rowsTextOf(result, MAX_SUMMARY)` when `$.session.messages({ after: seenUuid })` gives an array, and `''` otherwise: with no `seenUuid`, or after a `{ deny }` for a row that a compaction or a clear took away. If the send is delivered, apply `sentOf(task, helperId)`. Otherwise spawn as in Task 6a.
  - It puts the log text inline when there is no scratchpad, or when `live.isLogFailing` is set.
- The `agent.report` hook is `on('agent.report', { subagentType: HELPER_TYPE }, …)`:
  - It runs `await reported($, e).catch(() => undefined)`, then returns `{ consumed: 'open-items wrote the answer in its side question' }`.
  - Its registration gets `.catch(() => ({ consumed: 'open-items wrote the answer in its side question' }))`. A hook that throws or overruns is skipped, and the report then reaches main.
- `reported`:
  - Find the item by `side.helperId === e.agentId`. With none, only pump.
  - If `live.stoppedHelpers` holds the id, delete it and pump.
  - `completed` with text: `answeredOf`. Its `seenUuid` is the uuid of `(await $.session.messages({ last: 1 }))[0]`.
  - `completed` with no text: the notice `The helper gave no answer.`
  - `failed`: the notice `The helper could not answer: <first line, or "no reason given">`.
  - `stopped`: the notice `The helper stopped before it answered.`
  - On an answer, toast `Side question #N has an answer. See /open-items`.
  - Then `writeLog`, then `$.clock.after(0, () => void pump($))`. A spawn made in a subagent's event counts one level deeper, and a timer's counts at depth 1 (probe 0.9).
- `revive`: after a restart or a `--resume`, a working item's helper died with the old process, and no report or timer would end its work. For each side item that `isWorking` with no agent of its `helperId` in `AT_WORK` in `$.agent.list()`, it clears `side.sentMs`, then pumps. A code reload keeps its helper and reads nothing back, so `revive` does not run.
- `writeLog` writes `logOf` of the side items to `${scratchpadDir}/${LOG_NAME}`. With no scratchpad it writes nothing. It sets `live.isLogFailing` from the outcome, and it catches errors.
- `command.run side` gets `#N <text>`: a secret is refused as in Task 6a. Otherwise it runs `followUp`, and answers as Task 6a does for `askNew`.

- [ ] **Step 1: Write the failing tests** in `helper.test.tsx`:
  - `'a helper's answer goes into its item, and the main session hears nothing'`.
    - Seed a saved side item #1 whose helper `a1` works: `sentMs` is the question's `atMs`.
    - `$.agent.report({ agentId: 'a1', subagentType: 'open-items:helper', status: 'completed', text: 'A pointer into the feed.', … })` resolves to `{ consumed: … }`.
    - The newest entry is `{ from: 'claude', author: 'helper', text: 'A pointer into the feed.' }`, with `hasNewReply: true`.
    - The toast is `Side question #1 has an answer. See /open-items`.
    - `world.submitted` is `[]`, and `world.appended` holds no row. A typed prompt then carries no context that holds `Side question`.
  - `'a report for a side question that is gone is still kept from the main session'` (Review Focus 1). A report from `a9`, which no item holds, resolves to `{ consumed: … }`. A report of type `Explore` resolves to `{ text }`.
  - `'a second side question waits for the running helper'`. With seeded #1 working, `/side second` makes no spawn. After `a1`'s report, a spawn for `Side question #3` is heard.
  - `'a follow-up resumes the same helper with the main conversation since its last answer'`. Seed #1 answered by `a1`. `world.messages` holds rows `u1` `old words`, `u2` and `u3` `new words`, and `world.helpers` holds `a1`. A table:
    - With `seenUuid: 'u2'`, `/side #1 and then?` makes one send to `a1`. Its text holds `and then?` and `new words`, and not `old words`.
    - With `seenUuid: 'u9'`, which the conversation does not hold, the send holds `and then?` and `nothing new`.
    - Neither row makes a spawn.
  - `'a follow-up whose helper is gone starts a new helper with the thread and the log'`. With `world.helpers` empty, the send is not delivered. The spawn's prompt holds the earlier helper answer and `/s/pad/open-items-side-questions.md`.
  - `'a follow-up sent while its own helper works waits for its answer'` (plan's call). With seeded #1 working, `/side #1 more` makes no send. After `a1`'s report, one send to `a1` holds `more`.
  - `'after a refused start, a follow-up tries again'`. With `world.spawnDeny` set, `/side q` writes the notice, and `/side #1 again?` makes a second spawn.
  - `'/side #N refuses an item that is no side question'`. `#2` on a decision toasts `#2 is not an open side question.`, and no send or spawn is made.
  - `'after a restart, a side question whose helper is gone asks again, and one whose helper still runs waits'`. A table over a seeded working #1:
    - `world.agents` holds `a1` running: no spawn;
    - `world.agents` is empty: a spawn for `Side question #1`.
  - `'the session's log lists each side question with its latest answer'`.
    - After `a1`'s report, `world.files['/s/pad/open-items-side-questions.md']` holds `## #1` and `A pointer into the feed.`.
    - With `world.info` holding no `scratchpadDir`, nothing is written, and the next spawn's prompt holds `## #1`. So does it after a write that `world.isFileRefused` refused.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass.** Validate lists `agent.report{subagentType=open-items:helper}` with a `.catch`.
- [ ] **Step 5: Commit** the five files: `feat(open-items): a helper's answer goes into its item; follow-ups resume it, one helper at a time`

### Task 7: Stopping a helper at 10 minutes

**Spec:** "Claude's calls" (one helper at a time, and a 10-minute limit).

**Files:**
- Modify: `<plugin>/hooks/helper.ts`
- Modify: `<plugin>/hooks/state.ts`: add `helperTimers: Map<string, Timer>` to `live`.
- Test: `<plugin>/tests/helper.test.tsx`

**Interfaces:**
- Produces: `stopHelper($, agentId: string): Promise<boolean>`. It calls `$.tool.call({ tool: 'TaskStop', task_id: agentId })`. When the answer has no `deny`, it adds the id to `live.stoppedHelpers` and resolves true. A deny or a throw resolves false.
- Every hand-over that has an agent id arms `$.clock.after(HELPER_LIMIT_MS, …)`, keyed by that id. A hand-over is a delivered send or a spawn that answered an id.
- `reported` cancels and deletes that timer first.
- When the timer fires:
  - If `stopHelper` is true: `noticedOf(task, 'The helper did not answer in 10 minutes.', now)`, then `writeLog`, then `pump`.
  - If it is false, look the helper up in `$.agent.list()`, as `revive` does. While it is at work, nothing happens: its `maxTurns` bound ends it, and its report goes on as usual. When it is not at work, its report will never come: write the same notice, then `pump`.

- [ ] **Step 1: Write the failing tests** in `helper.test.tsx`:
  - `'a helper silent for 10 minutes is stopped, the item says so, and the next side question starts'`.
    - Seed #1 answered by `a1`, with `world.helpers` holding `a1`. `/side #1 more?` sends to it, and `/side second` waits.
    - After `clock.advance(600_000)`, `world.stops` is `['a1']`, and #1's newest entry is a notice `The helper did not answer in 10 minutes.`. A spawn for `Side question #3` is heard.
    - Then a report from `a1` with `status: 'stopped'` and `text: 'Running the 14 searches.'` is consumed, and #1's thread does not change (Review Focus 2).
  - `'where TaskStop is refused, the mod waits for the helper's own end'`. With `world.isStopRefused`, the same setup writes no notice after 600 s, and #3 is not started. The late report `completed` is written as the answer, and #3 starts. With the helper gone from `world.agents`, the 600 s timer writes the notice and #3 starts.
  - `'an answer before 10 minutes cancels the stop'`. A report at 300 s, then advance 600 s: `world.stops` is `[]`.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** the timer, `stopHelper` and the stopped-report rule.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** the three files: `feat(open-items): stop a helper that does not answer in 10 minutes`

### Task 8: Notes and questions for the main session, and the live-chat gate

**Spec:** "What the main session gets", and "Claude's calls" on messages to the main session.

**Files:**
- Modify: `<plugin>/hooks/helper.ts`
- Modify: `<plugin>/hooks/gate.ts` (`isLiveChat`)
- Modify: `<plugin>/hooks/register.tsx` (`prompt.submit`, `turn.complete`)
- Modify: `<plugin>/tests/world.tsx`: record each own prompt's `e.origin` in `world.ownOrigins`.
- Test: `<plugin>/tests/helper.test.tsx`

**Interfaces:**
- Consumes: `ridingOf`, `questionForMain` and `HELPER_TYPE` (Task 5); `isLiveChat` (`gate.ts`).
- Produces in `helper.ts`:
  - `sendQuestions($): Promise<void>`. It returns when `isLiveChat` is `true` ('unknown' sends). Otherwise, for the open side items with an unsent `toMain` question, it sends one `$.prompt.submit({ text })` with no `asUser`: their `questionForMain` texts, joined by blank lines. Then it sets each `toMain.sentMs`.
  - `rode($, ids: readonly number[]): Promise<void>`. It deletes the notes of those items and sets `sentMs` on their questions.
- `prompt.submit`: on a typed prompt (`isTyped`: composer or bridge, no `command`), add `ridingOf(tasks)?.context` to the context. After the pass, on either the `next` or the `passOn` path, call `rode` when the result has no `drop` and its context still holds `Side question #N (Open items)` for each id.
- `turn.complete` of the main loop: when it was not aborted, run `void sendQuestions($)`.
- `reported`: after an answer that set a question, when `live.mainTurn !== true` and `!live.wasStopped`, run `void sendQuestions($)`.
- `isLiveChat` leaves out agents whose `type` is `HELPER_TYPE` when it looks for work in `AT_WORK`.

- [ ] **Step 1: Write the failing tests** in `helper.test.tsx`, in `describe('what the main session gets')`:
  - `'a note waits for the user's next typed prompt and rides it as context, starting no turn'`.
    - A seeded answered #1 has a `toMain` note. After `turn.complete`, `world.submitted` is `[]`.
    - `typed('go on')` enters with context that holds `Side question #1 (Open items)` and the note's line. The next typed prompt has none.
  - `'a slash command does not carry the note, and the next typed prompt does'`. A prompt with `command: { name: 'foo', args: '' }` has no note in its context, and the next plain prompt has it.
  - `'a note on a prompt that a hook beneath drops waits for the next one'` (Review Focus 3). With `world.refusingTyped` set, the prompt drops. After it is cleared, the next typed prompt carries the note.
  - `'a question for the session goes when the main turn ends, also while background agents run, and not in the user's voice'`.
    - After `turn.start`, `a1` reports `A.\nQuestion for the session: Which branch holds the fix?`. `world.submitted` is still `[]`.
    - `world.agents` holds a running `Explore` agent. After `turn.complete`, `world.submitted` holds `Side question #1 (Open items): the helper needs you: Which branch holds the fix?`, and its origin has no `asUser`.
  - `'a question while the main session is idle goes at once'`. After a `turn.complete`, the report submits at once.
  - `'in a live chat, or after Esc, a question starts no turn and rides the next typed prompt'`. A table:
    - two typed prompts within 5 minutes and no agent: `turn.complete` sends nothing;
    - `turn.complete` with `reason: 'aborted'`: it sends nothing.
    - In both rows, the next typed prompt's context holds the question.
  - `'the mod's own helper is not background work for the live-chat gate'`. After two typed prompts, with `world.agents` holding a running `open-items:helper`, `add_item` is refused with `live chat: ask in the chat`. The existing test `'two typed prompts while an agent runs are allowed, and refused once it is done'` keeps the other side.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass.** The live-chat gate tests in `register.test.tsx` pass unchanged.
- [ ] **Step 5: Commit** the five files: `feat(open-items): a helper's note rides the next typed prompt; its question goes when the main turn ends`

### Task 9: The quota guard

**Spec:** "Quota guard".

**Files:**
- Modify: `<plugin>/hooks/helper.ts`
- Modify: `<plugin>/hooks/state.ts`: add `quotaHold: { percent: number; resetsAtMs?: number } | null`, `quotaTimer: Timer | null` and `alertedWindows: Set<string>` to `live`. `paneView` sets `PaneView.quota` from `quotaHold`.
- Modify: `<plugin>/hooks/pane.ts`: `PaneView.quota?: { percent: number; resumesAt?: string }`. Task 10a draws it.
- Modify: `<plugin>/tests/world.tsx`: a `session.measure` stand-in that answers `{ changed: e.changed }`.
- Test: `<plugin>/tests/helper.test.tsx`

**Interfaces:**
- Produces: `quotaAllows($): Promise<boolean>`.
  - It reads `fiveHourOf((await $.session.usage()).rateLimits, now)`. With no reading, or when the call throws, it returns true.
  - At `ALERT_AT` or more, for a window not yet in `live.alertedWindows` (keyed by `resetsAt`, or `''`), it sends `$.ui.notify('Five-hour usage at N%. Side questions pause at 85%.', { title: 'Open items' })`, with N rounded down, and catches a failure.
  - At `HOLD_AT` or more, it sets `live.quotaHold`. It arms one timer at `resetsAtMs + 1000` that runs `pump` and `sendQuestions`. It calls `refresh` and returns false.
  - Otherwise it clears the hold and returns true.
- `pump` calls it before each hand-over, and `sendQuestions` calls it before it submits. `ridingOf` and `rode` never call it.
- A `session.measure` hook: when `e.changed` includes `'rateLimits'` and `live.quotaHold` is set, run `pump` and `sendQuestions`.
- `PaneView.quota` is `{ percent: Math.floor(percent), resumesAt: clockOf(resetsAtMs) }` while a hold stands. With no `resetsAtMs`, it has no `resumesAt`.

- [ ] **Step 1: Write the failing tests** in `helper.test.tsx`, in `describe('the quota guard')`:
  - `'at 72% of the five-hour window the user gets one alert per window, and the question still runs'`.
    - Two `/side` questions under one `resetsAt` give one `world.notices` entry, with the exact text and `title: 'Open items'`. Both spawns are heard.
    - A reading with a new `resetsAt` alerts again.
  - `'at 86% a new side question is saved and held, and runs once the window resets'`. `/side q` adds item #1 and makes no spawn. After `clock.advance` past `resetsAt`, with a reading of 10, the spawn is heard.
  - `'a later reading under 85% ends the hold'`. `$.session.measure({ changed: ['rateLimits'], … })` with `five_hour` at 40 makes the spawn heard.
  - `'while held, a question for the session waits and a note still rides'`.
  - `'only the five-hour window counts, and a reading past its reset is stale'` (Review Focus 4). A table:
    - `seven_day` 89 with `five_hour` 14;
    - `seven_day` 89 alone;
    - `five_hour` 90 with a past `resetsAt`.
    - Each row makes a spawn and no notice.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** the four files: `feat(open-items): alert at 70% of the five-hour window and hold side questions at 85%`

### Task 10a: The list, the new-question field and an immediate /open-items

**Spec:** "What the user sees" (the list), "Opening and input".

**Files:**
- Modify: `<plugin>/hooks/pane.ts`: `groupsOf`, `marksOf`, `rowTitleOf`, `rowTextOf`, `listRowsOf`, plus new `NEW_SIDE` and `EMPTY_LINE`.
- Modify: `<plugin>/types/index.d.ts`: `Held.id` becomes `number | 'new'`.
- Modify: `<plugin>/hooks/state.ts`: add `live.isKeptOpen`, which `hidePane` clears; `refresh` closes the pane only when nothing is shown and `!live.isKeptOpen`; `paneView` takes the list's `draft` from `live.drafts.get(NEW_SIDE.key)`; `seated` sets `isTyping` on the list when the ring is on `NEW_SIDE.key`.
- Modify: `<plugin>/hooks/register.tsx`:
  - The list screen of the pane render.
  - `/open-items` gets `immediate: true`. It and `/side` with no text always open the pane, with `isKeptOpen` set.
  - `/side` with no text focuses `NEW_SIDE.key`.
- Modify: `<plugin>/tests/world.tsx`: record the keys of `ui.focus` calls in `world.focused`, and the registered commands in `world.commands`.
- Create: `<plugin>/tests/side-pane.test.tsx`
- Modify: `<plugin>/tests/look.test.tsx`, `<plugin>/tests/register.test.tsx` (Step 4 only)

**Interfaces:**
- Consumes: `isPending`, `isWorking`, `reportOf` and `newestUserOf` (Task 5); `askNew` (Task 6a); `PaneView.quota` (Task 9).
- Produces in `pane.ts`:
  - `NEW_SIDE = { key: 'side-new', label: 'Side question', placeholder: 'Enter asks a helper; Claude goes on', submitLabel: 'ask' } as const`
  - `EMPTY_LINE = 'No items for you right now.'`
- `groupsOf` adds `{ label: 'SIDE QUESTIONS', tasks: open side items }` last, after LATER.
- The head line is drawn only when a shown item is active and not a side question.
- `marksOf(task, view: Pick<PaneView, 'quota'>)` gives a side item one mark, picked in this order:
  1. `  ⏸ held`, for `isPending` with `view.quota` set;
  2. `  ⋯ helper working`, for `isWorking`;
  3. `  ? helper asks you`, when the newest entry is a helper message and `reportOf(text).asksUser`;
  4. `  ⋯ waiting for the session`, when `toMain` is a question;
  5. `  ● answered`, for `hasNewReply`.

  The first, second and fourth marks draw dim. The third and fifth draw in yellow.
- `rowTitleOf` and `rowTextOf` take the same `view` as `marksOf`, so a row's title is cut to fit its mark.
- `listRowsOf` adds:
  - `rowsOf(EMPTY_LINE, width)` when nothing is shown;
  - `fieldRowsOf(NEW_SIDE.label, NEW_SIDE.submitLabel, view.draft, view.isTyping, width)` when `view.canType`.
- The render's early return for an empty pane stays only while `!live.isKeptOpen`. A kept pane draws `EMPTY_LINE` and the field, and asks for their rows.
- The list screen draws:
  - `EMPTY_LINE`, dim, when nothing else is shown;
  - the SIDE QUESTIONS rows;
  - then, where the surface draws an `Input`, the field `NEW_SIDE`.
- The field follows v0.2's guard. On submit, text that `looksSecret` sets `held` to `{ id: 'new', text }`. Under the field, the list then draws `heldNoticeOf`'s notice with Edit, which puts the text back in the field, and Send anyway, which runs `askNew`. Any other text runs `askNew`. Either way, the field's draft is cleared with `live.drafts.delete` and `forget`.

- [ ] **Step 1: Write the failing tests** in `side-pane.test.tsx`, plus one row test in `look.test.tsx`:
  - `'SIDE QUESTIONS is the last section, and a pane with only side questions draws no head'`.
    - With a seeded decision, a Later action and a side question, the section labels in order are `DECISIONS`, `LATER`, `SIDE QUESTIONS`.
    - With only a side question, there is no `head` element. The head's counts are Task 2's `waitingOf` test, so this test does not repeat them.
  - `'each side question row shows one mark'`. A table of the five seeded states maps to the five marks. Include held, with `world.rateLimits` at 86.
  - `'/open-items opens the pane with the new-question field also when nothing is in it, and it stays open until Hide'`.
    - `runTasks` opens with focus. The pane draws `No items for you right now.` and an Input keyed `side-new`.
    - After `add_item` and `close_item`, `world.isPaneOpen` is still true. Pressing `hide` closes it.
  - `'Enter in the field adds a side question, says so, and asks a helper'`. A submit on `side-new` gives the toast `Side question #1 sent` and one spawn. The field's value is `''` again.
  - `'the field holds a secret back with Edit and Send anyway, as v0.2's reply field does'`. A submit of `KEY_SHAPED` adds no item and draws the notice. A press on Send anyway adds the item.
  - `'/side with nothing after it opens the pane on the field'`. `world.focused` holds `side-new`.
  - `'/open-items and /side run at once, also while Claude works'`. `world.commands` holds `{ name: 'open-items', immediate: true }` and `{ name: 'side', immediate: true, argumentHint: '[#N] <question>' }`.
    - Retention: the engine's mid-turn run is a platform contract that the kit cannot exercise (probe 0.4 proved the engine side).
  - In `look.test.tsx`: at width 76 with `canType`, `rowsFor` of a list holding one decision and one side question is the head row, two labels, two rows, the field's one row and the foot. Assert the literal number.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Update the assertions this task changes, and no others.**
  - The tests that expect `{ text: 'No items for you right now.' }` from `/open-items` now expect the pane to open.
  - The tests that open the pane with `/open-items` and then expect it to close when the last item goes now expect it to stay open until Hide.
  - The list row counts take the field's row where the drawing can type. `ROWS_THREE_KINDS`, `ROWS_ONE_KIND` and the other list counts in `register.test.tsx` grow by that row.
- [ ] **Step 5: Run and see them pass.**
- [ ] **Step 6: Commit** the eight files: `feat(open-items): side questions in the list, the new-question field and an immediate /open-items`

### Task 10b: The side item screen, Done and the press rule

**Spec:** "What the user sees" (the item screen), "Decided by Asaf (2026-11-21)" 9, and "Claude's calls" on the live-chat test.

**Files:**
- Modify: `<plugin>/hooks/pane.ts`: `headerLineOf`, `hasReplyField`, `sentLineOf`, `itemRowsOf`, plus new `FOLLOW_UP`.
- Modify: `<plugin>/hooks/helper.ts`: add `doneSide`.
- Modify: `<plugin>/hooks/delivery.ts` (`resolve`)
- Modify: `<plugin>/hooks/register.tsx`: the side item screen of the pane render; `pressed($, counts)`; the `ui.press` and `ui.input` hooks.
- Test: `<plugin>/tests/side-pane.test.tsx`

**Interfaces:**
- Consumes: Task 10a; `stopHelper` (Task 7); `sentLineOf` (Task 4).
- Produces in `pane.ts`: `FOLLOW_UP = { label: 'Follow up', placeholder: 'Enter sends it to the helper' } as const`.
- `headerLineOf` leaves the `· waiting for Claude` mark off a side item.
- `hasReplyField` is true for a side item where the surface can type. The side item screen draws no Long answer.
- `sentLineOf` for a side item gives:
  - `Waiting to send` when it `isPending`;
  - `Waiting to send · usage at 86%, resumes at 20:49` when it `isPending` under `view.quota`, with no `, resumes at …` part when there is no `resumesAt`;
  - `✓ The helper has it` otherwise.
- The side item screen draws:
  - the header `SIDE QUESTION #N` and age;
  - the detail as plain Text;
  - the thread;
  - the sent line;
  - a Done button, whose `onPress` runs `doneSide`;
  - the `FOLLOW_UP` field, whose `onSubmit` runs `answer($, id, value)`, so v0.2's guard with Edit and Send anyway applies;
  - the foot.
- `resolve` calls `void pump($)` for a side item, where it calls `sendSoon` for the other kinds.
- Produces in `helper.ts`: `doneSide($, id: number): Promise<void>`. For an item that `isWorking` with a `helperId`, it calls `stopHelper` and cancels its timer. Then it runs `edit` with `movedBy(task, DONE, now)`, `settle`, `writeLog` and `pump`.
- The live-chat gate: `pressed($, counts = true)` calls `noteInput('press', …)` only when `counts` is true. The `ui.press` and `ui.input` hooks pass false for these elements:
  - `side-new`;
  - `row-N` or `reply-N` of a side item;
  - any button on a side item's screen.

- [ ] **Step 1: Write the failing tests** in `side-pane.test.tsx`:
  - `'a side question's screen shows its kind, the question as plain text, the helper's head, Done and the follow-up field, and no Later'`.
    - `header` holds `SIDE QUESTION` and `#1`. `msg-0` is a `Text`, not a `Markdown`.
    - The helper head is `Helper`, bold, in `planMode`.
    - The Button keys are `done`, `back` and `hide`, with no `later` and no `long`. The Input's label is `Follow up`.
  - `'a follow-up from the item reaches its helper and Done closes it, and neither reaches the main session by any path'` (Review Focus 5).
    - Seed #1 answered by `a1`, with `world.helpers` holding `a1`.
    - A submit on `reply-1` sends to `a1`. A press on `done` resolves #1.
    - `world.submitted` is `[]`, and `world.appended` holds no row. After `turn.complete`, a typed prompt carries no context that holds `#1`. #1's `update` stays `none` throughout, so no digest and no `list_items` claim can take it.
  - `'Done on a side question whose helper works stops it, and the next one starts'`. With seeded #1 working with `a1` and #2 pending, a press on `done` on #1 gives `world.stops === ['a1']` and a spawn for #2.
  - `'the sent line on a side question names the helper'`.
    - Pending behind a working item: `Waiting to send`.
    - After the send to its helper: `✓ The helper has it`.
    - Held at 86.5: matches `/^Waiting to send · usage at 86%, resumes at \d\d:\d\d$/`.
  - `'a side question from the pane does not count as a press for the live-chat gate'`. After two typed prompts, a submit on `side-new`, then `add_item`: it is refused with `live chat: ask in the chat`. The existing test `'a pane press, then an add with no agent running, is allowed'` keeps the other side.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** the five files: `feat(open-items): the side question screen, Done, and side presses outside the live-chat gate`

### Task 11: Hand-off and take of side questions

**Spec:** "Hand-off and session end".

**Files:**
- Modify: `<plugin>/hooks/handoff.ts` (`handOffItems`, `takeIn`, `takeItems`, `takeLeft`, `takeBack`)
- Modify: `<plugin>/hooks/tasks.ts` (`arrivedAs`, `tookOf`, `takenByCodeOf`, `leftTakenOf`, `takenBackOf`)
- Test: `<plugin>/tests/helper.test.tsx`

**Interfaces:**
- Consumes: `stopHelper`, `writeLog` and `pump` (`helper.ts`); `isWorking` (`side.ts`).
- Changes `arrivedAs(task: Task, id: number, atMs: number, transcript = ''): Task`. A side item arrives this way:
  - with no `helperId` and no `seenUuid`;
  - with `transcript` added to `side.transcripts` when it is not empty and not already there;
  - with no `sentMs` when no helper entry follows its newest user message, so that the new session asks again. This rule reads the thread only: a taken item arrives `handing-off`, which `isWorking` does not count.
- `takeIn` passes `(await $.session.info().catch(() => undefined))?.transcriptPath ?? ''`.
- `handOffItems` first calls `stopHelper` for each side item that `isWorking` with a `helperId`, and clears that item's `side.sentMs`. A Take back in the same session then asks again.
- `tookOf` lists only items that are not side questions. When side questions came, it adds the line `N side question(s) of the user's came too: their helpers answer them, and they are not yours to close.`
- `takenByCodeOf`, `leftTakenOf` and `takenBackOf` count only the items that are not side questions in their heads.
- `takeLeft` and `takeBack` hand over only the items that are not side questions, and call no `handOver` when none are left: a Take of side questions alone tells main nothing, in the user's voice or any other.
- `takeItems`, `takeLeft` and `takeBack` call `writeLog` and then `pump` after the take.

- [ ] **Step 1: Write the failing tests** in `helper.test.tsx`, in `describe('hand-off')`:
  - `'a hand-off stops a working helper and hands its side question off with the rest'`. With a seeded working side item (`a1`) and an action, `handoff_items` gives `world.stops === ['a1']`, the result `Marked 2 items for the next session.`, and both items `handing-off`.
  - `'taken in a new session, a side question adds the new conversation file, and its unanswered question gets a new helper that can search both files'`.
    - The store holds session `old`'s handing-off side item with `transcripts: ['/t/old.jsonl']`, `helperId: 'a1'`, `sentMs` set to the question's `atMs`, and no answer. In session 2, `world.info.transcriptPath` is `/t/new.jsonl`.
    - After `take_items`, the item has `transcripts: ['/t/old.jsonl', '/t/new.jsonl']` and no `helperId`.
    - A spawn is heard whose prompt holds both paths. `world.files` holds the log with `## #`.
    - The result holds `1 side question of the user's came too` and not the question's text.
  - `'a Take of a leftover side question, or a Take back of the session's own hand-off, asks a helper again'`. A table with two rows: a press on `take` for a leftover, and a press on `take-back` after a hand-off that stopped `a1`. In each row only side questions come: a spawn is made, and `world.submitted` is `[]`.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass.** The `'hand-off'` and `'leftovers'` tests in `register.test.tsx` pass unchanged.
- [ ] **Step 5: Commit** the three files: `feat(open-items): side questions move with a hand-off and get a new helper there`

### Task 12: Claude's tools on side questions

**Spec:** "What the main session gets" (Tool text).

**Files:**
- Modify: `<plugin>/hooks/register.tsx` (the `add_item`, `reply_item` and `close_item` descriptions in `TOOLS`; `CLOSE`, `REPLY`, `pickedOf`)
- Modify: `<plugin>/hooks/tasks.ts` (`replyErrorOf`, `repliedBy`)
- Create: `<plugin>/tests/side-tools.test.tsx`

**Interfaces:**
- The exact copy:
  - `add_item`: the session-end paragraph ends with ` Side questions (kind side) are the user's: leave them out.`
  - `close_item`: its line becomes `- Before the session ends, resolve, record or hand off every open and Later item. Side questions are the user's: leave them out.`
  - `reply_item` gets this line after its first: `- A side question is the user's question to a helper. When its helper asks you something, answer it with text only, and change nothing because of it.`
- `close_item` on a side item denies `Only the user closes a side question (Done).`. Check this before the other refusals.
- `replyErrorOf` on a side item with a `change` gives `A side question takes only text: answer the user in it.`.
- `repliedBy` on a side item deletes a `toMain` question.
- `reply_item` on a side item:
  - sends no `$.ui.notify` and opens no pane;
  - toasts `Claude answered side question #N. See /open-items`;
  - answers `Added your answer to side question #N. The user reads it in the item.`.
- `pickedOf`:
  - `updates` and `open` leave out a side item unless its `toMain` is a question;
  - `all` lists every item;
  - `id` gives that item.

- [ ] **Step 1: Write the failing tests** in `side-tools.test.tsx`:
  - `'close_item refuses a side question and still closes an action'`.
  - `'reply_item answers a side question in its thread with text only, clears the waiting question, and sets off no alert'`.
    - On a seeded #1 with a sent `toMain` question, the main agent calls `reply_item { id: 1, text: 'Branch fix-feed.' }`.
    - The newest entry is from `claude`, with no `author`. `toMain` is gone, `world.notices` is `[]`, and the result is the exact text above.
    - With `title: 'New'`, the call is denied with the copy above.
  - `'list_items shows Claude a side question only while a question waits for it, and show all lists every one'`. A table over `updates`, `open`, `all` and `id`. With `id` on a side item that waits for its helper, the answer has no `The user replied and waits for you` line.
  - `'the tool text leaves side questions out of the session-end rule and tells Claude how to answer one'`. The registered descriptions hold the three exact lines above.
    - Retention: the tool descriptions are the only steering channel on both seats (v0.2), so their text is the contract. The existing test that caps a description at 4,096 characters still passes.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** the three files: `feat(open-items): Claude answers a side question in its item and cannot close it`

### Task 13: The composer bridge leaves side questions out

This changes a security gate. The lead runs a security review of it before install (spec, Claude's calls).

**Files:**
- Modify: `<plugin>/hooks/register.tsx` (`prompt.submit`)
- Test: `<plugin>/tests/side-tools.test.tsx`

**Interfaces:**
- In `prompt.submit`, `bridged` is set and an open side item has that id. Before the `isOpenAsk` lookup, return `{ drop: '#N is a side question: use /side #N <text>, or its field in /open-items.' }`. The engine shows a drop's reason to the user, as v0.2's other prompt drops do, so no toast repeats it.

- [ ] **Step 1: Write the failing test** in `side-tools.test.tsx`: `'↳ Answer to #N on a side question reaches neither the main session nor Done, and the drop points to /side #N'`.
  - `typed('↳ Answer to #1: more')` on a seeded open side #1 returns that `drop`.
  - #1's thread does not change, and `world.submitted` is `[]`.
  - `typed('↳ Answer to #1:')` leaves #1 `open`.
  - On a seeded question item #2, `typed('↳ Answer to #2: the log')` still answers #2. This keeps the gate keyed on both sides.
- [ ] **Step 2: Run and see it fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see it pass.**
- [ ] **Step 5: Commit** both files: `fix(open-items): the composer bridge leaves side questions out`

### Task 14: Live checks in a real terminal

**Files:**
- Modify: `<plugin>/tests/live/test_pane.py`, and `<plugin>/tests/live/screen.py` if a helper changes.

- [ ] **Step 1: Update the cases that Tasks 3, 4, 10a and 10b change.**
  - The thread-order lists and `assert_fits` accept one empty row between entries.
  - `test_a_thread_draws_each_message_under_its_head_…` checks:
    - each name's SGR is bold;
    - the colors of `You`, `Claude` and `Helper` differ from each other and from the message text;
    - the age is dim.
  - A seeded item that waits for Claude, with `update: 'delivered'`, shows `✓ Claude has it` under the newest reply.
  - Cases that open `/open-items` on an empty session expect the field.
- [ ] **Step 2: Add the side cases.** Follow the file's seeding pattern, with no model call:
  - (a) A session with a decision and three side questions: one answered and unread, one with a `toMain` question, and one working.
    - SIDE QUESTIONS is the last section, each row has its mark, and the head counts only the decision.
    - Opening the answered one shows `SIDE QUESTION #N`, a `Helper` head, `d: Done`, the `Follow up` field, and no `Later`.
  - (b) `/open-items` in a session with no items draws `No items for you right now.` and the `Side question` field.
- [ ] **Step 3: Add the model cases**, run only with `LIVE_MODEL=1`:
  - (c) `/side what is a cursor in pagination?` while idle.
    - The item shows within 2 s, and a `Helper` answer shows within 120 s.
    - The main transcript JSONL holds no assistant row after the `/side` row, and no row holds the question's text (a regression check of probe 0.7).
  - (d) Ask main to run `sleep 20` in Bash, and reply to an item in the pane while it runs.
    - `Sent · Claude reads it at its next step` shows.
    - `✓ Claude has it` shows once the call returns.
- [ ] **Step 4: Run.**
  - Run `python3 <plugin>/tests/live/test_pane.py` with `RENDERS_DIR` set to a scratchpad folder. Expected: all pass.
  - Run case (a) again with `LIVE_THEME=light`.
  - Run `LIVE_MODEL=1` once for (c) and (d).
  - Report the SGR codes of the three speaker names and of the `SIDE QUESTION` label in both themes. The main session judges the colors from those codes and the kept screens.
- [ ] **Step 5: Commit**: `test(open-items): live cases for side questions, speaker heads and the sent line`

### Task 15: Docs, version and CI pin

**Files:**
- Modify: `<plugin>/README.md`
- Modify: `<plugin>/.claude-plugin/plugin.json`: `version` becomes `0.4.0`.
- Modify: `<wt>/CHANGELOG.md`: a new top entry, `## open-items 0.4.0 — side questions`.
- Modify: `<wt>/.github/workflows/open-items.yml`: `@anthropic-ai/claude-code@2.1.310` becomes `@anthropic-ai/claude-code@2.1.331`.
- Modify: `<plugin>/tests/world.tsx`: drop the bare `on('ui.focus', …)` stand-in, which was there for 2.1.310. Keep the `{ plugin: '*' }` one.

- [ ] **Step 1: README.**
  - A section "Side questions": what one is; the field, `/side <question>`, `/side #N <text>` and `/side` alone; one helper at a time, with only Read, Grep and Glob, Opus at medium effort, stopped at 10 minutes; what main gets (a note on your next typed prompt, or a question when its turn ends); the quota alert at 70% and the hold at 85%; Done only, no alert; hand-off.
  - "What the mod adds to prompts" adds notes and questions. "Nothing else from the conversation … goes into a prompt" becomes what a helper's prompt holds: the summary (first prompt and latest messages, text only) and the paths of the conversation file and the log.
  - "Data and tools": the mod starts helpers of the type `open-items:helper`, writes one log file in the scratchpad, and `/open-items` opens the pane at any time.
  - No person's name and no tool of the user's (leak gate).
- [ ] **Step 2: Version and changelog**, in the changelog's existing style. Cover side questions, `/side`, the helper and its limits, notes and questions for main, the quota guard, the two thread changes for every kind, the bridge change, and the CI pin.
- [ ] **Step 3: Verify.**
  - `claude plugin validate <plugin>` and `claude plugin test <plugin>` pass.
  - The leak-gate grep from Global Constraints prints nothing.
  - `git -C <wt> diff --check` prints nothing.
- [ ] **Step 4: Commit** the five files: `docs(open-items): 0.4.0 README, changelog and the 2.1.331 CI pin`

### Task 16 (for the lead, not an implementer; the placement is the lead's proposal): Personal config

Spec Rollout step 2. It runs before the PR opens, so the rule and 0.4.0 go live together (the lead's decision). This is outside the repo, and it is a rule change. Asaf's process tests it with the `instruction-check` skill before it goes live.

- [ ] Draft a change to the session-end rule in `~/.claude/CLAUDE.md` and in the `/wrap-up` skill. The change leaves side questions out: they are the user's, and they move with a hand-off or wait as leftovers.
- [ ] Test the change with `instruction-check` on real moments, and give Asaf the result for his decision.

## After the last task (the lead)

1. Run the simplify pass and a code review of the whole branch in a fresh subagent, and fix what they find.
2. Run a security review in a fresh subagent. It covers:
   - the bridge change (Task 13);
   - the helper's file access (`dontAsk`, Read, Grep and Glob over the conversation files);
   - what goes into a helper's prompt (a conversation summary).

   Suggest `/claude-security` to Asaf as its own session.
3. Finish Task 16. Then, with Asaf's yes, open the PR so that CI runs on 2.1.331.
4. With Asaf's yes, merge, update open-items on both seats before the first side question (spec Rollout step 3), and run the spec's smoke test in a fresh session (Rollout step 4).
