import { atom, read, update } from 'claude-code'
import type { AgentInfo, AgentReportInput, AgentReportResult, AgentSpawnResult, EngineInterface, On, PromptSubmitResult } from 'claude-code'

import type { Task, ToMain } from '../types'
import { AT_WORK, isLiveChat } from './gate'
import { ALERT_AT, HELPER_LIMIT_MS, HELPER_PROMPT, HELPER_TYPE, HOLD_AT, LOG_NAME, MAX_SUMMARY, answeredOf, fiveHourOf, followUpOf, helperPromptOf, isPending, isWorking, logOf, newSideOf, newestUserOf, noticedOf, questionForMain, refusedOf, reportOf, ridingOf, rowsTextOf, sentOf, summaryOf } from './side'
import { LOADING, NEXT_ID_INITIAL, TASKS_INITIAL, change, edit, live, refresh, settle, showField } from './state'
import type { QuotaHold } from './state'
import { DONE, MAX_DETAIL, isActive, looksSecret, movedBy, replyOf } from './tasks'

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
      await showField($)
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

  on('session.measure', ($, e, next) => {
    if (e.changed.includes('rateLimits') && live.quotaHold !== null) {
      void quotaAllows($).catch(() => undefined)
    }

    return next(e)
  })
}

export function refusalOf(text: string): string | undefined {
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

/** The user's Done on side question `id`: a helper at work on it is stopped first, and the next side question goes. */
export async function doneSide($: EngineInterface, id: number): Promise<void> {
  const task = (await read($, tasks)).find(found => found.id === id)
  const helperId = task?.side?.helperId

  if (task !== undefined && isWorking(task) && helperId !== undefined) {
    disarm(helperId)
    await stopHelper($, helperId)
  }

  await edit($, id, (found, nowMs) => movedBy(found, DONE, nowMs))
  await settle($, id)
  await writeLog($)
  void pump($)
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

    if (next === undefined || !(await quotaAllows($))) {
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

export function disarm(helperId: string) {
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

    if (reportOf(text).toMain?.kind === 'question') {
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

const isNoting = (task: Task) => isOpenSide(task) && task.side?.toMain?.kind === 'note'

/** `task` with its message for the main session as `fn` makes it: none when `fn` gives undefined. */
function withToMain(task: Task, fn: (toMain: ToMain) => ToMain | undefined): Task {
  const { toMain, ...side } = task.side ?? { transcripts: [] }
  const made = toMain === undefined ? undefined : fn(toMain)

  return { ...task, side: made === undefined ? side : { ...side, toMain: made } }
}

/** Marks the questions that wait for the main session sent at `sentMs`, as `claim` marks, and resolves them as they stood: no other path takes them meanwhile. */
async function claimQuestions($: EngineInterface, sentMs: number): Promise<readonly Task[]> {
  let due: readonly Task[] = []

  await change($, list => {
    due = list.filter(isAskingMain)

    return due.length === 0 ? list : list.map(task => (isAskingMain(task) ? withToMain(task, toMain => ({ ...toMain, sentMs })) : task))
  })

  return due
}

/** Gives back the questions of the claim at `sentMs` that never reached the main session: those that still hold its mark. */
async function unclaim($: EngineInterface, lost: readonly Task[], sentMs: number) {
  const isMarked = (task: Task) => lost.some(one => one.id === task.id) && task.side?.toMain?.sentMs === sentMs

  if (lost.length > 0) {
    await change($, list => list.map(task => (isMarked(task) ? withToMain(task, ({ sentMs: was, ...toMain }) => toMain) : task)))
  }
}

/**
 * Sends the helpers' waiting questions to the main session as one prompt in
 * the mod's own name, never in the user's words. While the main turn runs
 * they go as it ends; after the user's Esc, or in a live chat, they wait and
 * ride the user's next typed prompt. It never rejects.
 */
export async function sendQuestions($: EngineInterface): Promise<void> {
  if (live.mainTurn === true || live.wasStopped) {
    return
  }

  try {
    if (!(await read($, tasks)).some(isAskingMain) || (await isLiveChat($, await $.clock.now())) === true) {
      return
    }

    if (!(await quotaAllows($))) {
      return
    }

    const sentMs = await $.clock.now()
    const due = await claimQuestions($, sentMs)

    if (due.length === 0) {
      return
    }

    const sent = await $.prompt.submit({ text: due.map(questionForMain).join('\n\n') }).catch(() => undefined)

    if (sent === undefined || sent.drop !== undefined) {
      await unclaim($, due, sentMs)
    }
  } catch {
    // A question left unmarked goes at the next turn's end, or rides the next typed prompt.
  }
}

/**
 * What rides the user's typed prompt: each note and question that waits for
 * the main session. Its questions are claimed now, so no send takes them
 * while the prompt passes; `carry` passes the prompt on, then drops the notes
 * it carried and gives back the questions it did not.
 */
export async function takeRiding($: EngineInterface): Promise<{ context: string; carry: <R extends PromptSubmitResult>(pass: () => Promise<R>) => Promise<R> } | undefined> {
  const sentMs = await $.clock.now()
  const questions = await claimQuestions($, sentMs)
  const notes = (await read($, tasks)).filter(isNoting)
  const riding = ridingOf([...notes, ...questions].sort((one, other) => one.id - other.id))

  if (riding === undefined) {
    return undefined
  }

  const { context, messages } = riding

  async function carry<R extends PromptSubmitResult>(pass: () => Promise<R>): Promise<R> {
    let carried: readonly string[] = []

    try {
      const result = await pass()
      carried = result.drop === undefined ? (result.context ?? []) : []

      return result
    } finally {
      const isCarried = (id: number) => carried.some(block => block.includes(`Side question #${id} (Open items)`))

      await rode($, messages.filter(({ id }) => isCarried(id))).catch(() => undefined)
      await unclaim($, questions.filter(task => !isCarried(task.id)), sentMs).catch(() => undefined)
    }
  }

  return { context, carry }
}

/** Drops the notes a typed prompt carried, by their `atMs`: a note that replaced one meanwhile waits for the next. */
async function rode($: EngineInterface, carried: readonly { id: number; atMs: number }[]) {
  const isCarried = (task: Task) => isNoting(task) && carried.some(one => one.id === task.id && one.atMs === task.side?.toMain?.atMs)

  if (carried.length > 0) {
    await change($, list => list.map(task => (isCarried(task) ? withToMain(task, () => undefined) : task)))
  }
}

/**
 * Whether the five-hour window lets a helper start or a question go to the
 * main session. At `ALERT_AT` it alerts once a window; at `HOLD_AT` it holds
 * them until a later reading is under it, or the window resets.
 */
export async function quotaAllows($: EngineInterface): Promise<boolean> {
  const nowMs = await $.clock.now()
  const reading = fiveHourOf(await $.session.usage().then(usage => usage.rateLimits, () => []), nowMs)

  if (reading !== undefined && reading.percent >= ALERT_AT) {
    alertOnce($, reading)
  }

  const hold = reading !== undefined && reading.percent >= HOLD_AT ? reading : null

  holdAs($, hold, nowMs)

  if (hold === null) {
    return true
  }

  await refresh($).catch(() => undefined)

  return false
}

function alertOnce($: EngineInterface, reading: QuotaHold) {
  const key = String(reading.resetsAtMs ?? '')

  if (live.alertedWindows.has(key)) {
    return
  }

  live.alertedWindows.add(key)
  $.ui.notify(`Five-hour usage at ${Math.floor(reading.percent)}%. Side questions pause at ${HOLD_AT}%.`, { title: 'Open items' }).catch(() => undefined)
}

/** Sets the hold, or clears it with `hold` null, with its one timer at the window's reset. A hold that ends runs what it held. */
function holdAs($: EngineInterface, hold: QuotaHold | null, nowMs: number) {
  const wasHeld = live.quotaHold !== null
  const resetsAtMs = hold?.resetsAtMs

  live.quotaHold = hold
  live.quotaTimer?.cancel()
  // `rateLimits` is the last response's reading: a quiet session would never see the window reset.
  live.quotaTimer = resetsAtMs === undefined ? null : $.clock.after(resetsAtMs + 1000 - nowMs, () => void quotaAllows($).catch(() => undefined))

  if (wasHeld || hold !== null) {
    $.ui.invalidate('ui.render')
  }

  if (wasHeld && hold === null) {
    void pump($)
    void sendQuestions($)
  }
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
