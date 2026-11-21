# open-items 0.3 (an item screen that is easy to read) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw one open item as formatted text in boxes (the Cards look), with a one-line ask and a note under each option, and make Claude send those two fields.

**Architecture:** Two new tool fields (`ask`, `option_notes`) are parsed and checked in `hooks/tasks.ts` and saved on the item as `askLine`, `optionNotes` and the mark `isMarkdown`. `hooks/pane.ts` gets the pure helpers the drawing needs (kind labels, the link rule, thread entries with their look, the row estimate). `hooks/register.tsx` draws the item screen from them and carries the new tool text. Items saved before 0.3 have no mark and keep today's plain text.

**Tech Stack:** TypeScript hooks module for Claude Code (no DOM, no Node), JSX against `h`, the engine's test kit (`claude plugin test`), the Python tmux harness in `tests/live/`.

**Spec:** `docs/superpowers/specs/2026-11-20-open-items-pane-look-design.md` (approved 2026-11-21). Read it before any task.

**Visual reference:** the throwaway test pane `/Users/asafdafna/.claude/dev-mods/9d5d2006-097e-4fda-b485-62c2f66dbce8/pane-look-test/hooks/register.tsx` is a working Cards drawing that Asaf saw live. Read it before Task 7. It stays until the release is checked.

## Global Constraints

- Work in the worktree `/Users/asafdafna/dev-projects/.worktrees/dafna-dev-standards-oi-look`, branch `feature/open-items-pane-look`. Use absolute paths; never start a command with `cd`. `<plugin>` below means `/Users/asafdafna/dev-projects/.worktrees/dafna-dev-standards-oi-look/plugins/open-items`.
- After every task, `claude plugin test <plugin>` passes and `claude plugin validate <plugin>` passes.
- Every commit names its files with `git -C <worktree> add <files>`, then `git -C <worktree> commit -m "<message>"`.
- Limits, verbatim from the spec: `ask` is one line under 150 characters; each option note is one line under 120 characters, not empty; options stay under 60 characters.
- A new decision needs an `ask` and one note per option. For the other kinds, `ask` is optional. `option_notes` is refused on the other kinds.
- Model text drawn on the item screen goes through `printable` (text.ts), as today: the title, the ask line, each note.
- Only `https:` links stay links in Claude's Markdown.
- The keys stay: digits for options, `l` Later, `d` Done or Seen, `b` Back.
- The pane asks for no width.
- The branch is shippable only after Task 7. Tasks 1 to 4 already require the new fields, which the 0.2 screen does not draw.
- Code comments follow the repo rule: none unless they explain a non-obvious why.

## Review Focus

1. **A decision saved before 0.3 gets `reply_item` with `option_notes` only.** Expect the notes to be checked against the item's current options and saved, and the item to stay plain text (no mark). Tests in Task 1.
2. **Options with an empty entry** (`['A', '', 'B']` with three notes). Expect the empty option and its note to drop together, so the notes stay in order. Test in Task 1.
3. **A hand-off of a 0.3 item.** Expect `take_items` to keep `askLine`, `optionNotes` and `isMarkdown`, and to list the ask and the notes. Test in Task 3.
4. **A link inside a code fence or an inline code span.** Expect it untouched. Test in Task 5.
5. **The focus background when the pane loses the keys, or the ring moves to the reply field.** Expect no option box to keep the background. Test in Task 7.

---

### Task 1: The new fields, parsed and checked

**Files:**
- Modify: `<plugin>/types/index.d.ts` (type `Task`)
- Modify: `<plugin>/hooks/tasks.ts` (`Ask`, `Reply`, `optionsIn`, `parseAsk`, `parseReply`, `replyErrorOf`)
- Modify: `<plugin>/tests/items.test.tsx`, `<plugin>/tests/register.test.tsx`

