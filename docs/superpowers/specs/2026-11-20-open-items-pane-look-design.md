# open-items 0.3: an item screen that is easy to read

## Intent

Asaf finds the Open items pane uncomfortable to use. An item with more than a few short lines is hard to read and looks messy, so the pane does not help him. This change makes one item easy to read in the pane, so that he can read and answer a long ask where it waits.

### Evidence

- On the item screen, the pane draws the item's text (the detail) as one dim gray block of plain text. Lists, bold text and commands show as raw characters.
- A decision repeats its options twice: once as a numbered list in the detail, and again as button labels.
- Saved items with text are 400 to 600 characters long on a typical day, often with steps and commands in one block.
- The pane caps its height at 18 rows only when it sits above the prompt (the main-screen layout). Beside the chat (the fullscreen layout that Asaf uses), it already uses the full height. A chat reply during the design talk said "at most 18 rows" without this condition.
- Earlier research (2026-11-07) ranked four other limits: no view across sessions, slow review of many items, a hidden pane below 144 columns, and no phone path. Asaf said none of these is the main problem now.

## Goals

1. A long item reads like a chat reply: formatted text at normal brightness, with space between its parts.
2. The question that Asaf must answer is the first thing he reads, apart from the title.
3. Each option of a decision is a box with its button and one line on what it means. The detail does not repeat the options.
4. The pane opens a little wider than today, and Asaf can change its width.
5. Claude writes items in this shape on both seats, without extra prompting.

## Non-goals

- The list screen keeps its look.
- The phone, the Herdr app and a browser page are out of scope.
- A view across sessions and a review mode for many items are out of scope.
- The rules on when to add an item stay as they are.

## Anti-goals: a failure even if it works

- Answering takes more key presses than today.
- The pane takes so much width that the chat becomes hard to read.
- An item saved before this change fails to show, or shows wrong.
- A reply, a choice, a hand-off or the live-chat gate behaves differently.

## Success criterion

1. For two weeks after the release, Asaf does not ask to move an item to the chat because it is hard to read.
2. Of the decision items written after the release, at least 9 of 10 have a question and a note for each option. The count comes from the `add_item` calls in the session transcripts of both seats. Nothing new is built for the count.

## Decided by Asaf (2026-11-15 and 2026-11-20)

- The main problem is reading a long item, not the four limits from the earlier research.
- Fix the Claude Code pane itself (approach 1 below), not a Herdr window or a browser page.
- Use the Cards style. Asaf chose it after he used a live test pane with both richer styles.
- The pane is a bit wider than today, but not so wide that the chat gets narrow, and its width is adjustable.

## Approaches

1. **Fix the Claude Code pane (chosen).** Draw the item with formatted text, boxes and normal brightness. It works in every terminal on the Mac that runs Claude Code, and Asaf answers in the same place.
2. **A Herdr reading window (rejected).** A Herdr app mod can show formatted text in a big window, but only in the Herdr app on the Mac, which is still on trial. The phone app shows no mods. Asaf still answers in the Claude pane, and each app update can break the mod.
3. **A browser page (rejected).** It has the most room, but Asaf leaves the terminal. Herdr 0.1.15 and 0.1.16 have no web view.

Three looks were tried for approach 1: plain formatted text, Cards, and Clean (options split by thin lines). Mockups and the test pane are in `.superpowers/brainstorm/` (not committed) and in the session's dev-mods folder.

## Claude's calls

- A new optional `question` field holds the question, so the pane does not guess it from the detail.
- A new optional `option_notes` list holds one line per option, in the same order as `options`.
- Claude's text (the detail and Claude's replies) is drawn as Markdown at normal brightness. Asaf's own replies stay plain text, because he does not type Markdown. Only metadata (age, the head of a reply, the hint) stays dim.
- Single line breaks stay. If the Markdown element joins single lines into one paragraph, the pane keeps each line break before it draws the text. This keeps items saved before 0.3 as they look today.
- The keys stay as they are today: digits for options, `l` Later, `d` Done or Seen, `b` Back. The mockups showed other keys only as an example.
- Above the prompt, the 18-row cap stays, because that layout shares the screen with the chat. The body scrolls.
- The pane asks to open at about 40% of the window width beside the chat.

