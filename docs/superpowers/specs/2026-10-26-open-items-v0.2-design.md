# open-items v0.2: each item is a conversation

**Date:** 2026-10-26 · **Status:** approved by Asaf 2026-10-26; spec-review fixes applied (report: session scratchpad `spec-review-oi-v02.md`)
**Builds on:** `2026-10-25-open-items-pane-design.md` (v0.1). Everything v0.1 decided stays unless this document changes it.

## Intent

Asaf's words (2026-10-26): "in sessions with subagents or several workstreams, where questions and important information are sent while they still working, the messages get lost in the stream and it's getting hard to track them. I want a place where I can see all the important messages/questions, and respond at my time, and I want to be able to get some context and ask clarification questions if needed."

v0.1 works, but Asaf finds it only "ok". Four org-seat `/coo` sessions on 2026-10-25 used it for about 83 items. In all four, Asaf typed nothing in the chat after `/coo`: the pane was his only input channel. v0.1 was built as a one-shot inbox beside a chat he reads. It was used as the conversation itself, and that is where it fell short.

### Evidence (2026-10-25 transcripts)

| Gap in v0.1 | What happened |
|---|---|
| Any reply closes the item; Claude cannot answer on it | About half of the free-text replies asked for more detail. Claude re-added the same decision under 3 to 5 numbers, or answered in the chat. Asaf: "NOOOOOOOOO not in the chat, it misses the whole point"; "STOP IT, you started with 2, then 3, now 4". |
| An item cannot hold detail | `why` is cut at 300 characters with no sign (`tasks.ts`, `why.slice(0, MAX_WHY)`); 12 items in one session were longer. Asaf: "I need context HERE"; "I think that you text was cut". Titles used internal IDs: "I can't follow it like this, you must add some context and write as ASD-STE100". |
| A cap of 5 open asks | One COO recap had 19 decisions. 9 to 15 asks per session never reached the pane. |
| Items end with the session | COO hand-offs lost answers that arrived 1 to 25 seconds after the switch. Claude re-added items by hand in the next session. |
| No "later" | "I'll do it later" counted as Done. Asaf: "postpone to a later session (with reminder)". |
| Late delivery | Some answers reached Claude 4 to 37 minutes late. Claude then said already-answered items still waited. |
| Steering never loaded on the org seat | The built-in `cc-plugin-sec-default` plugin skipped the open-items `prompt.compose` and `prompt.context` hooks in every org-seat session. Only the tool descriptions reached Claude. This is intended behavior (see "Steering on the org seat"). |
| Live chat | In a live brainstorm, the item only repeated the chat question. Asaf: "do we really need to use the pannel in a brainstoming session?" |

What worked and must stay: one-click options (answered in 21 seconds to 3 minutes), pane approvals that auto mode accepted as Asaf's consent (a merge, a deploy, an IAM removal), and no lost answers.

Per-session reports: `oi-e19fac22.md`, `oi-a02903ac.md`, `oi-7c940839.md`, `oi-cb09cb1d.md`, summarized in `oi-synthesis.md` (session scratchpad, not committed).

## Goals

1. One place for every message from Claude that needs Asaf: decisions, questions, actions and important findings.
2. Each item is a thread. Asaf can ask for context, and Claude answers inside the item.
3. Asaf answers in any order, when it suits him. Each answer reaches Claude on its own, at the next moment Claude can take it.
4. Items survive a COO hand-off, and an item can wait for later without blocking the work.
5. It works the same on both seats.

## Non-goals

- Use in a live chat. When Asaf is present and replying, Claude asks in the chat only.
- Replacing the pane with an artifact page. An artifact holds heavy detail; the pane stays the place to read and answer.
- Two live sessions sharing one pane. Items move between sessions only at a hand-off or after a session ends.
- Phone push, and the harness's "no visible output" nudge (see Skipped).

## Anti-goals: a failure even if it works

- An ask that reaches only the chat while background work runs.
- The same ask under more than one item number.
- Text cut without a sign.
- Items in a live chat.
- Questions that are not Asaf's to answer, added because the pane has room.

## Success criterion

Count from the transcripts of the first 10 background sessions after install, on both seats:

