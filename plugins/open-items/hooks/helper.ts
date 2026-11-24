import { atom, read, update } from 'claude-code'
import type { AgentInfo, AgentReportInput, AgentReportResult, AgentSpawnResult, EngineInterface, On } from 'claude-code'

import type { Task, ToMain } from '../types'
import { AT_WORK, isLiveChat } from './gate'
import { HELPER_LIMIT_MS, HELPER_PROMPT, HELPER_TYPE, LOG_NAME, MAX_SUMMARY, answeredOf, followUpOf, helperPromptOf, isPending, isWorking, logOf, newSideOf, newestUserOf, noticedOf, questionForMain, refusedOf, reportOf, rowsTextOf, sentOf, summaryOf } from './side'
import { LOADING, NEXT_ID_INITIAL, TASKS_INITIAL, change, edit, live, settle, show } from './state'
import { MAX_DETAIL, isActive, looksSecret, movedBy, replyOf } from './tasks'

const tasks = atom({ plugin: 'open-items', key: 'tasks' } as const, TASKS_INITIAL)
const nextId = atom({ plugin: 'open-items', key: 'nextId' } as const, NEXT_ID_INITIAL)

const SECRET = "This looks like a secret, so it wasn't sent. Put it where it belongs, then ask without it."
// It holds none of the question: when the command runs mid-turn, this text reaches the main session.
const TAKEN = 'A helper takes this side question (Open items); the main session goes on.'
const CONSUMED: AgentReportResult = { consumed: 'open-items wrote the answer in its side question' }
const FOLLOW_UP = /^#(\d+)(?:\s+([\s\S]*))?$/
const TIMED_OUT = 'The helper did not answer in 10 minutes.'

export async function registerHelper($: EngineInterface): Promise<void> {
  await $.agent
    .register({
      name: 'helper',
      description: 'Answers a side question the user left in the Open items pane; only the open-items mod starts it.',
      prompt: HELPER_PROMPT,
      tools: ['Read', 'Grep', 'Glob'],
      model: 'opus',
      effort: 'medium',
      maxTurns: 20,
      permissionMode: 'dontAsk',
    })
    .catch(() => undefined)
}

export function helperHooks(on: On): void {
  // Fails closed: a failed hook never offers the helper to the main model.
  on('agent.offer', { agent: 'open-items:helper' }, ($, e, next) => (e.agentId === undefined ? { isOffered: false } : next(e))).catch(() => ({ isOffered: false }))

  on('command.run', { command: 'side' }, async ($, e) => {
    const text = e.args.trim()

    if (text === '') {
      await show($, true)
      return {}
    }

    if (looksSecret(text)) {
      $.ui.toast(SECRET)
      return {}
    }

    const followed = FOLLOW_UP.exec(text)
    const isTaken = followed ? await followUp($, Number(followed[1]), followed[2] ?? '') : await askNew($, text)

    return isTaken ? { text: TAKEN, isTextDisplayOnly: true } : {}
  })

  // A hook that throws or overruns is skipped, and the report would start a main turn.
  on('agent.report', { subagentType: 'open-items:helper' }, async ($, e) => {
    await reported($, e).catch(() => undefined)
    // A spawn from a timer counts at depth 1; one made in this event would count one level under the helper (probe 0.9).
    $.clock.after(0, () => void pump($))

    return CONSUMED
  }).catch(() => CONSUMED)
}

function refusalOf(text: string): string | undefined {
  if (text.trim() === '') {
    return 'Type a question first.'
  }

  if (text.length > MAX_DETAIL) {
    return `Your side question is ${text.length} characters, so it wasn't sent: the most is ${MAX_DETAIL}.`
  }

  return live.loading === null ? undefined : LOADING
}

