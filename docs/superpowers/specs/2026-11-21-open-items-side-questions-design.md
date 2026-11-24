# open-items 0.4: side questions from the user to the session

**Status:** approved. Nir approved the design face to face on 2026-11-24. Asaf and Claude own the build (Asaf, 2026-11-24).
**Origin:** Nir's draft "open-items v0.3: asks from the user to the session" (PR 22, 2026-11-07). Asaf reviewed it on 2026-11-21 and changed the helper and the routing. This document replaces the draft. Nir's decisions that still hold keep his name.
**Builds on:** the v0.2 spec (`2026-10-26-open-items-v0.2-design.md`) and the 0.3 spec (`2026-11-20-open-items-pane-look-design.md`, shipped as 0.3.0). Everything they decided stays unless "Changes to earlier decisions" below lists it.
**Evidence:** an independent review of the draft and a live probe of the helper, both on 2026-11-21, and the probes of Rollout step 0 on 2026-11-24. The results of both probes are in `docs/superpowers/notes/2026-11-21-open-items-side-questions-probes.md`.
**Dropped from the draft:** the helper as a copy of the conversation, the main session answering a side question itself, the routing table, the metrics, and the "unused for 14 days" item.

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
3. The main session hears of a side question only when the answer matters to its work or only it can answer. A note reaches it with the user's next typed prompt; a question from the helper reaches it when its current turn has ended.
4. Each side question is a thread. The user can follow up, also much later, and the answers stay in the item.

## Non-goals

- Side questions that change things. A helper looks and reports only. A change the user wants after an answer goes through the chat.
- Replacing `/btw`. It stays the quickest path for a one-line answer that needs no files.
- A keyboard shortcut that opens the pane. The mod API cannot add one.

## Anti-goals: a failure even if it works

- The main session is pulled off its task by a side question, by a helper, or by a helper's end.
- A helper, or the main session, changes files, commits or pushes because of a side question.
- Side questions quietly use up the usage quota.
- Side questions show in the count of what needs the user, or set off an alert other than the quota alert. One accepted exception (Asaf): herdr shows the main session as working while a helper answers, and marks it done after.

## Success criterion

Over the first two weeks after install, on both seats, side questions stop going into the chat while Claude works. Nir and Asaf judge this from their own use, with no formal count (Nir). After two weeks they decide whether to keep, change or remove side questions (Nir).

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

Nir's routing table (decision 2 of his draft) is replaced by Asaf's decisions 5 to 7 below.

## Decided by Asaf (2026-11-21)

1. **The helper is not a copy of the conversation.** It starts with a short summary of the main conversation and searches the main conversation file when it needs more.
2. **It runs as an agent that the mod registers**, not as a separate hidden `claude` process. Asaf's concern was a main session that shows "working" while a helper rests. The probe showed that this does not happen. The status changes only while a helper answers: herdr shows "working", then marks the session "done". Asaf accepted that cost.
3. **One helper for each side question.** A follow-up on the same question wakes the same helper with its memory. The mod keeps a log of the session's side questions and answers, and each new helper gets its path, so it can connect earlier answers.
4. **Model:** Opus at medium effort, to start.
5. **The helper always answers**, also when the question is about the main session's work and the main session is idle. It tries to find the best answer: it searches the main conversation before it answers, and says what it could not find.
6. **The helper can send the main session a question** when only the main session can answer. The question waits until the main session's current turn ends, not until all its background work ends.
7. **A note waits for the user.** A note that may change the main session's work reaches the main session with the user's next typed prompt, never on its own. A question from the helper still goes when the main session's turn ends, and nothing blocks the main session in that turn: it is told to look and report only. (Asaf chose this after the review found that a block in that turn would also stop the main session's own work when its background agents report in the same turn.)
8. **Each speaker in a thread is easy to tell apart**, in every kind of item, not only side questions. Asaf found that a short reply such as "ok" gets lost between long messages: 0.3.0 draws each head as one dim line, right under the message before it. So a blank row separates the messages, and the name in each head is bold in its own theme color: "You" in `ide` (blue), "Claude" in `claude` (orange), "Helper" in `bashBorder` (pink). (Asaf changed Helper from `planMode` on 2026-11-25: it drew almost the same blue as "You".) The age stays dim and the message text keeps the normal text color. None of the three is a kind color.
9. **A reply shows that it went out**, in every kind of item. Asaf found that a reply typed in the pane while the main session is busy shows no sign that it was sent. So a dim line under the user's newest message tracks it: "Waiting to send" while it waits (a quota hold, a store failure), "Sent · Claude reads it at its next step" once the mod hands it to a running turn, and "✓ Claude has it" once a step of that turn read it or it went in as a prompt. The mod already knows both moments: the hand-over, and the next `turn.step`. In a side question the line names the helper.

