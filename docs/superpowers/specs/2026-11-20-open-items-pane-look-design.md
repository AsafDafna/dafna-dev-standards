# open-items 0.3: an item screen that is easy to read

Status: approved by Asaf on 2026-11-21.

## Intent

Asaf finds the Open items pane uncomfortable to use. An item with more than a few short lines is hard to read and looks messy, so the pane does not help him. This change makes one item easy to read in the pane, so that he can read and answer an item of more than a few lines where it waits.

### Evidence

- On the item screen, the pane draws the item's text (the detail) as plain text under a dim "Claude · age" line. Lists, bold text and commands show as raw characters, and nothing separates the parts of an item.
- A decision repeats its options twice: once as a numbered list in the detail, and again as button labels.
- Saved items with text are 400 to 600 characters long on a typical day, often with steps and commands in one block.
- Beside the chat (the fullscreen layout that both seats use), the pane already uses the full height. Above the prompt (the main-screen layout), it caps its height at 18 rows.
- At Asaf's window width (148 columns in the Herdr app), the pane already opens at 45% of the window, the widest that Claude Code allows. The engine's default width is the smallest of 45% of the window, 90 columns, and the window minus 70 columns (read from the Claude Code program, not from a documented contract).
- A live check in a test pane: the `Markdown` element keeps single line breaks, and text such as `snake_case_name` and `2 * 3 * 4` stays as typed. A plain line right after a numbered list is indented under the last list item, so older items, which were not written as Markdown, can shift.
- Earlier research (2026-11-07) ranked four other limits: no view across sessions, slow review of many items, a hidden pane below 144 columns, and no phone path. Asaf said none of these is the main problem now.

## Goals

1. A long item reads like a chat reply: formatted text, with space between its parts.
2. The ask, in one sentence, is the first thing he reads after the title.
3. Each option of a decision is a box with its button and one line on what it means. The detail does not repeat the options.
4. The pane stays as wide as today, and Asaf can change its width.
5. Claude writes items in this shape on both seats.

## Non-goals

- The list screen keeps its look.
- The phone, the Herdr app and a browser page are out of scope.
- A view across sessions and a review mode for many items are out of scope.
- The rules on when to add an item stay as they are, except the size line below.

## Anti-goals: a failure even if it works

- Answering takes more key presses than today.
- The pane takes so much width that the chat becomes hard to read.
- An item saved before this change fails to show, or shows wrong.
- A reply, a choice, a hand-off or the live-chat gate behaves differently.

## Success criterion

Claude runs this count at the first wrap-up that is at least two weeks after the release, from the session transcripts and the stores of both seats. The count needs at least 10 items with a detail over 400 characters; with fewer, it waits.

1. Asaf does not ask to move an item to the chat because it is hard to read.
2. Of the items with a detail over 400 characters, most are answered in the pane (a press or a reply in the item), not closed as "answered in chat".

## Decided by Asaf (2026-11-15 to 2026-11-21)

- The main problem is reading a long item, not the four limits from the earlier research.
- Fix the Claude Code pane itself (approach 1 below), not a Herdr window or a browser page.
- Use the Cards style. Asaf chose it after he used a live test pane with both richer styles.
- The pane is not so wide that the chat gets narrow, and its width is adjustable.
- The size rule for an item during background work counts only the detail. The ask line and the option notes are extra, and the limit goes up.

## Approaches

1. **Fix the Claude Code pane (chosen).** Draw the item with formatted text and boxes. It works in every terminal on the Mac that runs Claude Code, and Asaf answers in the same place.
2. **A Herdr reading window (rejected).** A Herdr app mod can show formatted text in a big window, but only in the Herdr app on the Mac, which is still on trial. The phone app shows no mods. Asaf still answers in the Claude pane, and each app update can break the mod.
3. **A browser page (rejected).** It has the most room, but Asaf leaves the terminal. Herdr 0.1.15 and 0.1.16 have no web view.

Three looks were tried for approach 1: plain formatted text, Cards, and Clean (options split by thin lines). The visual references are:

- the test pane, a working Cards drawing: `/Users/asafdafna/.claude/dev-mods/9d5d2006-097e-4fda-b485-62c2f66dbce8/pane-look-test/hooks/register.tsx`
- the mockup page: `/Users/asafdafna/dev-projects/dafna-dev-standards/.superpowers/brainstorm/74135-1795207365/content/pane-styles-v3.html` (its "Today" window draws the detail dim, which is wrong: see Evidence)

The plan copies the test pane's drawing code before rollout step 3 removes it.

## Claude's calls

- **New fields.** An `ask` field holds the ask in one sentence, so the pane does not guess it from the detail. The name is not `question`, because QUESTION is already a kind. An `option_notes` list holds one line per option.
- **Required for decisions.** A new decision must have an `ask` and a note for each option. `add_item` refuses a decision without them and says why, so Claude sends the call again. For the other kinds, `ask` is optional.
- **Markdown.** On an item made by 0.3, Claude's text (the detail and Claude's replies) goes to the `Markdown` element. Line breaks and characters are not rewritten; only the link rule below changes text. Asaf's own replies stay plain text, because he does not type Markdown.
- **Older items.** An item saved before 0.3 keeps today's plain text inside the new frame, so it shows as it does today. 0.3 marks each item it makes, so the pane can tell the two apart.
- **Links.** In Claude's Markdown, only `https:` links stay links. The pane draws `http:` and `file:` links as plain text, as the `link` field allows only `https:` today.
- **Focus.** The option box with the keyboard focus, or under the mouse, gets the darker background.
- **Keys.** The keys stay as they are today: digits for options, `l` Later, `d` Done or Seen, `b` Back. The mockups showed other keys only as an example.
- **Width.** The pane asks for no width and keeps the engine's default.
- **Above the prompt.** The same look, and the body scrolls. Both seats use the fullscreen layout, so this case is rare.
- **Size limit.** The raised limit is a detail of about 5 sentences or a short list. It was about 3 sentences with the options.