export async function askNew($: EngineInterface, text: string): Promise<boolean> {
  const refusal = refusalOf(text)

  if (refusal !== undefined) {
    $.ui.toast(refusal)
    return false
  }

  const nowMs = await $.clock.now()
  const id = (await update($, nextId, n => n + 1)) - 1
  const transcript = (await $.session.info().catch(() => undefined))?.transcriptPath ?? ''

  await change($, list => [...list, newSideOf(id, text, nowMs, transcript)])
  $.ui.toast(`Side question #${id} sent`)
  await writeLog($)
  void pump($)

  return true
}

const isOpenSide = (task: Task) => task.kind === 'side' && task.state === 'open'

export async function followUp($: EngineInterface, id: number, text: string): Promise<boolean> {
  const refusal = refusalOf(text)

  if (refusal !== undefined) {
    $.ui.toast(refusal)
    return false
  }

  const found = await edit($, id, (task, nowMs) => (isOpenSide(task) ? movedBy(task, replyOf(text), nowMs) : task))

  if (found === undefined || !isOpenSide(found)) {
    $.ui.toast(`#${id} is not an open side question.`)
    return false
  }

  await settle($, id)
  void pump($)

  return true
}

/** One run at a time, in the order asked. It never rejects, so a caller may leave it unawaited. */
export function pump($: EngineInterface): Promise<void> {
  const done = live.pumpQueue.then(() => pumpNow($)).catch(() => undefined)
  live.pumpQueue = done

  return done
}

async function pumpNow($: EngineInterface) {
  const tried = new Set<number>()

  for (;;) {
    const list = await read($, tasks)
    const next = list.some(isWorking) ? undefined : waitingOf(list, tried)

    if (next === undefined) {
      return
    }

    tried.add(next.id)
    await askHelper($, next)
  }
}

function waitingOf(list: readonly Task[], tried: ReadonlySet<number>): Task | undefined {
  const atOf = (task: Task) => newestUserOf(task)?.atMs ?? 0

  return list.filter(task => isPending(task) && !tried.has(task.id)).sort((one, other) => atOf(one) - atOf(other))[0]
}

async function askHelper($: EngineInterface, task: Task) {
  const givenMs = newestUserOf(task)?.atMs
  const helperId = task.side?.helperId

  if (helperId !== undefined && (await resumeHelper($, task, helperId))) {
    await handedOver($, task.id, helperId, givenMs)
    return
  }

  await startHelper($, task, givenMs)
}

async function handedOver($: EngineInterface, id: number, helperId: string, givenMs: number | undefined) {
  arm($, helperId)
  await edit($, id, found => sentOf(found, helperId, givenMs))
}

function arm($: EngineInterface, helperId: string) {
  disarm(helperId)
  live.helperTimers.set(helperId, $.clock.after(HELPER_LIMIT_MS, () => void timedOut($, helperId).catch(() => undefined)))
}

function disarm(helperId: string) {
  live.helperTimers.get(helperId)?.cancel()
  live.helperTimers.delete(helperId)
}

const isRunOf = (helperId: string) => (task: Task) => isWorking(task) && task.side?.helperId === helperId

async function timedOut($: EngineInterface, helperId: string) {
  live.helperTimers.delete(helperId)
  const task = (await read($, tasks)).find(isRunOf(helperId))

  if (task === undefined) {
    return
  }

  const sentMs = task.side?.sentMs
  const isRun = (found: Task) => isRunOf(helperId)(found) && found.side?.sentMs === sentMs

  if (!(await stopHelper($, helperId))) {
    const agents = await $.agent.list().catch(() => undefined)

    // Still at work, or out of sight: checked again later, as its maxTurns bound ends it and its report goes on as usual.
    if (agents === undefined || atWorkIn(agents, helperId)) {
      arm($, helperId)
      return
    }
  }

  await edit($, task.id, (found, nowMs) => (isRun(found) ? timedOutOf(found, nowMs) : found))
  await writeLog($)
  await pump($)
}

// The old helper may still run: its late report then finds no item, and a follow-up starts a fresh helper.
function timedOutOf(task: Task, nowMs: number): Task {
  const noticed = noticedOf(task, TIMED_OUT, nowMs)
  const { helperId, ...side } = noticed.side ?? { transcripts: [] }

  return { ...noticed, side }
}

