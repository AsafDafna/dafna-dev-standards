# open-items

A Claude Code mod that keeps the decisions, questions, actions and findings that need you in an Open items pane until you resolve them.

## Install

Add the marketplace once, with the `/plugin marketplace add` command in the [repository README](../../README.md#install). Then install the mod:

```
/plugin install open-items@dafna-dev-standards
```

## What it does

Claude adds an item with `add_item`. There are four kinds:

- **decision:** you pick one of 2 to 4 options. Each option has a short note on what it means for you.
- **question:** Claude needs your words, such as an error or a log.
- **action:** you do something Claude cannot, then press Done.
- **info:** something you should see. It asks nothing and sends Claude no response.

Items wait in the Open items pane. A status line under the prompt counts them. `/open-items` opens the pane. Claude keeps working while an item waits.

The pane has a list and an item screen. Open an item to read its thread, press an option or Done, or type a reply. A **Back** button returns to the list.

The item screen has a header box with the kind, the number, the age and the title. Under it is the ask line: one sentence that says what you must answer, do or know. Then come the detail and the thread. Each option of a decision is its own box with its note, and the recommended option shows `★ recommended`. Claude's text shows as formatted Markdown. Your replies, and every item saved before 0.3, show as plain text. In Claude's Markdown, a link written as `[text](target)` whose target is not `https:` shows as plain text. A target that starts with a scheme, such as `http:` or `file:`, shows as `text (target)`. A target with no scheme, such as a path, keeps its brackets and gains a space: `[text] (target)`. So does a `[` right after a letter, a digit or a closing bracket, as in code. An address written out in full stays as written, so its whole target shows.

To change the width of the pane, use these keys while the pane has the keyboard. They do not work inside the reply field. A click on the pane or `Ctrl+X Tab` gives the pane the keyboard, and `Esc` gives the keyboard back to the prompt.

- `Ctrl+X ←` makes the pane wider by 4 columns.
- `Ctrl+X →` makes it narrower by 4 columns.

The pane can take up to 45% of the window. You can also drag its edge. The width you set is kept, and it is one width for every plugin pane.

## Threads

Each item is a thread. A reply never closes the item. Claude answers inside the item with `reply_item`, and it can change the title, the ask, the options, the option notes or `done_when` in place. Claude closes an item with `close_item` when it is resolved, or withdrawn with a short note you can read. Info items stay until you press **Seen**.

## Later

**Later** moves an item to a Later section and tells Claude to go on without it. The item stays until you act on it, and you can still answer it from there.

## Hand-off

Before Claude starts a new session, it calls `handoff_items`. This marks every open and Later item and returns a short hand-off code. Claude puts the code in the prompt of the new session. The new session calls `take_items` with the code and gets the items, their threads and your unread answers. Without the code, no session takes the items.

When a session ends without a hand-off, the next session in the same folder offers the leftover items. **Take** moves them to the current session and tells Claude. **Dismiss** closes them, and Claude hears nothing.

Items are kept per session. A resumed session gets its items back. After `/clear`, the new conversation holds no items, and the pane at once offers the earlier conversation's open and Later items with **Take** and **Dismiss**. Saved sessions are deleted after 30 days.

## Answers

Each answer goes to Claude at once. While Claude works, the mod adds your answer to the running turn. When Claude is idle, the mod sends it as a prompt. Answers pressed within a second go as one message. A long answer goes through your own prompt box, which starts with `↳ Answer to #N:`.

For example, Claude adds an action and a decision while it works. You press Done on the first and an option on the second. Claude gets both as one message. A reply you type after Claude stops goes as its own prompt.

## The alert

When Claude adds a decision, question or action and you have been quiet for two minutes, the mod calls `$.ui.notify`. The alert reaches you through your own notification channel. If that channel is off, add a `Notification` hook in your settings with the matcher `plugin_notification`. The mod runs no host command.

## Side questions

A side question is a question you leave for the session while Claude works. A helper answers it in its own item, so Claude goes on with its task. Use it for a follow-up on something said in the session, a term you are not sure of, or a question that came up while you worked.

To ask one, type it in the **Side question** field at the end of the pane's list and press Enter. The field is always there, also when the pane holds nothing else. It is not drawn on the phone, so use `/side` there. You can also use the command:

- `/side <question>` asks a new side question.
- `/side #N <text>` follows up on side question #N.
- `/side` alone opens the pane on the field.

`/side` runs at once, also while Claude works and through Remote Control. A toast confirms the number, for example "Side question #12 sent". In the pane, you follow up in the item's **Follow up** field.

The mod starts a helper for each side question. One helper runs at a time, and the next side question waits for it. A helper has only Read, Grep and Glob: it can look and report, but it cannot change files, run commands or send messages. It runs on Opus at medium effort and keeps your CLAUDE.md. It is hidden from the main model, so only the mod starts it. Before it answers a question about the session's work, it searches the conversation file, and it says what it could not find. When it is not sure what you mean, it asks you one short question in the item. A follow-up wakes the same helper, with its memory. If a helper does not answer in 10 minutes, the mod stops it with Claude Code's `TaskStop` tool, says so in the item, and starts the next one. Where that call is refused, the helper runs until its limit of 20 turns ends it.

Side questions have their own section, SIDE QUESTIONS, after the other kinds. Each line shows one mark: "⋯ helper working", "? helper asks you", "● answered", "⋯ waiting for the session" or "⏸ held". Side questions are not counted in the status line or in the reminder line, and they set off no alert other than the usage alert below. A side question has no Later and no options. Only you close it, with **Done**, which also stops its helper if it still works. Claude's `close_item` refuses a side question, and `add_item` cannot make one.

**What Claude gets.** When the answer matters to Claude's work, the helper adds a one-line note for Claude. The note rides your next typed prompt and starts no turn. It tells Claude to ask you before it acts on the note. When only Claude can answer, the helper adds a one-line question for Claude instead. The question goes when Claude's current turn ends, even if background work still runs. After you pressed Esc, or in a live chat with no other agent or background work running, it starts no turn and rides your next typed prompt. It asks Claude to answer in the item and to change nothing because of the question. A note or a question reaches Claude as quoted data, marked as coming from the helper and not from you.

**Usage.** Where the account has a five-hour usage window, the mod reads it before it starts a helper or sends a question to Claude. At 70% it sends one alert per window, through the same path as the alert above. At 85% it holds side questions: a new one is saved, but no helper starts and no question goes to Claude. Held side questions run when a later reading is under 85%, or when the window resets. An account with no five-hour window gets no alert and no hold.

**Hand-off.** `handoff_items` and `take_items` move open side questions with their threads. A helper cannot move, so a helper that still works is stopped. In the new session, a question that had no answer yet goes to a new helper, and so does a follow-up. A new helper can still search the old conversation file. When a session ends with no hand-off, its open side questions are offered as leftovers, as other items are.

## What the mod adds to prompts

- **Your answers.** The message opens with "My response to an item you gave me (Open items):" ("My responses to items you gave me" for several). Then, for each item, it gives the number and title and what you did: Done, the option you chose, or your reply.
- **One reminder line on each prompt you type,** while an item is open: `Open items: N open, M unread answers; call list_items.`
- **One fixed line,** "I answered an item while you were finishing your reply; my answer is above.", when your answer arrived during Claude's final reply.
- **A side question's note,** on your next typed prompt: your question, then the helper's answer and its one-line reason, quoted and marked as the helper's words. It starts no turn.
- **A side question's question for Claude,** as a plugin prompt when Claude's turn ends, or on your next typed prompt in a live chat or after Esc: the helper's line, quoted and marked as the helper's words, and a request to answer in the item with `reply_item` and change nothing.
- **One fixed line when `/side` runs while Claude works:** "A helper takes this side question (Open items); the main session goes on." The command does not send your question to Claude.

The mod also reads every prompt you type. It turns a prompt that starts with `↳ Answer to #N:` into that item's answer. For a side question, it drops such a prompt, and the reason points to `/side #N`. It also counts your typed prompts for the live-chat gate. A live chat is one where your last two inputs were typed prompts, the last under five minutes ago. In a live chat with no agent or background work running, `add_item` refuses, so Claude asks in the chat. A slash command is not a typed prompt here. The mod's own helpers are not background work here, and a side question you send from the pane is not an input.

A helper's prompt holds a summary of the conversation: your first prompt, up to 2,000 characters, and the latest messages, up to 8,000 characters, text only, with no tool output. It also holds the side question's thread, the path of the conversation file (and of the earlier ones after a hand-off), and the path of the side-question log. In a session with no scratchpad, the log's text goes in the prompt in place of its path. A follow-up adds the conversation's messages since the helper's last answer. The helper reads anything else itself, with Read, Grep and Glob. Nothing else from the conversation, your files or your machine goes into a prompt. The mod adds nothing to the main session's system prompt. It reaches Claude through its tool descriptions, its tool results, the reminder line on each prompt, its answers, and the notes and questions of side questions.

## Data and tools

Items stay on your machine, in the session's state and in the plugin's own store. The mod uses no network of its own and starts no process. It registers one agent type, `open-items:helper`, and starts helpers of that type for side questions. Helpers run as subagents of the session, so their model calls count toward your usage. The mod writes one file, `open-items-side-questions.md` in the session's scratchpad: the log of the session's side questions, each with its latest answer. It answers only calls to its own six tools, `add_item`, `reply_item`, `close_item`, `list_items`, `handoff_items` and `take_items`, and its two commands, `/open-items` and `/side`. `/open-items` opens the pane at any time, also when it holds nothing and while Claude works. The mod also reads the result rows of Bash and Monitor calls and task-notification prompts, only so the live-chat gate knows whether background work runs.

`add_item` takes two fields besides the title and the detail. `ask` is one line under 150 characters. A new decision needs it, and for the other kinds it is optional. `option_notes` is one note for each option, in the same order. A note is one line under 120 characters and is not empty. A decision needs the notes, and the other kinds refuse them. An option stays under 60 characters. `reply_item` takes the same two fields. New options need new notes, and an ask can change but not be removed.

## License

MIT. Based on human-in-the-loop by Tzafrir Rehan (MIT).