## The design

### What Asaf sees on the item screen

From top to bottom:

1. **Header box.** A box with a rounded border holds a kind label with a colored background (DECISION, QUESTION, ACTION or INFO), the age, and the title in bold on its own line.
2. **Question.** A bar and the question in bold, in the kind's color. With no `question`, the line is left out.
3. **Detail.** The detail, drawn as Markdown: lists, bold, inline code and code blocks look as they do in a chat reply.
4. **Thread.** Each later message, with its head ("You", "Claude", the age) dim. Claude's text is Markdown, and Asaf's text is plain text, both at normal brightness.
5. **Options** (decisions only). One box with a rounded border for each option. The box holds the option's button (`1: label`) and, when given, its note below. The recommended option has a green border and "★ recommended" after its label. The box under the pointer gets a darker background.
6. **Buttons and reply field.** Done, Seen, Later, Long answer… and the reply field work as today.
7. **Foot.** The hint, Back and Hide, as today.

The link and the done-when line keep their places between the thread and the options. The held-answer notice keeps its place under the buttons.

### Width

When the pane opens beside the chat, it asks for about 40% of the window. The engine caps a docked pane at 45% of the window and at least 24 columns. A width that Asaf sets wins and is kept: `Ctrl+X ←` makes the pane wider, `Ctrl+X →` makes it narrower, and he can drag its edge. The README names these keys.

### The tools Claude calls

`add_item` gets two optional fields:

| Field | Description shown to Claude |
|---|---|
| `question` | The one question the user answers, as a full sentence under 150 characters. Shown first. For an info item: what the user must know. |
| `option_notes` | For decision only: one line per option, in the order of `options`, each under 120 characters, on what the option means for the user. |

`reply_item` accepts the same two fields. When `reply_item` changes `options` without new `option_notes`, the old notes are dropped. When `option_notes` and `options` differ in length, the tool refuses and says why, so Claude can send the call again.

The `detail` description changes to: what the user needs to know and why, in two or three short sentences or a short list. Markdown shows formatted. The options are not repeated here.

"How to write an item" in `add_item` gets one rule: "Put the question in `question`, keep the detail short, and give each option a note." Steering stays in the tool descriptions only, as in 0.2.1, so it reaches both seats.

### Saved items

A saved item gets two optional fields, `question` and `optionNotes`. An item saved before 0.3 has neither and shows without the question line and without notes. A hand-off copies both fields to the new session.

## Constraints

- The look uses only what a Claude Code pane can draw: Box borders (`round`), border and background colors, a hover background on a keyed Box, the `Markdown` element, `Text` styles and plain Buttons. One drawing holds at most 100,000 characters.
- The terminal has one font and one text size, so the title cannot be bigger.
- Colors come from theme keys where one fits, so a light theme stays readable. The mockup colors are for a dark theme.
- Text from the model passes the same checks as today before it is drawn. The Markdown element draws only `https:`, `http:` and `file:` links as links.
- The mod API can change between Claude Code releases. The builder checks every prop above against the current types.
- Below 144 columns, a pane that opens without a key press still waits, as today.

## Rollout

1. Release open-items 0.3.0 and update it on both seats.
2. Live check in a fresh session on each seat: a decision with a question and notes, a long action with a code block, a question item, and an item saved before 0.3 with single line breaks. Check the pane beside the chat and above the prompt.
3. Remove the throwaway test pane and stop the mockup server.

## Left to the builder

- The row count above the prompt: each box adds two border rows, and Markdown can add rows. An estimate that is too small is acceptable, because the body scrolls.
- The color of each kind.
- The tests for the new fields, the refusal for a length mismatch, the old-item case and the hand-off copy.

## Skipped

- **A new look for the list screen.** Add it when Asaf says the list is hard to read.
- **An "open in browser" button for one item.** Add it when an item needs a table wider than the pane.
- **A Herdr reading window.** Reconsider it when Asaf adopts the Herdr app.
