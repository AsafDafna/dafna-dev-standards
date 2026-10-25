# open-items: a pane for decisions, questions, actions and info

**Date:** 2026-10-25 · **Status:** approved direction (Asaf: "fork it, use it as a starting point, take the good stuff, remove the bad stuff, add what is needed")
**Users:** Asaf first (Mac, Ghostty + herdr, fullscreen TUI, personal + org seats); Nir may install it (opt-in plugin).

## Intent

Sessions that run background subagents post questions and findings into the chat while the work goes on. Asaf does not watch the session while it works, so later hand-backs push those questions out of view and they get lost. A CLAUDE.md rule against this has failed several times. This mod keeps every decision, question, action and important finding for the person in a pane, visible and answerable until it is resolved.

## Starting point

`plugins/open-items/` starts as a verbatim copy of `tzafrir/human-in-the-loop` 0.1.8 at `bf8233cd` (MIT; its LICENSE and copyright line stay). Commit `1c1f545` is that import, so `git diff 1c1f545 -- plugins/open-items` shows every change we made. This is a one-time copy, not a tracked fork: upstream changes are not merged.

Upstream baseline: `claude plugin validate` passes; `claude plugin test` 192 pass. Upstream's own design doc (kept out of the plugin) is at `docs/DESIGN.md` in the upstream repo and explains the delivery and persistence logic.

## Decided by Asaf (2026-10-24/25)

1. One pane per session, showing only that session's items.
2. Layout A: grouped by kind, decisions first.
3. A decision offers its options and a free-text answer.
4. The pane is collapsible and leaves a one-line summary.
5. A new item alerts him with a macOS notification and a sound.
6. Home: a new opt-in plugin `open-items` in this marketplace.
7. Fork upstream as a starting point and modify it.

## Keep from upstream

- The tool-based mechanism: Claude calls a tool instead of writing the ask in prose; the tool is not deferred (`tool.describe` → `isDeferred: false`).
- Refusing the tools from subagents (`e.agentId` set).
- No steering section and no tools' prompt section in `print` or `bare` sessions.
- Delivery: Send now while idle (`$.prompt.submit`, `asUser`), Save for later while Claude works, the mid-turn append, the final-reply wake-up, the next-prompt digest, `prompt.context` after compaction.
- A response that does not reach Claude stays saved (drop handling).
- The inline answer field, the composer bridge for long answers, the secret guard.
- The cap of 5 open asks, duplicate merge, withdraw with a reason.
- The status line under the prompt and the command that opens the pane. The pane closes itself when empty.
- The `ToolUse` transcript row, the system notice rows, the mobile and desktop handling.
- The test kit (`tests/register.test.tsx`) and the live render harness (`tests/live/`).

## Remove from upstream

- All 0.1.4 legacy handling (`editLegacy`, the legacy project value, legacy notes) and its tests.
- The multi-session machinery: project-wide slots, joining a project, the heartbeat, quiet-session detection, taking on another session's tasks, the `took` notes, project-wide numbering, the "N tasks in another session" status, and the "across sessions" tests. Asaf's rule already gives parallel sessions their own worktrees, so the case this serves is rare, and it is most of the complexity.
- Upstream's website files, icon, marketing README and `docs/DESIGN.md` from the plugin folder.

