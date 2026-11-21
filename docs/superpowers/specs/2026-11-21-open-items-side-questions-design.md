# open-items 0.4: side questions from the user to the session

**Status:** draft for Nir's review.
**Origin:** Nir's draft "open-items v0.3: asks from the user to the session" (PR 22, 2026-11-07). Asaf reviewed it on 2026-11-21 and changed the helper and the routing. This document replaces the draft. Nir's decisions that still hold keep his name.
**Builds on:** the v0.2 spec (`2026-10-26-open-items-v0.2-design.md`) and the 0.3 spec (`2026-11-20-open-items-pane-look-design.md`, shipped as 0.3.0). Everything they decided stays unless "Changes to earlier decisions" below lists it.
**Evidence:** an independent review of the draft and a live probe of the helper, both on 2026-11-21. The probe results are in `docs/superpowers/notes/2026-11-21-open-items-side-questions-probes.md`.

## Intent

Nir, in Slack `#edut-app-developers` on 2026-11-07: "while a session works, I think of side questions or ideas for Claude. If I type them in the chat, they arrive mid-task and change what Claude is doing."

Nir named three kinds of side question:

1. A follow-up on something said in the session.
2. A term he is not sure of.
3. A question with only a weak tie to the session, which came up while he worked in it.

open-items today goes one way: every item starts from Claude's `add_item`. A side question goes the other way. The user leaves a question in the pane, and a helper answers it inside the item, without pulling the main session off its task.

| Path today | What goes wrong |
|---|---|
| Type the question in the chat | It reaches Claude mid-task and changes what Claude is doing. |
| `/btw` | It answers at once, but it cannot open files, and there is no follow-up. |
| Wait until the session is idle | A long background run keeps the session busy for hours. |

## Goals

1. The user can leave a side question at any moment, also while Claude works, without changing what the main session does.
2. A side question gets an answer within minutes, from a helper that knows the conversation and can read files.
3. The main session hears of a side question only when the answer matters to its work, and only when its current turn has ended.
4. Each side question is a thread. The user can follow up, also much later, and the answers stay in the item.

## Non-goals

- Side questions that change things. A helper looks and reports only. A change the user wants after an answer goes through the chat.
- Replacing `/btw`. It stays the quickest path for a one-line answer that needs no files.
- A keyboard shortcut that opens the pane. The mod API cannot add one.

## Anti-goals: a failure even if it works

- The main session is pulled off its task by a side question, by a helper, or by a helper's end.
- A helper, or the main session, changes files, commits or pushes because of a side question.
- Side questions quietly use up the usage quota.
- Side questions show in the count of what needs the user, or set off an alert other than the quota alert.

## Success criterion

Over the first two weeks after install, on both seats, side questions stop going into the chat while Claude works. Nir and Asaf judge this from their own use, with no formal count (Nir). After two weeks they decide whether to keep, change or remove side questions (Nir). The metrics below help them decide.

If the criterion does not hold, change the design before adding features.

## Decided by Nir (2026-11-07), still in force

1. A helper takes every side question first. If it is not sure whether the question is about the main session's work, it asks the user one short question in the item.
2. Look and report only, everywhere: no file edits, commits or pushes because of a side question.
3. When a helper's note changes the main session's work, the main session asks the user before it acts. It never acts on a note alone.
4. The pane has a field for a new side question. `/open-items` opens the pane at any time, also when it holds nothing and while Claude works.
5. A command is the way in on the phone. It works on every surface.
6. A side question ends only when the user presses **Done**. Until then the user can follow up.
7. Side questions have their own section in the pane. They are not counted under the prompt and set off no alert, apart from the quota alert. They move with a hand-off like other items.
8. Quota: the pane never shows what an answer cost. At 70% of the five-hour window the mod alerts the user. At 85% it holds side questions.
9. If the org seat stops the mod from starting a helper or from limiting its tools, the feature does not go ahead.
10. No Bash for helpers. They read and search files only, and say what they could not check.

Nir's routing table (decision 2 of his draft) is replaced by Asaf's decisions 5 and 6 below.

## Decided by Asaf (2026-11-21)

1. **The helper is not a copy of the conversation.** It starts with a short summary of the main conversation and searches the main conversation file when it needs more.
2. **It runs as an agent that the mod registers**, not as a separate hidden `claude` process. Asaf's concern was a main session that shows "working" while a helper rests. The probe showed that this does not happen. The status changes only while a helper answers: herdr shows "working", then marks the session "done". Asaf accepted that cost.
3. **One helper for each side question.** A follow-up on the same question wakes the same helper with its memory. The mod keeps a log of the session's side questions and answers, and each new helper gets it, so it can connect earlier answers.
4. **Model:** Opus at medium effort, to start.
5. **The helper always answers**, also when the question is about the main session's work and the main session is idle. It tries to find the best answer: it searches the main conversation before it answers, and says what it could not find.
6. **The helper can send the main session a question** when only the main session can answer. A message to the main session waits until the main session's current turn ends, not until all its background work ends.

