# open-items v0.3: asks from the user to the session

**Date:** 2026-11-07 · **Status:** draft for Asaf's review
**Builds on:** `2026-10-26-open-items-v0.2-design.md` (v0.2, shipped as 0.2.1). Everything v0.2 decided stays unless this document changes it.
**Why a new document, not an amendment:** v0.2 is approved and shipped. Asks turn the direction around (from the user to Claude) and add a helper agent, so they get their own design, as v0.2 did on top of v0.1.

## Intent

Nir proposed the idea in Slack `#edut-app-developers` on 2026-11-07: "while a session works, I think of side questions or ideas for Claude. If I type them in the chat, they arrive mid-task and change what Claude is doing." Asaf answered the same day: "yes. Please write the spec and send a PR for the 'asks to the session' idea. I will review it."

In the brainstorm (2026-11-07), Nir named three kinds of side question:

1. A follow-up on something said in the session.
2. A term he is not sure of.
3. A question with only a weak tie to the session, which came up while he worked in it.

open-items today goes one way: every item starts from Claude's `add_item`. An ask goes the other way. The user leaves a question in the pane, and Claude answers it inside the item, without pulling the main session off its task.

### Why the current paths fall short

| Path | What goes wrong |
|---|---|
| Type the question in the chat | It reaches Claude mid-task and changes what Claude is doing. |
| `/btw` (Claude Code 2.1.251) | It answers at once and shares the context, but it cannot open files or run anything, and there is no follow-up. |
| Wait until the session is idle (the first Slack proposal) | A long background run keeps the session busy for hours. Nir: a term question needs a faster path, such as a side session he reaches from the pane. |

The third row turned the Slack proposal (pick asks up only when the session is fully idle) into the design below. A helper answers at once. The main session takes an ask only when the ask is about its work and it is idle.

## Goals

1. The user can leave a question for Claude at any moment, also while Claude works, without changing what the main session does.
2. An ask gets an answer within minutes, from an agent that knows the conversation and can read files.
3. The main session hears of an ask only when the ask is about its work, and only when it is idle.
4. Each ask is a thread. The user can follow up, and the answer stays in the item.

## Non-goals

- Asks that change things. An ask gets looking and reporting only: no file edits, commits or pushes. A change the user wants after an answer goes through the chat, as today.
- Replacing `/btw`. It stays the quickest path for a one-line answer that needs no files.
- Starting an ask from the pane on a phone. The pane's `Input` is not drawn on mobile; `/ask <question>` is the way in there.
- A keyboard shortcut that opens the pane. The mod API cannot add one (see Constraints).

## Anti-goals: a failure even if it works

- The main session is pulled off its task: by an ask, by a helper's report, or by the notice that a helper finished.
- The helper or the main session changes files, commits or pushes because of an ask.
- Asks quietly use up the user's usage quota.
- Asks show in the count of what needs the user, or set off an alert other than the quota alert (Decided 9). v0.2's anti-goal ("Questions that are not the user's to answer, added because the pane has room") stays intact, because asks live in their own section.

## Success criterion

Count over the first two weeks after install, on both seats:

- **No side question typed into the chat while Claude works.** Counted from transcripts: a prompt the user typed during a main turn, or while background work ran, that asks something off the task.
- **Helper usage,** from the mod's own records: asks per session; the route each took; how often the helper asked the user back; the time from an ask to its first answer; and the tokens the helpers spent.

If the first fails, record the cases and fix that rule before adding features.

## Decided by Nir (2026-11-07)

1. A helper takes every ask first. It decides whether the ask is about the main session's work. If it is not sure, it asks the user one follow-up question in the item.
2. Routing:

   | The ask is | The main session is | Who answers | Does the main session hear of it? |
   |---|---|---|---|
   | not about main's work | busy or idle | the helper | never |
   | about main's work | busy | the helper, at once | yes, when main is next fully idle, if it matters to main's work |
   | about main's work | idle | the main session, in the item | (it answered) |