## The design

### What Asaf sees on the item screen

From top to bottom:

1. **Header box.** A box with a rounded border holds a kind label (DECISION, QUESTION, ACTION or INFO), the item number `#N`, the age, the "waiting for Claude" mark when it applies, and the title in bold on its own line.
2. **Ask line.** A bar and the `ask` text in bold, in the kind's color. With no `ask`, the line is left out.
3. **Detail.** On a 0.3 item, the detail as Markdown: lists, bold, inline code and code blocks look as they do in a chat reply. On an older item, plain text as today. It has no "Claude · age" line, because the header shows the age.
4. **Thread.** Each later message has its dim head ("You" or "Claude", and the age). On a 0.3 item, Claude's text is Markdown. Asaf's text, and all text on an older item, is plain text.
5. **Link and done-when.** They keep their places. The done-when line is plain text at normal brightness.
6. **Options** (decisions only). One box with a rounded border for each option. The box holds the option's button (`1: label`) and its note below. The recommended option has a green border and "★ recommended" after its label. The box with the focus or under the mouse gets a darker background.
7. **Buttons and reply field.** Done, Seen, Later, Long answer… and the reply field work as today. The held-answer notice keeps its place.
8. **Foot.** The hint, Back and Hide, as today.

### Width

The pane keeps the engine's default width. A width that Asaf sets wins and is kept, as one width for every plugin pane. While the pane has the keyboard, `Ctrl+X ←` makes it wider and `Ctrl+X →` makes it narrower, by 4 columns, up to 45% of the window. These keys do not work inside the reply field. Asaf can also drag the pane's edge. The README says all of this.

### The tools Claude calls

`add_item` gets two fields:

| Field | Description shown to Claude | Rules |
|---|---|---|
| `ask` | One sentence: for a decision or a QUESTION item, what the user answers; for an action, what the user must do; for info, what the user must know. Shown first. | Required for a decision. One line, under 150 characters. Longer text is refused, as an option over 60 characters is refused today. |
| `option_notes` | For a decision: one line per option, in the order of `options`, on what the option means for the user. | Required for a decision, refused on the other kinds. One note for each option, counted after the same cleanup as `options`. Each note is one line under 120 characters, not empty. Longer text is refused. |

`reply_item` accepts the same two fields. When it changes `options`, it needs new `option_notes` too. `option_notes` alone is checked against the item's current options. An `ask` can change but not be removed. The `reply_item` description lists `ask` and `option_notes` among the things it can change.

The `detail` description becomes: what the user needs to know and why, in about 5 sentences or a short list. Markdown shows formatted. The options are not repeated here.

The size line in "When to add an item" becomes: "While background agents, shell commands or monitors run, add an item for a short ask: a detail of about 5 sentences or a short list. The `ask` line and the option notes do not count. A longer ask waits for the chat recap."

"How to write an item" changes "An imperative title; the rest goes in the detail" to: "An imperative title, the ask in `ask`, a note for each option, and the rest in a short detail." Steering stays in the tool descriptions only, as in 0.2.1, so it reaches both seats.

What Claude reads back from `list_items`, `take_items` and a leftover Take shows the `ask` and each option with its note. After a compaction or a hand-off, Claude can still read them.

### Saved items

A saved item gets three optional fields: `askLine` (the `ask` argument), `optionNotes`, and the mark that 0.3 made it. The check that reads saved items accepts all three as optional typed fields, and closed items drop `askLine` and `optionNotes` as they drop options today. An item saved before 0.3 has none of them and shows as plain text, without the ask line and without notes. A hand-off copies all three fields to the new session.

## Constraints

- The look uses only what a Claude Code pane can draw: Box borders (`round`), border and background colors, a hover background on a keyed Box, the `Markdown` element, `Text` styles and plain Buttons. One drawing holds at most 100,000 characters.
- The terminal has one font and one text size, so the title cannot be bigger.
- The theme keys have no background color for the kind label or the focus. The builder picks colors that read well on both a dark and a light theme.
- Text from the model passes the same checks as today before it is drawn.
- The mod API can change between Claude Code releases. The builder checks every prop above against the current types.
- Below 144 columns, a pane that opens without a key press still waits, as today.

## Rollout

1. Release open-items 0.3.0 and update it on both seats at the same time. A session still on 0.2.3 shows a 0.3 item without its ask line and notes. This cost is accepted.
2. Live check in a fresh session on each seat: a decision with an ask and notes, a long action with a code block, a QUESTION item, and an item saved before 0.3 that holds `*`, `_`, `<...>`, a line that starts with `1.` and a line that starts with `# `. The older item must look as it does today. Check the pane beside the chat and above the prompt. The phone is not checked, because the pane does not fit its screen.
3. Remove the throwaway test pane and stop the mockup server.

## Left to the builder

- The row count above the prompt: each box adds two border rows, and Markdown can add rows. An estimate that is too small is acceptable, because the body scrolls.
- The color of each kind, on a dark and a light theme.
- The tests: the new fields and their refusals, `list_items` output with the ask and notes, the older-item case, the hand-off copy, the link rule, and the focus background.

## Skipped

- **A new look for the list screen.** Add it when Asaf says the list is hard to read.
- **An "open in browser" button for one item.** Add it when an item needs a table wider than the pane.
- **A Herdr reading window.** Reconsider it when Asaf adopts the Herdr app.
- **A wider pane.** Claude Code caps a pane at 45% of the window. Reconsider it if Claude Code raises the cap.