## Decided by Asaf (2026-11-24), after the step 0 probes

1. **No cost limit beyond the quota guard and the 10-minute helper limit.** One side question cost about 0.05% of the org seat's five-hour window (probe 0.2).
2. **The helper is told never to call `advisor`, and a rare call is accepted.** Where the advisor is on (the personal seat), the helper calls it when a question asks for it, and no mod API withholds a server tool (probe 0.1).
3. **Asaf and Claude own the build.** It does not wait for Nir's review.

## Claude's calls

These are Claude's, for Nir to check.

- **Names.** The kind is `side`, its label SIDE QUESTION, its section SIDE QUESTIONS, and the command `/side`. 0.3.0 already uses "ask" for the one-line field of every item, and "question" is a kind, so Nir's `ask` would make the tool text ambiguous.
- **The summary.** The mod builds it with no model call: the session's first user prompt and the last user and assistant messages from `$.session.messages()`, text only, no tool output, cut to a set size. The helper searches the conversation file for anything older. (Asaf asked Claude to pick.)
- **One helper at a time per session, and a 10-minute limit** (from Nir's draft; Asaf: "maybe ok"). The next side question waits. Every helper run is also bounded by `maxTurns` in its registration, so it always ends. At 10 minutes the mod stops the helper with `TaskStop` through `$.tool.call` where probe 0.1 shows that call is allowed, writes "The helper did not answer in 10 minutes" in the item, and starts the next one. Where it is not allowed, the mod waits for the bounded end.
- **Every follow-up** also gets the main session's messages since the helper's last answer, so its picture is current.
- **A failed resume** (after `/clear` or a restart the helper is gone) starts a new helper with the thread, the log and the conversation file.
- **Messages to the main session never use the user's voice.** A note rides the user's next typed prompt as `prompt.submit` context, the channel v0.2 uses on both seats. A question goes as a plugin message, never as `asUser`. Consent words come only from the user (v0.2 ruling R43). In a live chat (v0.2's test) a question starts no turn either: it rides the user's next typed prompt. The mod's own helpers and a side question sent from the pane do not count as background work or as a press for that test. If the main turn ended because the user pressed Esc, a question does not start a turn (ruling R22): it rides the next typed prompt.
- **The main session's answer to a helper's question** goes into the thread for the user. It does not wake the helper; the user can follow up.
- **A go-ahead is a normal decision item.** When a note changes its work, the main session adds a decision with `add_item` (with `ask` and option notes) and waits for the press. In a live chat, where `add_item` refuses (v0.2 Decided 12), it asks in the chat. Nir's draft added options to the ask itself, which 0.3.0's `reply_item` refuses, and whose consent path is untested. A decision item uses the tested path.
- **Follow-ups on the phone** use `/side #N <text>`. The `↳ Answer to #N:` bridge leaves side questions out: the mod drops such a prompt from the main session, and the drop's reason points to `/side #N`. The bridge today takes any open item that is not info, so without this a typed answer would reach the main session as the user's answer. This only narrows the bridge, but it is still a change to a security gate, so it gets a security review before install.
- **Each side question records the main conversation file** where it was asked, so a helper after a hand-off can still search it.
- **The helper keeps the user's CLAUDE.md**, and its prompt says that it writes for the user and follows the user's reply rules there.
- **The draft's "unused for 14 days" item and its metrics are dropped.** Nir's criterion is judged with no formal count, and nothing would read the metrics.
- **Proposal to Nir on his decision 1:** ask the user back only when the question is still unclear after the helper searched the conversation. His trigger ("not sure whether it is about the main session's work") chose who answers in his routing; now the helper always answers.

## Changes to earlier decisions

Each row changes a decision of Asaf's. Asaf approved them on 2026-11-21.

| Earlier decision | Change |
|---|---|
| v0.2 Decided 5: an item closes on an option, Done, or Claude's `close_item` | A side question closes only on Done. `close_item` refuses it. |
| v0.2 Decided 6: each reply goes to Claude at once | A side question's message goes to a helper, which may wait behind another helper or a quota hold. |
| v0.2 Decided 8: every item has Later | A side question has no Later. |
| v0.2 Decided 9: Claude resolves, records or hands off every item before the session ends | Side questions are left out. They are the user's: they move with a hand-off or wait as leftovers. |
| v0.2 reply alert: a Claude reply in a thread alerts like a new item | A reply in a side question, from the helper or the main session, sets off no alert (Nir 7). |
| v0.2 composer bridge: `↳ Answer to #N:` answers any open item but info | It leaves side questions out (above). |
| README: "Nothing else from the conversation ... goes into a prompt"; "The mod uses no network and starts no process. It answers only calls to its own six tools" | A helper's prompt carries a summary of the conversation, and the mod starts helpers. The README says so. |
| 0.3.0 `add_item` kinds | A fifth kind, `side`, that only the user creates. `add_item` refuses it. |
| 0.3.0 Cards thread: each head is one dim line, with no gap between messages | A blank row between messages, and each name bold in its own color (Asaf 8). |
| 0.3.0 item screen: no sign that a reply was sent | A dim line under the user's newest message: waiting, sent, or Claude has it (Asaf 9). |

## The design

### The side question

An item of kind `side`. Its thread starts with the user's question, so `thread[0]` comes from the user. Each Claude message records its author: the helper or the main session.

It also records:

- the main conversation file it belongs to;
- its helper's `agentId`, once a helper ran;
- whether a message to main waits.

Its title is the question, cut at 80 characters with "…". States: `open` until the user presses Done, then `resolved`. `handing-off` and `moved` as in v0.2. No `later`.

### The helper

The mod registers one agent type at session start with `$.agent.register`:

- `tools: ["Read", "Grep", "Glob"]`, so other tools are refused by the engine (probes: `Write`, `Bash`, `Agent`, an MCP tool and `SubagentHandback` were refused when the mod called them as the helper with `$.agent.call`, also after a resume, on both seats). The helper's own run ends with `SubagentHandback`, which the engine answers "Report received"; the mod's `agent.report` hook consumes that report (probes note, correction of 2026-11-24). `advisor` is a server tool, which neither `tools` nor `disallowedTools` withholds: where the advisor is on, the helper can call it, so its prompt forbids it (Asaf 2026-11-24, 2);
- `permissionMode: "dontAsk"`, so a read outside the paths the engine allows (the main conversation file and the scratchpad are allowed) is refused with no dialog on the user's screen, and the helper says it could not read it (probe 0.3);
- `model: "opus"`, `effort: "medium"`, and a `maxTurns` bound;
- its own system prompt (below), plus the user's CLAUDE.md;
- hidden from the main model with `agent.offer`, so only the mod starts it.

For each side question the mod starts a helper with `$.agent.spawn`. A follow-up resumes the same helper with `$.session.send({ to: { agentId } })`. The mod's `agent.report` hook takes the helper's report with `{ consumed }`, so the main session gets no turn, and writes `e.text` into the thread. If the spawn is refused, the item says "The helper could not start: <reason>", and a follow-up tries again.

The helper's prompt holds:

- the summary of the main conversation;
- the path of the main conversation file;
- the path of the session's log file (below);
- the side question's thread;
- the steering below.

**The log.** The mod keeps a file in the session's scratchpad with each side question of the session: its number, the question, and the latest answer. A new helper reads it when an earlier question may connect. After a take, the new session's log gets the side questions it took. A session with no scratchpad puts the log in the helper's prompt.

**What the helper is told:**

- You answer a side question the user left for this session. The main session goes on without you. You write for the user: follow the user's reply rules in CLAUDE.md.
- Search the main conversation file before you answer a question about the session's work. Look for every term that may hold the answer. Say what you could not find.
- If you are not sure whether the question is about the main session's work, ask the user one short question and stop.
- Look and report only. You have no shell. Never edit files, commit, push or send messages. Never call the advisor.
- Put the answer first. Keep it short.
- When your answer matters to the main session's work, add a one-line note for the main session: what it should know, and why. When only the main session can answer, add a one-line question for it instead.

### How a side question flows

1. The user submits the field, or runs `/side <question>`. The mod adds the item and starts a helper, or queues the question behind the running helper.
2. The helper answers in the item, or asks the user back. It may add a note or a question for the main session.
3. The mod adds a note to the user's next typed prompt to the main session, and sends a question when the main session's current turn ends.
4. The user reads the answer, follows up (back to step 1, same helper), or presses Done.

### What the main session gets

- **A note**, as context on the user's next typed prompt: "Side question #N (Open items): <question>. The helper answered: <answer>. Why it may matter: <line>. If it changes your work, ask the user before you act: add a decision with `add_item`, or in a live chat ask in the chat." It starts no turn.
- **A question**, as a plugin message when the main turn ends: "Side question #N (Open items): the helper needs you: <question>. Answer in the item with `reply_item`. Look and report only: change nothing because of this question." It starts a turn (not in a live chat or after Esc; see Claude's calls), and does not count as a typed prompt for the live-chat gate.
- **Tool text.** `reply_item` gets one line on answering a side question. `close_item` refuses a side question: "Only the user closes a side question (Done)." `add_item`'s session-end rule leaves side questions out. `list_items` shows the main session a side question only while a question waits for it; `show: all` lists every side question. The reminder line on each prompt does not count side questions.

### What the user sees

The list screen gets a SIDE QUESTIONS section after the others, and the field for a new side question is always drawn, also when the pane holds nothing else. Each list line shows one mark: "⋯ helper working", "⋯ waiting for the session" (a question for it waits), "? helper asks you", "● answered" (unread), or "⏸ held". The header counts leave side questions out.

The item screen is 0.3.0's Cards screen. The header box shows SIDE QUESTION and the number. The detail is the user's question as plain text. Each thread message has its head ("You", "Helper" or "Claude") and its age, drawn as Asaf 8 says. Helper and Claude text is Markdown under 0.3.0's link rule. The buttons are Done and the follow-up field. No Later, and no options.

A toast confirms a new side question and its number ("Side question #12 sent"). On the phone it is the only sign that `/side` worked. The pane does not fit the phone, so the user reads the answer later in the pane.

### Opening and input

- `/open-items` is registered `immediate: true`. It opens the pane also when nothing is in it.
- The new-question field: Enter submits. v0.2's secret guard and length limit apply.
- `/side <question>` is registered `immediate: true`, with an argument hint. `/side #N <text>` follows up on side question #N. `/side` with no text opens the pane on the field.

### Hand-off and session end

- `handoff_items` and `take_items` move open side questions with their threads, as other items.
- A helper cannot move to another session. A follow-up in the new session starts a new helper with the thread, the log, and the old and new conversation files.
- A helper that still runs at a hand-off is stopped where `TaskStop` is allowed (probe 0.1). Its question gets a new helper in the new session.
- A session that ends with open side questions leaves them as leftovers. The next session in the folder offers them with Take.

### Quota guard

The mod reads the five-hour window from `$.session.usage().rateLimits` before it starts a helper or sends a question to the main session.

- **70% or more:** one alert per window, through v0.2's alert path: "Five-hour usage at 72%. Side questions pause at 85%." The question still runs.
- **85% or more:** no helper starts and no question goes to the main session on its own. A note, and a question that waits, still ride the user's next typed prompt; neither starts a turn of its own. New side questions are still saved. A held one shows "⏸ held" on its list line, and its item screen's sent line gives the usage and the reset time: "Waiting to send · usage at 86%, resumes at 20:49". It runs when a later reading is under 85%, or when the window's reset time passes. (`rateLimits` is the last response's reading, so a quiet session would never see the drop.)
- **No window to read** (an account with no subscription, or no reading yet): no alert and no hold. The personal seat has no five-hour window (probe 0.6: `rateLimits` lists only `seven_day`), so side questions there get no alert and no hold.

## Constraints

Claude Code 2.1.330 mod API, checked against its types and the probes (step 0 ran on 2.1.331):

- `$.agent.register({ name, description, prompt, tools, disallowedTools, model, effort, maxTurns, permissionMode })` defines an agent type; a call to a tool outside `tools` is refused (probes: `Write`, `Bash`, `Agent`, an MCP tool and `SubagentHandback`, called as the helper with `$.agent.call`). The helper itself ends its run with `SubagentHandback`, which the mod's `agent.report` hook consumes. A server tool such as `advisor` is not: on the org seat it is listed as a deferred tool that the helper cannot load; on the personal seat (`advisorModel` set) the helper called it when asked. `turn.complete` usage leaves out the advisor's tokens.
- A helper's prompt cache lasts 5 minutes (main's lasts an hour), so a follow-up after a pause re-reads its conversation at full price (probe 0.5: a resume after 31 minutes kept its memory).
- `$.agent.spawn` starts it in the background. With `{ consumed }` from `agent.report`, the main session gets no turn, and the answer is `agent.report`'s `e.text`.
- `$.session.send({ to: { agentId } })` resumes a finished helper, also after it left `$.agent.list()`. It can answer that it was not delivered.
- `TaskStop` through `$.tool.call` stops a helper. The types say a person's mod gets `{ deny }` on `$.tool.call` where `cc-plugin-sec-default` is seated (the org seat) until that call is allowed; probe 0.1 found it allowed there on 2.1.331. The mod keeps the fallback (wait for the bounded end) for a deny.
- `$.session.messages()` returns the conversation, one entry per user or assistant message. `$.session.info()` returns the transcript path and the scratchpad, which a session may not have.
- A mod helper turns on the main pane's title spinner while it runs, and no mod API reaches the title.
- A plugin prompt sent while the main turn runs starts its own turn right after that turn ends, also while background work runs.
- `$.session.usage().rateLimits` is the last response's reading, and empty on an account with no subscription. The org seat lists `five_hour` and `seven_day`; the personal seat only `seven_day`.
- A mod command registered `immediate: true` runs at once while the main turn runs, also when it is sent from the phone through Remote Control (probe 0.4).
- v0.2's constraints stay: `Input` is not drawn on mobile; Esc belongs to the engine; the leak gate scans `plugins/`.

## Rollout

**Who builds and owns it:** Asaf and Claude (Asaf, 2026-11-24).

0. **Probes before the build.** Done on 2026-11-24, all passed or settled; results in the probes note. Probe 0.1 passed on the org seat, so the feature goes ahead.
   1. *Org seat, first:* the mod can register the helper type, start a helper, and resume it; a consumed report starts no main turn; the tool list refuses `Write`, `Bash`, `Agent` and an MCP tool, also after a resume; whether `advisor` or `SubagentHandback` is callable; `$.session.messages()` and `$.session.info()` answer; and `TaskStop` through `$.tool.call` is allowed. If the helper or its tool limit fails, the feature stops here (Nir 9). If the consumed report fails, it stops too (first anti-goal).
   2. *Cost:* on the org seat, the change in the five-hour window for one helper run in this spec's setup (Opus at medium effort, CLAUDE.md kept, real searches of a long conversation file), with a warm and a cold cache, and for one main turn that a helper's question starts. Nir and Asaf set a limit from it before the build.
   3. *Permission modes:* the helper's `Read` of the main conversation file in default mode, which may raise a dialog while main works. If it does, the helper answers from the summary and says it could not search, and Nir and Asaf decide before the build whether that is enough.
   4. *Phone:* whether `/side` sent through Remote Control runs at once while Claude works.
   5. *A late follow-up:* a resume after 30 minutes keeps the helper's memory.
   6. *Personal seat:* `rateLimits` has a five-hour window there.
1. PR to this repo: the plugin at 0.4.0, tests, CHANGELOG, README (side questions, `/side`, the helpers, the conversation summary in a helper's prompt). CI moves its Claude Code pin from 2.1.310 to 2.1.331, the version the probes ran on (the design needs 2.1.330 or later).
2. Personal config: the session-end rule in `~/.claude/CLAUDE.md` and the `/wrap-up` skill leave side questions out.
3. Update both seats after merge, before the first side question: a session still on 0.3.0 drops a saved item of an unknown kind, so a take there would lose side questions.
4. Smoke test in a fresh session. While a background batch runs, the user leaves a term question, a question about the batch's work, and a vague question. The first gets an answer and nothing else; the second gets an answer, and a note that reaches the main session with the user's next typed prompt; the third gets a question back.

Test cases:

- not about main's work: the helper answers; the main session hears nothing.
- about main's work, main busy: the helper answers; the note reaches main only with the user's next typed prompt, and starts no turn.
- about main's work, main idle: the helper answers after it searched the main conversation.
- only main can answer: the helper's question reaches main when its turn ends, also while background agents run; main answers in the item.
- not sure: the helper asks back; the reply wakes the same helper.
- a follow-up gets main's messages since the last answer.
- a follow-up after `/clear` (the helper is gone) starts a new helper with the thread and the log.
- a new helper reads an earlier side question from the log.
- `↳ Answer to #N:` on a side question reaches neither the main session nor Done; the drop's reason points to `/side #N`.
- two typed prompts, then a side question from the pane field, then a helper's question: still a live chat, so no turn starts.
- a refused spawn: the item says so; a follow-up tries again.
- two side questions at once: the second waits for the first helper.
- a helper silent for 10 minutes is stopped where `TaskStop` is allowed; the item says so; the next one starts.
- a note changes main's work: main adds a decision item and acts only after the press.
- a helper's question during a live chat, or after Esc: it starts no turn, and rides the user's next typed prompt.
- usage at 72%: one alert per window. At 86%: the question is saved and held, and runs after the reset time.
- Done closes a side question; `close_item` and `add_item` refuse the kind.
- a helper's `Edit`, `Bash` and `Agent` calls are refused, also after a resume; its `Read` and `Grep` are not.
- a pane reply while a long tool call runs: "Sent · Claude reads it at its next step", then "✓ Claude has it" once the call returns.
- hand-off: an open side question moves; a follow-up in the new session starts a new helper that can search the old conversation file.

## Left to the builder

- The wording of every prompt and toast, and the size of the summary.
- How the helper marks a note or a question for the main session in its answer.
- The layout of the log file, and the `maxTurns` bound.
- How the list draws SIDE QUESTIONS when the pane is shorter than the list.

## Skipped

- A keyboard shortcut: add when the mod API gets one.
- Read-only shell commands and web search for helpers: add if helpers often say they could not check something.
- Reading an answer on the phone: add when the pane fits the phone.
- Side questions that change code: add only if Nir and Asaf ask for it after the two-week decision.
- Rex: it reads status in its own way; check how it shows a helper if they move to Rex.
