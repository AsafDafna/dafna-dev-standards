# open-items 0.3 (an item screen that is easy to read) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw one open item as formatted text in boxes (the Cards look), with a one-line ask and a note under each option, and make Claude send those two fields.

**Architecture:** Two new tool fields (`ask`, `option_notes`) are parsed and checked in `hooks/tasks.ts` and saved on the item as `askLine`, `optionNotes` and the mark `isMarkdown`. `hooks/pane.ts` gets the pure helpers the drawing needs (kind labels, the link rule, thread entries with their look, the row estimate). `hooks/register.tsx` draws the item screen from them and carries the new tool text. Items saved before 0.3 have no mark and keep today's plain text.

**Tech Stack:** TypeScript hooks module for Claude Code (no DOM, no Node), JSX against `h`, the engine's test kit (`claude plugin test`), the Python tmux harness in `tests/live/`.

**Spec:** `docs/superpowers/specs/2026-11-20-open-items-pane-look-design.md` (approved 2026-11-21). Read it before any task.

## Global Constraints

- Work in the worktree `/Users/asafdafna/dev-projects/.worktrees/dafna-dev-standards-oi-look`, branch `docs/open-items-pane-look`. Run every command with absolute paths; never start a command with `cd`.
- Tests: `claude plugin test /Users/asafdafna/dev-projects/.worktrees/dafna-dev-standards-oi-look/plugins/open-items` must pass after every task. Validate with `claude plugin validate <same path>`.
- Limits, verbatim from the spec: `ask` is one line under 150 characters; each option note is one line under 120 characters, not empty; options stay under 60 characters.
- A new decision needs an `ask` and one note per option. For the other kinds, `ask` is optional. `option_notes` is refused on the other kinds.
- Only `https:` links stay links in Claude's Markdown; `http:` and `file:` link targets are drawn as plain text.
- The keys stay: digits for options, `l` Later, `d` Done or Seen, `b` Back.
- The pane asks for no width.
- Code comments follow the repo rule: none unless they explain a non-obvious why.
- Copy rule for every user-facing string and tool description: plain English, short sentences, active voice.

## Review Focus