**Interfaces:**
- Produces on `Task`: `askLine?: string` (the `ask` argument, one line), `optionNotes?: readonly string[]` (same length and order as `options`), `isMarkdown?: true` (set on every item that `add_item` makes from 0.3 on).
- Produces in `tasks.ts`: `export const MAX_ASK = 150`, `export const MAX_OPTION_NOTE = 120`; `Ask` gains `askLine?`, `optionNotes?` and `isMarkdown: true`; `Reply['change']` gains `askLine?` and `optionNotes?`.
- Replaces `optionsIn` with `choicesIn(rawOptions: unknown, rawNotes: unknown): { options?: string[]; notes?: string[] } | { error: string }`:
  - `rawNotes` not an array: `notes` is undefined.
  - `rawOptions` not an array and `rawNotes` an array (the notes-only `reply_item`): `notes` is `rawNotes` with each entry as `oneLine(entry)`, or `''` for a non-string.
  - Both arrays of different lengths: the count error below.
  - Both arrays of the same length: pair option i with note i, then drop each pair whose option is not a non-empty string after `oneLine`.
  - `rawOptions` an array: `options` holds the options kept, as today.

Exact error strings (the tests assert them):
- `ask is required for a decision: the one question the user answers, in one sentence.`
- `ask is ${n} characters; keep it under 150 and put the rest in detail.`
- `option_notes are for a decision only.`
- `option_notes needs one note for each option, in the same order.` (a missing list on a new decision, a count that differs, or an empty note)
- `keep each option note under 120 characters.`
- `new options need new option_notes, one for each option.` (from `replyErrorOf`, after its "for a decision only" check, so a non-decision still gets that error first)
- The `parseReply` "needs text or a change" error lists the new fields: `reply_item needs text or a change: a message for the user, or a new title, ask, options, option_notes, recommended, link or done_when.`

- [ ] **Step 1: Write the failing tests** in `items.test.tsx`, in a new `describe('ask and option notes')`:
  - `parseAsk` of a decision with `ask: 'Pick one?'`, options `['A','B']`, notes `['a','b']` returns `askLine: 'Pick one?'`, `optionNotes: ['a','b']`, `isMarkdown: true`.
  - `parseAsk` of a decision with no `ask` returns the "ask is required" error; with a 151-character ask, the "151 characters" error.
  - `parseAsk` of a decision with no `option_notes`, with notes `['a']` for two options, with three notes for two options, or with `['a','']`, returns the "one note for each option" error; a 121-character note returns the "under 120" error.
  - `parseAsk` of an action with `option_notes` returns "option_notes are for a decision only."; an action with no `ask` parses, with `isMarkdown: true` and no `askLine`.
  - `parseAsk` with options `['A','','B']` and notes `['a','x','b']` returns options `['A','B']` and notes `['a','b']`.
  - `parseReply` with `option_notes: ['a','b']` and no `options` returns `change.optionNotes: ['a','b']`; with a 151-character `ask`, the "151 characters" error.
  - `replyErrorOf` on a decision saved before 0.3 (options `['A','B']`, no notes, no mark) with `change.optionNotes: ['a','b']` returns undefined; with `['a']`, the count error; with `change.options: ['C','D']` and no notes, the "new options need new option_notes" error; on a question item with notes, "option_notes are for a decision only.".
  - `repliedBy` with `change.askLine: 'New?'` sets `askLine` and leaves `isMarkdown` absent on an item that had none.
- [ ] **Step 2: Run the tests and see them fail.** `claude plugin test <plugin>`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the fields and checks as the Interfaces block says. `parseReply` reads `ask` with `lineIn`, so an empty `ask` means no change.
- [ ] **Step 4: Update the fixtures that the new rules refuse.** In `register.test.tsx`, add `ask` and `option_notes` to the `add_item` decisions: `PAGING_TASK`, the inline decision near line 4436, the decision constants near lines 4504, 4836 and 5058, and the `ask` helper near line 4911. Add `option_notes` to the `reply_item` calls that change options near lines 1928, 5144 and 5157; leave the call near 5174 as it is (it still gets "for a decision only"). Leave every saved-item fixture without the new fields (the v0.1 `why` items, `saved(...)`, `savedItem(...)`, and both fixtures in `items.test.tsx`), because they stand for items saved before 0.3.
- [ ] **Step 5: Run the tests and see them pass.** Expected: all PASS.
- [ ] **Step 6: Commit** the four files: `feat(open-items): ask and option notes on items, required for decisions`