## Claude's calls

These are Claude's, for Nir to check.

- **Names.** The kind is `side`, its label SIDE QUESTION, its section SIDE QUESTIONS, and the command `/side`. 0.3.0 already uses "ask" for the one-line field of every item, and "question" is a kind, so Nir's `ask` would make the tool text ambiguous.
- **The summary.** The mod builds it with no model call: the last user and assistant messages from `$.session.messages()`, text only, no tool output, cut to a set size. The helper searches the conversation file for anything older. (Asaf asked Claude to pick.)
- **One helper at a time per session.** The next side question waits. This keeps quota use bounded.
- **A 10-minute limit.** After 10 minutes the mod stops the helper with `TaskStop` through `$.tool.call`, writes "The helper did not answer in 10 minutes" in the item, and starts the next one. Nir's draft could only stop waiting; the probe showed that the stop works.
- **A follow-up after a pause** also gets the main session's messages since the helper's last answer, so its picture is current.
- **Messages to the main session** (a note or a question) go as a plugin message, never as `asUser`. Consent words come only from the user (v0.2 ruling R43). In a live chat (v0.2's test) a message starts no turn: it rides the user's next typed prompt. If the main turn ended because the user pressed Esc, a message does not start a turn either (ruling R22): it rides the next typed prompt.
- **Look-only in the main session.** A turn that a message to main starts is look-only. A `tool.check` hook denies, in that turn only, every call the engine does not mark `isReadOnly`, every `Bash` and every `Agent` call. It fails closed: an error in the hook denies. The deny ends the moment a prompt the user typed joins that turn. This is a security gate: it gets an adversarial review and a harness test before install. Helpers need no such hook: their tool list already refuses every other tool.
- **A go-ahead is a normal decision item.** When a note changes its work, the main session adds a decision with `add_item` (with `ask` and option notes) and waits for the press. Nir's draft added options to the ask itself, which 0.3.0's `reply_item` refuses, and whose consent path is untested. A decision item uses the tested path.
- **Follow-ups on the phone** use `/side #N <text>`. The `↳ Answer to #N:` bridge stays unchanged, because a bridge change is a security gate change.
- **Each side question records the main conversation file** where it was asked, so a helper after a hand-off can still search it.
- **The helper keeps the user's CLAUDE.md**, so the user's reply rules apply to its answers.
- **Metrics are trimmed** to what the two-week decision needs. The draft's "unused for 14 days" item is dropped: the two-week decision is a date Nir and Asaf already know.

## Changes to earlier decisions

| Earlier decision | Change |
|---|---|
| v0.2 Decided 5: an item closes on an option, Done, or Claude's `close_item` | A side question closes only on Done. `close_item` refuses it. |
| v0.2 Decided 6: each reply goes to Claude at once | A side question's message goes to a helper, which may wait behind another helper or a quota hold. |
| v0.2 Decided 8: every item has Later | A side question has no Later. |
| v0.2 Decided 9: Claude resolves, records or hands off every item before the session ends | Side questions are left out. They are the user's: they move with a hand-off or wait as leftovers. |
| v0.2: a closed item keeps only its number, title and state, for 7 days | A closed side question keeps its thread and metrics for 30 days: the log and the two-week count read them. |
| v0.1 and ruling R11: the mod hooks only its own tools | A `tool.check` deny on Claude Code's tools in main's message turns. The README line "the mod hooks no tool of Claude Code's own" changes. |
| 0.3.0 `add_item` kinds | A fifth kind, `side`, that only the user creates. `add_item` refuses it. |

## The design

### The side question

An item of kind `side`. Its thread starts with the user's question, so `thread[0]` comes from the user. Each Claude message records its author: the helper or the main session.

It also records:

- the main conversation file it belongs to;
- its helper's `agentId`, once a helper ran;
- whether a message to main waits;
- the metrics below.

States: `open` until the user presses Done, then `resolved`. `handing-off` and `moved` as in v0.2. No `later`.

### The helper

The mod registers one agent type at session start with `$.agent.register`:

- `tools: ["Read", "Grep", "Glob"]`, so every other tool is refused by the engine (probe: `Write`, `Bash`, `Agent` and an MCP tool were refused);
- `model: "opus"`, `effort: "medium"`;
- its own system prompt (below), plus the user's CLAUDE.md;
- hidden from the main model with `agent.offer`, so only the mod starts it.

For each side question the mod starts a helper with `$.agent.spawn`. A follow-up resumes the same helper with `$.session.send({ to: { agentId } })`. The mod's `agent.report` hook takes the helper's report with `{ consumed }`, so the main session gets no turn, and writes `e.text` into the thread.

The helper's prompt holds:

- the summary of the main conversation;
- the path of the main conversation file;
- the path of the session's log file (below);
- the side question's thread;
- the steering below.

**The log.** The mod keeps a file in the session's scratchpad with each side question of the session: its number, the question, and the latest answer. A new helper reads it when an earlier question may connect.

**What the helper is told:**

- You answer a side question the user left for this session. The main session goes on without you.
- Search the main conversation file before you answer a question about the session's work. Look for every term that may hold the answer. Say what you could not find.
- If you are not sure whether the question is about the main session's work, ask the user one short question and stop.
- Look and report only. You have no shell. Never edit files, commit, push or send messages.
- Put the answer first. Keep it short.
- When your answer matters to the main session's work, add a one-line note for the main session: what it should know, and why. When only the main session can answer, add a one-line question for it instead.

### How a side question flows

1. The user submits the field, or runs `/side <question>`. The mod adds the item and starts a helper, or queues the question behind the running helper.
2. The helper answers in the item, or asks the user back. It may add a note or a question for the main session.
3. The mod sends that note or question to the main session when the main session's current turn ends.
4. The user reads the answer, follows up (back to step 1, same helper), or presses Done.

### What the main session gets

- **A note:** "Side question #N (Open items): <question>. The helper answered: <answer>. Why it may matter: <line>. If it changes your work, add a decision with `add_item` and wait for the user's press before you act. If not, do nothing."
- **A question:** "Side question #N (Open items): the helper needs you: <question>. Answer in the item with `reply_item`. Look and report only."
- Both are plugin messages and start a look-only turn. Neither counts as a typed prompt for the live-chat gate.
- **Tool text.** `reply_item` gets one line on answering a side question. `close_item` refuses a side question: "Only the user closes a side question (Done)." `add_item`'s session-end rule leaves side questions out. `list_items` shows the main session a side question only while a question waits for it; `show: all` lists every side question. The reminder line on each prompt does not count side questions.

### What the user sees

The list screen gets a SIDE QUESTIONS section after the others, and the field for a new side question is always drawn, also when the pane holds nothing else. Each list line shows one mark: "⋯ helper working", "⋯ waiting for the session", "? helper asks you", "● answered" (unread), or "⏸ held". The header counts leave side questions out.

The item screen is 0.3.0's Cards screen. The header box shows SIDE QUESTION and the number. The detail is the user's question as plain text. Each thread message has its head ("You", "Helper" or "Claude") and its age. Helper and Claude text is Markdown under 0.3.0's link rule. The buttons are Done and the follow-up field. No Later, and no options.

A toast confirms a new side question and its number ("Side question #12 sent"). On the phone it is the only sign that `/side` worked.

### Opening and input

- `/open-items` is registered `immediate: true`. It opens the pane also when nothing is in it.
- The new-question field: Enter submits. v0.2's secret guard and length limit apply.
- `/side <question>` is registered `immediate: true`, with an argument hint. `/side #N <text>` follows up on side question #N. `/side` with no text opens the pane on the field.

### Hand-off and session end

- `handoff_items` and `take_items` move open side questions with their threads, as other items.
- A helper cannot move to another session. A follow-up in the new session starts a new helper with the thread, the log, and the old and new conversation files.
- A helper that still runs at a hand-off is stopped. Its question gets a new helper in the new session.
- A session that ends with open side questions leaves them as leftovers. The next session in the folder offers them with Take.

### Quota guard

The mod reads the five-hour window from `$.session.usage().rateLimits` before it starts a helper or sends a message to the main session.

- **70% or more:** one alert per window, through v0.2's alert path: "Five-hour usage at 72%. Side questions pause at 85%." The question still runs.
- **85% or more:** no helper starts and no message goes to the main session. New side questions are still saved. A held one shows "⏸ held: usage at 86%, resumes at 20:49". It runs when a later reading is under 85%, or when the window's reset time passes. (`rateLimits` is the last response's reading, so a quiet session would never see the drop.)
- **No window to read** (an account with no subscription): no alert and no hold.

