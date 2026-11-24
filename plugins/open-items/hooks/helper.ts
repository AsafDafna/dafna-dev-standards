import { atom, read, update } from 'claude-code'
import type { AgentReportInput, AgentReportResult, AgentSpawnResult, EngineInterface, On } from 'claude-code'

import type { Task } from '../types'
import { AT_WORK } from './gate'
import { HELPER_PROMPT, HELPER_TYPE, LOG_NAME, MAX_SUMMARY, answeredOf, followUpOf, helperPromptOf, isPending, isWorking, logOf, newSideOf, newestUserOf, noticedOf, refusedOf, rowsTextOf, sentOf, summaryOf } from './side'
import { LOADING, NEXT_ID_INITIAL, TASKS_INITIAL, change, edit, live, settle, show } from './state'
import { MAX_DETAIL, isActive, looksSecret, movedBy, replyOf } from './tasks'

const tasks = atom({ plugin: 'open-items', key: 'tasks' } as const, TASKS_INITIAL)
const nextId = atom({ plugin: 'open-items', key: 'nextId' } as const, NEXT_ID_INITIAL)

const SECRET = "This looks like a secret, so it wasn't sent. Put it where it belongs, then ask without it."
// It holds none of the question: when the command runs mid-turn, this text reaches the main session.
const TAKEN = 'A helper takes this side question (Open items); the main session goes on.'
const CONSUMED: AgentReportResult = { consumed: 'open-items wrote the answer in its side question' }
const FOLLOW_UP = /^#(\d+)(?:\s+([\s\S]*))?$/

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
    await edit($, task.id, found => sentOf(found, helperId, givenMs))
    return
  }

  await startHelper($, task, givenMs)
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

  await edit($, task.id, found => sentOf(found, agentId, givenMs))
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
  const task = (await read($, tasks)).find(found => found.side?.helperId === e.agentId)
  const isStopped = live.stoppedHelpers.delete(e.agentId)

  if (isStopped || task === undefined) {
    return
  }

  const text = e.text.trim()
  const isAnswer = e.status === 'completed' && text !== ''
  const rows = isAnswer ? await $.session.messages({ last: 1 }).catch(() => undefined) : undefined
  const seenUuid = Array.isArray(rows) ? rows[0]?.uuid : undefined
  const found = await edit($, task.id, (current, nowMs) => (isAnswer ? answeredOf(current, text, nowMs, seenUuid) : noticedOf(current, noticeOf(e.status, text), nowMs)))

  if (isAnswer && found !== undefined && isActive(found)) {
    $.ui.toast(`Side question #${task.id} has an answer. See /open-items`)
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
  const isGone = (task: Task) => isWorking(task) && !agents.some(agent => agent.id === task.side?.helperId && AT_WORK.includes(agent.status))

  await change($, list => (list.some(isGone) ? list.map(task => (isGone(task) ? unsentOf(task) : task)) : list))
  await pump($)
}

function unsentOf(task: Task): Task {
  const { sentMs, ...side } = task.side ?? { transcripts: [] }

  return { ...task, side }
}
