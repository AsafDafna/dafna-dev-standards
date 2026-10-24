# open-items: a pane for decisions, questions and info

**Date:** 2026-10-25 · **Status:** design, awaiting approval
**Users:** Asaf first (Mac, Ghostty + herdr, fullscreen TUI); Nir may install it (opt-in plugin).

## Intent

Sessions that run background subagents post questions and findings into the chat while the work goes on. The person does not watch the session while it works, so later hand-backs push those questions out of view, and they get lost. A CLAUDE.md rule against this has failed several times. This mod moves every question, decision and important finding out of the chat stream into a pane that keeps them visible and answerable until they are resolved.

## Goals

- Every open decision, question and info item for the person is visible in one place in the session, regardless of how much chat came after it.
- The person answers a decision with one click, or with free text, from the pane.
- A new decision or question alerts the person when they are away from the session.
- The pane can be collapsed and leaves a one-line summary.

## Non-goals

- One inbox across sessions. Each session has its own pane (Asaf's choice). Skipped: a shared inbox; add it when per-session panes prove too scattered across herdr workspaces.
- Moshi (iPhone) push or a mobile layout. Asaf reads sessions on the Mac terminal. Skipped: add Moshi push when he reads sessions on the iPhone often.
- Subagents asking the person directly. Their questions go through the main session.

## Anti-goals (a failure even if it works)

- An item that exists only as chat text. If the model asks without the tool, the mod failed its purpose.
- More questions because asking became cheap. The bar stays the same: ask only about design, direction and trade-offs.
- Alert noise. Info items never alert; one alert per new decision or question.
- A mod that can approve tool calls. The mod's `tool.call` hooks match only its own tool names, so it can never approve a call that a deny rule or a security hook refused.

## Decided by Asaf (brainstorming, 2026-10-24/25)

1. **Scope:** one pane per session, showing only that session's items.
2. **Layout A, grouped by kind:** sections DECISIONS, QUESTIONS, INFO, in that order. Mockup: see "Layout" below.
3. **Decisions take free text:** each decision shows its option buttons and a text field under them ("or type your own answer…").
4. **Collapsible:** collapsing closes the pane and leaves a one-line band above the prompt (counts per kind + an Open button).
5. **Alert:** a new decision or question raises a macOS notification with a sound.
6. **Home:** a new opt-in plugin `open-items` in this marketplace (`plugins/open-items`), installed per person at user scope.

## Builder's calls made during design (Claude's, not Asaf's; check while reading)

1. **Items come in through a tool, not text.** The mod registers tools the model calls (`add` an item, `resolve` an item). A `prompt.compose` section (scope `session`) tells the model: every decision, question or info item for the person goes through `add`; never only as chat text; when the person answers in chat instead of the pane, call `resolve`.
2. **Item fields:** kind (`decision` | `question` | `info`), short text, for a decision 2–4 options with at most one marked recommended. The mod assigns ids per session: `D1, D2…`, `Q1…`, `I1…`.
3. **Answering from the pane:** a button or a submitted text field calls `$.prompt.submit({ text, asUser: true })` with the id, the question and the answer (example: `D1 (Merge PR #18?): 1 Yes`). The mod marks the item answered at once. A plugin prompt runs once the session is idle, so an answer given mid-turn waits for that turn to end.
4. **Answered items** move to a folded "Answered" list at the bottom of the pane for the rest of the session.
5. **Info items** have a "Seen" button that dismisses them locally. "Seen" sends nothing to the model.
6. **Subagent progress line** at the bottom of INFO ("Subagents: 2 of 3 back"), from engine state (`$.agent.list()` and agent events), never from model text. Hidden when no background subagent runs.
7. **Opening:** the pane opens unasked when the first open item arrives, unless the person collapsed it in this session. Once collapsed, it stays collapsed; the band and the alert still show new items. A `/open-items` command opens it.
8. **Band:** shows only while the pane is closed and open items exist. Text: `Open items: 1 decision · 1 question · 1 info`, with an `o Open` button. The engine draws its `[-]`.
9. **Alert path:** do NOT rely on `$.ui.notify`. It writes through the person's `preferredNotifChannel`, which is `notifications_disabled` on both of Asaf's seats, and turning that on would enable every Claude Code notification. On macOS, run `osascript` through `$.process.run` (`display notification … sound name …`). On other platforms, fall back to `$.ui.notify`.
10. **The chat rule still holds.** The batch recap still ends with a "Decisions needed:" block in chat. The pane adds visibility; it does not replace the recap.
11. **State:** session items live in `$.state`, declared in `types/index.d.ts`. Nothing persists across sessions (`$.store` unused).
12. **No mod guard needed:** the managed-settings mod guard (Asaf's prerequisite for third-party mods) protects against mods that approve tool calls. This mod approves none (see Anti-goals), and it lives in a repo Asaf controls.

## Layout

Open, docked beside the transcript (fullscreen TUI, window ≥ 110 columns):

```
Open items · 4                    [collapse]
DECISIONS
D1 Merge PR #18 (coo 1.0.4)?  new
   [1 Yes (recommended)] [2 Not yet]
   [or type your own answer…        ]
QUESTIONS
Q1 What should the pane be called?
   [type an answer…                 ]
INFO
CI is red on rhizon #212: 2 tests fail [Seen]
Subagents: 2 of 3 back
▸ Answered (3)
```

Collapsed (one line above the prompt):

```
Open items: 1 decision · 1 question · 1 info        [o Open] [-]
```

Under 110 columns, the engine seats the pane inline above the prompt instead of docked; the same tree draws there.

## Constraints (checked against the Claude Code 2.1.310 mod API)

- `Pane` docks beside the transcript only in the fullscreen TUI from 110 columns; otherwise it is inline above the prompt. A pane opened unasked seats from 144 columns (110 per `$.ui.open`'s doc) and waits below that. Size trees to `e.props.bodyColumns`.
- `AbovePrompt` (the band) is drawn on terminal and desktop only; the engine adds `[-]` collapse itself.
- `Input` exists on terminal, desktop and VS Code, not on mobile.
- `$.tool.register` declares `mcp__open-items__<name>`; a `tool.call` hook on that exact name serves it; registration works from `session.start` on.
- `$.prompt.submit` from a plugin runs once idle; `asUser: true` makes the model read it as the person's words.
- Repo rules: a CHANGELOG line, a version in the plugin's `plugin.json`, a marketplace entry, PR merged by Asaf.

## Left to the builder

- Exact tool names, input schemas and the wording of the `prompt.compose` section (keep it short; it is in every turn).
- How "2 of 3 back" counts a batch (for example, background agents started since the last person prompt).
- Whether `$.process.run` of `osascript` needs a permission rule, and which macOS sound to use.
- Whether `$.state` survives `--resume`; if not, the pane starts empty on resume, and that is acceptable.
- Tests (`claude plugin test`): add an item → pane shows it; press an option → `prompt.submit` called with the expected text and the item moves to Answered; free text → same; collapse → band shows counts; "Seen" → no prompt; a new decision → one alert, an info item → none.

## Rollout

1. PR to this repo: `plugins/open-items`, marketplace entry, CHANGELOG, README line.
2. Install on both of Asaf's seats: `/plugin install open-items@dafna-dev-standards`.
3. Amend the batch rule in Asaf's `~/.claude/CLAUDE.md` and in coo's `orchestration.md`: with open-items installed, put a held item into the pane at once (still no chat text mid-batch).
4. Smoke test in a real session: a background subagent batch that raises one decision and one question mid-batch; answer one from the pane and one in chat.