- no ask in the chat only;
- no ask re-added under a new number;
- no complaint that text was cut or that an answer went to the chat;
- every clarification question answered inside its item.

- no answer reaches Claude later than the end of the tool call that was running when Asaf pressed it;
- no item or answer is lost or doubled at a hand-off.

If one of these fails, record which one and what happened, and fix that rule before adding features.

## Decided by Asaf (2026-10-25/26)

1. The pane is the conversation. Claude replies inside an item, and the item holds the detail.
2. The terminal pane is the place to read and answer. An artifact is only for content that benefits from a page.
3. Layout B: a list screen and an item screen. Enter opens an item; a Back button returns to the list. (Asaf chose Esc; the mod API keeps Esc for the engine, so Back replaces it. See Constraints.)
4. Any order. Asaf moves with ↑↓ and opens with Enter. No typing of item numbers: `1` then `0` is ambiguous between #1 and #10.
5. A reply never closes an item. An item closes when Asaf presses an option or Done, or when Claude reads his reply and marks the item resolved.
6. Each reply goes to Claude at once, never held back for other items.
7. Hand-off: open and Later items, with their threads, move to the new session in the same folder. The old pane says where they went. Items never move on a plain `/clear`.
8. A **Later** button. The item moves to a LATER section, and Claude goes on without it. It stays until Asaf does it, and it moves with a hand-off.
9. Session end: Claude does not end a session with open items. It resolves them, records them, or hands them off. If items are left anyway, the next session in that folder shows them again.
10. One artifact per session for heavy detail, updated in place. A second one only when Asaf asks for it.
11. No cap. The pane holds every ask, and Claude asks no unnecessary questions.
12. No items in a live chat.

## Claude's calls

These follow from the evidence; Asaf saw them in the brainstorm and did not object, but did not decide them one by one.

- **No silent cut.** An item's detail has a generous limit. Over the limit, the tool returns an error that says so. The pane never cuts stored text without a sign. The detail and every thread message keep their line breaks (v0.1's `oneLine()` on `why` goes), so a step list stays a list.
- **Plain, self-contained titles** in simple English (ASD-STE100 style), with no internal IDs. The 80-character title limit stays, with v0.1's error; the detail holds the rest. Other numbers are written without `#` ("PR 787", not "#787"), so `#N` always means an item.
- **"Record" an item** (Decided 9) means: Claude writes the item and its state into the hand-off file or the session's final summary, then closes it with `close_item withdrawn` and the note "recorded in <where>".
- **Consent is a decision.** When only Asaf's consent is missing ("run this command"), Claude adds a decision ("Run it" / "Don't"), not an action, so one press lets Claude do it.
- **One item per ask.** Claude changes an item in place (title, detail, options) instead of adding a new one.
- **Reply alert.** A Claude reply in a thread alerts Asaf like a new item, with v0.1's presence rule (no alert if he used the session in the last 2 minutes).
- **Steering lives in the tool descriptions,** the one prompt channel that reaches Claude on both seats. The `prompt.compose` section stays as a short copy where it loads (the personal seat).
- **A live chat** means a back-and-forth: no background task runs (agent, background shell command, or monitor), and Asaf's last two inputs were both prompts he typed in the chat, the latest less than 5 minutes ago. A pane press never counts, because in the COO sessions the pane was his only input. A long answer sent through the composer bridge (`↳ Answer to #N:`) is a pane answer and does not count either. In a live chat, `add_item` refuses with "live chat: ask in the chat". One typed prompt is not enough: a COO session starts with a typed `/coo` and adds items before its first agent (session 7c940839 added #1 at 18:46:16 and dispatched its first agent at 18:47:05). For the first turn, the steering rule decides. The 5 minutes is a setting the builder can tune. Test cases the rule must pass:
  - a brainstorm, second typed prompt, no agent running: refused;
  - a COO first turn, an add before the first agent: allowed;
  - a pane press, then an add with no agent running: allowed;
  - two long answers through the composer bridge, no agent running: allowed;
  - two typed prompts while a background shell command runs: allowed.