### Metrics

Each side question keeps, for 30 days: when the user asked; when the first answer came; whether the helper asked back; the helper's tokens; whether a note or a question went to the main session; and the main session's tokens in that turn.

## Constraints

Claude Code 2.1.330 mod API, checked against its types and the probe:

- `$.agent.register({ name, description, prompt, tools, model, effort })` defines an agent type; a call to a tool outside `tools` is refused.
- `$.agent.spawn` starts it in the background. With `{ consumed }` from `agent.report`, the main session gets no turn, and the answer is `agent.report`'s `e.text`.
- `$.session.send({ to: { agentId } })` resumes a finished helper, also after it left `$.agent.list()`.
- `TaskStop` through `$.tool.call` stops a helper. Where `cc-plugin-sec-default` is seated (the org seat), a person's mod gets `{ deny }` on `$.tool.call` until that call is allowed.
- `$.session.messages()` returns the conversation, one entry per user or assistant message. `$.session.info()` returns the transcript path and the scratchpad.
- A mod helper turns on the main pane's title spinner while it runs, and no mod API reaches the title.
- A plugin prompt sent while the main turn runs starts its own turn right after that turn ends, also while background work runs.
- `$.session.usage().rateLimits` is the last response's reading, and empty on an account with no subscription.
- v0.2's constraints stay: `Input` is not drawn on mobile; Esc belongs to the engine; the leak gate scans `plugins/`.