**Replacement persistence (Claude's call):** one `$.store` key per session id. The session writes it on every change and reads it at `session.start`, so `--resume` brings the items back. On `/clear` (`session.end` reason `clear`), the new session starts empty, because the items refer to a conversation the model no longer has. The old key stays, so `claude --resume <old id>` brings them back, until the 30-day cleanup. At start, keys older than 30 days are deleted. Numbering is per session (`#1, #2, …`).

## Add

1. **Rename to `open-items` everywhere:** plugin name, state keys, tools, command, prompts, toasts, tests. The long-answer prefix `↳ Answer to #N:` stays (it has no upstream name). Model-facing tool names: `mcp__open-items__add_item`, `list_items`, `withdraw_item`. Command: `/open-items`. Pane title: "Open items".
2. **Four kinds, model-facing:** `decision` (upstream `choose`: 2–4 options, one may be marked recommended, plus "Other…" free text), `question` (upstream `answer`), `action` (upstream `do`: something only the person can do; Done), and the new `info`.
3. **The `info` kind:** a finding the person must see (a CI failure, a result that changes their plan). It has one button, **Seen**, which dismisses it locally and sends nothing to Claude. Info items do not count toward the cap of 5 open asks; at most 5 info items stay, and a sixth drops the oldest.
4. **Grouped pane:** sections DECISIONS, QUESTIONS, ACTIONS, INFO, in that order; an empty section is not drawn. Within a section, oldest first. The selected-item action row and hotkeys work as upstream.
5. **Status line by kind:** `☐ 1 decision · 1 question · 1 info · /open-items` (plus upstream's "N not sent yet" when it applies). This is the collapsed summary. It needs no band, works at any width, and no other mod can cover it.
6. **Recommended option:** a decision's recommended option shows `(recommended)` after its label.
7. **Alert:** when Claude adds a `decision`, `question` or `action`, the mod calls `$.ui.notify(text, { title: 'Open items' })`. One call per turn at most: it fires when the turn's first such item is added (not at the turn's end, which can be an hour later) and names that item. No alert for `info`. No alert if the person typed a prompt (origin `composer` or `bridge`) or pressed a pane button in the last 2 minutes, because they are present. The mod runs no host command.
8. **Steering text** (the `prompt.compose` section and the tool descriptions), short:
   - Add an item for a decision that is the user's, a question only they can answer, an action only they can do, or info they must see.
   - Add it even when you also ask in your reply. When the user answers in chat instead, withdraw the item with reason "answered in chat".
   - While background agents run, add the item and write no chat text about it until the batch ends.
   - If `add_item` fails, ask in chat.
9. **Hooks-list test:** a test asserts that every `tool.call` hook matches one of the mod's own three tools, so the mod can never approve another tool's call.
10. **README:** short. What the mod does, what it puts in the prompts it submits, the alert path, and the credit to upstream.
11. **CI:** a workflow on `paths: [plugins/open-items/**]` installs a pinned `@anthropic-ai/claude-code` and runs `claude plugin validate` and `claude plugin test` for the plugin. It is not a required check.

## The alert path (verified 2026-10-25, Claude Code 2.1.310)

A probe mod showed on both seats: `$.ui.notify` returns `{ isSent: false, reason: 'disabled' }` because `preferredNotifChannel` is `notifications_disabled`, but a settings `Notification` hook with matcher `plugin_notification` still receives the call (`message`, `title`). The org seat's `sec-default` guard admitted a module that calls `$.process.run`, so either path would load there; the mod still runs no host command.

So the public mod only calls `$.ui.notify`. On Asaf's machine, a private hook (outside this repo) turns it into a macOS notification with a sound: `~/.claude/hooks/open-items-alert.sh`, wired as a `Notification` hook with matcher `plugin_notification` in both seats' `settings.json`. The hook passes the text to `osascript` as an argument (`on run argv`), never inside the script source, so a quote in the text cannot run code. Another user gets the alert through their own notification channel.

## Constraints (Claude Code 2.1.310 mod API)

- A pane Claude opens is seated only from 144 columns (110 once the person opened it before); below that the status line still shows the count and a toast names the item. `/open-items` opens it at any width.
- `Input` is drawn on terminal, desktop and VS Code, not on mobile.
- Upstream saw `isDeferred: false` ignored when the mod loaded mid-session; the smoke test uses a session started with the plugin installed.
- The repo's required CI runs only jq, shellcheck and the leak gate; the new open-items workflow (Add 11) adds validate and test. `tsc -p` and the live harness run locally before the PR. The leak gate scans `plugins/`, so plugin files never name people or Asaf's tools.
- Repo rules: CHANGELOG line, `open-items` version `0.1.0`, a marketplace entry, PR merged by Asaf.

## Rollout

1. PR to this repo with the plugin, the CI workflow, the marketplace entry and CHANGELOG.
2. Personal config (claude-config): `open-items-alert.sh`, the `Notification` hook on both seats, and the batch rule in `~/.claude/CLAUDE.md` amended: with open-items installed, a held item goes into the pane at once, still with no chat text mid-batch.
3. coo `orchestration.md`: the same amendment, with a coo version bump and a CHANGELOG line (after PR #18).
4. Install on both seats after the PR merges: `/plugin install open-items@dafna-dev-standards`.
5. Smoke test in a fresh session (Asaf): a background batch that adds a decision and a question; the alert is seen and heard; one answer from the pane, one in chat.

## Success criterion

In the first 10 background batches after install, no question reaches the chat without an item, counted from the transcripts. If one does, add a deterministic `turn.complete` check (a question line or numbered options in the final text with no `add_item` call that turn → remind Claude next turn). Skipped until then.

## Skipped

- Moshi push for items: add when Asaf reads sessions on the iPhone often. (The existing presence gate already pushes on Stop when he is away from the Mac.)
- A subagent progress line: add when Asaf asks for live progress on long fan-outs.
- Items that outlive the session or move between sessions: add if per-session items prove too short-lived.
- The `turn.complete` detector: see the success criterion.