### Task 2: Saved items accept and trim the new fields

**Files:**
- Modify: `<plugin>/hooks/saved.ts` (`isItem`, `trimmed`)
- Test: `<plugin>/tests/items.test.tsx`

**Interfaces:**
- Consumes: the three `Task` fields from Task 1.

- [ ] **Step 1: Write the failing tests:** `savedIn` keeps an item with `askLine: 'Pick?'`, `optionNotes: ['a','b']`, `isMarkdown: true`; it drops an item whose `optionNotes` is `[1, 2]`, or whose `isMarkdown` is `false`; `trimmed` on a resolved item that Claude has heard of removes `askLine` and `optionNotes`.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement:** in `isItem`, `askLine` is optional text, `optionNotes` is optional texts, and `isMarkdown` is optional and `true` when present. In `trimmed`, drop `askLine` and `optionNotes` together with `options`.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** both files: `feat(open-items): saved items keep the ask and option notes`

### Task 3: What Claude reads back shows the ask and the notes

**Files:**
- Modify: `<plugin>/hooks/tasks.ts` (`listedOf`)
- Modify: `<plugin>/tests/register.test.tsx`

**Interfaces:**
- Produces: `listedOf` lines, after the waiting lines: `Ask: <askLine>` when present; then, when `optionNotes` is present, `Options:` and one line per option, `- <option>: <note>`; otherwise today's `Options: a | b`.

- [ ] **Step 1: Write the failing tests:** after `add_item` of a decision with ask "Who else should hold a key?" and notes, `list_items` contains `Ask: Who else should hold a key?` and `- Both keys now: Choose the second person now.`. After `handoff_items` and `take_items` in a second session, the taken item in the store has `askLine`, `optionNotes` and `isMarkdown: true`, and the `take_items` answer contains the same two lines.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** the lines in `listedOf`.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** both files: `feat(open-items): list and take show the ask and option notes`

### Task 4: The tool text Claude reads

**Files:**
- Modify: `<plugin>/hooks/register.tsx` (`TOOLS`: `add_item`, `reply_item`)
- Modify: `<plugin>/tests/register.test.tsx`

Exact copy, from the spec:
- In `add_item` "When to add an item", the first line becomes: ``- While background agents, shell commands or monitors run, add an item for a short ask: a detail of about 5 sentences or a short list. The ask line and the option notes do not count. A longer ask waits for the chat recap. Do not repeat the item in the chat.``
- In "How to write an item", the title line becomes: ``- An imperative title, the ask in `ask`, a note for each option, and the rest in a short detail.``
- `detail` description: `What the user needs to know and why, in about 5 sentences or a short list. Markdown shows formatted. Do not repeat the options here. Up to 4000 characters.`
- New property `ask`: `{ type: 'string', description: 'One sentence, under 150 characters, shown first: for a decision or a question, what the user answers; for an action, what the user must do; for info, what the user must know. Required for a decision.' }`
- New property `option_notes`: `{ type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4, description: 'For decision only, and required there: one line per option, in the order of options, under 120 characters, on what the option means for the user.' }`
- In `reply_item`: the same two properties, with the descriptions `A new ask: one sentence, under 150 characters.` and `For a decision: one note per option, in order. New options need new notes.`; its change line becomes ``- To change the ask, change the item in place (title, ask, options, option_notes, recommended, done_when or link), and say in text why.``

- [ ] **Step 1: Write the failing test:** in the registered `add_item` spec (as the existing tool tests read `world.tools`), the description contains `a detail of about 5 sentences or a short list`, and the schema has `ask` and `option_notes`; the `reply_item` schema has both. The existing test that keeps each description at most 4096 characters still passes.
- [ ] **Step 2: Run and see it fail.**
- [ ] **Step 3: Implement** the copy above. Change no other rule text.
- [ ] **Step 4: Run and see it pass.**
- [ ] **Step 5: Commit** both files: `feat(open-items): tool text for the ask, the option notes and the raised size line`

### Task 5: The link rule for Claude's Markdown

**Files:**
- Modify: `<plugin>/hooks/pane.ts`
- Create: `<plugin>/tests/look.test.tsx`