- **Hand-off by claim, not by start order.** `handoff_items` returns a short hand-off code. The hand-off prompt for the successor carries it, and the successor calls `take_items` with the code. A worker session that starts in the same folder can never take the items by accident.
- **Leftovers are offered, not taken.** Items left by an ended session, or by the conversation before a `/clear`, show in the next session in that folder as "N items left by an earlier session" with **Take** and **Dismiss** buttons. Nothing moves until Asaf presses Take; Dismiss drops them.
- **When items count as left.** Each session writes `lastActiveAt` on every turn and every press, and `endedAt` at `session.end`. Its items are offered elsewhere only when it ended, or had no activity for 12 hours. There is no heartbeat timer. A wrong guess costs one ignored offer, because nothing moves without Take.
- **Consent fallback, no flag needed.** If the consent probe (see "What Claude gets") fails, option and Done presses go as a prompt at the end of Claude's current turn, without v0.1's open-asks hold. Replies and Later still go in at once. Claude never has to mark an item as an approval in advance.
- **Item numbers move with the item.** A moved item keeps its number, and the new session's counter starts past the highest number it holds. `reply_item` and `close_item` keep addressing items by number.
- **Waiting for Claude.** After Asaf replies, the item shows "waiting for Claude" and leaves the counts of what needs him, until Claude replies or closes it.
- **Info items stay until Seen.** v0.1 dropped the oldest info item beyond 5; with no cap, nothing drops.
- **An unread mark (●)** shows on an item with a Claude reply Asaf has not opened.

## The design

### Item

An item has a kind (`decision`, `question`, `action`, `info`, unchanged from v0.1), a title, a thread, and a state.

- **Thread:** messages in time order, each from Claude or from Asaf, with a time. The first message is the item's detail. Option presses, Done, Later and Claude's in-place changes appear in the thread as one-line events, so the history reads in order.
- **States:** `open`, `later`, `resolved`, `withdrawn`, `handing-off` (marked by `handoff_items`, not taken yet), `moved` (taken by another session). An open item can also be "waiting for Claude" after Asaf's reply.
- **Owner and folder:** an item records its owner session and the folder that session started in (read once at session start, not on each write, so a later `/cd` or worktree move does not change it).
- **Link (optional):** a URL to a section of the session's artifact.

### Model-facing tools

The names are a proposal; the behavior is the design.

