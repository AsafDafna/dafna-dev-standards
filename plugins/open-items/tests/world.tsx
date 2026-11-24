import type { AgentInfo, AgentReportInput, AgentReportReview, CommandSpec, EngineInterface, On, PaneOpenArgs, PromptOrigin, PromptSubmitInput, SessionInfo, SessionMessage, SessionRateLimit, ToolSpec } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import type { Saved, Task } from '../types'

export const ADD = 'mcp__open-items__add_item'
export const LIST = 'mcp__open-items__list_items'
export const REPLY = 'mcp__open-items__reply_item'
export const CLOSE = 'mcp__open-items__close_item'
export const HANDOFF = 'mcp__open-items__handoff_items'
export const TAKE = 'mcp__open-items__take_items'

export const PANE = {
  plugin: 'open-items',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'open-items',
  props: {
    title: 'Open items',
    isFocused: true,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

export const DONE = {
  answer: 'Done.',
  durationMs: 1000,
  isAborted: false,
  reason: 'answer',
  category: null,
  explanation: null,
} as const

export const NOW = 1_000_000

/** Has the shape of a Stripe key, which `looksSecret` holds; built here, so no file carries one. */
export const KEY_SHAPED = `sk_live_${'0'.repeat(24)}`

/**
 * Seats the engine beneath the plugin: a session, a store, a clock, panes
 * and a status line, and the calls the plugin makes to Claude, kept in
 * `world`. `isNarrow` makes a pane opened unasked wait, as a narrow
 * terminal does.
 */
export function seat(on: On, store: Record<string, unknown> = {}) {
  const world = {
    submitted: [] as string[],
    /** What the plugin's own prompts carried beside their words, one entry per prompt. */
    ownContexts: [] as (readonly string[] | undefined)[],
    /** The origin of each of the plugin's own prompts, as the hooks beneath heard it. */
    ownOrigins: [] as PromptOrigin[],
    appended: [] as { type: string; text: string }[],
    toasts: [] as string[],
    /** Every `$.ui.notify` the plugin made. */
    notices: [] as { text: string; title: string | undefined }[],
    /** Set, a hook beneath refuses the plugin's notifications with this reason. */
    refusingNotify: undefined as string | undefined,
    opens: [] as PaneOpenArgs[],
    isPaneOpen: false,
    isNarrow: false,
    status: undefined as string | undefined,
    composer: '',
    /** Set, the plugin's prompts don't enter: a hook beneath drops them with this reason. */
    refusing: undefined as string | undefined,
    /** Set, the user's typed prompts don't enter: a hook beneath (a settings hook, say) drops them with this reason. */
    refusingTyped: undefined as string | undefined,
    /** Set, the plugin's own rows don't enter the conversation: a hook beneath refuses them with this reason. */
    refusingRows: undefined as string | undefined,
    sessionId: 'session-1',
    /** The folder the session runs in now: a /cd or a worktree move changes it. */
    cwd: '/repo',
    store: JSON.parse(JSON.stringify(store)) as Record<string, unknown>,
    /** Every store call the plugin makes, in order: `get <key>`, `set <key>`, `delete <key>` or `keys`. */
    ops: [] as string[],
    /** Set, the plugin's store calls fail: its file locked too long, or out of reach. */
    isStoreFailing: false,
    /** Set, the plugin's store writes fail and its reads go on: a disk full, say. */
    isWriteFailing: false,
    /** Set, the store's next get doesn't answer until `unstick`, then with the value as it stands: a store stuck on a slow disk. */
    isStuck: false,
    unstick: undefined as (() => void) | undefined,
    /** How long the plugin's store writes take. */
    setMs: 0,
    /** Set, the plugin's next read of this value of its state answers `readMs` late, with the value as it stood when asked. */
    slowRead: undefined as string | undefined,
    readMs: 0,
    /** Set, a hook beneath takes the context out of the user's typed prompts. */
    isStripping: false,
    /** Set, a hook beneath rewrites the user's typed prompts and their context with it (masks a secret, say). */
    rewriting: undefined as ((text: string) => string) | undefined,
    /** Set, a hook beneath rewrites every prompt, the plugin's own among them, and their context with it. */
    masking: undefined as ((text: string) => string) | undefined,
    /** Set, the user's typed prompts fail beneath: nothing there answers them, and the engine rejects them. */
    isTypedFailing: false,
    /** How long the hooks beneath take to pass on the user's typed prompts. */
    typedMs: 0,
    /** How long the plugin's own rows take to join the conversation. */
    appendMs: 0,
    /** How long the surface takes to open a pane. */
    openMs: 0,
    /** How long the surface takes to say which panes are open: it says so as they were when asked. */
    panesMs: 0,
    /** How long the engine takes to attach a client once the plugin's hooks have seen it. */
    attachMs: 0,
    /** Set, the engine can't list the plugin's panes. */
    isPanesFailing: false,
    /** Set, the engine keeps the pane's focus ring where it is: each move is refused with this reason. */
    refusingFocus: undefined as string | undefined,
    /** How many times the plugin asked which of its panes are open. */
    panesAsked: 0,
    /** How many times the plugin read its task list. */
    tasksRead: 0,
    /** The task list as the plugin last wrote it to its state. */
    items: [] as readonly Task[],
    /** The agents `$.agent.list()` answers with. */
    agents: [] as AgentInfo[],
    /** The rows `$.session.messages()` answers with: none in a session that has just started. */
    messages: [] as SessionMessage[],
    /** Set, `$.agent.list()` fails. */
    isAgentListFailing: false,
    /** The tools the plugin registered, as it described them. */
    tools: [] as ToolSpec[],
    /** Every move of the pane's window that reached the surface. */
    scrolls: [] as { by: number; origin: string }[],
    /** The pane's screen as the plugin last wrote it to its state. */
    screen: undefined as unknown,
    /** The agent types the plugin registered, as it described them. */
    registered: [] as Parameters<EngineInterface['agent']['register']>[0][],
    /** Every agent the plugin started, as the Agent tool beneath heard it. */
    spawns: [] as { subagentType: string; description: string; prompt: string }[],
    /** Set, the engine refuses the plugin's spawns with this reason. */
    spawnDeny: undefined as string | undefined,
    /** How long the engine takes to answer a spawn. */
    spawnMs: 0,
    /** Auto mode's review of each agent report, as `next` answers it; none when unset. */
    review: undefined as AgentReportReview | undefined,
    /** The agent ids a send reaches. */
    helpers: [] as string[],
    /** Every message the plugin sent to an agent. */
    sends: [] as { to: string; text: string }[],
    /** How long the engine takes to answer a send. */
    sendMs: 0,
    /** The task ids of every `TaskStop` the plugin made that went through. */
    stops: [] as string[],
    /** Set, the plugin's `TaskStop` calls are refused. */
    isStopRefused: false,
    /** Set, the plugin's `TaskStop` calls answer as a tool error, as for a task that is not running. */
    isStopError: false,
    /** How long the engine takes to answer a `TaskStop`. */
    stopMs: 0,
    /** The files the plugin wrote, by path. */
    files: {} as Record<string, string>,
    /** Set, the plugin's file writes are refused. */
    isFileRefused: false,
    /** What `$.session.info()` answers with. */
    info: { transcriptPath: '/t/main.jsonl', scratchpadDir: '/s/pad' } as SessionInfo,
    /** The rate-limit windows `$.session.usage()` answers with: none off a subscription. */
    rateLimits: [] as SessionRateLimit[],
    /** The slash commands the plugin registered, as it described them. */
    commands: [] as CommandSpec[],
  }

  const clock = mock.clock(on, { now: NOW })
  // The plugin's own store, kept where a test can read it. Its keys run to
  // 256 characters, as the engine's do; a refusal rejects the plugin's call.
  const refused = (op: string, key?: string) => {
    world.ops.push(key === undefined ? op : `${op} ${key}`)

    if (world.isStoreFailing || (world.isWriteFailing && (op === 'set' || op === 'delete'))) {
      return { deny: 'The store is locked.' }
    }

    return key !== undefined && key.length > 256 ? { deny: `Store keys run to 256 characters; this one has ${key.length}.` } : undefined
  }
  on('store.get', ($, e) => {
    if (world.isStuck) {
      world.isStuck = false
      world.ops.push(`get ${e.key}`)
      return new Promise<{ value: unknown }>(resolve => {
        world.unstick = () => resolve({ value: world.store[e.key] })
      })
    }

    return refused('get', e.key) ?? { value: world.store[e.key] }
  })
  on('store.set', async ($, e) => {
    const refusal = refused('set', e.key)

    if (refusal !== undefined) {
      return refusal
    }

    if (world.setMs > 0) {
      await clock.sleep(world.setMs)
    }

    world.store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    const refusal = refused('delete', e.key)

    if (refusal !== undefined) {
      return refusal
    }

    delete world.store[e.key]
    return { value: undefined }
  })
  on('store.keys', () => refused('keys') ?? { value: Object.keys(world.store) })

  on('state.get', { plugin: 'open-items' }, async ($, e, next) => {
    const read = await next(e)
    world.tasksRead += e.key === 'tasks' ? 1 : 0

    if (e.key === world.slowRead) {
      world.slowRead = undefined
      await clock.sleep(world.readMs)
    }

    return read
  })
  on('state.set', { plugin: 'open-items' }, async ($, e, next) => {
    const set = await next(e)

    // A write another beat is made again, so the last one made is the one that stands.
    if (e.key === 'tasks') {
      world.items = e.value as readonly Task[]
    }

    if (e.key === 'screen') {
      world.screen = e.value
    }

    return set
  })

  on('session.id', () => ({ value: world.sessionId }))
  on('session.cwd', () => ({ value: world.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.attach', async ($, e) => {
    if (world.attachMs > 0) {
      await clock.sleep(world.attachMs)
    }

    return { clientId: e.clientId }
  })
  on('session.detach', ($, e) => ({ clientId: e.clientId }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.register', ($, e) => {
    world.tools.push(e)
    return { value: { tool: `mcp__open-items__${e.name}` } }
  })
  on('agent.list', () => (world.isAgentListFailing ? { deny: 'The agent list is out of reach.' } : { value: world.agents }))
  // A row an `after` names that the conversation no longer holds (a compaction, a /clear) answers `{ deny }`, as the engine resolves it.
  on('session.messages', ($, e) => {
    if (e.after !== undefined) {
      const at = world.messages.findIndex(message => message.uuid === e.after)

      return { value: at < 0 ? { deny: `No row ${e.after} in this conversation.` } : world.messages.slice(at + 1) }
    }

    return { value: e.last === undefined ? world.messages : world.messages.slice(Math.max(0, world.messages.length - e.last)) }
  })
  on('session.info', () => ({ value: world.info }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: world.rateLimits } }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('agent.register', ($, e) => {
    world.registered.push(e)
    return { value: { agent: `open-items:${e.name}` } }
  })
  // The plugin's own spawn reaches the Agent tool beneath with the tool's own field names.
  on('agent.spawn', async ($, e) => {
    const call = e as unknown as { subagent_type: string; description: string; prompt: string }
    world.spawns.push({ subagentType: call.subagent_type, description: call.description, prompt: call.prompt })

    if (world.spawnMs > 0) {
      await clock.sleep(world.spawnMs)
    }

    return world.spawnDeny === undefined ? { model: 'opus' } : { deny: world.spawnDeny }
  })
  on('agent.offer', () => ({ isOffered: true }))
  on('agent.report', ($, e) => ({ text: e.text, ...(world.review === undefined ? {} : { review: world.review }) }))
  on('session.send', async ($, e) => {
    world.sends.push({ to: e.to, text: e.text })

    if (world.sendMs > 0) {
      await clock.sleep(world.sendMs)
    }

    return world.helpers.includes(e.to) ? { isDelivered: true } : { isDelivered: false, reason: 'No agent by that id.' }
  })
  on('tool.call', { tool: 'TaskStop' }, async ($, e) => {
    if (world.stopMs > 0) {
      await clock.sleep(world.stopMs)
    }

    if (world.isStopRefused) {
      return { deny: 'TaskStop is not allowed here.' }
    }

    if (world.isStopError) {
      return { isError: true as const, result: undefined, text: `No task found with ID: ${e.task_id ?? ''}` }
    }

    const taskId = e.task_id ?? ''
    world.stops.push(taskId)

    return { result: { message: 'Successfully stopped task', task_id: taskId, task_type: 'local_agent' } }
  })
  on('fs.write', ($, e) => {
    if (world.isFileRefused) {
      return { deny: 'The disk is full.' }
    }

    world.files[e.path] = e.text
    return { value: undefined }
  })
  on('command.register', ($, e) => {
    world.commands.push(e)
    return { value: { command: e.name } }
  })
  on('ui.toast', ($, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', ($, e) => {
    world.notices.push({ text: e.text, title: e.title })

    return world.refusingNotify === undefined ? { value: { isSent: true as const, channel: 'ghostty' as const } } : { deny: world.refusingNotify }
  })
  on('ui.status', ($, e) => {
    world.status = e.text
    return { value: undefined }
  })
  on('ui.open', async ($, e) => {
    if (world.openMs > 0) {
      await clock.sleep(world.openMs)
    }

    world.opens.push(e)
    world.isPaneOpen = true
    const isPlaced = e.focus === true || !world.isNarrow
    return { value: isPlaced ? { isPlaced: true } : { isPlaced: false, reason: 'narrow terminal' } }
  })
  on('ui.close', () => {
    world.isPaneOpen = false
    return { value: undefined }
  })
  on('ui.panes', async () => {
    world.panesAsked += 1

    if (world.isPanesFailing) {
      return { deny: 'The surface is busy.' }
    }

    const value = world.isPaneOpen ? [{ id: 'open-items', title: 'Open items', isShown: true, isFocused: true, isPlaced: !world.isNarrow }] : []

    if (world.panesMs > 0) {
      await clock.sleep(world.panesMs)
    }

    return { value }
  })
  on('ui.focus', { plugin: '*' }, () => (world.refusingFocus === undefined ? {} : { deny: world.refusingFocus }))
  on('ui.scroll', ($, e) => {
    world.scrolls.push({ by: e.by, origin: e.origin.kind })
    return {}
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.submit', async ($, e) => {
    if (e.origin.kind === 'composer' && world.typedMs > 0) {
      await clock.sleep(world.typedMs)
    }

    if (e.origin.kind === 'plugin' && world.refusing !== undefined) {
      return { drop: world.refusing }
    }

    if (e.origin.kind === 'composer' && world.refusingTyped !== undefined) {
      return { drop: world.refusingTyped }
    }

    if (e.origin.kind === 'composer' && world.isTypedFailing) {
      // A hook that throws is skipped; with none beneath it, the engine rejects the prompt.
      throw new Error('The prompt hook timed out.')
    }

    if (e.origin.kind === 'composer' && world.isStripping) {
      return { text: e.text }
    }

    if (e.origin.kind === 'plugin' && e.origin.name === 'open-items') {
      world.submitted.push(e.text)
      world.ownContexts.push(e.context)
      world.ownOrigins.push(e.origin)
    }

    const rewrite = (e.origin.kind === 'composer' ? world.rewriting : undefined) ?? world.masking

    if (rewrite !== undefined) {
      return { text: rewrite(e.text), ...(e.context === undefined ? {} : { context: e.context.map(rewrite) }) }
    }

    return { text: e.text, ...(e.context === undefined ? {} : { context: e.context }) }
  })
  on('session.append', async ($, e, next) => {
    if (e.door === 'note' && world.appendMs > 0) {
      await clock.sleep(world.appendMs)
    }

    // Only a plugin's own row may be refused; any other must go on with next.
    if (e.door === 'note' && world.refusingRows !== undefined) {
      return { deny: world.refusingRows }
    }

    const block = e.message.content[0] as { text?: string } | undefined
    world.appended.push({ type: e.message.type, text: block?.text ?? '' })

    return next(e)
  })
  on('prompt.context', ($, e) => ({ blocks: e.blocks }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box key="engine" />
  })
  on('prompt.read', () => ({ value: { text: world.composer, cursor: world.composer.length } }))
  on('prompt.fill', ($, e) => {
    world.composer = e.mode === 'append' ? world.composer + e.text : e.text
    return { isFilled: true, text: world.composer, cursor: world.composer.length }
  })

  return { world, clock }
}

export async function start($: Engine) {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
}

export function typed(text: string, turnId?: string): PromptSubmitInput {
  return { text, wait: false, origin: { kind: 'composer' }, ...(turnId === undefined ? {} : { turnId }) }
}

/** One model request of turn `turnId`, in the main loop or in agent `agentId`'s. */
export async function step($: Engine, turnId: string, agentId?: string) {
  const stream = $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', messageCount: 1, ...(agentId === undefined ? {} : { agentId }) })

  for await (const chunk of stream) {
    void chunk
  }

  await stream.result
}

export async function runTasks($: Engine) {
  return $.command.run({
    command: 'open-items',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
}

export function side($: Engine, args: string) {
  return $.command.run({ command: 'side', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
}

/** A helper's report: a1's answer unless `fields` say otherwise. */
export function report($: Engine, fields: Partial<AgentReportInput> = {}) {
  return $.agent.report({ agentId: 'a1', subagentType: 'open-items:helper', provider: { plugin: 'open-items', tier: 'user' }, status: 'completed', text: 'A pointer into the feed.', ...fields })
}

type Drawn = Pick<Mounted<'terminal', 'Pane'>, 'find'>

export async function textOf(ui: Drawn, key: string): Promise<string> {
  return (await ui.find({ key }))?.text ?? ''
}

export function itemOf(world: ReturnType<typeof seat>['world'], id: number): Task | undefined {
  return world.items.find(task => task.id === id)
}

/** The pane seated inline above the prompt, `bodyColumns` across. */
export function inline(bodyColumns: number) {
  return { ...PANE, props: { ...PANE.props, placement: 'inline', bodyColumns } } as const
}

/** The store as session 1 saved `items` before, in v0.2's format. */
export function earlierItems(items: readonly Task[]) {
  return { 'session:session-1': { version: 2, tasks: items, nextId: 3, savedMs: NOW, lastActiveMs: NOW, folder: '/repo', taken: [] } }
}

/** The pane's focus ring moving onto `element`, as the person's click or Tab moves it. */
export function ringTo(element: string) {
  return {
    component: 'Pane',
    requestId: 'open-items',
    plugin: 'open-items',
    element,
    origin: { kind: 'person' },
  } as const
}

export const OLD = 'session:session-old'
export const NEW = 'session:session-new'
export const OWN = 'session:session-1'
export const HOUR_MS = 60 * 60_000
export const CODE = 'k3x9q2'

/** An item a session saved, as v0.2 holds it. */
export function savedItem(id: number, fields: Partial<Task> = {}): Task {
  return {
    id,
    kind: 'action',
    title: `Rotate deploy key number ${id}`,
    thread: [{ from: 'claude', text: 'Needed before the release.', atMs: NOW - 240_000 }],
    state: 'open',
    isWaitingForClaude: false,
    hasNewReply: false,
    update: 'none',
    createdMs: NOW - 240_000,
    updatedMs: NOW - 240_000,
    ...fields,
  }
}

/** The key another session saved for `tasks` in /repo, active now unless `fields` say otherwise. */
export function keyed(tasks: readonly Task[], fields: Partial<Saved> = {}): Saved {
  return {
    version: 2,
    tasks,
    nextId: Math.max(0, ...tasks.map(task => task.id)) + 1,
    savedMs: NOW,
    lastActiveMs: NOW,
    folder: '/repo',
    taken: [],
    ...fields,
  }
}

/** `handoff_items`'s code, read from its result. */
export function codeIn(result: string | undefined): string {
  return /Hand-off code: ([a-z0-9]{6})\./.exec(result ?? '')?.[1] ?? ''
}

export function answerOf(call: unknown) {
  return call as { result?: string; deny?: string }
}