## Rollout

**Who builds and owns it:** open, for Asaf and Nir.

0. **Probes before the build.**
   1. *Org seat, first:* the mod can register the helper type, start a helper, and resume it; the tool list refuses `Write`, `Bash`, `Agent` and an MCP tool; `TaskStop` through `$.tool.call` is allowed; and main's look-only deny holds with `cc-plugin-sec-default` seated. Nir's earlier probe saw sec-default once pass an event on past a probe's `tool.check` hook: find which calls it passes on. If the helper or its tool limit fails, the feature stops here (Nir 9). If only the deny fails, a message to main rides the next typed prompt instead of starting a turn.
   2. *Cost:* the change in the five-hour window per helper run on the org seat, Opus at medium effort, with a warm and a cold cache. Nir and Asaf set a limit from it before the build.
   3. *Permission modes:* the helper's `Read` of the main conversation file in default mode, which may raise a dialog while main works.
   4. *Phone:* whether `/side` sent through Remote Control runs at once while Claude works.
   5. *A late follow-up:* a resume after 30 minutes keeps the helper's memory.
1. PR to this repo: the plugin at 0.4.0, tests, CHANGELOG, README (side questions, `/side`, the tool hook).
2. Personal config: the session-end rule in `~/.claude/CLAUDE.md` and the `/wrap-up` skill leave side questions out.
3. Update on both seats after merge.
4. Smoke test in a fresh session. While a background batch runs, the user leaves a term question, a question about the batch's work, and a vague question. The first gets an answer and nothing else; the second gets an answer and, after the turn ends, a note to the main session; the third gets a question back.

Test cases:

- not about main's work: the helper answers; the main session hears nothing.
- about main's work, main busy: the helper answers; the note reaches main when its turn ends.
- about main's work, main idle: the helper answers after it searched the main conversation.
- only main can answer: the helper's question reaches main at turn end; main answers in the item; `Edit` is denied in that turn.
- not sure: the helper asks back; the reply wakes the same helper.
- a follow-up after a pause gets main's messages since the last answer.
- a new helper reads an earlier side question from the log.
- two side questions at once: the second waits for the first helper.
- a helper silent for 10 minutes is stopped; the item says so; the next one starts.
- a note changes main's work: main adds a decision item; the press reaches main and `Edit` is allowed in that turn.
- the user types during a message turn: from then on, `Edit` is allowed in that turn.
- a message waits during a live chat, or after Esc: it starts no turn, and rides the user's next typed prompt.
- usage at 72%: one alert per window. At 86%: the question is saved and held, and runs after the reset time.
- Done closes a side question; `close_item` and `add_item` refuse the kind.
- a helper's `Edit`, `Bash` and `Agent` calls are refused; its `Read` and `Grep` are not.
- a hook error in main's message turn denies the call.
- hand-off: an open side question moves; a follow-up in the new session starts a new helper that can search the old conversation file.

## Left to the builder

- The wording of every prompt and toast, and the size of the summary.
- How the helper marks a note or a question for the main session in its answer.
- The layout of the metric record and of the log file.
- How the list draws SIDE QUESTIONS when the pane is shorter than the list.

## Skipped

- A keyboard shortcut: add when the mod API gets one.
- Read-only shell commands for helpers: add if helpers often say they could not check something.
- Side questions that change code: add only if Nir and Asaf ask for it after the two-week count.
- Rex: it reads status in its own way; check how it shows a helper if they move to Rex.