/** Resolves whether the helper's run is over: `TaskStop` stopped it, so its stopped report says nothing in the item, or its own report came while the call ran. */
export async function stopHelper($: EngineInterface, agentId: string): Promise<boolean> {
  // Held before the call, as the stopped helper's report may come before the call resolves.
  live.stoppedHelpers.add(agentId)
  const answer = await $.tool.call({ tool: 'TaskStop', task_id: agentId }).catch(() => undefined)

  if (answer !== undefined && answer.deny === undefined && answer.isError !== true) {
    return true
  }

  // A report that came while the call ran took the mark: that helper has ended.
  return !live.stoppedHelpers.delete(agentId)
}

function atWorkIn(agents: readonly AgentInfo[], agentId: string | undefined): boolean {
  return agents.some(agent => agent.id === agentId && AT_WORK.includes(agent.status))
}

/** Resolves whether the follow-up reached the helper. */
async function resumeHelper($: EngineInterface, task: Task, helperId: string): Promise<boolean> {
  const seenUuid = task.side?.seenUuid
  const rows = seenUuid === undefined ? undefined : await $.session.messages({ after: seenUuid }).catch(() => undefined)
  const since = Array.isArray(rows) ? rowsTextOf(rows, MAX_SUMMARY) : ''
  const sent = await $.session.send({ to: { agentId: helperId }, text: followUpOf(task, since) }).catch(() => undefined)

  return sent?.isDelivered === true
}

async function startHelper($: EngineInterface, task: Task, givenMs: number | undefined) {
  const prompt = await promptOf($, task)
  const spawned: AgentSpawnResult = await $.agent
    .spawn({ subagentType: HELPER_TYPE, description: `Side question #${task.id}`, prompt })
    .catch((error: unknown) => ({ deny: error instanceof Error ? error.message : String(error) }))
  const agentId = spawned.agentId

  if (agentId === undefined) {
    const line = `The helper could not start: ${spawned.deny ?? 'no helper id came back'}`

    await edit($, task.id, (found, nowMs) => refusedOf(found, line, nowMs, givenMs))
    return
  }

  await handedOver($, task.id, agentId, givenMs)
}

async function promptOf($: EngineInterface, task: Task): Promise<string> {
  const [info, messages, list] = await Promise.all([$.session.info().catch(() => undefined), $.session.messages().catch(() => []), read($, tasks)])
  const scratchpad = info?.scratchpadDir
  const text = logOf(list)

  return helperPromptOf({
    task,
    summary: summaryOf(messages),
    current: info?.transcriptPath ?? '',
    log: scratchpad && !live.isLogFailing ? { path: `${scratchpad}/${LOG_NAME}`, text } : { text },
  })
}

async function reported($: EngineInterface, e: AgentReportInput) {
  // After our stop, its stopped report ends no run: the stop ended it and owns its timer. Any other report clears the mark.
  if (live.stoppedHelpers.delete(e.agentId) && e.status === 'stopped') {
    return
  }

  disarm(e.agentId)
  const task = (await read($, tasks)).find(found => found.side?.helperId === e.agentId)

  if (task === undefined) {
    return
  }

  const text = e.text.trim()
  const isAnswer = e.status === 'completed' && text !== ''
  const rows = isAnswer ? await $.session.messages({ last: 1 }).catch(() => undefined) : undefined
  const seenUuid = Array.isArray(rows) ? rows[0]?.uuid : undefined
  const found = await edit($, task.id, (current, nowMs) => (isAnswer ? answeredOf(current, text, nowMs, seenUuid) : noticedOf(current, noticeOf(e.status, text), nowMs)))

  if (isAnswer && found !== undefined && isActive(found)) {
    $.ui.toast(`Side question #${task.id} has an answer. See /open-items`)

    // A running turn sends it as it ends; after the user's Esc it rides their next typed prompt.
    if (reportOf(text).toMain?.kind === 'question' && live.mainTurn !== true && !live.wasStopped) {
      void sendQuestions($)
    }
  }

  await writeLog($)
}