| Tool | Does |
|---|---|
| `add_item` | Adds an item: kind, title, detail, options and recommended (decision), done-when (action), link. |
| `reply_item` | Adds Claude's message to an item's thread. It can also change the title, detail, options or link in place. The item stays open. |
| `close_item` | Closes an item: `resolved` (after Asaf's answer) or `withdrawn` (no longer needed, or "answered in chat"), with a one-line note. Replaces v0.1's `withdraw_item`. |
| `list_items` | Lists items with their state, unread replies, and the thread tail. Unchanged in purpose. |
| `handoff_items` | Marks every open and Later item for a successor session. Returns how many, and a hand-off code. |
| `take_items` | Called by the successor with the hand-off code. Moves the items, threads included, to this session. Returns each item's number, kind, title, thread and unread answers, so the new Claude has the context. |

- Subagents: every tool except `list_items` refuses a call from a subagent (v0.1 lets a subagent list).
- Deferred: `add_item`, `reply_item`, `close_item` and `list_items` are not deferred, because the steering lives in their descriptions. `handoff_items` and `take_items` are deferred; the coo hand-off steps load them.
- Budget: a tool description holds at most 4,096 characters. `add_item` carries the rules for adding and the session-end rule (it is not deferred, so the rule is always in view); `reply_item` and `close_item` carry the rules for threads and closing; `handoff_items` says how to pass the code.
- When Asaf presses Take on leftovers, the mod sends Claude one message with the same content `take_items` returns.

### What Asaf sees

List screen:

```
 Open items              5 open · ● 1 new reply · 1 later
 DECISIONS
 ❯ #5  Merge #787 with override:no-review?          ● 2
   #8  Revoke quarantine PAT now or after deploy?
 QUESTIONS
   #9  Which GCP project holds the YouTube uploader?
 ACTIONS
   #3  Create 3 dev tokens (steps inside)
 INFO
   #12 CI red on edut-app main: lint only
 LATER
   #4  Remove the old owner from GCP project
 ↵ open · ↑↓ move
```

Item screen:

```
 ‹ Open items    #5 Decision
 Merge #787 with the override:no-review label?
 ─────────────────────────────────────────────
 Claude · 4m
 PR #787 moves the 40 slow e2e tests to a nightly
 job. CI drops from 14 to 6 min. No reviewer is
 free before Thursday.
 You · 2m
 how does it make the tests faster?
 Claude · 1m
 Each PR now runs only the unit tests (6 min).
 The e2e tests still run every night at 02:00.
 Details: <artifact link>
 ─────────────────────────────────────────────
 [ Merge with label (recommended) ] [ Wait for review ] [ Later ]
 › Reply or ask a question…
 [ ‹ Back ] · ↑↓ scroll
```

- Sections in order: DECISIONS, QUESTIONS, ACTIONS, INFO, LATER. An empty section is not drawn. Oldest first inside a section.
- The list scrolls when it is longer than the pane. Risk: the engine gives ↑↓ to body scrolling when the content overflows, so ↑↓ may stop moving between items in a long list. A live probe settles it before the list screen is built; if ↑↓ scroll, a `ui.scroll` hook turns arrow moves into focus moves, or two letter hotkeys move the selection.
- From the reply field, Back must stay reachable (Tab to the Back button, or Enter on an empty field). The same probe confirms which works.
- An item waiting for Claude shows "⋯ waiting for Claude" on its list line.
- Buttons by kind: decision → its options, "Other…" stays as the reply field; action → Done; info → Seen; all but info → Later. An item in LATER keeps all its buttons, so Asaf can answer it from there.
- The status line under the prompt (v0.1's collapsed summary) adds replies and Later: `☐ 2 decisions · 1 question · ● 1 reply · 1 later · /open-items`.

### What Claude gets

- Each press or reply reaches Claude at the next moment Claude can take input, never held while other items are open. v0.1's 800 ms batch stays: presses made within it go as one message. The wording keeps v0.1's form, so auto mode still reads a pane approval as Asaf's consent.
- A free-text reply arrives marked as a reply on item #N, not as an answer. Claude decides: answer in the thread with `reply_item`, or close it with `close_item resolved`.
- Later arrives as "Later: go on without it". Claude does not wait on a Later item.

Why v0.1 held answers, and the change (from the v0.1 code):

- v0.1 sends a default press only while Claude is idle (`resolve` in `register.tsx`). While Claude works, the answer is only saved.
- At the end of the main turn, `turn.complete` sends saved answers only if no ask is still open (the `!all.some(isAsk)` check). This is the hold.
- After that, a saved answer leaves only on another idle answer, on Send now, or on the next prompt of another origin. A subagent hand-back counts, which is why answers arrived as a digest on an unrelated hand-back.
- **Consent probe, the first build step.** v0.1's pane approvals counted as Asaf's consent in auto mode because they arrived as his prompt. Before the delivery code changes, a live probe on the org seat checks that an answer added mid-turn with `$.session.append` counts the same way. If it does not, the consent fallback in Claude's calls applies.
- v0.2: while Claude works, an answer goes in at once with `$.session.append`, and the open-asks hold is removed. It reaches Claude at the next model request. During one long tool call, nothing can reach Claude sooner; that limit stays.
- **"Claude is working"** means the main turn is between `turn.start` and `turn.complete`. Background tasks do not count here: with the main turn idle, a prompt wakes Claude at once (an idle answer on 2026-10-25 went out at once while agents ran). Background tasks count only for the live-chat gate. When the mod cannot tell, it sends the answer as a prompt, which the engine runs when Claude is idle; an appended answer with no turn to read it would be the late-delivery gap again. Fix on the way: `turn.start` clears `isUnread` for subagent turns too.

### Hand-off and session end

How a COO hand-off runs today (from the 2026-10-25 transcripts): the old session writes a hand-off file, starts the successor as a new `claude` process with a prompt that names the file, and stays open until the successor closes it. So two processes are alive for a short time.

- Before it starts the successor, the old session calls `handoff_items` and puts the returned code, and the session artifact's URL, in the successor's prompt.
- `handoff_items` marks the open and Later items `handing-off`. It also takes along any answer the old Claude has not read yet (pressed after its last model request), as an unread answer on the moved item, so a press made a second before the hand-off is not lost.
- From `handoff_items` on, the old pane shows those items read-only: "Moving to a new session". A press there could not reach the new Claude, so the pane does not offer one. The old pane does not name the successor (that would need polling the store).
- The successor calls `take_items` with the code. The items become `moved` for the old session and open (or Later) for the successor, keeping their numbers. The successor's pane shows "N items moved from the previous session". Each item has one owner session at a time.
- If no session takes them within 30 minutes, the items stop being `handing-off` and become leftovers: any session in the folder offers them with Take, the old one included.
- A session that exits with open or Later items and no hand-off leaves them in the store. The next session in that folder offers them with a Take button (see Claude's calls). v0.1's 30-day cleanup still applies.
- `/clear`: the new conversation starts empty. The earlier conversation's open items are offered the same way, never moved on their own. `claude --resume <old id>` still brings them back while nobody took them.
- `--resume` of a session whose items moved does not bring them back; they belong to the new owner.
- `$.store` is one JSON file per plugin, at most 4 MiB, shared by all sessions and folders. Each session writes only its own key, so two live processes do not overwrite each other. A take writes the successor's key and then the old session's key.
- What is saved: open, Later and `handing-off` items with their full threads. A resolved or withdrawn item keeps only its number, title and final state, for 7 days. v0.1's 30-day cleanup applies to the rest.
- A failed store write is never silent: the pane and the status line show "open-items: could not save", because a lost write means items do not survive a hand-off.

### The session artifact

One artifact per session holds detail that a terminal cannot show well: tables, diffs, long step lists. Claude updates it in place and links the item to the section. A second artifact only when Asaf asks. After a hand-off, the new session keeps using the same artifact; the hand-off prompt carries its URL (Claude's call). On a seat without the artifact tools, the detail goes in the item.

### Steering

Short rules, written into the tool descriptions, and repeated in `prompt.compose` where it loads:

- Add an item for every ask while background agents run or after the user went quiet. In a live chat, ask in the chat only; `add_item` refuses there.
- Add only what is the user's: a decision, a question only they can answer, an action only they can do, or a finding they must see. Ask no unnecessary questions.
- One item per ask. Change it in place with `reply_item`; never add the same ask again.
- Write titles and detail in plain English, self-contained, with no internal IDs. Write other numbers without `#`. Put tables, diffs and long steps on the session's one artifact and link to it.
- When only the user's consent is missing, add a decision, not an action.
- When the user replies on an item, answer in the item, not in the chat. Close the item when it is resolved.
- When the user answers in the chat instead, close the item with "answered in chat".
- Go on without Later items.
- Before the session ends, resolve, record or hand off every open and Later item.
- While background agents run, add the item and write no chat text about it until the batch ends.
- If a tool call fails, ask in the chat.

### Steering on the org seat

This is intended behavior, not a bug. On Team and Enterprise accounts, `cc-plugin-sec-default` runs in the `prepend` tier. Its `prompt.compose` and `prompt.context` hooks send the event on to the `append` tier and skip the `user` tier, where every plugin a person installs runs. Its own description says it keeps prompt content "out of reach of the plugins a person installs". A user plugin cannot change its tier; only an org admin can, through managed settings.

On the org seat, these channels reach Claude: tool descriptions (`tool.describe`), context added on `prompt.submit`, rows added with `$.session.append`, tool results, and CLAUDE.md. These do not: `prompt.compose`, `prompt.context`, `prompt.section`, `prompt.attachment`, `session.compact`.

So v0.2 puts every rule in the tool descriptions. One v0.1 feature loses its channel on the org seat: the open-items summary after compaction (v0.1 uses `prompt.context`). The mod cannot see a compaction there either, because `session.compact` is skipped too. Instead, while items are open, each prompt carries one short `prompt.submit` context line ("Open items: N open, M unread answers; call list_items"), and `list_items` gives the full state. The next-prompt digest keeps working: it already rides `prompt.submit` context.

A feature request to Claude Code (let a user plugin add its own prompt section on a managed account) is worth filing; it does not block v0.2.

## Changes from v0.1

| v0.1 | v0.2 |
|---|---|
| Any free-text answer closes the item | A reply never closes it |
| `why` cut at 300 characters, no sign | Generous limit, error over it, no silent cut |
| Cap of 5 open asks; info drops the oldest beyond 5 | No cap; info stays until Seen |
| One screen, all items expanded | List screen and item screen |
| Answers can wait for other items | Each answer goes at once |
| `withdraw_item` | `close_item` (resolved or withdrawn), plus `reply_item`, `handoff_items` and `take_items` |
| Items stay with their session | Hand-off by code; leftovers offered to the next session in the folder |
| Steering mainly in `prompt.compose` | Steering in the tool descriptions |

Kept from v0.1: the four kinds, the recommended marker, the inline field and the composer bridge for long answers, the secret guard, the subagent refusal, the alert path (`$.ui.notify` only), the status line and `/open-items`, the hooks-list test, the test kit and the live harness, the CI workflow.

## Constraints

- Claude Code 2.1.310 mod API. v0.1's constraints stay: the seat widths for a pane Claude opens (144 columns, or 110 once Asaf opened it), `Input` not drawn on mobile, `isDeferred: false` ignored when the mod loads mid-session.
- Two views in one pane work: one render hook draws from state, and a Button switches the view. A hotkey (one digit or one lowercase letter) presses a Button while the pane has the keyboard.
- Esc belongs to the engine: it returns the keyboard to the prompt, or closes the pane. So "back" is a Button with a hotkey.
- A docked pane in a fullscreen terminal (from 110 columns) gets the full height and at most 45% of the width (about 88 columns). An inline pane gets the rows it asks for, up to what the layout spares (v0.1 asks for 18).
- The engine scrolls a long pane body (wheel, arrows, page keys); `$.ui.scroll` can jump to an element.
- A `Link` works on every surface (an OSC 8 hyperlink in the terminal; remote surfaces need https). A `Link` cannot sit inside a Button.
- The leak gate scans `plugins/`: plugin files never name people or Asaf's tools.
- Repo rules: CHANGELOG line, version `0.2.0`, marketplace entry, PR merged by Asaf.

## Rollout

0. Live probes before the build, on the org seat: the consent probe, and the ↑↓ and Back-from-field probe on a list longer than the pane. Their results set the delivery code and the list keys.
1. PR to this repo: the plugin at 0.2.0, tests, CHANGELOG, marketplace version.
2. coo `orchestration.md`: the hand-off step calls `handoff_items` and puts the code and the artifact URL in the successor's prompt; the successor's first step calls `take_items`; one artifact per session; the session-end rule. Each step applies only when the open-items 0.2 tools are listed; without them, coo hands off as today. coo version bump, and a CHANGELOG line that names open-items 0.2.0 as the minimum.
3. Personal config: the batch rule in `~/.claude/CLAUDE.md` and the `/wrap-up` skill get the session-end rule. The batch rule's "while subagents or tasks run" matches the live-chat gate's "any background task", so Claude always has one allowed channel.
4. Update on both seats after merge.
5. Smoke test in a fresh org-seat session: a background batch adds a decision and a question; Asaf asks a clarification on one, gets the reply in the item, answers the other first, and puts one action in Later; then a hand-off moves the open items to a new session.

## Left to the builder

- Tool parameter names, the detail limit, and the reply wording Claude receives.
- Key bindings beyond Enter, ↑↓ and the Back hotkey, and which letter Back uses.
- What happens to v0.1 items saved in the store at upgrade: convert them or drop them.
- How the pane draws a thread taller than its rows.

## Skipped

- Phone push for items: add when Asaf reads sessions on the iPhone often (unchanged from v0.1).
- Two live sessions sharing one pane: add when Asaf runs two live sessions in one folder and needs one pane for both.
- A dated reminder ("merge on 29 Oct"): add when a dated ask is lost again; Later covers "not now".
- The harness's "no visible output" nudge during a silent batch: not in the mod; it conflicts with the CLAUDE.md batch rule and is a separate fix.
- The deterministic `turn.complete` detector from v0.1: add if the success criterion finds an ask in the chat only.
