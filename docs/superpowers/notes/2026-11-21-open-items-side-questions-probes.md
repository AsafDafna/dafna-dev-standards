# open-items side questions: live probes (2026-11-21)

Claude Code 2.1.330, herdr TUI, personal seat, auto mode. A throwaway mod loaded with `claude --plugin-dir` ran each check from control files and logged `turn.start`, `turn.complete`, `agent.report`, `agent.offer` and `prompt.submit`. It had no `tool.call` or `tool.check` hook. A sampler read `herdr agent list` for the main pane about once a second.

The question: should the helper run as an agent that the mod registers (the agent option), or as a separate headless `claude -p` process that the mod starts (the hidden session option)?

## Deciding reading: herdr status of the main pane

Main idle and already seen. A hidden session ran first, then an agent helper (spawned at 10:15:01.27, report at 10:15:06.63):

```
10:15:00.712 status=idle    rule=live_prompt_box   title='✳ PELICAN-47 code word'
10:15:01.735 status=idle    rule=osc_title_working title='◐ PELICAN-47 code word'
10:15:02.756 status=working rule=osc_title_working title='◐ PELICAN-47 code word'
10:15:05.850 status=working rule=osc_title_working title='◐ PELICAN-47 code word'
10:15:06.884 status=done    rule=live_prompt_box   title='✳ PELICAN-47 code word'
```

- Agent helper: in all 7 runs and follow-ups, the title spinner came on while the helper ran, and herdr marked a new `done` when it ended. No mod API reaches the terminal title.
- Hidden session: the status stayed `idle` (or stayed `done` with the same completion count) through every run.
- A background agent that the model starts does the same as the agent helper. A Bash command that the model puts in the background did not keep the spinner.

Asaf accepted the agent option's status cost, because the status changes only while a helper answers, never while it rests.

## Agent option: checks

The probe helper was registered with `tools: ["Read", "Grep", "Glob"]`, Sonnet at effort low, `omitClaudeMd` and `maxTurns: 15`. The spec's helper differs (Opus at medium effort, CLAUDE.md kept), so cost and time here are not the spec's.

| Check | Result |
|---|---|
| The tool list alone (`tools: ["Read", "Grep", "Glob"]`) refuses other tools | Passed. `$.agent.call` as the helper: `Write`, `Bash`, `Agent` and an MCP tool each answered `that agent has no tool named "X"`. `Read` worked. No file was made. |
| It runs on the model and effort set in `$.agent.register` | Passed. `claude-sonnet-5-5`, effort low, while main ran Opus 5.5 at xhigh. |
| A follow-up resumes the finished helper with its memory | Passed. `$.session.send({ to: { agentId }, text })` delivered; the same helper recalled the earlier answer; same model. It works after the helper left `$.agent.list()` (about 95 s after it ended). The tool limit after a resume is only the model's own report. |
| Main gets no turn when a helper ends | Passed only when the mod's `agent.report` hook returns `{ consumed }`. Without it the report reached main as a prompt and started a full main turn. |
| The mod can stop a running helper | Passed: a `TaskStop` call through `$.tool.call`, with the helper's `agentId` as the task id, answered "Successfully stopped task". `$.turn.abort` does not reach a helper's turn. The 2.1.330 types say that where `cc-plugin-sec-default` is seated (the org seat), a person's mod gets `{ deny }` on `$.tool.call` until that call is allowed. |
| The helper finds a planted word in the main conversation file (outside the working folder) | Passed: two Grep calls, 7.5 s, no permission prompt (auto mode). |
| `$.prompt.submit` sent while main's turn runs | Starts its own main turn about 130 ms after that turn ends, also while a helper still runs. |

Agent helper times and tokens (Sonnet, effort low): 2.4 to 7.5 s for a short question; 26 s for a 14-search question. Cache reads 3k to 160k tokens a run.

## Gotchas for the build

1. With the report consumed, `turn.complete`'s answer is empty. Take the answer from `agent.report`'s `e.text`.
2. `agent.offer` returning `{ isOffered: false }` also refuses `$.agent.call` as that agent. A resume offer carries `agentId` and passes.
3. The mod's own `$.agent.spawn` does not raise its own `agent.spawn` hook.
4. Main's agent panel lists each helper while it runs.
5. The helper's model named `SubagentHandback` and `advisor` beside its three tools. Whether it can call them was not checked.

## Hidden session option (not chosen)