3. When a helper's report reaches the main session, main reads it. If it changes main's work, main asks the user in the item before it acts. Main never acts on a report alone.
4. Look and report only, on every route (from the Slack proposal).
5. The user leaves an ask in a "new ask" field in the pane. `/open-items` opens the pane at any time: when it holds nothing, and while Claude works.
6. `/ask <question>` is the fallback for the phone. It works on every surface.
7. An ask ends only when the user presses **Done**. Until then it stays, so the user can follow up.
8. Asks have their own section, FOR CLAUDE. They are not counted under the prompt and set off no alert, apart from the quota alert (Decided 9). They move with a hand-off like other items (from the Slack proposal).
9. Quota: the pane never shows what an answer cost. When the five-hour usage window reaches 70%, the mod alerts the user. At 85% it holds asks (see "Quota guard").

## Claude's calls

These follow from the brainstorm. Nir saw them played back and did not object, but did not decide them one by one.

- **Every user message in an ask is routed like a new ask.** A follow-up goes to a helper first, with the thread so far, so a follow-up never lands in a busy main session. The one exception is an option press while main asks for a go-ahead (below).
- **"Fully idle"** means: no main turn in flight, no agent at work (the mod's own helpers excepted), and no background shell command or monitor. This reuses v0.2's live-chat test of background work. When the mod cannot tell whether background work runs (v0.2's `live.background === null`), main counts as fully idle once its turn ended and no agent is at work, so a report never waits forever.
- **The helper is a fork** of the main conversation. It starts with the main thread's whole context as of its last request, so it can answer about what was said. It has the main session's tools.
- **A fresh helper for each message,** not one long-lived helper. Each one sees the latest conversation. A follow-up's helper gets the ask's thread in its prompt.
- **One helper at a time per session.** A second ask waits in order behind the running helper. This keeps quota use bounded. The builder may raise it to two if the metrics show long waits.
- **The mod sends to main only at a fully idle moment it sees.** The engine runs a plugin prompt as soon as main's turn ends, even while background agents run, so its queue is no wait for full idle. The mod tells the helper, in its prompt, whether main is fully idle at that moment. When the helper routes an ask to main, the mod checks again before it sends. If main is no longer fully idle, a new helper answers the ask as "main busy" (answer now, report later). A report also goes only at a fully idle moment the mod sees.
- **Look-only is enforced, not only asked for.** For a helper (by its `agentId`), and in a main turn that an ask or a report started, a `tool.check` hook denies every call the engine does not mark `isReadOnly`, and every `Agent` call (a helper's own subagent would escape the deny by its new `agentId`). Bash commands and MCP tools that change things are denied this way too. The deny text tells Claude to say in its answer what it could not check. Left over: a tool's `isReadOnly` is its own word, and an MCP tool may claim it falsely; the prompt forbids sending messages too. The README's line "the mod hooks no tool of Claude Code's own" changes with this.
- **Main asks for a go-ahead with options in the item.** When a report changes main's work (Decided 3), main adds options to the ask with `reply_item` ("Change it" / "Leave it"). A press reaches main at once, as a v0.2 option press, so auto mode reads it as the user's consent, and the turn it reaches is not an ask turn. A free-text reply still goes to a helper first, like every message in an ask. Without this, a "yes" typed in the item would go to a helper, and main could never act on it.
- **An ask reaches main in the user's words; a report does not.** A routed ask goes as `$.prompt.submit({ text, asUser: true })`, like v0.2's idle answers, because it is the user's question. A report goes without `asUser`, so main reads it as a message from the plugin, not as an instruction from the user.
- **Asks share the item numbers.** An ask is `#N` like any item, so `reply_item`, the composer bridge (`↳ Answer to #N:`) and the hand-off number map work unchanged.
- **Only the user closes an ask.** `close_item` refuses an ask. An ask has a **Done** button and no **Later**. It has options only while main asks for a go-ahead. Done sends main nothing.
- **No alert, even when the helper asks back.** The item gets v0.2's unread mark (●) and a "helper asks you" mark on its list line. The user started the ask, so the user is likely watching it.
- **Main's view of asks stays narrow.** `list_items` shows main an ask only while main must answer it; `show: all` lists every ask. The reminder line on each prompt ("Open items: N open, M unread answers") does not count asks.

## The design

### The ask

A fifth kind, `ask`. Its thread starts with the user's question, so `thread[0]` comes from the user, not from Claude. Each Claude message in an ask's thread records its author: the helper or the main session.

An ask also records:

- its **route**, once a helper decided it: `side`, `main`, or `helper-then-main`;
- who works on it now: a helper, the main session, or nobody;
- whether a report to main waits;
- for the metrics: when the user asked, when the first answer came, whether the helper asked back, and each helper's token use.

States: `open` until the user presses Done, then `resolved`. `handing-off` and `moved` as in v0.2. No `later`.

### How an ask flows

1. The user submits the "new ask" field, or runs `/ask <question>`. The mod adds the ask and starts a helper at once, or queues it behind the running helper.
2. The helper's prompt holds the ask's thread, whether main is fully idle now, and the steering below. The helper first decides the route:
   - **Not sure:** it asks the user one short question in the item and stops. The user's reply starts a new helper (step 1).
   - **Not about main's work:** it answers in the item.
   - **About main's work, main fully idle:** it answers nothing. If main is still fully idle, the mod sends the ask to main, and main answers in the item with `reply_item`. If not, a new helper answers it as "main busy".
   - **About main's work, main busy:** it answers in the item, and adds a report for main when the answer matters to main's work. The mod holds the report until main is fully idle.
3. The helper's result reaches the mod at the helper's `turn.complete`, matched by `agentId`. The mod writes the answer into the thread.
4. The user reads it, follows up (back to step 1), or presses Done.

### What the helper is told

The helper's prompt is the mod's own text, so it reaches the helper on both seats. The fork also inherits the main session's system prompt and CLAUDE.md, so the user's own response rules apply to its answers.

- You answer a side question the user left for this session. You are a copy of the session; the main session goes on without you.
- First decide whether the question is about the main session's current work. If you are not sure, ask the user one short question and stop.
- Look and report only: read files, search, and run commands that change nothing. Never edit files, commit, push, or start background work.
- Put the answer first. Keep it short, and say what you did not check.
- When main is busy and your answer matters to its work, add a one-line report for main: what it should know, and why.

### What the main session gets

- **An ask sent to main:** a prompt in the user's words: "Ask #N (Open items), about your work: <thread>. Answer it in the item with `reply_item`. Look and report only." The turn it starts is an ask turn: the edit tools are denied in it.
- **A report:** a plugin message at the next fully idle moment: the ask, the helper's answer, and the line on why it may matter. "If it changes your work, add options to item #N with `reply_item` and wait for the user's press before you act. If not, do nothing." The turn it starts is also an ask turn.
- Neither counts as a typed prompt for the live-chat gate. v0.2's `prompt.submit` hook already skips the mod's own prompts.
- Tool descriptions: `reply_item` gets one line on answering asks (look and report only). `close_item` refuses an ask: "Only the user closes an ask (Done)." `add_item`'s session-end rule leaves asks out, because Claude cannot close them. The 4,096-character budget per description stays.

### What the user sees

List screen. FOR CLAUDE comes last, and the "new ask" field is always drawn, also when the pane holds nothing else:

```
 Open items              2 open · 1 later
 DECISIONS
 ❯ #5  Merge PR 787 with override:no-review?
 QUESTIONS
   #9  Which GCP project holds the uploader?
 LATER
   #4  Remove the old owner from the GCP project
 FOR CLAUDE
   #11 What does "RLS" mean here?              ● answered
   #12 Why did we pick a nightly job?          ⋯ helper working
   #13 Is the CI cache shared across forks?    ? helper asks you
 › New ask for Claude…
 ↵ open · ↑↓ move
```

Ask screen:

```
 ‹ Open items    #12 Ask
 Why did we pick a nightly job for the e2e tests?
 ─────────────────────────────────────────────
 You · 6m
 Why did we pick a nightly job for the e2e tests?
 Helper · 4m
 To cut CI from 14 to 6 minutes. PR 787 moved the
 40 slow e2e tests to a nightly run; the session
 chose this at 14:02. I did not check the nightly
 run's last result.
 ─────────────────────────────────────────────
 [ Done ]
 › Follow up…
 [ ‹ Back ] · ↑↓ scroll
```

- The counts in the header and under the prompt leave asks out.
- List-line marks: "⋯ helper working", "⋯ waiting for the session" (sent to main), "? helper asks you", "● answered" (unread).
- A toast confirms a new ask and its number ("Ask #12 sent"). On the phone this is the only sign that `/ask` worked.

### Opening and input

- `/open-items` is registered `immediate: true`, so it runs while a turn is in flight. It opens the pane also when nothing is in it (today it answers "No items for you right now.").
- The "new ask" field: Enter submits. v0.2's secret guard and length limit apply.
- `/ask <question>` is registered `immediate: true`, with an argument hint. It adds the ask as the field does. With no text, it opens the pane on the field.
- On the phone, a follow-up goes through the composer bridge (`↳ Answer to #N:`), which now also accepts an ask's number.

### Hand-off and session end

- `handoff_items` marks open asks with the other open and Later items. `take_items` moves them with their threads and any waiting report. The take result carries a waiting report to the successor's main session.
- The mod cannot stop a running agent (`$.agent` has no call for it). A helper still running at a hand-off finishes in the old session, and its result is dropped. The successor starts a new helper for that ask. This costs an extra helper run now and then, and loses nothing.
- A session that ends with open asks leaves them like other items. The next session in the folder offers them with Take (v0.2's leftovers).
- The session-end rule ("resolve, record or hand off every open and Later item") leaves asks out. They are the user's: they move with a hand-off, or wait as leftovers.

### Quota guard

The mod reads the five-hour window from `$.session.usage().rateLimits` before it starts a helper or sends an ask or a report to main.

- **At 70% or more:** it alerts the user once per window, through v0.2's alert path (a toast, and `$.ui.notify` when the user has been away two minutes): "Five-hour usage at 72%. Asks pause at 85%." The ask still runs.
- **At 85% or more:** it holds every ask: no helper starts, and no ask or report goes to main. New asks are still saved. A held ask shows "⏸ held: usage at 86%, resumes at 20:49" on its list line, with the window's reset time. When the window drops under 85%, held asks run in order.
- **No window to read** (an account with no subscription, where `rateLimits` is empty): no alert and no hold; the metrics still count tokens.
- The pane never shows tokens or cost (Decided 9).

### Metrics

The mod keeps the metric fields of each ask. A closed ask keeps them, with its number, title and final state, for 30 days instead of v0.2's 7, so a two-week count can read them. The first success measure (side questions typed in the chat) is counted outside the mod, by a script over the session transcripts; that script is not part of the plugin.

## Constraints

Claude Code 2.1.319 mod API (the types the plugin-authoring skill wrote on 2026-11-07):

- `$.command.register({ name, description, argumentHint, immediate: true })`: the command runs at once while a turn is in flight. Its `command.run` hook must not assume the turn's state.
- No API adds a key chord. The engine's own `ctrl+x tab` moves the keyboard into a pane that is already open.
- `$.agent.spawn({ prompt, subagentType, description, name })` starts a subagent in the background from a mod. Its answer is its `turn.complete`, matched by `agentId`. A fork inherits the parent's context and model (`model` is ignored for it), and the parent's tools and permission mode; spawn takes no tool list.
- `$.agent.list()` lists the agents plugins spawn too, so the live-chat gate and the fully-idle test must leave out the mod's own helpers.
- `$.agent` has no call that stops an agent.
- `$.session.usage()` returns `rateLimits`, the account's usage windows, as the status line shows them. The list is empty on an account with no subscription.
- `$.model.fork({ prompt })` is a fork with every tool denied, which is what `/btw` gives. Not used: the helper must read files.
- A `tool.check` hook sees `agentId` and, set by the engine, `isReadOnly`: present only when the tool holds this input read-only. Absent means a write or "cannot say". It is the tool's own word, not proof.
- A plugin prompt without `asUser` reaches the model as "The <name> plugin sent a message: …".
- v0.2's constraints stay: `Input` is not drawn on mobile; Esc belongs to the engine; the leak gate scans `plugins/`.

## Rollout

0. **Probes before the build,** live, on both seats. Each result sets one part of the build.
   1. *Fork from a mod:* `$.agent.spawn` with `subagentType: 'fork'` starts a helper that holds the main conversation. If it cannot, fall back to a mod-registered read-only agent type with a summary of the conversation in its prompt. That is weaker for follow-ups on what was said.
   2. *Finish notice:* whether a helper's end reaches the main loop as a task notification. If it does, the mod drops that prompt (`prompt.submit` → `drop`), so main is not woken.
   3. *Permission prompts:* whether a helper's tool call can raise a permission dialog while main works, in each permission mode the seats use.
   4. *Phone:* whether `/ask` sent through Remote Control runs at once while Claude works, or waits for the turn to end.
   5. *Cost:* the tokens one helper run costs in a long session, with the main thread's prompt cache warm and cold.
   6. *Org seat deny:* whether a user-tier `tool.check` hook can deny Claude Code's own tools on the org seat, where `cc-plugin-sec-default` already skips other user-tier hooks (v0.2, "Steering on the org seat").

   If a probe shows an anti-goal cannot be met on a seat (the deny does not hold, the finish notice cannot be dropped, a helper raises permission dialogs while main works), asks stay off on that seat. The pane says so, and the finding comes back to Nir and Asaf before the build goes further (Claude's call).
1. PR to this repo: the plugin at 0.3.0, tests, CHANGELOG, marketplace version, README (asks, `/ask`, the tool hooks).
2. Personal config: the session-end rule in `~/.claude/CLAUDE.md` and the `/wrap-up` skill leave asks out.
3. Update on both seats after merge.
4. Smoke test in a fresh session. While a background batch runs, the user leaves a term question, a question about the batch's work, and a vague question. The first gets a helper answer and nothing else; the second gets a helper answer and, after the batch, a report to main; the third gets a question back from the helper. Then, with main idle, a question about its work goes to main and is answered in the item.

Test cases the routing must pass:

- not about main, main busy: the helper answers; main hears nothing.
- not about main, main idle: the helper answers; main hears nothing.
- about main, main busy: the helper answers; the report reaches main only after the batch ends and no agent runs.
- about main, main idle: main answers in the item; `Edit` is denied in that turn.
- about main, main idle when the helper started, busy when it ended: a new helper answers; main hears only the report, later.
- not sure: the helper asks back; the reply starts a new helper.
- two asks at once: the second waits for the first helper.
- a report changes main's work: main adds options; the press reaches main at once and `Edit` is allowed in that turn.
- usage at 72%: the ask runs, and the alert comes once; a second ask in the same window sets off no second alert.
- usage at 86%: the ask is saved and held; it runs after the window resets.
- Done closes an ask; `close_item` on an ask is refused.
- a helper's `Edit`, a `git push` through Bash, and an `Agent` call are all denied; its `Read` and `Grep` are not.

## Left to the builder

- The helper's result format, and how the mod reads it; the wording of every prompt and toast.
- Whether the helper writes into the thread through a tool only it may call, or through its final reply.
- The layout of the metric record.
- How the list draws FOR CLAUDE when the pane is shorter than the list.

## Skipped

- A keyboard shortcut: add when the mod API gets one.
- A cheaper model for the helper: a fork always runs on the main model. Add a path without the fork for term questions if the token metric shows asks are expensive.
- Asks that change code: add only if Nir asks for it after the two-week count.