1. **A decision saved before 0.3 gets `reply_item` with `option_notes` only.** Expect the notes to be checked against the item's current options and saved, and the item to stay plain text (no mark). Test in Task 1.
2. **Options with an empty entry** (`['A', '', 'B']` with three notes). Expect the empty option and its note to drop together, so notes stay in order. Test in Task 1.
3. **A hand-off of a 0.3 item.** Expect `take_items` to keep `askLine`, `optionNotes` and `isMarkdown`, and to list the ask and notes. Test in Task 3.
4. **A link inside a code fence** (```` ``` ```` block holding `[x](http://a)`). Expect it untouched. Test in Task 5.
5. **The reply field holds the keys while a choice box has the focus background.** Expect the background to follow the ring off the option buttons when the ring moves to the field. Test in Task 6.

---

### Task 1: The new fields, parsed and checked

**Files:**
- Modify: `plugins/open-items/types/index.d.ts` (type `Task`)
- Modify: `plugins/open-items/hooks/tasks.ts` (`Ask`, `Reply`, `optionsIn`, `parseAsk`, `parseReply`, `replyErrorOf`, `repliedBy`)
- Modify: `plugins/open-items/tests/items.test.tsx`, `plugins/open-items/tests/register.test.tsx` (every decision fixture: 2 in items, 13 in register)

**Interfaces:**
- Produces, in `types/index.d.ts`, on `Task`: `askLine?: string` (the `ask` argument, one line), `optionNotes?: readonly string[]` (same length and order as `options`), `isMarkdown?: true` (set on every item 0.3 adds).
- Produces, in `tasks.ts`: `export const MAX_ASK = 150`, `export const MAX_OPTION_NOTE = 120`; `Ask` gains `askLine?`, `optionNotes?`, `isMarkdown: true`; `Reply['change']` gains `askLine?` and `optionNotes?`.
- Replace `optionsIn(raw: unknown[]): string[]` with `choicesIn(rawOptions: unknown, rawNotes: unknown): { options: string[] | undefined; notes: string[] | undefined }`. It pairs option i with note i, drops a pair whose option is not a non-empty string after `oneLine`, and keeps a note as `oneLine(note)` ('' when it is no text). `options` is undefined when `rawOptions` is not an array; `notes` is undefined when `rawNotes` is not an array.

Exact error strings (the tests assert them):
- `ask is required for a decision: the one question the user answers, in one sentence.`
- `ask is ${n} characters; keep it under 150 and put the rest in detail.`
- `option_notes are for a decision only.`
- `option_notes needs one note for each option, in the same order.` (counts differ, or a note is empty)
- `keep each option note under 120 characters.`
- `new options need new option_notes, one for each option.` (`reply_item` with `options` and no `option_notes`)

- [ ] **Step 1: Write the failing tests** in `items.test.tsx`, in a new `describe('ask and option notes')`:
  - `parseAsk` of a decision with `ask`, options `['A','B']`, notes `['a','b']` returns `askLine: 'Pick one?'`, `optionNotes: ['a','b']`, `isMarkdown: true`.
  - `parseAsk` of a decision with no `ask` returns the "ask is required" error; with a 151-character ask, the "151 characters" error.
  - `parseAsk` of a decision with notes `['a']` for two options, or `['a','']`, returns the "one note for each option" error; a 121-character note returns the "under 120" error.
  - `parseAsk` of an action with `option_notes` returns "option_notes are for a decision only."; an action with no `ask` parses, with `isMarkdown: true` and no `askLine`.
  - `parseAsk` with options `['A','','B']` and notes `['a','x','b']` returns options `['A','B']` and notes `['a','b']`.
  - `parseReply` with `options` and no `option_notes` returns the "new options need new option_notes" error.
  - `replyErrorOf` on a decision item with options `['A','B']` and no notes (an item saved before 0.3), with `change.optionNotes: ['a','b']`, returns undefined; with `['a']`, the count error; on a question item, "option_notes are for a decision only.".
  - `repliedBy` with `change.askLine: 'New?'` sets `askLine` and leaves `isMarkdown` as it was.
- [ ] **Step 2: Run the tests and see them fail.** Run: `claude plugin test /Users/asafdafna/dev-projects/.worktrees/dafna-dev-standards-oi-look/plugins/open-items`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the fields and checks in `tasks.ts` and `types/index.d.ts` as the Interfaces block says. `parseReply` reads `ask` with `lineIn`, so an empty `ask` means no change. `errorIn` keeps its order; the ask and note checks run after the options checks.
- [ ] **Step 4: Update every decision fixture** in both test files to send `ask` and `option_notes`, so the old tests pass again. Keep each test's own assertions.
- [ ] **Step 5: Run the tests and see them pass.** Same command. Expected: all PASS.
- [ ] **Step 6: Commit.** `git -C <worktree> commit -am "feat(open-items): ask and option notes on items, required for decisions"`

### Task 2: Saved items accept and trim the new fields

**Files:**
- Modify: `plugins/open-items/hooks/saved.ts` (`isItem`, `trimmed`)
- Test: `plugins/open-items/tests/items.test.tsx`

**Interfaces:**
- Consumes: the three `Task` fields from Task 1.

- [ ] **Step 1: Write the failing tests:** `savedIn` keeps an item with `askLine: 'Pick?'`, `optionNotes: ['a','b']`, `isMarkdown: true`; it drops an item whose `optionNotes` is `[1, 2]` or whose `isMarkdown` is `false`; `trimmed` on a resolved item Claude has heard of removes `askLine` and `optionNotes`.
- [ ] **Step 2: Run the tests and see them fail.** Expected: the new tests FAIL.
- [ ] **Step 3: Implement:** in `isItem`, `askLine` is optional text, `optionNotes` is optional texts, `isMarkdown` is optional and, when present, `true`. In `trimmed`, drop `askLine` and `optionNotes` with `options`.
- [ ] **Step 4: Run the tests and see them pass.**
- [ ] **Step 5: Commit.** `feat(open-items): saved items keep the ask and option notes`

### Task 3: What Claude reads back shows the ask and the notes

**Files:**
- Modify: `plugins/open-items/hooks/tasks.ts` (`listedOf`)
- Test: `plugins/open-items/tests/register.test.tsx`

**Interfaces:**
- Consumes: `Task.askLine`, `Task.optionNotes`.
- Produces: `listedOf` lines, in this order after the waiting lines: `Ask: <askLine>` when present; then `Options:` followed by one line per option, `- <option>: <note>`, when `optionNotes` is present; else today's `Options: a | b`.

- [ ] **Step 1: Write the failing tests:** after `add_item` of a decision with ask "Who else should hold a key?" and notes, `list_items` contains `Ask: Who else should hold a key?` and `- Both keys now: Choose the second person now.`; after `handoff_items` and `take_items` in a second session, the taken item in the store still has `askLine`, `optionNotes` and `isMarkdown: true`, and the `take_items` answer contains the same two lines.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** the lines in `listedOf`.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit.** `feat(open-items): list and take show the ask and option notes`

### Task 4: The tool text Claude reads

**Files:**
- Modify: `plugins/open-items/hooks/register.tsx` (`TOOLS`: `add_item`, `reply_item`)
- Test: `plugins/open-items/tests/register.test.tsx`

Exact copy, from the spec:
- `add_item` "When to add an item", first line becomes: `- While background agents, shell commands or monitors run, add an item for a short ask: a detail of about 5 sentences or a short list. The ask line and the option notes do not count. A longer ask waits for the chat recap. Do not repeat the item in the chat.`
- "How to write an item", the title line becomes: `- An imperative title, the ask in ask, a note for each option, and the rest in a short detail.`
- `detail` description: `What the user needs to know and why, in about 5 sentences or a short list. Markdown shows formatted. Do not repeat the options here. Up to 4000 characters.`
- New property `ask`: `{ type: 'string', description: 'One sentence, under 150 characters, shown first: for a decision or a question, what the user answers; for an action, what the user must do; for info, what the user must know. Required for a decision.' }`
- New property `option_notes`: `{ type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4, description: 'For decision only, and required there: one line per option, in the order of options, under 120 characters, on what the option means for the user.' }`
- `reply_item`: the same two properties (descriptions: `A new ask: one sentence, under 150 characters.` and `For a decision: one note per option, in order. New options need new notes.`); its change line becomes `- To change the ask, change the item in place (title, ask, options, option_notes, recommended, done_when or link), and say in text why.`

- [ ] **Step 1: Write the failing test:** the `add_item` spec that the mod registers (as the existing tool tests read it) has a description that contains `a detail of about 5 sentences or a short list` and lists `ask` and `option_notes` in its schema; `reply_item`'s schema lists both.
- [ ] **Step 2: Run and see it fail.**
- [ ] **Step 3: Implement** the copy above. Change no other rule text.
- [ ] **Step 4: Run and see it pass.**
- [ ] **Step 5: Commit.** `feat(open-items): tool text for the ask, the option notes and the raised size line`

### Task 5: The link rule for Claude's Markdown

**Files:**
- Modify: `plugins/open-items/hooks/pane.ts`
- Create: `plugins/open-items/tests/look.test.tsx`

**Interfaces:**
- Produces: `export function safeLinksOf(markdown: string): string` in `pane.ts`.

Algorithm (the tests do not fix it alone): split the text into lines; track fenced blocks (a line whose trimmed start is ```` ``` ```` or `~~~` opens or closes one); outside fences, rewrite `[text](target)` whose target does not start with `https:` to `text (target)`, and `<target>` whose target starts with `http:` or `file:` to `target`. Leave everything else as written.

- [ ] **Step 1: Write the failing tests** in `look.test.tsx`: `[docs](https://a.b)` stays; `[docs](http://a.b)` becomes `docs (http://a.b)`; `[f](file:///etc/hosts)` becomes `f (file:///etc/hosts)`; `<http://a.b>` becomes `http://a.b`; inside a ```` ``` ```` fence, `[x](http://a)` stays; `snake_case_name` and `2 * 3` stay.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** `safeLinksOf`.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit.** `feat(open-items): only https links stay links in item text`

### Task 6: The item screen in the Cards look

**Files:**
- Modify: `plugins/open-items/hooks/pane.ts` (`Entry`, `entryOf`, `entriesOf`, `itemRowsOf`; new `KIND_LABEL`, `KIND_COLOR`, `FOCUS_BACKGROUND`)
- Modify: `plugins/open-items/hooks/register.tsx` (the item screen in the `ui.render` hook for the pane, the `ui.focus` hook)
- Test: `plugins/open-items/tests/register.test.tsx`, `plugins/open-items/tests/look.test.tsx`

**Interfaces:**
- Consumes: `safeLinksOf` (Task 5); `Task.askLine`, `Task.optionNotes`, `Task.isMarkdown` (Task 1).
- Produces in `pane.ts`:
  - `export type Entry = { i: number; head?: string; text: string; look: 'markdown' | 'plain' | 'event' }`. The detail (entry 0) has no `head`. `look` is `markdown` for a message from Claude on an item with `isMarkdown`, `event` for a press, a choice, a change or a take, and `plain` otherwise.
  - `export const KIND_LABEL: Record<TaskKind, string> = { decision: 'DECISION', question: 'QUESTION', action: 'ACTION', info: 'INFO' }`
  - `export const KIND_COLOR: Record<TaskKind, ThemeKey> = { decision: 'warning', question: 'suggestion', action: 'permission', info: 'success' }`
  - `export const FOCUS_BACKGROUND = 'subtle'` (a theme key, so light and dark themes both get a readable shade; the live check in Task 7 confirms it, and a bold border in `suggestion` is the fallback if text on it is hard to read)

Drawing, top to bottom, inside the existing `item-${task.id}` Box (keys are what the tests find):
1. `header`: a Box with `borderStyle="round"`, `borderColor="subtle"`, `paddingX={1}`. First line: the kind label as `<Text inverse bold color={KIND_COLOR[kind]}>` with a space on each side, then `#N`, the age and the waiting mark as today's `ageOf` gives them, dim. Second line: the title, bold, wrapped.
2. `ask`: when `askLine` is present, a row of `▌ ` and the ask, bold, in `KIND_COLOR[kind]`.
3. `thread`: each entry; `markdown` entries as the engine's `Markdown` element with `safeLinksOf(text)`, `plain` entries as `Text`, `event` entries as dim `Text`; a `head` stays dim above its text. If the surface's table has no `Markdown`, draw `Text`.
4. `link` and the done-when line, as today; the done-when text is not dim.
5. For a decision, one Box per option with key `choice-${n}`: `borderStyle="round"`, `borderColor` `success` for the recommended option and `subtle` for the rest, `paddingX={1}`, `hover={{ backgroundColor: FOCUS_BACKGROUND }}`, and `backgroundColor={FOCUS_BACKGROUND}` while `live.ring` is `option-${n}`. It holds the existing option Button (key `option-${n}`, plain, hotkey `${n}`), `★ recommended` in `success` after the recommended label, and the note below as `Text`.
6. `options`: the Box keeps its key and now holds only Done, Seen, Later and Long answer…; then the held notice and the reply field as today; then the foot as today.

In the `ui.focus` hook: when the ring moves onto or off a key that starts with `option-`, call `$.ui.invalidate('ui.render')`.

`itemRowsOf` counts: the header (2 border rows, the label row, the title rows at `inner - 4`), the ask rows, the thread as today, and per option box 2 border rows plus the label row and the note rows at `inner - 4`.

- [ ] **Step 1: Write the failing tests** in `register.test.tsx`:
  - A decision with ask and notes: on the item screen, `header` contains `DECISION` and the title; `ask` contains the ask; `choice-1` contains option 1's label, `★ recommended` and its note; `options` holds `Later` and does not hold the option labels.
  - An action item with a detail of `1. Open settings\n2. Click New`: the detail is drawn by a `Markdown` element (`ui.find({ type: 'Markdown' })` finds it with that text).
  - An item seeded in the store without `isMarkdown` (the existing v0.2 fixture style): no `Markdown` element is drawn; the detail is a `Text` with today's words.
  - A reply typed by the user on a 0.3 item draws as `Text`, not `Markdown`.
  - After `ui.focus` onto `option-2`, `choice-2` is drawn with the focus background and `choice-1` is not; after focus moves to the reply field, no choice box has it (Review Focus 5).
  - In `look.test.tsx`: `itemRowsOf` through `rowsFor` gives a decision with two noted options at least 6 more rows than the same item as a question with the same detail.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** the `pane.ts` helpers, then the drawing and the focus redraw in `register.tsx`. Update the existing tests that read option labels from `options` to read them from `choice-N`; change no other assertion.
- [ ] **Step 4: Run the tests and validate.** `claude plugin test <plugin>` and `claude plugin validate <plugin>`. Expected: all PASS, validation passes.
- [ ] **Step 5: Commit.** `feat(open-items): the item screen in the Cards look`

### Task 7: Live checks in a real terminal

**Files:**
- Modify: `plugins/open-items/tests/live/test_pane.py`

- [ ] **Step 1: Add three cases** that follow the file's own seeding pattern: (a) a 0.3 decision with ask, three noted options and a recommended one, at 150 columns (docked) and at 100 columns (above the prompt); (b) a 0.3 action whose detail has a fenced code block; (c) an item saved before 0.3 whose detail holds `*`, `_`, `<name>`, a line that starts with `1.` and a line that starts with `# `. Assert: the option boxes' corners `╭` and `╰` appear; the ask line starts with `▌`; nothing is cut off at the pane's bottom; case (c) shows its detail lines exactly as written.
- [ ] **Step 2: Run** `python3 /Users/asafdafna/dev-projects/.worktrees/dafna-dev-standards-oi-look/plugins/open-items/tests/live/test_pane.py` with `RENDERS_DIR` set to the session scratchpad. Expected: all cases pass. Look at the kept screens for the focus background; if text on it is hard to read, switch `FOCUS_BACKGROUND` to the bold-border fallback from Task 6 and run again.
- [ ] **Step 3: Commit.** `test(open-items): live cases for the Cards look`

### Task 8: Docs and version

**Files:**
- Modify: `plugins/open-items/README.md` (sections "What it does" and "Data and tools")
- Modify: `plugins/open-items/.claude-plugin/plugin.json` (`version` to `0.3.0`)
- Modify: `CHANGELOG.md` (new top entry `## open-items 0.3.0 — an item screen that is easy to read`)

- [ ] **Step 1: README:** describe the item screen in two or three sentences; name the width keys as the spec's Width section says (while the pane has the keyboard, `Ctrl+X ←` wider and `Ctrl+X →` narrower by 4 columns, up to 45% of the window, not inside the reply field, one kept width for every plugin pane, or drag the edge); list `ask` and `option_notes` under the tools.
- [ ] **Step 2: Version and changelog,** in the changelog's existing style: the Cards look, the two fields and their rules, older items unchanged, the link rule, the raised size line.
- [ ] **Step 3: Run** `claude plugin validate <plugin>` and `claude plugin test <plugin>`. Expected: PASS.
- [ ] **Step 4: Commit.** `docs(open-items): 0.3.0 README and changelog`

## After the last task (each step needs Asaf's yes)

1. Open the PR; CI runs validate and test.
2. Merge, update open-items on both seats, and start a fresh session on each seat for the live check in the spec's Rollout step 2.
3. At the first wrap-up at least two weeks after the release, run the spec's success count from the transcripts and stores of both seats.
4. Remove the throwaway test pane at `/Users/asafdafna/.claude/dev-mods/9d5d2006-097e-4fda-b485-62c2f66dbce8/pane-look-test` and stop the mockup server.