It works, with costs: it needs `--strict-mcp-config` (with only `--tools Read,Grep,Glob` every MCP tool stayed, Gmail's send among them) and `--safe-mode` (without it, a one-word answer wrote 51,710 cache tokens). It inherits main's whole environment. Its transcripts land in main's project folder, so `--resume` lists them.

## Not tested

- Any of this on the org seat.
- A permission mode other than auto.
- A follow-up after a long pause (cache expired).
- Rex: it reads status from the program's own escape sequence (OSC 7501); how it shows a mod helper is unknown.
- Opus as the helper's model.

# Step 0 probes (2026-11-24)

Claude Code 2.1.331, manual mode, the spec's helper: Opus 5.5 at medium effort, CLAUDE.md kept, `tools: ["Read", "Grep", "Glob"]`. The same throwaway mod as above, loaded with `claude --plugin-dir`. Personal seat run by a subagent; the org seat and the phone check run by the lead after Asaf's go.

| Probe | Result | Evidence |
|---|---|---|
| 0.1 org seat | Passed | Register, spawn and resume work; a consumed report started no main turn; after a resume, `$.agent.call` as the helper is refused for `Write`, `Bash`, `Agent`, an MCP tool and `SubagentHandback`; `$.session.messages()` and `$.session.info()` answer; `TaskStop` through `$.tool.call` stopped a helper, with no deny from `cc-plugin-sec-default`. `advisor` is listed as a deferred tool (`defer_loading: true`) that the helper cannot load; no call was made. |
| 0.1 personal seat | Passed, but `advisor` is callable | The same checks pass. Asked to, the helper made real `advisor` calls (Fable, about 12k to 14k uncached input tokens each); `disallowedTools: ["advisor"]` did not stop it. No helper called it unprompted (11 helpers). Likely source: `advisorModel` in the personal settings (not tested). |
| 0.2 cost, org seat | About 0.05% of the five-hour window per side question | A cold helper search of a 4.9 MB real conversation: 6 requests, 12 tool uses, 2,746 output, 20,628 cache write, 71,453 cache read tokens. A warm repeat: 2,021 output, 8,224 cache write, 61,116 cache read. A main turn from a helper's question in a short session: 148 output, 16,448 cache write, 43,024 cache read. Percent from weighted tokens (input 1, output 5, cache write 1.25, cache read 0.1) against this week's org logs: 1% of the week is about 4.85M weighted, 1% of the five-hour window about 0.92M. Both answers were right. In a long real session the main turn reads its whole context: about 30k weighted per 300k tokens warm, about 375k weighted when main's cache has lapsed. |
| 0.3 permission modes | Passed with `permissionMode: "dontAsk"` | In default mode, `Read` and `Grep` of the main conversation file and the scratchpad raise no dialog. A read elsewhere showed a Yes/No dialog on main's screen in mid-turn, and the helper waited. With `dontAsk` the read is refused with no dialog and the helper says so. |
| 0.4 phone | Passed | A stand-in command registered `immediate: true`, sent from the Claude app through Remote Control while main wrote a long answer, ran 5.5 s into the turn. |
| 0.5 late follow-up | Passed | A resume after 31 minutes recalled the code word, still Opus at medium effort. Its cache was cold (10.4k cache write, no read): a helper's cache lasts 5 minutes. |
| 0.6 personal seat | No five-hour window | `rateLimits` lists only `seven_day`. |
| 0.7 `/side` and the main model (personal seat) | The question never reaches main | Two stand-in commands, sent with a planted word while main was idle and while it answered. The arguments never reached main (it saw `<command-args></command-args>` empty), and the transcript does not store them. The command name line reached main. The output text reached main mid-turn, also with `isTextDisplayOnly: true`; it stayed out only when answered while idle. So `/side` answers with neutral text and `isTextDisplayOnly: true`. |
| 0.8 a spawn before the first turn (personal seat) | Passed | In a session that never had a prompt, the mod registered the helper and spawned it 0.5 s later. It answered, and its report was consumed. |
| 0.9 a spawn from the report hook (personal seat) | Passed | Inside a consumed report's `agent.report` hook, a helper spawned directly and one spawned from `$.clock.after(0, …)` both answered and were consumed; main got no turn. Not tested: a chain three or more deep. The types say a spawn made handling a subagent's event counts one level deeper and a timer's counts at depth 1, so queued helpers start from `$.clock.after(0, …)`. |
