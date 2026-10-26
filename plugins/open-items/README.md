# open-items

A Claude Code mod that keeps the decisions, questions, actions and findings that need you in an Open items pane until you resolve them.

## Install

Add the marketplace once, with the `/plugin marketplace add` command in the [repository README](../../README.md#install). Then install the mod:

```
/plugin install open-items@dafna-dev-standards
```

## What it does

Claude adds an item with `add_item`. There are four kinds:

- **decision:** you pick one of 2 to 4 options.
- **question:** Claude needs your words, such as an error or a log.
- **action:** you do something Claude cannot, then press Done.
- **info:** something you should see. It asks nothing and sends Claude no response.

Items wait in the Open items pane. A status line under the prompt counts them. `/open-items` opens the pane. Claude keeps working while an item waits.

The pane has a list and an item screen. Open an item to read its thread, press an option or Done, or type a reply. A **Back** button returns to the list.

## Threads

Each item is a thread. A reply never closes the item. Claude answers inside the item with `reply_item`, and it can change the title, options or `done_when` in place. Claude closes an item with `close_item` when it is resolved, or withdrawn with a short note you can read. Info items stay until you press **Seen**.

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

## What the mod adds to prompts

- **Your answers.** The message opens with "My response to an item you gave me (Open items):" ("My responses to items you gave me" for several). Then, for each item, it gives the number and title and what you did: Done, the option you chose, or your reply.
- **One reminder line on each prompt you type,** while an item is open: `Open items: N open, M unread answers; call list_items.`
- **One fixed line,** "I answered an item while you were finishing your reply; my answer is above.", when your answer arrived during Claude's final reply.

The mod also reads every prompt you type. It turns a prompt that starts with `↳ Answer to #N:` into that item's answer. It also counts your typed prompts for the live-chat gate. A live chat is one where your last two inputs were typed prompts, the last under five minutes ago. In a live chat with no agent or background work running, `add_item` refuses, so Claude asks in the chat. A slash command is not a typed prompt here.

Nothing else from the conversation, your files or your machine goes into a prompt. The mod adds nothing to the system prompt. It reaches Claude through its tool descriptions, its tool results, the reminder line on each prompt and its answers.

## Data and tools

Items stay on your machine, in the session's state and in the plugin's own store. The mod uses no network and starts no process. It answers only calls to its own six tools: `add_item`, `reply_item`, `close_item`, `list_items`, `handoff_items` and `take_items`. It also reads the result rows of Bash and Monitor calls and task-notification prompts, only so the live-chat gate knows whether background work runs.

## License

MIT. Based on human-in-the-loop by Tzafrir Rehan (MIT).
