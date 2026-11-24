# open-items 0.4 (side questions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user leaves a side question in the Open items pane or with `/side`; a helper agent that the mod registers answers it inside the item, and the main session hears of it only through a note on the user's next typed prompt or a question when its turn ends. Two thread changes ship with it for every kind: colored speaker heads with a blank row, and a "sent" line under the user's newest reply.

**Architecture:** A behavior-unchanged split of `hooks/register.tsx` comes first, so new code lives in its own files without import cycles. A fifth kind, `side`, joins the item model with a `side` record on the item. Pure builders (prompts, summary, report markers, log, quota reading, main-facing text) live in `hooks/side.ts`. The `$`-calling runtime lives in `hooks/helper.ts`: the agent type, the one-at-a-time queue, spawn and resume, the consumed report, the 10-minute stop, notes and questions for main, and the quota guard. `hooks/pane.ts` and `register.tsx` draw the SIDE QUESTIONS section, the new-question field and the side item screen.

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
- Quota, verbatim: at 70% or more of the five-hour window, one alert per window, `Five-hour usage at 72%. Side questions pause at 85%.` At 85% or more, no helper starts and no question goes to main.
- List marks, verbatim: `⋯ helper working`, `⋯ waiting for the session`, `? helper asks you`, `● answered`, `⏸ held`.
- Speaker heads: `You` in `ide`, `Claude` in `claude` and `Helper` in `planMode`, each name bold. The age is dim, and the message text keeps the normal color. A blank row comes before each entry after the detail.
- The sent line, verbatim: `Waiting to send`, `Sent · Claude reads it at its next step`, `✓ Claude has it`. On a side question it names the helper.
- The new-question toast, verbatim: `Side question #12 sent` (the item's own number).
- A side question's messages to the main session never use `asUser`. A note goes as `prompt.submit` context. A question goes as a framed plugin prompt.
- `earlierItems` saves `nextId: 3`, so a side question added after seeding the store gets #3.
- A seeded side item whose helper works needs a running agent row in `world.agents`: `{ id: helperId, type: 'open-items:helper', status: 'running' } as AgentInfo`. Without it, the start treats the helper as gone and asks again (Task 6).
- Test kit facts found on 2.1.331. A spike in the session's scratchpad checked them.
  - A test cannot read the mod's module state, because the kit loads its own instance. Observe through stand-ins.
  - `$.agent.spawn` reaches an `on('agent.spawn', …)` stand-in with an Agent-tool-shaped `e`: `subagent_type`, `description`, `prompt`, `run_in_background`. The stand-in must return `{ model }` or `{ deny }`. Whatever it returns, the mod gets `{ model: 'inherit' }` with no `agentId`. So a unit test never gets a running helper from a spawn. To test one, seed a saved side item that already has `side.helperId` and `side.sentMs`. A resume through `session.send` works.
  - Ops are answered with `{ value }`: `agent.register`, `session.usage`, `session.info`, `fs.write`, `session.messages`. Events are answered with their own result: `agent.spawn`, `session.send`, `tool.call` for `TaskStop`, `agent.offer`, `agent.report`.
  - An `agent.report` hook that throws is skipped, and the report goes on to the main loop. In a real session, that starts a main turn.

## Review Focus

1. **A helper's report arrives after its item is gone** (Done, `/clear`, moved). Expected: the report is consumed, main gets no turn, and nothing is written. Test in Task 6.
2. **A helper that was stopped at 10 minutes still reports**, with `status: "stopped"` and partial text. Expected: the item has one notice and no answer. Test in Task 7.
3. **A typed prompt that carries a note is dropped by a hook beneath.** Expected: the note waits for the next typed prompt. Test in Task 8.
4. **A rate-limit reading from the wrong window:** `seven_day` at 89 with `five_hour` at 14, `seven_day` alone, or a `five_hour` reading whose `resetsAt` has passed. Expected: no alert and no hold. Test in Task 9.
5. **A side follow-up or Done goes into v0.2's delivery:** the batch, the digest, a `list_items` claim, or a prompt sent `asUser`. Expected: neither reaches main by any path. Test in Task 10.

## Plan's calls

The spec leaves these choices to the builder. Each line is the plan's call.

- Report markers: the helper starts a line with `Question for you:` (it asks the user back), `Note for the session:` or `Question for the session:`. The lines stay in the text that the user reads. A question for the session wins over a note.
- Summary size: the first user prompt is cut at 2,000 characters. Then come the newest user and assistant messages, text only, up to 8,000 characters in all and 2,000 each.
- The log is the file `<scratchpad>/open-items-side-questions.md`, in Markdown. It has one section for each side question of the session: its number, the question and the latest answer.
- SIDE QUESTIONS is the last section, after LATER.
- When the list is taller than the pane, the body scrolls as today. Side rows join the arrow walk through `groupsOf`; the new-question field does not, and Tab or `/side` reaches it.
- A follow-up typed while its own helper still works waits for that helper's report, then resumes it. The mod never sends to a running helper. So a side question's sent line has two states: `Waiting to send` and `✓ The helper has it`.
- A failure is a new thread event, `notice`: "The helper could not start: …", "The helper did not answer in 10 minutes." and the like. It draws dim.
- A new side question that looks like a secret (in the field or with `/side`) is refused with a toast, with no "Send anyway". Follow-ups on the item's own field are refused the same way.
- The list row shows `⏸ held`. The item screen's sent line shows the long form: `Waiting to send · usage at 86%, resumes at 20:49`.
- Done on a side question stops its working helper where `TaskStop` is allowed.
- The quota alert has no two-minute quiet rule; it is one alert per window. A question that rides a typed prompt is not held, because it starts no turn.
- A helper's answer shows a toast. It opens no pane and sends no `$.ui.notify`.
- Nothing done on a side item counts as a pane press for the live-chat gate: not its row, its buttons or its field, and not the new-question field.
- A pane that the user opened with `/open-items` or `/side` stays open with only the field until Hide.
- `take_items` and a Take name side questions only by count.
- `close_item`'s session-end line also leaves side questions out, the same as `add_item`'s.
- `reply_item` on a side question takes text only.
- Copy: the field is `Side question` with the placeholder `Enter asks a helper; Claude goes on` and the submit label `ask`. The follow-up field is `Follow up` with `Enter sends it to the helper`.
- The kind color for `side` is `merged`. The live run checks it in both themes.

## The spec's test cases and their owners

Each case has one owner. A case that a probe proved on 2.1.331 is not replayed against a stand-in.

| Spec test case | Owner |
|---|---|
| Not about main's work: answered, main hears nothing | Task 6 |
| About main's work, main busy: the note rides the next typed prompt, no turn | Task 8 |
| About main's work, main idle: the helper searched first | Task 6 (the file path is in the prompt); the smoke test (the search itself) |
| Only main can answer: the question at turn end, also with agents running; main answers in the item | Tasks 8 and 12 |
| Not sure: the helper asks back, and the reply wakes the same helper | Tasks 6 and 10 (mark) |
| A follow-up gets main's messages since the last answer | Task 6 |
| A follow-up after `/clear`: a new helper with the thread and the log | Task 6 (send not delivered) |
| A restart or `--resume` while a helper worked: the question asks again | Task 6 (`revive`) |
| A new helper reads an earlier side question from the log | Task 6 (the log is written, and its path is in the prompt); the smoke test (the read) |
| `↳ Answer to #N:` on a side question | Task 13 |
| Two typed prompts, a side question from the field, then a helper's question: still a live chat | Tasks 8 and 10 |
| A refused spawn, then a follow-up tries again | Task 6 |
| Two side questions at once | Task 6 |
| A helper silent for 10 minutes | Task 7 |
| A note changes main's work: a decision item first | Task 5 (the note's copy); the smoke test (main's act) |
| A helper's question in a live chat or after Esc | Task 8 |
| Usage at 72% and at 86% | Task 9 |
| Done closes; `close_item` and `add_item` refuse the kind | Tasks 10, 12 and 2 |
| The helper's `Edit`, `Bash` and `Agent` refused, also after a resume | Probe 0.1 (engine); Task 6 pins the registration |
| A pane reply during a long tool call: sent, then has it | Task 4; Task 14 (d) |
| A hand-off: the item moves, and a new helper can search the old file | Task 11. Not probed: whether `dontAsk` lets the helper read the old session's file. If the engine refuses the read, the helper says it could not read it |

---

### Task 1 (lead's proposal): Split register.tsx and the test world, behavior unchanged

The spec does not ask for this. Asaf's recorded follow-up does: "register.tsx is about 2,800 lines: split the live-chat gate and the hand-off code on the next edit there." New side code needs the atoms, `live` and the store plumbing without importing `register.tsx`, which would make a cycle. If the reviewer rejects this task, keep only `tests/world.tsx`. Tasks 6 to 12 then put their `$` code in `register.tsx` and keep their pure code in `side.ts`. Their test files do not change.

**Files:**
- Create: `<plugin>/hooks/tools.ts`: `ADD`, `REPLY`, `CLOSE`, `LIST`, `HANDOFF`, `TAKE`, `DEFERRED`, `TOOLS`.
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
  - `register`, with every `on(…)` in today's order.
  - `pickedOf`, `startCleared`, `startResumed`, `newIdAfter`, `switchTo`, `restore`, `takeUp`.
  - The pane actions: `typed`, `fieldValueOf`, `openItem`, `markRead`, `toList`, `pressOn`, `respond`, `toPromptBox`, `answerTyped`, `markSeen`, `answer`, `editHeld`, `longAnswer`, `pressed`.
- Create: `<plugin>/tests/world.tsx`. Move these out of `register.test.tsx`, exported: the six tool names, `PANE`, `DONE`, `NOW`, `KEY_SHAPED`, `seat`, `start`, `typed`, `step`, `runTasks`, `textOf`, `itemOf`, `inline`, `ringTo`, `earlierItems`. Leave the rest where they are.
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
- [ ] **Step 4: Verify.** `claude plugin test <plugin>`: 309 pass. Run `claude plugin validate <plugin> > <scratchpad>/validate-after.txt`. In both files, the two lines that start with `./register.tsx hooks:` must be the same. `git -C <wt> diff --stat` lists no change to `items.test.tsx` or `look.test.tsx`. `git -C <wt> diff -M --color-moved=zebra` shows moved blocks only.
- [ ] **Step 5: Commit** the eight files: `refactor(open-items): split register.tsx into tools, state, gate, delivery and hand-off modules`

### Task 2: The side kind in the item model and the store

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
  - `actionsOf(side).map(a => a.key)` is `['done']`.
  - `listOf([side])` holds `- The user, ` and `- The helper, `, and the notice as `- The helper could not start: x, `.
- [ ] **Step 2: Run and see them fail.** `claude plugin test <plugin>`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - `isOpenAsk` and `waitsOnUser` are false for a side item.
  - The fallback count of `waitingOf` (`⋯ N waiting for Claude`) leaves side items out.
  - `movedBy` never sets `update: 'pending'` on a side item.
  - In `listedEntryOf`, a helper message is `The helper`, and a `notice` is `- <text>, <when>.`.
  - In `saved.ts`: `isMessage` takes `author` undefined or `'helper'`, `EVENTS` gets `notice`, and `isItem` checks an optional `side` of the shape above. `trimmed` drops `side` from a closed item, as it drops `options`.
  - In `pane.ts`: `KIND_LABEL.side = 'SIDE QUESTION'` and `KIND_COLOR.side = 'merged'`. `actionsOf` gives a side item only Done (`key: 'done'`, `hotkey: 'd'`), and no Later. `entryOf` draws a `notice` as `look: 'event'` with its `text` (through `printable`).
- [ ] **Step 4: Run and see them pass.** Expected: all PASS.
- [ ] **Step 5: Commit** the five files: `feat(open-items): the side kind in the item model and the store`

### Task 3: Thread heads: a blank row and a colored, bold name (Asaf 8)

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
  - In `look.test.tsx`:
    - `entriesOf` on an item whose thread holds `{ from: 'claude', author: 'helper', … }` gives `head.who === 'Helper'`.
    - At width 76, `rowsFor` of an item with a one-line detail and two one-line replies, minus `rowsFor` of the same item with only the detail, is exactly 6: two heads, two messages and two blank rows.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** the types, the drawing and the row count above.
- [ ] **Step 4: Update the assertions this task changes, and no others.** The item-screen row counts in the `'the item screen'` tests of `register.test.tsx` take the new values. The thread test that matches `/You · 2m.*Claude · 1m/s` must still pass as it is.
- [ ] **Step 5: Run the tests and see them pass.**
- [ ] **Step 6: Commit** the five files: `feat(open-items): speaker heads in color with a blank row between messages`

### Task 4: The sent line under the user's newest reply (Asaf 9)

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
  - Task 10 adds the side states.
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

**Files:**
- Create: `<plugin>/hooks/side.ts`
- Create: `<plugin>/tests/side.test.tsx`

**Interfaces:**
- Consumes: `Task`, `Side`, `ToMain`, `Message` (Task 2); `SessionMessage` and `SessionRateLimit` from `claude-code`; `MAX_TITLE`, `MAX_DETAIL` and `isSide` from `tasks.ts`; `clip` and `oneLine` from `text.ts`.
- Produces in `side.ts`:
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
  - `newestUserOf(task: Task): Message | undefined`.
  - `isPending(task: Task): boolean`: an open side item whose newest user message is later than `side.sentMs` (or `sentMs` is absent).
  - `isWorking(task: Task): boolean`: an open side item where the newest user message at or before `sentMs` has no helper entry after it. A handed-off, moved or closed item never works, so it never blocks the queue. A helper entry is a Claude message or `notice` with `author: 'helper'`.
  - `reportOf(text: string): { asksUser: boolean; toMain?: { kind: 'note' | 'question'; text: string } }`. It matches the markers case-insensitively, each at the start of a line.
  - `answeredOf(task: Task, text: string, atMs: number, seenUuid?: string): Task`. It adds `{ from: 'claude', author: 'helper', text, atMs }`, sets `hasNewReply: true`, sets `side.toMain` from `reportOf` with this `atMs`, and sets `side.seenUuid`. `isWaitingForClaude` becomes `isPending` of the result.
  - `noticedOf(task: Task, line: string, atMs: number): Task`. It adds `{ from: 'claude', author: 'helper', event: 'notice', text: line, atMs }`, sets `hasNewReply: true`, and sets `isWaitingForClaude` to `isPending` of the result.
  - `sentOf(task: Task, helperId: string | undefined): Task`. It sets `side.sentMs` to the newest user message's `atMs`, and `side.helperId` when the id is given.
  - `rowsTextOf(messages: readonly SessionMessage[], max: number): string`. Lines are `User: …` and `Claude: …`. It skips messages with empty `text`, cuts each at `MAX_ROW`, and keeps the newest within `max`, oldest first.
  - `summaryOf(messages: readonly SessionMessage[]): string`. It gives `First prompt: <first user text, cut at MAX_SUMMARY_FIRST>`, then `Latest messages:` and `rowsTextOf(rest, MAX_SUMMARY)`.
  - `helperPromptOf(args: { task: Task; summary: string; current: string; log: { path?: string; text: string } }): string`. The sections are:
    - `Side question #N from the user (Open items).`;
    - the main conversation file (`current`), or `This session keeps no conversation file.`;
    - `Earlier conversation files:` for every `side.transcripts` entry that is not `current`;
    - the log path, or the log text inline when there is no path;
    - `Summary of the main conversation:`;
    - `The side question's thread:`, one `User:`, `Helper:` or `Claude:` line block for each message. A notice goes in as its text.
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
  - `ridingOf(tasks: readonly Task[]): { context: string; ids: number[] } | undefined`. It covers every open side item whose `toMain` has no `sentMs`: notes through `noteForMain`, questions through `questionForMain`, joined by blank lines.

- [ ] **Step 1: Write the failing tests** in `side.test.tsx`:
  - `newSideOf` of a 90-character question gives an 80-character title that ends in `…`, `thread[0].from === 'user'` and `side.transcripts === ['/t/main.jsonl']`. With `''` it gives `[]`.
  - A `reportOf` table:
    - `'A.\nQuestion for you: which one?'` gives `asksUser: true`.
    - `'A.\nnote for the session: The test is flaky.'` gives a note with `The test is flaky.`.
    - A note line and a question line give the question.
    - `'See the Note for the session: x'` (the marker in mid-line) gives neither.
  - An `isPending` and `isWorking` table over five threads:
    - asked and not sent: pending, not working;
    - sent, with no answer: working;
    - sent and answered: neither;
    - answered, then a follow-up: pending, not working.
    - sent, with no answer, but `handing-off`: neither.
  - `summaryOf`:
    - skips a user row whose `text` is `''`;
    - cuts a 2,500-character first prompt to 2,000 characters ending in `…`;
    - from twenty 1,000-character messages keeps only the newest 8,000 characters or fewer;
    - labels rows `User:` and `Claude:`.
  - `helperPromptOf` holds `/t/main.jsonl`, `/t/old.jsonl` under `Earlier conversation files:`, `/s/pad/open-items-side-questions.md`, `Helper: ` and `#3`. With no log path it holds the log's `## #1` instead.
  - `logOf` of two side items holds `## #1`, `Question: what is a cursor?`, `Latest answer: A pointer into the feed.` and `Latest answer: none yet`.
  - A `fiveHourOf` table:
    - `five_hour` at 86 with a future `resetsAt` gives `{ percent: 86, resetsAtMs }`;
    - `seven_day` at 89 with `five_hour` at 14 gives `{ percent: 14, … }`;
    - `seven_day` alone gives `undefined`;
    - `five_hour` at 90 with a past `resetsAt` gives `undefined`;
    - `five_hour` at 72 with no `resetsAt` gives `{ percent: 72 }`.
  - `clockOf(new Date(2026, 10, 24, 20, 49).getTime())` is `'20:49'`, and 9:05 gives `'09:05'`.
  - `noteForMain` and `questionForMain` of a fixture give the exact strings above, with its values filled in.
  - `ridingOf` of one side item with a note and one with a sent question gives only the first id.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** `side.ts`.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** both files: `feat(open-items): side-question prompts, summary, report markers, log and quota reading`

### Task 6: The helper runtime and `/side`

**Files:**
- Create: `<plugin>/hooks/helper.ts`
- Modify: `<plugin>/hooks/state.ts`: add to `live` `pumpQueue: Promise<unknown>` and `stoppedHelpers: Set<string>`.
- Modify: `<plugin>/hooks/register.tsx`:
  - In `session.start`: call `registerHelper($)`, and register `/side` with `{ name: 'side', description: 'Leave a side question for a helper; Claude goes on', argumentHint: '[#N] <question>', immediate: true }`.
  - In `register`: call `helperHooks(on)`.
  - In `restore`: once `takeUp` kept items, call `revive($)`.
- Modify: `<plugin>/tests/world.tsx`: add these stand-ins.
  - `agent.register`: records the spec in `world.registered` and answers `{ value: { agent: 'open-items:' + e.name } }`.
  - `agent.spawn`: records `{ subagentType: e.subagent_type, description, prompt }` in `world.spawns`. It answers `{ deny: world.spawnDeny }` when that is set, else `{ model: 'opus' }`.
  - `session.send`: records in `world.sends`. It answers `{ isDelivered: true }` only when `e.to` is in `world.helpers`, else `{ isDelivered: false, reason: 'No agent by that id.' }`.
  - `tool.call` `{ tool: 'TaskStop' }`: records `e.task_id` in `world.stops`. It answers a result only when `e.task_id` is in `world.helpers` and `world.isStopRefused` is not set, else `{ deny: 'TaskStop is not allowed.' }`.
  - `session.usage`: answers `{ value: { startedAt: 0, context: …, rateLimits: world.rateLimits } }`.
  - `session.info`: answers `{ value: world.info }`. The default is `{ transcriptPath: '/t/main.jsonl', scratchpadDir: '/s/pad' }`.
  - `fs.write`: records `world.files[e.path] = e.text`.
  - `session.messages`: honors `e.last` and `e.after` over `world.messages`.
  - `agent.offer` answers `{ isOffered: true }`, and `agent.report` answers `{ text: e.text }`, for the types the mod passes on.
- Create: `<plugin>/tests/helper.test.tsx`

**Interfaces:**
- Consumes: Task 5 (all of `side.ts`); `change`, `edit`, `settle`, `show` and `live` from `state.ts`; `AT_WORK` from `gate.ts`; `movedBy`, `replyOf`, `DONE`, `isSide`, `looksSecret` and `MAX_DETAIL` from `tasks.ts`.
- Produces in `helper.ts`:
  - `HELPER_TYPE = 'open-items:helper'`
  - `registerHelper($): Promise<void>`. It registers `{ name: 'helper', description: 'Answers a side question the user left in the Open items pane; only the open-items mod starts it.', prompt: HELPER_PROMPT, tools: ['Read', 'Grep', 'Glob'], model: 'opus', effort: 'medium', maxTurns: 20, permissionMode: 'dontAsk' }`, and catches a failure.
  - `helperHooks(on: On): void`. It registers:
    - `agent.offer` `{ agent: HELPER_TYPE }`, which answers `{ isOffered: false }` when `e.agentId` is undefined, else `next(e)`;
    - `agent.report`;
    - `command.run` `{ command: 'side' }`.
  - `askNew($, text: string): Promise<void>`, `followUp($, id: number, text: string): Promise<void>`, `pump($): Promise<void>`, `writeLog($): Promise<void>`.
  - `revive($): Promise<void>`. A restart or a `--resume` reads the item back, but its helper died with the old process, so no report and no timer would ever end its work. For each side item that `isWorking`, `revive` looks in `$.agent.list()` for an agent with its `helperId` whose status is in `AT_WORK`. With none, it clears the item's `side.sentMs`. Then it pumps. A code reload keeps its helper, and `takeUp` reads nothing then, so it does not run.
- Guards for `askNew` and `followUp`, each a toast. Nothing is saved.
  - Empty text: `Type a question first.`
  - `looksSecret`: `This looks like a secret, so it wasn't sent. Put it where it belongs, then ask without it.`
  - Over `MAX_DETAIL`: `Your side question is N characters, so it wasn't sent: the most is 4000.`
  - `live.loading`: `LOADING`.
  - For `followUp` only, when `#N` is not an open side item: `#N is not an open side question.`
- `askNew`:
  - Takes the next id, as `add_item` does.
  - Reads the transcript path from `$.session.info()`, or `''` when that fails.
  - `change` adds `newSideOf`, then toasts `Side question #N sent`, then runs `void pump($)`.
- `followUp` runs `edit` with `movedBy(task, replyOf(text), now)`, then `settle`, then `pump`.
- `pump`:
  - It runs serially on `live.pumpQueue`. Do no work when any item `isWorking`. Then take the `isPending` items in order of their newest user message.
  - When the item has a `helperId`, send `followUpOf(task, rowsTextOf(await $.session.messages({ after: seenUuid }), MAX_SUMMARY))` to it (`since` is `''` with no `seenUuid`, or when that read fails). If it is delivered, apply `sentOf(task, helperId)`.
  - Otherwise, spawn `{ subagentType: HELPER_TYPE, description: 'Side question #N', prompt: helperPromptOf(…) }`. The summary comes from `$.session.messages()`. The log path is `${scratchpadDir}/${LOG_NAME}`, or the log text when there is no scratchpad.
  - A spawn that is denied, throws, or answers no `agentId` gives `noticedOf('The helper could not start: <reason>')`, then `sentOf(task, undefined)`, and the pump goes on to the next item. With no id, `<reason>` is `no helper id came back`.
  - Otherwise apply `sentOf(task, agentId)`.
- The `agent.report` hook: for `e.subagentType === HELPER_TYPE`, run `await reported($, e).catch(() => undefined)`, then return `{ consumed: 'open-items wrote the answer in its side question' }`. Pass every other type to `next(e)`. A hook that throws is skipped and the report reaches main, so nothing may throw before the return.
- `reported`:
  - Find the item by `side.helperId === e.agentId`. With none, only pump.
  - If `live.stoppedHelpers` holds the id, delete it and pump.
  - `completed` with text: `answeredOf`. Its `seenUuid` is the uuid of `(await $.session.messages({ last: 1 }))[0]`.
  - `completed` with no text: the notice `The helper gave no answer.`
  - `failed`: the notice `The helper could not answer: <first line, or "no reason given">`.
  - `stopped`: the notice `The helper stopped before it answered.`
  - On an answer, toast `Side question #N has an answer. See /open-items`.
  - Then `writeLog`, then `pump`.
- `command.run side`:
  - `''` runs `show($, true)` and returns `{}`.
  - `#N <text>` runs `followUp`.
  - Any other text runs `askNew`.
  - Every case returns `{}`, never `text`.
- `writeLog` writes `logOf` of the side items to `${scratchpadDir}/${LOG_NAME}`. With no scratchpad it writes nothing. It catches errors.

- [ ] **Step 1: Write the failing tests** in `helper.test.tsx`:
  - `'the helper type is registered with only Read, Grep and Glob, no permission dialogs, Opus at medium effort and a turn bound'`. `world.registered[0]` holds those fields and `maxTurns: 20`. It has no `omitClaudeMd`, and its `prompt` holds `Never call the advisor.`.
    - Retention: this pins the mod's side of the look-and-report-only grant (the spec's "Decided" items 9 and 10). The engine's refusals were proved by probe 0.1, so no unit test replays them.
  - `'the helper type is hidden from the main model, and its own runs still resume'`. `$.agent.offer` of `open-items:helper` with no `agentId` gives `{ isOffered: false }`. With `agentId: 'a1'` it is offered. `Explore` with no `agentId` is offered.
  - `'/side <question> adds a side question and asks a helper with what it needs'`.
    - `world.messages` holds a first prompt `Build the feed` and a later reply.
    - `/side what is a cursor?` toasts `Side question #1 sent`, and item #1 has kind `side`.
    - `world.spawns[0]` has `subagentType: 'open-items:helper'` and `description: 'Side question #1'`. Its prompt holds `/t/main.jsonl`, `/s/pad/open-items-side-questions.md`, `Build the feed` and `what is a cursor?`.
    - The kit returns no `agentId` (Global Constraints), so do not assert what follows the spawn.
  - `'a refused start says so in the item, and a follow-up tries again'`. With `world.spawnDeny = 'Agents are off here.'`, the newest entry is a notice `The helper could not start: Agents are off here.`. `/side #1 again?` makes a second spawn.
  - `'a helper's answer goes into its item, and the main session hears nothing'`.
    - Seed a saved side item #1 whose helper `a1` works: `sentMs` is the question's `atMs`.
    - `$.agent.report({ agentId: 'a1', subagentType: 'open-items:helper', status: 'completed', text: 'A pointer into the feed.', … })` resolves to `{ consumed: … }`.
    - The newest entry is `{ from: 'claude', author: 'helper', text: 'A pointer into the feed.' }`, with `hasNewReply: true`.
    - The toast is `Side question #1 has an answer. See /open-items`.
    - `world.submitted` is `[]`, and `world.appended` holds no row. A typed prompt then carries no context that holds `Side question`.
  - `'a report for a side question that is gone is still kept from the main session'` (Review Focus 1). A report from `a9`, which no item holds, resolves to `{ consumed: … }`. A report of type `Explore` resolves to `{ text }`.
  - `'a second side question waits for the running helper'`. With seeded #1 working, `/side second` makes no spawn. After `a1`'s report, a spawn for `Side question #3` is heard.
  - `'a follow-up resumes the same helper with the main conversation since its last answer'`.
    - Seed #1 answered by `a1`, with `seenUuid: 'u2'`. `world.messages` holds rows `u1` `old words`, `u2` and `u3` `new words`. `world.helpers` holds `a1`.
    - `/side #1 and then?` makes one send to `a1`. Its text holds `and then?` and `new words`, and not `old words`. No spawn is made.
  - `'a follow-up whose helper is gone starts a new helper with the thread and the log'`. With `world.helpers` empty, the send is not delivered. The spawn's prompt holds the earlier helper answer and `/s/pad/open-items-side-questions.md`.
  - `'a follow-up sent while its own helper works waits for its answer'` (plan's call). With seeded #1 working, `/side #1 more` makes no send. After `a1`'s report, one send to `a1` holds `more`.
  - `'/side refuses a secret, an over-long question and an item that is no side question'`. A table:
    - `KEY_SHAPED` gives the secret toast;
    - 4,001 characters gives the length toast;
    - `#2` on a decision gives `#2 is not an open side question.`.
    - In each case no item is added and no spawn is made.
  - `'after a restart, a side question whose helper is gone asks again, and one whose helper still runs waits'`. A table over a seeded working #1:
    - `world.agents` holds `a1` running: no spawn;
    - `world.agents` is empty: a spawn for `Side question #1`.
  - `'the session's log lists each side question with its latest answer'`.
    - After `a1`'s report, `world.files['/s/pad/open-items-side-questions.md']` holds `## #1` and `A pointer into the feed.`.
    - With `world.info` holding no `scratchpadDir`, nothing is written, and the next spawn's prompt holds `## #1`.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** `helper.ts`, the stand-ins and the registrations.
- [ ] **Step 4: Run and see them pass.** Expected: all PASS. Validate lists `agent.offer`, `agent.report` and `command.run{command=side}`.
- [ ] **Step 5: Commit** the five files: `feat(open-items): a helper answers each side question, one at a time, with /side to ask`

### Task 7: Stopping a helper at 10 minutes

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
  - If it is false: nothing happens. The helper's `maxTurns` bound ends it, and its report goes on as usual.

- [ ] **Step 1: Write the failing tests** in `helper.test.tsx`:
  - `'a helper silent for 10 minutes is stopped, the item says so, and the next side question starts'`.
    - Seed #1 answered by `a1`, with `world.helpers` holding `a1`. `/side #1 more?` sends to it, and `/side second` waits.
    - After `clock.advance(600_000)`, `world.stops` is `['a1']`, and #1's newest entry is a notice `The helper did not answer in 10 minutes.`. A spawn for `Side question #3` is heard.
    - Then a report from `a1` with `status: 'stopped'` and `text: 'Running the 14 searches.'` is consumed, and #1's thread does not change (Review Focus 2).
  - `'where TaskStop is refused, the mod waits for the helper's own end'`. With `world.isStopRefused`, the same setup writes no notice after 600 s, and #3 is not started. The late report `completed` is written as the answer, and #3 starts.
  - `'an answer before 10 minutes cancels the stop'`. A report at 300 s, then advance 600 s: `world.stops` is `[]`.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** the timer, `stopHelper` and the stopped-report rule.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** the three files: `feat(open-items): stop a helper that does not answer in 10 minutes`

### Task 8: Notes and questions for the main session, and the live-chat gate

**Files:**
- Modify: `<plugin>/hooks/helper.ts`
- Modify: `<plugin>/hooks/gate.ts` (`isLiveChat`)
- Modify: `<plugin>/hooks/register.tsx` (`prompt.submit`, `turn.complete`)
- Modify: `<plugin>/tests/world.tsx`: record each own prompt's `e.origin` in `world.ownOrigins`.
- Test: `<plugin>/tests/helper.test.tsx`

**Interfaces:**
- Consumes: `ridingOf`, `questionForMain` (Task 5); `isLiveChat` (`gate.ts`).
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
    - `typed('go on')` enters with context that holds the exact `noteForMain` text. The next typed prompt has none.
  - `'a slash command does not carry the note, and the next typed prompt does'`. A prompt with `command: { name: 'foo', args: '' }` has no note in its context, and the next plain prompt has it.
  - `'a note on a prompt that a hook beneath drops waits for the next one'` (Review Focus 3). With `world.refusingTyped` set, the prompt drops. After it is cleared, the next typed prompt carries the note.
  - `'a question for the session goes when the main turn ends, also while background agents run, and not in the user's voice'`.
    - After `turn.start`, `a1` reports `A.\nQuestion for the session: Which branch holds the fix?`. `world.submitted` is still `[]`.
    - `world.agents` holds a running `Explore` agent. After `turn.complete`, `world.submitted` holds the exact `questionForMain` text, and its origin has no `asUser`.
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

**Files:**
- Modify: `<plugin>/hooks/helper.ts`
- Modify: `<plugin>/hooks/state.ts`: add `quotaHold: { percent: number; resetsAtMs?: number } | null`, `quotaTimer: Timer | null` and `alertedWindows: Set<string>` to `live`. `paneView` sets `PaneView.quota` from `quotaHold`.
- Modify: `<plugin>/hooks/pane.ts`: `PaneView.quota?: { percent: number; resumesAt?: string }`. Task 10 draws it.
- Modify: `<plugin>/tests/world.tsx`: a `session.measure` stand-in that answers `{ changed: e.changed }`.
- Test: `<plugin>/tests/helper.test.tsx`

**Interfaces:**
- Produces: `quotaAllows($): Promise<boolean>`.
  - It reads `fiveHourOf((await $.session.usage()).rateLimits, now)`. With no reading, or when the call throws, it returns true.
  - At `ALERT_AT` or more, for a window not yet in `live.alertedWindows` (keyed by `resetsAt`, or `''`), it sends `$.ui.notify('Five-hour usage at N%. Side questions pause at 85%.', { title: 'Open items' })` and catches a failure.
  - At `HOLD_AT` or more, it sets `live.quotaHold`. It arms one timer at `resetsAtMs + 1000` that runs `pump` and `sendQuestions`. It calls `refresh` and returns false.
  - Otherwise it clears the hold and returns true.
- `pump` calls it before each hand-over, and `sendQuestions` calls it before it submits. `ridingOf` and `rode` never call it.
- A `session.measure` hook: when `e.changed` includes `'rateLimits'` and `live.quotaHold` is set, run `pump` and `sendQuestions`.
- `PaneView.quota` is `{ percent, resumesAt: clockOf(resetsAtMs) }` while a hold stands. With no `resetsAtMs`, it has no `resumesAt`.

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

### Task 10: Side questions in the pane, the new-question field and an immediate /open-items

**Files:**
- Modify: `<plugin>/hooks/pane.ts`: `groupsOf`, `marksOf`, `rowTitleOf`, `headerLineOf`, `hasReplyField`, `sentLineOf`, `listRowsOf`, `itemRowsOf`, plus new `NEW_SIDE`, `FOLLOW_UP`, `EMPTY_LINE`.
- Modify: `<plugin>/hooks/state.ts`:
  - Add `live.isKeptOpen`.
  - `refresh` closes the pane only when nothing is shown and `!live.isKeptOpen`.
  - `hidePane` clears it.
  - `paneView` puts the list's draft from `live.drafts.get(NEW_SIDE.key)` in `draft`.
  - `seated` sets `isTyping` on the list when the ring is on `NEW_SIDE.key`.
- Modify: `<plugin>/hooks/helper.ts`: add `doneSide`.
- Modify: `<plugin>/hooks/register.tsx`:
  - The pane render.
  - `/open-items` gets `immediate: true`. It and `/side` with no text always open the pane, with `isKeptOpen` set.
  - `/side` with no text focuses `NEW_SIDE.key`.
  - `pressed($, counts)`, and the `ui.press` and `ui.input` hooks.
- Modify: `<plugin>/tests/world.tsx`: record the keys of `ui.focus` calls in `world.focused`, and the registered commands in `world.commands`.
- Create: `<plugin>/tests/side-pane.test.tsx`
- Modify: `<plugin>/tests/look.test.tsx`

**Interfaces:**
- Consumes: `isPending`, `isWorking`, `reportOf` and `newestUserOf` (Task 5); `askNew`, `followUp` and `stopHelper` (Tasks 6 and 7); `PaneView.quota` (Task 9); `sentLineOf` (Task 4).
- Produces in `pane.ts`:
  - `NEW_SIDE = { key: 'side-new', label: 'Side question', placeholder: 'Enter asks a helper; Claude goes on', submitLabel: 'ask' } as const`
  - `FOLLOW_UP = { label: 'Follow up', placeholder: 'Enter sends it to the helper' } as const`
  - `EMPTY_LINE = 'No items for you right now.'`
- `groupsOf` adds `{ label: 'SIDE QUESTIONS', tasks: open side items }` last, after LATER.
- The head line is drawn only when a shown item is active and not a side question.
- `marksOf(task, view: Pick<PaneView, 'quota'>)` gives a side item one mark, picked in this order:
  1. `  ⏸ held`, for `isPending` with `view.quota` set;
  2. `  ⋯ helper working`, for `isWorking`;
  3. `  ? helper asks you`, when the newest entry is a helper message and `reportOf(text).asksUser`;
  4. `  ⋯ waiting for the session`, when `toMain` is a question;
  5. `  ● answered`, for `hasNewReply`.

  The first, second and fourth marks draw dim. The third and fifth draw in yellow. `headerLineOf` leaves the `· waiting for Claude` mark off a side item.
- `hasReplyField` is true for a side item where the surface can type. The side item screen draws no Long answer.
- `sentLineOf` for a side item gives:
  - `Waiting to send` when it `isPending`;
  - `Waiting to send · usage at 86%, resumes at 20:49` when it `isPending` under `view.quota`, with no `, resumes at …` part when there is no `resumesAt`;
  - `✓ The helper has it` otherwise.
- `listRowsOf` adds:
  - `rowsOf(EMPTY_LINE, width)` when nothing is shown;
  - `fieldRowsOf(NEW_SIDE.label, NEW_SIDE.submitLabel, view.draft, view.isTyping, width)` when `view.canType`.
- The render's early return for an empty pane stays only while `!live.isKeptOpen`. A kept pane draws `EMPTY_LINE` and the field, and asks for their rows.
- The list screen draws:
  - `EMPTY_LINE`, dim, when nothing else is shown;
  - the SIDE QUESTIONS rows;
  - then, where the surface draws an `Input`, the field `NEW_SIDE`. Its `onSubmit` runs `askNew($, value)`, then clears its draft with `live.drafts.delete` and `forget`.
- The side item screen draws:
  - the header `SIDE QUESTION #N` and age;
  - the detail as plain Text;
  - the thread;
  - the sent line;
  - a Done button, whose `onPress` runs `doneSide`;
  - the `FOLLOW_UP` field, whose `onSubmit` runs `followUp`;
  - the foot.
- Produces in `helper.ts`: `doneSide($, id: number): Promise<void>`. For an item that `isWorking` with a `helperId`, it calls `stopHelper` and cancels its timer. Then it runs `edit` with `movedBy(task, DONE, now)`, `settle`, `writeLog` and `pump`.
- `rowTitleOf` and `rowTextOf` take the same `view` as `marksOf`, so a row's title is cut to fit its mark.
- The live-chat gate: `pressed($, counts = true)` calls `noteInput('press', …)` only when `counts` is true. The `ui.press` and `ui.input` hooks pass false for these elements:
  - `side-new`;
  - `row-N` or `reply-N` of a side item;
  - any button on a side item's screen.

- [ ] **Step 1: Write the failing tests** in `side-pane.test.tsx`, plus one row test in `look.test.tsx`:
  - `'SIDE QUESTIONS is the last section, and a pane with only side questions draws no head'`.
    - With a seeded decision, a Later action and a side question, the section labels in order are `DECISIONS`, `LATER`, `SIDE QUESTIONS`.
    - With only a side question, there is no `head` element. The head's counts are Task 2's `waitingOf` test, so this test does not repeat them.
  - `'each side question row shows one mark'`. A table of the five seeded states maps to the five marks. Include held, with `world.rateLimits` at 86.
  - `'/open-items opens the pane with the new-question field also when nothing is in it, and it stays open until Hide'`.
    - `runTasks` opens with focus. The pane draws `No items for you right now.` and an Input keyed `side-new`.
    - After `add_item` and `close_item`, `world.isPaneOpen` is still true. Pressing `hide` closes it.
  - `'Enter in the field adds a side question, says so, and asks a helper'`. A submit on `side-new` gives the toast `Side question #1 sent` and one spawn. The field's value is `''` again.
  - `'the field refuses a secret, and nothing is added'`.
  - `'/side with nothing after it opens the pane on the field'`. `world.focused` holds `side-new`.
  - `'/open-items and /side run at once, also while Claude works'`. `world.commands` holds `{ name: 'open-items', immediate: true }` and `{ name: 'side', immediate: true, argumentHint: '[#N] <question>' }`.
    - Retention: the engine's mid-turn run is a platform contract that the kit cannot exercise (probe 0.4 proved the engine side).
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
    - Held at 86: matches `/^Waiting to send · usage at 86%, resumes at \d\d:\d\d$/`.
  - `'a side question from the pane does not count as a press for the live-chat gate'`. After two typed prompts, a submit on `side-new`, then `add_item`: it is refused with `live chat: ask in the chat`. The existing test `'a pane press, then an add with no agent running, is allowed'` keeps the other side.
  - In `look.test.tsx`: at width 76 with `canType`, `rowsFor` of a list holding one decision and one side question is the head row, two labels, two rows, the field's one row and the foot. Assert the literal number.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Update the assertions this task changes, and no others.**
  - The tests that expect `{ text: 'No items for you right now.' }` from `/open-items` now expect the pane to open.
  - The tests that open the pane with `/open-items` and then expect it to close when the last item goes now expect it to stay open until Hide.
  - The list row counts take the field's row where the drawing can type. `ROWS_THREE_KINDS`, `ROWS_ONE_KIND` and the other list counts in `register.test.tsx` grow by that row.
- [ ] **Step 5: Run and see them pass.**
- [ ] **Step 6: Commit** the eight files: `feat(open-items): side questions in the pane, the new-question field and an immediate /open-items`

### Task 11: Hand-off and take of side questions

**Files:**
- Modify: `<plugin>/hooks/handoff.ts` (`handOffItems`, `takeIn`, `takeItems`, `takeLeft`, `takeBack`)
- Modify: `<plugin>/hooks/tasks.ts` (`arrivedAs`, `tookOf`)
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
- `takeItems`, `takeLeft` and `takeBack` call `writeLog` and then `pump` after the take.

- [ ] **Step 1: Write the failing tests** in `helper.test.tsx`, in `describe('hand-off')`:
  - `'a hand-off stops a working helper and hands its side question off with the rest'`. With a seeded working side item (`a1`) and an action, `handoff_items` gives `world.stops === ['a1']`, the result `Marked 2 items for the next session.`, and both items `handing-off`.
  - `'taken in a new session, a side question adds the new conversation file, and its unanswered question gets a new helper that can search both files'`.
    - The store holds session `old`'s handing-off side item with `transcripts: ['/t/old.jsonl']`, `helperId: 'a1'`, `sentMs` set to the question's `atMs`, and no answer. In session 2, `world.info.transcriptPath` is `/t/new.jsonl`.
    - After `take_items`, the item has `transcripts: ['/t/old.jsonl', '/t/new.jsonl']` and no `helperId`.
    - A spawn is heard whose prompt holds both paths. `world.files` holds the log with `## #`.
    - The result holds `1 side question of the user's came too` and not the question's text.
  - `'a Take of a leftover side question, or a Take back of the session's own hand-off, asks a helper again'`. A table with two rows: a press on `take` for a leftover, and a press on `take-back` after a hand-off that stopped `a1`. Each row makes a spawn.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass.** The `'hand-off'` and `'leftovers'` tests in `register.test.tsx` pass unchanged.
- [ ] **Step 5: Commit** the three files: `feat(open-items): side questions move with a hand-off and get a new helper there`

### Task 12: Claude's tools on side questions

**Files:**
- Modify: `<plugin>/hooks/tools.ts` (`add_item`, `reply_item`, `close_item` descriptions)
- Modify: `<plugin>/hooks/register.tsx` (`CLOSE`, `REPLY`, `pickedOf`)
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
  - `'list_items shows Claude a side question only while a question waits for it, and show all lists every one'`. A table over `updates`, `open`, `all` and `id`.
  - `'the tool text leaves side questions out of the session-end rule and tells Claude how to answer one'`. The registered descriptions hold the three exact lines above.
    - Retention: the tool descriptions are the only steering channel on both seats (v0.2), so their text is the contract. The existing test that caps a description at 4,096 characters still passes.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** the four files: `feat(open-items): Claude answers a side question in its item and cannot close it`

### Task 13: The composer bridge leaves side questions out

This changes a security gate. The lead runs a security review of it before install (spec, Claude's calls).

**Files:**
- Modify: `<plugin>/hooks/register.tsx` (`prompt.submit`)
- Test: `<plugin>/tests/side-tools.test.tsx`

**Interfaces:**
- In `prompt.submit`, `bridged` is set and an open side item has that id. Before the `isOpenAsk` lookup, toast `Side question #N takes follow-ups with /side #N <text>.`. Then return `{ drop: '#N is a side question: use /side #N <text>, or its field in /open-items.' }`.

- [ ] **Step 1: Write the failing test** in `side-tools.test.tsx`: `'↳ Answer to #N on a side question reaches neither the main session nor Done, and a toast points to /side #N'`.
  - `typed('↳ Answer to #1: more')` on a seeded open side #1 returns that `drop`, and the toast is heard.
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

- [ ] **Step 1: Update the cases that Tasks 3, 4 and 10 change.**
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
    - The main transcript JSONL holds no assistant row after the `/side` row.
    - Report the type of each transcript row that holds the question's text. A row of type `user` means that the question can reach the main model.
  - (d) Ask main to run `sleep 20` in Bash, and reply to an item in the pane while it runs.
    - `Sent · Claude reads it at its next step` shows.
    - `✓ Claude has it` shows once the call returns.
- [ ] **Step 4: Run.**
  - Run `python3 <plugin>/tests/live/test_pane.py` with `RENDERS_DIR` set to a scratchpad folder. Expected: all pass.
  - Run case (a) again with `LIVE_THEME=light`.
  - Run `LIVE_MODEL=1` once for (c) and (d).
  - Report the SGR codes of the three speaker names and of the `SIDE QUESTION` label in both themes, and the finding of (c). The main session judges the colors from those codes and the kept screens.
- [ ] **Step 5: Commit**: `test(open-items): live cases for side questions, speaker heads and the sent line`

### Task 15: Docs, version and CI pin

**Files:**
- Modify: `<plugin>/README.md`
- Modify: `<plugin>/.claude-plugin/plugin.json`: `version` becomes `0.4.0`.
- Modify: `<wt>/CHANGELOG.md`: a new top entry, `## open-items 0.4.0 — side questions`.
- Modify: `<wt>/.github/workflows/open-items.yml`: `@anthropic-ai/claude-code@2.1.310` becomes `@anthropic-ai/claude-code@2.1.331`.
- Modify: `<plugin>/tests/world.tsx`: drop the bare `on('ui.focus', …)` stand-in, which was there for 2.1.310. Keep the `{ plugin: '*' }` one.

- [ ] **Step 1: README.**
  - Add a section "Side questions" that covers:
    - what a side question is;
    - the field, `/side <question>`, `/side #N <text>` and `/side` alone;
    - one helper at a time, with only Read, Grep and Glob, no shell, Opus at medium effort, and stopped at 10 minutes;
    - what the main session gets: a note on your next typed prompt, or a question when its turn ends;
    - the quota alert at 70% and the hold at 85%;
    - Done only, and no alert;
    - hand-off.
  - In "What the mod adds to prompts", add notes and questions.
  - Replace "Nothing else from the conversation … goes into a prompt" with what a helper's prompt holds: a summary, which is the first prompt and the latest messages, text only, plus the conversation file's path and the log's path.
  - In "Data and tools", say that the mod starts helpers of the agent type `open-items:helper` and writes one log file in the session's scratchpad. Say that `/open-items` opens the pane at any time.
  - Put no person's name and no tool of the user's in it (leak gate).
- [ ] **Step 2: Version and changelog**, in the changelog's existing style. Cover side questions, `/side`, the helper and its limits, notes and questions for main, the quota guard, the two thread changes for every kind, the bridge change, and the CI pin.
- [ ] **Step 3: Verify.**
  - `claude plugin validate <plugin>` and `claude plugin test <plugin>` pass.
  - The leak-gate grep from Global Constraints prints nothing.
  - `git -C <wt> diff --check` prints nothing.
- [ ] **Step 4: Commit** the five files: `docs(open-items): 0.4.0 README, changelog and the 2.1.331 CI pin`

### Task 16 (for the lead, not an implementer; the placement is the lead's proposal): Personal config

Spec Rollout step 2. This is outside the repo, and it is a rule change. Asaf's process tests it with the `instruction-check` skill before it goes live.

- [ ] Draft a change to the session-end rule in `~/.claude/CLAUDE.md` and in the `/wrap-up` skill. The change leaves side questions out: they are the user's, and they move with a hand-off or wait as leftovers.
- [ ] Test the change with `instruction-check` on real moments, and give Asaf the result for his decision.

## After the last task (the lead)

1. Run the simplify pass and a code review of the whole branch in a fresh subagent, and fix what they find.
2. Run a security review in a fresh subagent. It covers:
   - the bridge change (Task 13);
   - the helper's file access (`dontAsk`, Read, Grep and Glob over the conversation files);
   - what goes into a helper's prompt (a conversation summary).

   Suggest `/claude-security` to Asaf as its own session.
3. With Asaf's yes, open the PR so that CI runs on 2.1.331.
4. With Asaf's yes, merge, update open-items on both seats before the first side question (spec Rollout step 3), and run the spec's smoke test in a fresh session (Rollout step 4).