function noticeOf(status: AgentReportInput['status'], text: string): string {
  switch (status) {
    case 'completed':
      return 'The helper gave no answer.'
    case 'failed':
      return `The helper could not answer: ${text.split('\n')[0]?.trim() || 'no reason given'}`
    case 'stopped':
      return 'The helper stopped before it answered.'
  }
}

const isAskingMain = (task: Task) => isOpenSide(task) && task.side?.toMain?.kind === 'question' && task.side.toMain.sentMs === undefined

/** `task` with its message for the main session as `fn` makes it: none when `fn` gives undefined. */
function withToMain(task: Task, fn: (toMain: ToMain) => ToMain | undefined): Task {
  const { toMain, ...side } = task.side ?? { transcripts: [] }
  const made = toMain === undefined ? undefined : fn(toMain)

  return { ...task, side: made === undefined ? side : { ...side, toMain: made } }
}

/**
 * Sends the helpers' waiting questions to the main session as one prompt in
 * the mod's own name, never in the user's words. In a live chat they wait,
 * and ride the user's next typed prompt. It never rejects.
 */
export async function sendQuestions($: EngineInterface): Promise<void> {
  try {
    if (!(await read($, tasks)).some(isAskingMain) || (await isLiveChat($, await $.clock.now())) === true) {
      return
    }

    const sentMs = await $.clock.now()
    let due: readonly Task[] = []

    // Marked before the send, as `claim` marks: a send or a typed prompt meanwhile finds none of them waiting.
    await change($, list => {
      due = list.filter(isAskingMain)

      return due.length === 0 ? list : list.map(task => (isAskingMain(task) ? withToMain(task, toMain => ({ ...toMain, sentMs })) : task))
    })

    if (due.length === 0) {
      return
    }

    const sent = await $.prompt.submit({ text: due.map(questionForMain).join('\n\n') }).catch(() => undefined)

    if (sent === undefined || sent.drop !== undefined) {
      const isMarked = (task: Task) => due.some(one => one.id === task.id) && task.side?.toMain?.sentMs === sentMs

      await change($, list => list.map(task => (isMarked(task) ? withToMain(task, ({ sentMs: was, ...toMain }) => toMain) : task)))
    }
  } catch {
    // A question left unmarked goes at the next turn's end, or rides the next typed prompt.
  }
}

/** After the user's typed prompt carried items `ids` to the main session: their notes are gone, their questions sent. */
export async function rode($: EngineInterface, ids: readonly number[]): Promise<void> {
  if (ids.length === 0) {
    return
  }

  const nowMs = await $.clock.now()
  const isRiding = (task: Task) => ids.includes(task.id) && task.side?.toMain !== undefined && task.side.toMain.sentMs === undefined

  await change($, list => list.map(task => (isRiding(task) ? withToMain(task, toMain => (toMain.kind === 'note' ? undefined : { ...toMain, sentMs: nowMs })) : task)))
}

export async function writeLog($: EngineInterface): Promise<void> {
  const scratchpad = (await $.session.info().catch(() => undefined))?.scratchpadDir

  if (!scratchpad) {
    return
  }

  try {
    await $.fs.write(`${scratchpad}/${LOG_NAME}`, logOf(await read($, tasks)))
    live.isLogFailing = false
  } catch {
    live.isLogFailing = true
  }
}

/** After a restart or a resume: a working item's helper died with the old process, and no report or timer would end its work. */
export async function revive($: EngineInterface): Promise<void> {
  const agents = await $.agent.list().catch(() => [])
  const isGone = (task: Task) => isWorking(task) && !atWorkIn(agents, task.side?.helperId)

  await change($, list => (list.some(isGone) ? list.map(task => (isGone(task) ? unsentOf(task) : task)) : list))
  await pump($)
}

function unsentOf(task: Task): Task {
  const { sentMs, ...side } = task.side ?? { transcripts: [] }

  return { ...task, side }
}