**Interfaces:**
- Produces: `export function safeLinksOf(markdown: string): string` in `pane.ts`.

Algorithm: go line by line. A line whose trimmed start is ```` ``` ```` or `~~~` opens or closes a fenced block; lines inside a fence stay as written. Outside a fence, leave each inline code span (text between matching backticks) as written, and in the rest of the line:
- rewrite `[text](target)` whose target does not start with `https:` to `text (target)`;
- rewrite `<target>` whose target starts with `http:` or `file:` to `target`;
- rewrite a reference definition line `[id]: target` whose target does not start with `https:` to `id: target`, so a `[text][id]` that uses it draws as plain text.
A bare `http://…` or `file://…` address stays as written: it shows its whole target, so nothing is hidden.

- [ ] **Step 1: Write the failing tests** in `look.test.tsx`: `[docs](https://a.b)` stays; `[docs](http://a.b)` becomes `docs (http://a.b)`; `[f](file:///etc/hosts)` becomes `f (file:///etc/hosts)`; `<http://a.b>` becomes `http://a.b`; `[1]: http://a.b` becomes `1: http://a.b`; inside a ```` ``` ```` fence and inside `` `[x](http://a)` ``, the link stays; `snake_case_name` and `2 * 3` stay.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** `safeLinksOf`.
- [ ] **Step 4: Run and see them pass.**
- [ ] **Step 5: Commit** both files: `feat(open-items): only https links stay links in item text`

### Task 6: The helpers and the row estimate for the new item screen

**Files:**
- Modify: `<plugin>/hooks/pane.ts` (`Entry`, `entryOf`, `entriesOf`, `actionsOf`, `itemRowsOf`; new `KIND_LABEL`, `KIND_COLOR`, `FOCUS_BACKGROUND`)
- Modify: `<plugin>/tests/look.test.tsx`, `<plugin>/tests/register.test.tsx`

**Interfaces:**
- Consumes: `Task.askLine`, `Task.optionNotes`, `Task.isMarkdown` (Task 1).
- Produces in `pane.ts`:
  - `export type Entry = { i: number; head?: string; text: string; look: 'markdown' | 'plain' | 'event' }`. The detail (entry 0) has no `head`. `look` is `markdown` for a message from Claude on an item with `isMarkdown`, `event` for a press, a choice, a change or a take, and `plain` otherwise.
  - `export const KIND_LABEL: Record<TaskKind, string> = { decision: 'DECISION', question: 'QUESTION', action: 'ACTION', info: 'INFO' }`
  - `export const KIND_COLOR: Record<TaskKind, ThemeKey> = { decision: 'warning', question: 'suggestion', action: 'permission', info: 'success' }`
  - `export const FOCUS_BACKGROUND: ThemeKey = 'subtle'`
  - `actionsOf` drops the ` (recommended)` suffix from an option's label: the option box shows `★ recommended` instead.
  - `itemRowsOf` counts, at body width `width` with no left indent: the header box (2 border rows, the label row, and the title rows at `width - 4`); 1 gap row; the ask rows at `width` when `askLine` is present, then 1 gap row; the thread as today but with no head row for the detail; 1 gap row before the option boxes; each option box (2 border rows, the label row at `width - 4`, the note rows at `width - 4`); 1 gap row before the button row; the button row from Later, Done, Seen and Long answer… only; then the held notice, the field and the foot as today.

- [ ] **Step 1: Write the failing tests:**
  - In `look.test.tsx`: at width 76, `rowsFor` of a decision with ask, a one-line detail and two options with one-line notes minus `rowsFor` of the same item as a question (no options) is exactly 9 (two boxes of 4 rows and one gap row), with `max` 99.
  - `entriesOf` on a 0.3 item gives the detail `look: 'markdown'` and no head, a user reply `look: 'plain'`, and a press `look: 'event'`; on an item with no mark, the detail is `plain`.
  - `actionsOf` of a decision labels the recommended option with its plain text.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** the helpers above.
- [ ] **Step 4: Update the assertions this task changes,** and no others: the item-screen row counts near `register.test.tsx` lines 1181 to 1208 take the new `rowsFor` values; the four checks of a `(recommended)` label near lines 1874, 4531, 4822 and 5154 expect the plain label.
- [ ] **Step 5: Run and see them pass.**
- [ ] **Step 6: Commit** the three files: `feat(open-items): helpers and row estimate for the Cards item screen`

### Task 7: The item screen in the Cards look

**Files:**
- Modify: `<plugin>/hooks/register.tsx` (the item screen in the pane's `ui.render` hook; the `ui.focus` hook)
- Modify: `<plugin>/tests/register.test.tsx`

**Interfaces:**
- Consumes: `safeLinksOf` (Task 5); `Entry`, `KIND_LABEL`, `KIND_COLOR`, `FOCUS_BACKGROUND`, `actionsOf` (Task 6).

Drawing, inside the `item-${task.id}` Box. The header replaces today's `☐ ` title row, and the `paddingLeft={2}` indent goes: every part starts at the body's left edge. Parts are separated by one empty row (`marginTop={1}`), as in the test pane.
1. `header`: a Box with `borderStyle="round"`, `borderColor="subtle"`, `paddingX={1}`. Its first line is the kind label, `<Text backgroundColor={KIND_COLOR[kind]} color="inverseText" bold>` with a space on each side (not `inverse`, which marks the focus ring), then `#N`, the age and the waiting mark as `ageOf` gives them, dim. Its second line is `printable(title)`, bold, wrapped.
2. `ask`: when `askLine` is present, a row of `▌ ` and `printable(askLine, MAX_ASK)`, bold, in `KIND_COLOR[kind]`.
3. `thread`: each entry; a `markdown` entry is the engine's `Markdown` element with `safeLinksOf(text)`; a `plain` entry is `Text`; an `event` entry is dim `Text`; a `head` stays dim above its text.
4. `link` and the done-when line, as today; the done-when text is not dim.
5. For a decision, one Box per option with key `choice-${n}`: `borderStyle="round"`, `borderColor` `success` for the recommended option and `subtle` for the others, `paddingX={1}`, `hover={{ backgroundColor: FOCUS_BACKGROUND }}`, and `backgroundColor={FOCUS_BACKGROUND}` only while `e.props.isFocused` is true and `live.ring` is `option-${n}`. It holds the option Button (key `option-${n}`, plain, hotkey `${n}`), then `  ★ recommended` in `success` for the recommended option, and the note below as `printable(note, MAX_OPTION_NOTE)`.
6. `options`: the Box keeps its key and now holds only Done, Seen, Later and Long answer…; then the held notice and the reply field as today; then the foot as today.

In the `ui.focus` hook, when the ring moves onto or off a key that starts with `option-`, call `$.ui.invalidate('ui.render')`. This redraws every instance of the mod's render hooks, which costs little, because it runs only on those moves.

- [ ] **Step 1: Write the failing tests** in `register.test.tsx`:
  - A decision with ask and notes, on the item screen: `header` contains `DECISION` and the title; `ask` contains the ask; `choice-1` contains option 1's label, `★ recommended` and its note; `options` contains `Later` and none of the option labels.
  - An action whose detail is `1. Open settings\n2. Click New`: `ui.find({ type: 'Markdown' })` finds that text.
  - An item seeded in the store with no `isMarkdown`: `ui.find({ type: 'Markdown' })` finds nothing, and the detail is a `Text` with today's words.
  - A reply typed by the user on a 0.3 item is drawn as `Text`, not `Markdown`.
  - After `ui.focus` onto `option-2`, `choice-2` has the focus background and `choice-1` does not. After the ring moves to the reply field, or the pane is drawn with `isFocused: false`, no choice box has it.
- [ ] **Step 2: Run and see them fail.**
- [ ] **Step 3: Implement** the drawing and the focus redraw. Use the test pane named under "Visual reference" as the model for the boxes.
- [ ] **Step 4: Update the assertions this task changes,** and no others: the thread test near line 1768 expects `/You · 2m.*Claude · 1m/s` (the detail has no head); tests that read option labels from `options` read them from `choice-N`.
- [ ] **Step 5: Run the tests and validate.** Expected: all PASS, and validation passes.
- [ ] **Step 6: Commit** both files: `feat(open-items): the item screen in the Cards look`

### Task 8: Live checks in a real terminal

**Files:**
- Modify: `<plugin>/tests/live/test_pane.py`, `<plugin>/tests/live/screen.py` if a helper changes

- [ ] **Step 1: Update the existing cases that Task 7 changes:** `assert_title` finds the title in the header box (the row after the one with the kind label) instead of a `☐ ` row, and no longer expects a `Claude · ` head under it; the thread-order list loses the detail's head (`'Claude · 3m'` at its start); the long-thread check starts with the header's title row instead of `#1 Pick the runner for the nightly build 1h Claude · 1h`; `'1: Yes (recommended)'` becomes `'1: Yes'` with `★ recommended` on the same row; `assert_fits` accepts one empty row between parts on a 0.3 item.
- [ ] **Step 2: Add cases** that follow the file's own seeding pattern:
  - (a) A 0.3 decision with ask, three noted options and a recommended one. At 150 columns (docked), the whole item shows in one window. At 100 columns (above the prompt, 18 rows), press Home: the window shows the header and the ask line; press End: it shows the last option box and the foot. Both windows have no cut-off row.
  - (b) A 0.3 action whose detail has a fenced code block and a `[docs](http://a.b)` link: the code lines show as written, and the link shows as `docs (http://a.b)`.
  - (c) An item saved before 0.3 whose detail holds `*`, `_`, `<name>`, a line that starts with `1.` and a line that starts with `# `: each line shows exactly as written.
  - Assert in (a): the corners `╭` and `╰` of each option box appear; the ask row starts with `▌`; after Tab onto option 2, its box rows carry a background SGR code and the kind label is not read as the ring.
- [ ] **Step 3: Run** `python3 <plugin>/tests/live/test_pane.py` with `RENDERS_DIR` set to `/private/tmp/claude-501/-Users-asafdafna-dev-projects/9d5d2006-097e-4fda-b485-62c2f66dbce8/scratchpad/renders`. Expected: all cases pass. Run case (a) once more with the light theme (`"theme": "light"` in the harness session's settings). Report the SGR codes found on the focused option box and on the kind label in both themes; the main session judges their readability from those codes and the kept screens.
- [ ] **Step 4: Commit** the changed files: `test(open-items): live cases for the Cards look`

### Task 9: Docs and version

**Files:**
- Modify: `<plugin>/README.md` (sections "What it does", "Threads" and "Data and tools")
- Modify: `<plugin>/.claude-plugin/plugin.json` (`version` to `0.3.0`)
- Modify: `/Users/asafdafna/dev-projects/.worktrees/dafna-dev-standards-oi-look/CHANGELOG.md` (new top entry `## open-items 0.3.0 — an item screen that is easy to read`)

- [ ] **Step 1: README:** describe the item screen in two or three sentences; give the width keys as the spec's Width section says (while the pane has the keyboard, `Ctrl+X ←` wider and `Ctrl+X →` narrower by 4 columns, up to 45% of the window, not inside the reply field, one kept width for every plugin pane, or drag the edge); in "Threads", add the ask and the option notes to what Claude can change in place; list `ask` and `option_notes` under the tools.
- [ ] **Step 2: Version and changelog,** in the changelog's existing style: the Cards look, the two fields and their rules, older items unchanged, the link rule, the raised size line.
- [ ] **Step 3: Run** `claude plugin validate <plugin>` and `claude plugin test <plugin>`. Expected: PASS.
- [ ] **Step 4: Commit** the three files: `docs(open-items): 0.3.0 README and changelog`

## After the last task

1. Run the simplify pass and a code review of the whole branch in a fresh subagent; fix what they find.
2. With Asaf's yes: open the PR, so CI runs validate and test.
3. With Asaf's yes: merge, update open-items on both seats, and start a fresh session on each seat for the live check in the spec's Rollout step 2.
4. At the first wrap-up at least two weeks after the release, run the spec's success count from the transcripts and stores of both seats.
5. Remove the throwaway test pane at `/Users/asafdafna/.claude/dev-mods/9d5d2006-097e-4fda-b485-62c2f66dbce8/pane-look-test` and stop the mockup server.
