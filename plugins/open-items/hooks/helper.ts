import { atom, read, update } from 'claude-code'
import type { AgentSpawnResult, EngineInterface, On } from 'claude-code'

import type { Task } from '../types'
import { HELPER_PROMPT, HELPER_TYPE, LOG_NAME, helperPromptOf, isPending, logOf, newSideOf, newestUserOf, refusedOf, sentOf, summaryOf } from './side'
import { LOADING, NEXT_ID_INITIAL, TASKS_INITIAL, change, edit, live, show } from './state'
import { MAX_DETAIL, looksSecret } from './tasks'

const tasks = atom({ plugin: 'open-items', key: 'tasks' } as const, TASKS_INITIAL)
const nextId = atom({ plugin: 'open-items', key: 'nextId' } as const, NEXT_ID_INITIAL)

const SECRET = "This looks like a secret, so it wasn't sent. Put it where it belongs, then ask without it."
// It holds none of the question: when the command runs mid-turn, this text reaches the main session.
const TAKEN = 'A helper takes this side question (Open items); the main session goes on.'

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

    return (await askNew($, text)) ? { text: TAKEN, isTextDisplayOnly: true } : {}
  })
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

/** One run at a time, in the order asked. It never rejects, so a caller may leave it unawaited. */
export function pump($: EngineInterface): Promise<void> {
  const done = live.pumpQueue.then(() => pumpNow($)).catch(() => undefined)
  live.pumpQueue = done

  return done
}

async function pumpNow($: EngineInterface) {
  const tried = new Set<number>()

  for (;;) {
    const next = waitingOf(await read($, tasks), tried)

    if (next === undefined) {
      return
    }

    tried.add(next.id)
    await startHelper($, next)
  }
}

function waitingOf(list: readonly Task[], tried: ReadonlySet<number>): Task | undefined {
  const atOf = (task: Task) => newestUserOf(task)?.atMs ?? 0

  return list.filter(task => isPending(task) && !tried.has(task.id)).sort((one, other) => atOf(one) - atOf(other))[0]
}

async function startHelper($: EngineInterface, task: Task) {
  const givenMs = newestUserOf(task)?.atMs
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
    log: scratchpad ? { path: `${scratchpad}/${LOG_NAME}`, text } : { text },
  })
}
