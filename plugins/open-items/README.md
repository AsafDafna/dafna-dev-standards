# open-items

A Claude Code mod that keeps the decisions, questions, actions and findings that need you in an Open items pane until you resolve them.

## Install

```
/plugin install open-items@dafna-dev-standards
```

## What it does

Claude adds an item with `add_item`. There are four kinds:

- **decision:** you pick one of 2 to 4 options.
- **question:** Claude needs your words, such as an error or a log.
- **action:** you do something Claude cannot, then press Done.
- **info:** something you should see. It asks nothing and sends Claude no response.

Items wait in the Open items pane, grouped by kind. A status line under the prompt counts them. `/open-items` opens the pane. Claude keeps working while an item waits.

Items are kept per session. A resumed session gets its items back, `/clear` starts with an empty pane, and saved sessions are deleted after 30 days.

Your answers reach Claude right away when it is idle, and after its turn when it is working. **Send now** sends them at once. A long answer goes through your own prompt box, which starts with `↳ Answer to #N:`.

## The alert

When Claude adds a decision, question or action and you have been quiet for two minutes, the mod calls `$.ui.notify`. The alert reaches you through your own notification channel. If that channel is off, add a `Notification` hook in your settings with the matcher `plugin_notification`. The mod runs no host command.

## What the mod puts in the prompts it submits

It submits a prompt in two cases:

- **Your responses to items.** It opens with "My response to an item you gave me (Open items):" ("My responses to items" for several). Then, for each item, it gives the number and title Claude gave it, and what you did: Done, the option you chose, your answer, or a rejection with your reason.
- **One fixed line:** "I answered an item while you were finishing your reply; my answer is above." It goes when your answer arrived during Claude's final reply.

The mod also reads every prompt you type. It turns a prompt that starts with `↳ Answer to #N:` into that item's response. While responses wait, it attaches them as a context block beside your next prompt.

Nothing else from the conversation, your files or your machine goes into a prompt. The mod also adds four lines to the system prompt that tell Claude about items, and a short list of open items at the start of a conversation or after a compaction.

## Data and tools

Items stay on your machine, in the session's state and in the plugin's own store. The mod uses no network and starts no process. It answers only calls to its own three tools: `add_item`, `list_items` and `withdraw_item`.

## License

MIT. Based on human-in-the-loop by Tzafrir Rehan (MIT).
