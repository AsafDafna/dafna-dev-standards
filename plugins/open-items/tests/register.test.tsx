import type { AgentInfo, On, PaneOpenArgs, PromptSubmitInput, SessionAppendInput, SessionMessage, ToolSpec } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { arrowTargetOf, fieldRowsOf, focusOrderOf, rowBackTo, rowsFor } from '../hooks/pane'
import { register } from '../hooks/register'
import { leftoversIn, savedIn } from '../hooks/saved'
import { DONE as DONE_PRESS, movedBy } from '../hooks/tasks'
import { cellsOf, rowsOf, wrapRows } from '../hooks/text'
import type { Message, Saved, Task, TaskKind } from '../types'

const ADD = 'mcp__open-items__add_item'
const LIST = 'mcp__open-items__list_items'
const REPLY = 'mcp__open-items__reply_item'
const CLOSE = 'mcp__open-items__close_item'
const HANDOFF = 'mcp__open-items__handoff_items'
const TAKE = 'mcp__open-items__take_items'

const PANE = {
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

const DONE = {
  answer: 'Done.',
  durationMs: 1000,
  isAborted: false,
  reason: 'answer',
  category: null,
  explanation: null,
} as const

const KEY_TASK = {
  tool: ADD,
  title: 'Add STRIPE_SECRET_KEY to .env',
  detail: "The webhook test can't run without it.",
  done_when: "It's in .env. Don't paste it here.",
  kind: 'action',
} as const

const XCODE_TASK = {
  tool: ADD,
  title: 'Run xcodebuild test on your Mac, paste the failures',
  detail: "I can't run Xcode here.",
  kind: 'question',
} as const

const PAGING_TASK = {
  tool: ADD,
  title: 'Pick a pagination strategy for /feed',
  detail: 'I lean towards cursor: the feed is append-only.',
  kind: 'decision',
  options: ['Cursor', 'Offset, capped at 10k'],
} as const

const NOW = 1_000_000

/** Has the shape of a Stripe key, which `looksSecret` holds; built here, so no file carries one. */
const KEY_SHAPED = `sk_live_${'0'.repeat(24)}`

/** An item a session saved. */
const ROTATE = {
  id: 7,
  title: 'Rotate the leaked token in Vault',
  why: 'It was in a public gist.',
  kind: 'action',
  state: 'open',
  update: 'none',
  createdMs: 0,
  updatedMs: 0,
} as const

/**
 * Seats the engine beneath the plugin: a session, a store, a clock, panes
 * and a status line, and the calls the plugin makes to Claude, kept in
 * `world`. `isNarrow` makes a pane opened unasked wait, as a narrow
 * terminal does.
 */
function seat(on: On, store: Record<string, unknown> = {}) {
  const world = {
    submitted: [] as string[],
    /** What the plugin's own prompts carried beside their words, one entry per prompt. */
    ownContexts: [] as (readonly string[] | undefined)[],
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
  on('session.messages', () => ({ value: world.messages }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
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
  on('ui.focus', () => ({}))
  on('ui.scroll', ($, e) => {
    world.scrolls.push({ by: e.by, origin: e.origin.kind })
    return {}
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.submit', ($, e) => {
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

    if (e.origin.kind === 'plugin') {
      world.submitted.push(e.text)
      world.ownContexts.push(e.context)
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

async function start($: Engine) {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
}

function typed(text: string, turnId?: string): PromptSubmitInput {
  return { text, wait: false, origin: { kind: 'composer' }, ...(turnId === undefined ? {} : { turnId }) }
}

/** A subagent's hand-back, as the engine raises it once the agent is done. */
const HAND_BACK: PromptSubmitInput = {
  text: '<agent-message from="tester">[Subagent hand-back] The tests pass.</agent-message>',
  wait: false,
  origin: { kind: 'peer' },
}

/** How Claude reads a message of the user's: a response to one item, then its head. */
const ONE = 'My response to an item you gave me (Open items):\n\n'

/** What follows an item's head in a reply of the user's, before the reply's own lines. */
const REPLY_WORDS = 'my reply (the item stays open; answer in it with reply_item, or close it with close_item):'

/** The prompt that wakes Claude for an answer its turn ended without reading. */
const WAKE_UP = 'I answered an item while you were finishing your reply; my answer is above.'

/** One model request of turn `turnId`, in the main loop or in agent `agentId`'s. */
async function step($: Engine, turnId: string, agentId?: string) {
  const stream = $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', messageCount: 1, ...(agentId === undefined ? {} : { agentId }) })

  for await (const chunk of stream) {
    void chunk
  }

  await stream.result
}

async function runTasks($: Engine) {
  return $.command.run({
    command: 'open-items',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
}

/**
 * Set, holds the next press short of its button until `letGo`: a press from
 * a drawing a write has changed since, before the drawing it wakes lands.
 */
function holdingPresses(on: On) {
  const held = { isOn: false, letGo: () => {} }

  on('ui.press', async ($, e, next) => {
    if (held.isOn) {
      held.isOn = false
      await new Promise<void>(resolve => {
        held.letGo = resolve
      })
    }

    return next(e)
  })

  return held
}

type Drawn = Pick<Mounted<'terminal', 'Pane'>, 'find'>

async function textOf(ui: Drawn, key: string): Promise<string> {
  return (await ui.find({ key }))?.text ?? ''
}

function itemOf(world: ReturnType<typeof seat>['world'], id: number): Task | undefined {
  return world.items.find(task => task.id === id)
}

function folderOf(world: ReturnType<typeof seat>['world'], sessionId: string): string | undefined {
  return (world.store[`session:${sessionId}`] as { folder?: string } | undefined)?.folder
}

/** The list's rows: the head, a label and a row for each section, and the foot. */
const ROWS_THREE_KINDS = 8
const ROWS_ONE_KIND = 4

describe('adding', () => {
  test('an item opens the Open items pane, with its detail and its buttons, and the status line counts it', async ($, on) => {
    const { world } = seat(on)
    await start($)

    const added = await $.tool.call(KEY_TASK)
    const ui = await $.ui.mount(PANE)

    expect(String((added as { result?: unknown }).result)).toContain('Added item #1')
    expect(world.opens.at(-1)?.id).toBe('open-items')
    expect(world.opens.at(-1)?.focus).toBeUndefined()
    expect(world.status).toBe('☐ 1 action · /open-items')
    expect(await textOf(ui, 'head')).toBe('☐ 1 action')
    await ui.press({ key: 'row-1' })
    expect(await textOf(ui, 'item-1')).toContain("The webhook test can't run without it.")
    expect(await textOf(ui, 'item-1')).toContain('Done when:')
    expect(await textOf(ui, 'options')).toContain('Done')
    expect(await textOf(ui, 'options')).not.toContain('Accept')
    expect(world.toasts).toHaveLength(0)
  })

  test('where the pane cannot be seated unasked, a toast points at /open-items', async ($, on) => {
    const { world } = seat(on)
    world.isNarrow = true
    await start($)

    await $.tool.call(KEY_TASK)

    expect(world.toasts[0]).toBe('Claude added an item for you: Add STRIPE_SECRET_KEY to .env. See /open-items')
    expect(world.status).toBe('☐ 1 action · /open-items')
  })

  test('the same ask twice is still one item', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    const again = await $.tool.call({ ...KEY_TASK, title: 'add stripe_secret_key to .env!' })
    expect(String((again as { result?: unknown }).result)).toContain('Item #1 already asks')

    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.press({ key: 'later' })
    const later = await $.tool.call(KEY_TASK)

    expect(String((later as { result?: unknown }).result)).toContain('Item #1 already asks')
    expect(world.items.map(task => task.id)).toEqual([1])
  })

  test('a seventh open item is added: there is no cap', async ($, on) => {
    const { world } = seat(on)
    await start($)

    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      const added = await $.tool.call({ ...KEY_TASK, title: `Do thing number ${n}` })

      expect(String((added as { result?: unknown }).result)).toContain(`Added item #${n}`)
    }

    expect(world.items.filter(task => task.state === 'open').map(task => task.id)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(world.status).toBe('☐ 7 actions · /open-items')
  })

  test('an item closed as withdrawn leaves: the pane closes and the status line clears', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    await $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn', note: 'Found the key in the vault' })

    expect(world.isPaneOpen).toBe(false)
    expect(world.status).toBeUndefined()
    expect(world.toasts.at(-1)).toBe('Claude withdrew the item: Add STRIPE_SECRET_KEY to .env. Found the key in the vault')
  })
})

/**
 * Two tasks with titles near the 80 characters a title may have, as the
 * session saved them. The live check (tests/live/test_pane.py) draws them in
 * a real Claude Code; the row counts here are what it drew.
 */
const INSTRUMENTS = {
  ...ROTATE,
  id: 1,
  title: 'Open Instruments from Xcode and record with the Activity Monitor template',
  why: 'I need a trace of the launch to see where the 4 seconds go.',
  doneWhen: 'The .trace file is in ~/traces.',
  createdMs: NOW - 180_000,
} as const

const XCODE_LONG = {
  ...ROTATE,
  id: 2,
  title: 'Run xcodebuild test on your Mac and paste every failure you see here please',
  why: "I can't run Xcode here.",
  kind: 'question',
  createdMs: NOW - 180_000,
} as const

/** The pane seated inline above the prompt, `bodyColumns` across. */
function inline(bodyColumns: number) {
  return { ...PANE, props: { ...PANE.props, placement: 'inline', bodyColumns } } as const
}

/** The store as session 1 saved `tasks` before, in v0.1's format: started again, it shows the open ones. */
function earlier(tasks: readonly unknown[]) {
  return { 'session:session-1': { tasks, nextId: 3, savedMs: NOW } }
}

/** v0.1's open tasks as v0.2 holds them. */
function asItems(tasks: readonly unknown[]): Task[] {
  return [...(savedIn({ tasks, nextId: 1, savedMs: NOW })?.tasks ?? [])]
}

/** The store as session 1 saved `items` before, in v0.2's format. */
function earlierItems(items: readonly Task[]) {
  return { 'session:session-1': { version: 2, tasks: items, nextId: 3, savedMs: NOW, lastActiveMs: NOW, folder: '/repo', taken: [] } }
}

describe('long titles', () => {
  test('wrap as the terminal wraps them: at spaces, a word wider than the row broken where it ends', () => {
    expect(wrapRows(' a b c d e f g h i j k l m n o p q r s t u v w x y z A B C D E F G H I J  3m · from an earlier session', 32)).toEqual([
      ' a b c d e f g h i j k l m n o p',
      ' q r s t u v w x y z A B C D E F',
      ' G H I J  3m · from an earlier ',
      'session',
    ])
    expect(wrapRows('#3 Datenbankverbindungseinstellungsüberprüfungsprotokoll im Ordner ablegen', 30)).toEqual([
      '#3 Datenbankverbindungseinstel',
      'lungsüberprüfungsprotokoll im ',
      'Ordner ablegen',
    ])
    expect(cellsOf('ステージング')).toBe(12)
    expect(rowsOf('ステージング環境のデータベース移行を承認してください', 30)).toBe(2)
  })

  test('count an emoji as the terminal draws it: two cells, however it is built', () => {
    // Drawn as emoji by default, below U+1F300 too.
    expect(cellsOf('⌛ ✅ ⚡ ⭐ 🀄 🈯')).toBe(17)
    // An emoji drawn as text unless U+FE0F asks otherwise.
    expect(cellsOf('☀ 🌡')).toBe(3)
    expect(cellsOf('☀️ 🌡️ ⚠️')).toBe(8)
    // A keycap, a skin tone, a flag, and emoji joined by U+200D.
    expect(cellsOf('1️⃣ 👍🏽 🇮🇱 👩‍💻 🫱🏼‍🫲🏿')).toBe(14)
    // Without U+FE0F: a keycap, and an emoji drawn as text joined to another.
    expect(cellsOf('1⃣ ❤‍🔥 ❤‍🩹')).toBe(8)
    // A digit, `©` and `®` stay text.
    expect(cellsOf('9️ ©‍🔥')).toBe(5)
    // Marks and format characters take no cell of their own, nor a Hangul vowel and final spelled apart.
    expect(cellsOf('é​')).toBe(1)
    expect(cellsOf('각')).toBe(2)
    expect(rowsOf('Fix the ⏳ timeouts ✅ before the ⛔ freeze', 20)).toBe(3)
  })

  test('break a word wider than the row between the characters the terminal draws, never inside one', () => {
    // A skin tone stays on its hand, U+FE0F on its sun, emoji joined by U+200D together, and a conjunct with its vowel sign.
    expect(wrapRows('👍🏽👍🏽👍🏽👍🏽👍🏽', 9)).toEqual(['👍🏽👍🏽👍🏽👍🏽', '👍🏽'])
    expect(wrapRows('Status:☀️', 8)).toEqual(['Status:', '☀️'])
    expect(wrapRows('Pair 👩‍💻👩‍💻👩‍💻👩‍💻', 7)).toEqual(['Pair 👩‍💻', '👩‍💻👩‍💻👩‍💻'])
    expect(wrapRows('नमस्ते', 3)).toEqual(['नम', 'स्ते'])
    // A row one cell wide: a wide character goes on a row past it, after an empty one where the row before is full.
    expect(wrapRows('一二', 1)).toEqual(['', '一', '二'])
    expect(wrapRows('a一', 1)).toEqual(['a', '', '一'])
  })

  test('count East Asian wide forms two cells, and the ambiguous ones one', () => {
    expect(cellsOf('〈☰⚊䷀ꥠ︐﹐\u{16FE0}\u{17000}\u{1B000}\u{1D300}\u{1F200}')).toBe(24)
    expect(cellsOf('㉈')).toBe(1)
  })

  test('the list asks for a row for each item, and for the rows its head and foot wrap to at the width it is drawn in', () => {
    const view = {
      shown: asItems([INSTRUMENTS, XCODE_LONG]),
      screen: { kind: 'list' },
      held: null,
      draft: '',
      nowMs: NOW,
      canType: true,
      isFocused: true,
      isTyping: false,
    } as const

    // The head, two section labels, a row for each item, and the foot: the foot wraps below 50 columns, the head below 24.
    expect(rowsFor(view, 60, 99)).toBe(6)
    expect(rowsFor(view, 32, 99)).toBe(7)
    expect(rowsFor(view, 20, 99)).toBe(10)
    expect(rowsFor({ ...view, shown: asItems([INSTRUMENTS]) }, 60, 99)).toBe(4)
    expect(rowsFor(view, 20, 8)).toBe(8)
  })

  test('drawn narrow, the pane opens again as tall as its wrapped titles', async ($, on) => {
    const { world } = seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    await start($)

    await runTasks($)
    const ui = await $.ui.mount(inline(60))
    expect(world.opens.at(-1)?.rows).toBe(6)

    // The terminal narrows: the foot takes more rows, and the pane asks for them.
    await ui.redraw(inline(32).props)
    expect(world.opens.at(-1)?.rows).toBe(7)
  })

  test('drawn on two surfaces at once, the pane asks for the rows the narrower takes, and keeps them', async ($, on) => {
    const { world, clock } = seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    await start($)
    await $.session.attach({ surface: 'mobile', clientId: 'phone' })

    await runTasks($)
    const terminal = await $.ui.mount(inline(60))
    const phone = await $.ui.mount({ ...inline(32), surface: 'mobile' })
    expect(world.opens.at(-1)?.rows).toBe(7)

    // Each draws again: the pane asks for nothing new.
    const opens = world.opens.length
    await terminal.redraw(inline(60).props)
    await phone.redraw(inline(32).props)
    expect(world.opens.length).toBe(opens)

    // The phone leaves: the pane fits the terminal.
    await phone.unmount()
    await $.session.detach({ surface: 'mobile', clientId: 'phone', reason: 'detach' })
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(6)
  })

  test('a surface that docks the pane it drew inline leaves it as tall as the surfaces still drawing it inline', async ($, on) => {
    const { world } = seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    await start($)
    await $.session.attach({ surface: 'mobile', clientId: 'phone' })

    await runTasks($)
    const terminal = await $.ui.mount(inline(32))
    await $.ui.mount({ ...inline(60), surface: 'mobile' })
    expect(world.opens.at(-1)?.rows).toBe(7)

    // The terminal widens and docks the pane: the phone's rows are the pane's.
    await terminal.redraw(PANE.props)
    expect(world.opens.at(-1)?.rows).toBe(6)
  })

  test('drawn by two clients of one surface, the pane asks for the rows the narrower takes, and keeps them', async ($, on) => {
    const { world, clock } = seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    await start($)
    await $.session.attach({ surface: 'mobile', clientId: 'tablet' })
    await $.session.attach({ surface: 'mobile', clientId: 'phone' })

    // A render names its surface, not its client: the tablet's and the phone's come as one surface's.
    await runTasks($)
    const mobile = await $.ui.mount({ ...inline(32), surface: 'mobile' })
    await mobile.redraw(inline(20).props)
    expect(world.opens.at(-1)?.rows).toBe(10)

    // Each draws again: the pane asks for nothing new.
    const opens = world.opens.length
    await mobile.redraw(inline(32).props)
    await mobile.redraw(inline(20).props)
    expect(world.opens.length).toBe(opens)

    // The phone leaves: the tablet drawing again, the pane fits it, and
    // follows it as it widens.
    await $.session.detach({ surface: 'mobile', clientId: 'phone', reason: 'detach' })
    await mobile.redraw(inline(32).props)
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(7)

    await mobile.redraw(inline(60).props)
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(6)
  })

  test("of two clients of one surface, one drawing it otherwise again and again keeps the other's rows", async ($, on) => {
    const { world } = seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    await start($)
    await $.session.attach({ surface: 'mobile', clientId: 'phone' })
    await $.session.attach({ surface: 'mobile', clientId: 'tablet' })

    await runTasks($)
    const mobile = await $.ui.mount({ ...inline(32), surface: 'mobile' })
    // The tablet takes the keys and gives them back, turned one way and the other.
    for (const [columns, isFocused] of [[60, false], [60, true], [90, false], [90, true]] as const) {
      await mobile.redraw({ ...inline(columns).props, isFocused })
    }

    expect(world.opens.at(-1)?.rows).toBe(7)
  })

  test('a client of two leaving, the pane asks for none of the rows it took', async ($, on) => {
    const { world, clock } = seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    await start($)
    await $.session.attach({ surface: 'mobile', clientId: 'tablet' })
    await $.session.attach({ surface: 'mobile', clientId: 'phone' })

    await runTasks($)
    await $.ui.mount(inline(60))
    const mobile = await $.ui.mount({ ...inline(60), surface: 'mobile' })
    await mobile.redraw(inline(32).props)
    await mobile.redraw(inline(60).props)
    expect(world.opens.at(-1)?.rows).toBe(7)

    // The phone leaves, and the tablet draws the pane again: the pane fits it and the terminal.
    await $.session.detach({ surface: 'mobile', clientId: 'phone', reason: 'detach' })
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(6)
  })

  test('a client of three leaving, the two left draw the pane again, and it fits them', async ($, on) => {
    const { world, clock } = seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    await start($)

    for (const clientId of ['phone', 'tablet', 'laptop']) {
      await $.session.attach({ surface: 'mobile', clientId })
    }

    await runTasks($)
    const mobile = await $.ui.mount({ ...inline(20), surface: 'mobile' })
    await mobile.redraw(inline(60).props)
    await mobile.redraw(inline(32).props)
    expect(world.opens.at(-1)?.rows).toBe(10)

    // The phone leaves. No surface seats the pane inline but theirs, and the
    // narrower of the two drew last.
    await $.session.detach({ surface: 'mobile', clientId: 'phone', reason: 'detach' })
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(7)
  })

  test('two clients of one surface leaving at once, the pane fits the surfaces left', async ($, on) => {
    const { world, clock } = seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    await start($)
    await $.session.attach({ surface: 'mobile', clientId: 'tablet' })
    await $.session.attach({ surface: 'mobile', clientId: 'phone' })

    await runTasks($)
    await $.ui.mount(inline(60))
    const mobile = await $.ui.mount({ ...inline(32), surface: 'mobile' })
    expect(world.opens.at(-1)?.rows).toBe(7)

    // Both leave together, and the phone reads who is attached late: the tablet still is.
    await mobile.unmount()
    world.slowRead = 'clients'
    world.readMs = 500
    const leaving = Promise.all([
      $.session.detach({ surface: 'mobile', clientId: 'phone', reason: 'detach' }),
      $.session.detach({ surface: 'mobile', clientId: 'tablet', reason: 'detach' }),
    ])
    await clock.advance(500)
    await leaving
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(6)
  })

  test("clients leaving as the roster's write answers late, the pane still fits those left", async ($, on) => {
    const { world, clock } = seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    let lateMs = 0
    on('state.set', { plugin: 'open-items' }, async ($, e, next) => {
      const set = await next(e)

      if (e.key === 'clients' && lateMs > 0) {
        await clock.sleep(lateMs)
      }

      return set
    })
    await start($)

    for (const clientId of ['laptop', 'tablet', 'phone']) {
      await $.session.attach({ surface: 'mobile', clientId })
    }

    await runTasks($)
    await $.ui.mount(inline(60))
    const mobile = await $.ui.mount({ ...inline(32), surface: 'mobile' })
    await mobile.redraw(inline(50).props)
    expect(world.opens.at(-1)?.rows).toBe(7)

    // The pane draws again before the write that wakes it answers: the two
    // left start their seats over, and once they leave too, the terminal's fit.
    lateMs = 100
    const phoneLeaving = $.session.detach({ surface: 'mobile', clientId: 'phone', reason: 'detach' })
    await clock.advance(100)
    await phoneLeaving
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(6)

    await mobile.unmount()

    for (const clientId of ['tablet', 'laptop']) {
      const leaving = $.session.detach({ surface: 'mobile', clientId, reason: 'detach' })
      await clock.advance(100)
      await leaving
    }

    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(6)
  })

  test("a client leaving and attaching again as the roster's write answers late keeps the rows it draws", async ($, on) => {
    const { world, clock } = seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    const lateMs: number[] = []
    on('state.set', { plugin: 'open-items' }, async ($, e, next) => {
      const ms = e.key === 'clients' ? (lateMs.shift() ?? 0) : 0
      const set = await next(e)

      if (ms > 0) {
        await clock.sleep(ms)
      }

      return set
    })
    await start($)
    await $.session.attach({ surface: 'mobile', clientId: 'phone' })

    await runTasks($)
    const terminal = await $.ui.mount(inline(60))
    const mobile = await $.ui.mount({ ...inline(32), surface: 'mobile' })
    expect(world.opens.at(-1)?.rows).toBe(7)

    // The phone drops and comes back, drawing the pane, before the write of
    // its leaving answers: the seat it draws stays.
    lateMs.push(100)
    await mobile.unmount()
    const leaving = $.session.detach({ surface: 'mobile', clientId: 'phone', reason: 'detach' })
    await clock.settle()
    const attaching = $.session.attach({ surface: 'mobile', clientId: 'phone' })
    await $.ui.mount({ ...inline(32), surface: 'mobile' })
    await clock.advance(100)
    await Promise.all([leaving, attaching])

    await terminal.redraw(inline(60).props)
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(7)
  })

  test('a client leaving and attaching again stays counted, though the write of its leaving lands late', async ($, on) => {
    const { world, clock } = seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    let lateMs = 0
    on('state.set', { plugin: 'open-items' }, async ($, e, next) => {
      if (e.key === 'clients' && lateMs > 0) {
        const ms = lateMs
        lateMs = 0
        await clock.sleep(ms)
      }

      return next(e)
    })
    await start($)
    await $.session.attach({ surface: 'mobile', clientId: 'phone' })

    await runTasks($)
    await $.ui.mount(inline(60))
    const mobile = await $.ui.mount({ ...inline(32), surface: 'mobile' })
    expect(world.opens.at(-1)?.rows).toBe(7)

    // The phone drops and attaches again, and the write of its leaving lands
    // after the engine has it back: it stays counted, so a tablet attaching
    // next draws as one of two.
    lateMs = 100
    await mobile.unmount()
    const leaving = $.session.detach({ surface: 'mobile', clientId: 'phone', reason: 'detach' })
    await clock.settle()
    const attaching = $.session.attach({ surface: 'mobile', clientId: 'phone' })
    await clock.advance(100)
    await Promise.all([leaving, attaching])

    const phone = await $.ui.mount({ ...inline(32), surface: 'mobile' })
    await $.session.attach({ surface: 'mobile', clientId: 'tablet' })
    await phone.redraw(inline(60).props)
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(7)
  })

  test('the last client of a surface leaving as it draws the pane, the pane asks for none of the rows that drawing takes', async ($, on) => {
    const { world, clock } = seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    await start($)
    await $.session.attach({ surface: 'mobile', clientId: 'phone' })

    await runTasks($)
    const terminal = await $.ui.mount(inline(60))
    const mobile = await $.ui.mount({ ...inline(32), surface: 'mobile' })
    expect(world.opens.at(-1)?.rows).toBe(7)

    // The phone draws the pane again and leaves before that drawing reads who is attached.
    world.slowRead = 'clients'
    world.readMs = 100
    const drawing = mobile.redraw(inline(32).props)
    await clock.settle()
    await mobile.unmount()
    await $.session.detach({ surface: 'mobile', clientId: 'phone', reason: 'detach' })
    await clock.advance(100)
    await drawing.catch(() => undefined)

    await terminal.redraw(inline(60).props)
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(6)
  })

  test('a client is counted before it first draws the pane', async ($, on) => {
    const { world, clock } = seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    await start($)
    await $.session.attach({ surface: 'mobile', clientId: 'phone' })

    await runTasks($)
    const mobile = await $.ui.mount({ ...inline(32), surface: 'mobile' })
    expect(world.opens.at(-1)?.rows).toBe(7)

    // The tablet draws as it attaches, before the engine is done attaching it.
    world.attachMs = 500
    const attached = $.session.attach({ surface: 'mobile', clientId: 'tablet' })
    await clock.advance(1)
    await mobile.redraw(inline(60).props)
    await clock.advance(500)
    await attached
    await clock.settle()

    expect(world.opens.at(-1)?.rows).toBe(7)
  })

  test("the clients attached are kept in the session's state, which a reload of the code keeps", async ($, on) => {
    seat(on)
    let roster: unknown
    on('state.set', { plugin: 'open-items' }, ($, e, next) => {
      roster = e.key === 'clients' ? e.value : roster
      return next(e)
    })
    await start($)

    await $.session.attach({ surface: 'mobile', clientId: 'phone' })
    await $.session.attach({ surface: 'mobile', clientId: 'tablet' })
    await $.session.attach({ surface: 'desktop', clientId: 'laptop' })
    await $.session.detach({ surface: 'mobile', clientId: 'phone', reason: 'detach' })

    expect(roster).toEqual({ mobile: ['tablet'], desktop: ['laptop'] })
  })

  test('re-sizing the pane, a drawing or a keystroke reads the tasks once', async ($, on) => {
    const { world } = seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    await start($)

    await runTasks($)
    const ui = await $.ui.mount(inline(60))
    world.tasksRead = 0
    await ui.redraw(inline(32).props)
    expect(world.opens.at(-1)?.rows).toBe(7)
    expect(world.tasksRead).toBe(1)

    await ui.redraw(inline(100).props)
    await ui.press({ key: 'row-1' })
    const rows = world.opens.at(-1)?.rows ?? 0
    world.tasksRead = 0
    await ui.input({
      key: 'reply-1',
      text: 'LoginTests.testExpiredToken failed, and CartTests.testCouponRounding failed with a rounding error in the total',
      kind: 'change',
    })
    expect(world.opens.at(-1)?.rows).toBe(rows + 1)
    expect(world.tasksRead).toBe(1)
  })

  test('docked beside the transcript, the terminal asks for no rows of its own', async ($, on) => {
    const { world } = seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    await start($)

    await runTasks($)
    await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 32 } })
    await $.ui.mount({ ...inline(60), surface: 'mobile' })

    expect(world.opens.at(-1)?.rows).toBe(6)
  })

  test('the last task leaving, the pane closes and asks for no rows as it goes', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    const ui = await $.ui.mount(inline(60))
    const opens = world.opens.length
    // Drawn empty while the withdraw writes the store, before the pane closes.
    world.setMs = 1000
    const withdrawn = $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn' })
    await clock.advance(1)
    await ui.redraw(inline(60).props)
    await clock.advance(1000)
    await withdrawn

    expect(world.opens.length).toBe(opens)
    expect(world.isPaneOpen).toBe(false)
  })

  test('re-sizing as its last task leaves, the pane stays closed', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(inline(64))
    await ui.press({ key: 'row-1' })
    const rows = world.opens.at(-1)?.rows ?? 0
    await ui.input({ key: 'reply-1', text: 'Two failures: LoginTests.testExpiredToken and CartTests.testCouponRounding', kind: 'change' })
    expect(world.opens.at(-1)?.rows).toBe(rows + 1)

    // The answer, cut short, takes a row less, and the pane re-sizes reading
    // the tasks late: Claude withdraws the task meanwhile.
    world.slowRead = 'tasks'
    world.readMs = 500
    const typing = ui.input({ key: 'reply-1', text: 'Two failures', kind: 'change' })
    await clock.advance(1)
    await $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn', note: 'Found them in the CI logs' })
    await clock.advance(500)
    await typing
    await clock.settle()

    expect(world.isPaneOpen).toBe(false)
  })

  test('a re-size the surface answers late, as Claude withdraws the last task, leaves the pane closed', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(inline(64))
    await ui.press({ key: 'row-1' })
    const rows = world.opens.at(-1)?.rows ?? 0

    // The answer takes a row more, and the surface says late, as it was when
    // asked, that the pane is open: Claude withdraws the task meanwhile.
    world.panesMs = 500
    const typing = ui.input({ key: 'reply-1', text: 'Two failures: LoginTests.testExpiredToken and CartTests.testCouponRounding', kind: 'change' })
    await clock.advance(1)
    await $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn', note: 'Found them in the CI logs' })
    await clock.advance(500)
    await typing
    await clock.settle()

    expect(world.isPaneOpen).toBe(false)
    expect(world.opens.at(-1)?.rows).toBe(rows)
  })

  test('a re-size the surface answers late, as the pane is hidden, leaves it hidden', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(inline(64))
    await ui.press({ key: 'row-1' })

    world.panesMs = 500
    const typing = ui.input({ key: 'reply-1', text: 'Two failures: LoginTests.testExpiredToken and CartTests.testCouponRounding', kind: 'change' })
    await clock.advance(1)
    await ui.press({ key: 'hide' })
    await clock.advance(500)
    await typing
    await clock.settle()

    expect(world.isPaneOpen).toBe(false)
  })

  test('a long title is cut to one line in the list, and drawn whole, wrapping, with its age after it on its item screen', async ($, on) => {
    seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    await start($)

    const ui = await $.ui.mount(inline(32))
    const row = await textOf(ui, 'row-2')
    expect(row).toMatch(/^#2 Run xcodebuild .*…$/)
    expect(rowsOf(row, 30)).toBe(1)

    await ui.press({ key: 'row-2' })
    const title = await ui.find({ type: 'Text', text: /Run xcodebuild/ })

    expect(title?.props.wrap).toBe('wrap')
    expect(title?.text).toBe(`#2 ${XCODE_LONG.title}  3m`)
  })

  test('a title past 80 characters, an older version left, is drawn whole', async ($, on) => {
    const title = `Rotate the deploy key ${'and check every runner that holds it '.repeat(3).trim()}`
    seat(on, earlierItems(asItems([{ ...INSTRUMENTS, title }, { ...XCODE_LONG, title }])))
    await start($)

    const ui = await $.ui.mount(inline(32))

    expect(title.length).toBeGreaterThan(80)
    await ui.press({ key: 'row-1' })
    expect(await textOf(ui, 'item-1')).toContain(title)
    await ui.press({ key: 'back' })
    await ui.press({ key: 'row-2' })
    expect(await textOf(ui, 'item-2')).toContain(title)
  })

  test('a focused field wraps its text a column short of the field, for the cursor', () => {
    // 60 across: `Answer: ` and ` ⏎ send` leave the field 45 columns, its text 44.
    expect(fieldRowsOf('Answer', 'send', 'x'.repeat(44), true, 60)).toBe(1)
    expect(fieldRowsOf('Answer', 'send', 'x'.repeat(45), true, 60)).toBe(2)
    // Out of the keys, the text is cut to one row, and the label, cut short, wraps onto a second:
    // as Claude Code 2.1.296 drew 56 and 57 characters at 64 columns.
    expect(fieldRowsOf('Answer', 'send', 'x'.repeat(56), false, 60)).toBe(1)
    expect(fieldRowsOf('Answer', 'send', 'x'.repeat(57), false, 60)).toBe(2)
    // However narrow the pane, the terminal gives the field 12 columns, its text 11.
    expect(fieldRowsOf('Answer', 'send', 'x'.repeat(22), true, 20)).toBe(2)
    expect(fieldRowsOf('Answer', 'send', 'x'.repeat(23), true, 20)).toBe(3)
  })

  test('a row too narrow for the label, the field and the hint takes its lack from each, and what is cut short wraps onto a second', () => {
    // As Claude Code 2.1.296 drew them at 30, 29 and 28 columns: bodies 26, 25 and 24 across.
    // The placeholder takes the field's 12 columns, the text its cells and the cursor's: a row a cell short cuts only the field.
    expect(fieldRowsOf('Answer', 'send', '', true, 26)).toBe(1)
    expect(fieldRowsOf('Answer', 'send', '', true, 25)).toBe(2)
    expect(fieldRowsOf('Reason', 'reject', '', true, 26)).toBe(2)
    expect(fieldRowsOf('Answer', 'send', 'abc', true, 24)).toBe(1)
    expect(fieldRowsOf('Answer', 'send', 'abcdefghij', true, 25)).toBe(1)
    expect(fieldRowsOf('Answer', 'send', 'abcdefghijk', true, 26)).toBe(1)
    expect(fieldRowsOf('Answer', 'send', 'abcdefghijk', true, 25)).toBe(2)
    // Out of the keys, the placeholder cut to the field, at 23 and 22 columns.
    expect(fieldRowsOf('Answer', 'send', '', false, 19)).toBe(1)
    expect(fieldRowsOf('Answer', 'send', '', false, 18)).toBe(2)
  })

  test('a field squeezed onto a second row in a narrow pane asks for that row', async ($, on) => {
    const { world, clock } = seat(on, earlier([{ ...XCODE_LONG, title: 'Paste the failures', why: "I can't run Xcode." }]))
    await start($)

    await runTasks($)
    // At 28 columns Claude Code 2.1.296 squeezes `⏎ send` under the empty field, on a row of its own.
    // The field takes the ring as the item opens.
    const ui = await $.ui.mount(inline(24))
    await ui.press({ key: 'row-2' })
    expect(world.opens.at(-1)?.rows).toBe(16)

    // A short answer leaves the hint room on its row.
    await ui.input({ key: 'reply-2', text: 'abc', kind: 'change' })
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(15)

    await ui.input({ key: 'reply-2', text: 'abcdefghijk', kind: 'change' })
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(16)
  })

  test('a field in a narrow pane, hidden and opened again, has the ring no more and asks for no squeezed row', async ($, on) => {
    const { world, clock } = seat(on, earlier([{ ...XCODE_LONG, title: 'Paste the failures', why: "I can't run Xcode." }]))
    await start($)

    await runTasks($)
    const ui = await $.ui.mount(inline(24))
    await ui.press({ key: 'row-2' })
    expect(world.opens.at(-1)?.rows).toBe(16)

    // Opened again, the ring starts on nothing: the field has no autoFocus.
    await ui.press({ key: 'hide' })
    await ui.unmount()
    await runTasks($)
    await $.ui.mount(inline(24))
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(15)
  })

  test('the transcript row keeps its label whole and wraps the title after it', async ($, on) => {
    seat(on)
    await start($)

    const ui = await $.ui.mount({
      plugin: 'open-items',
      surface: 'terminal',
      component: 'ToolUse',
      props: {
        tool_use_id: 'toolu_1',
        tool: ADD,
        input: { title: XCODE_LONG.title },
        isRunning: false,
        isErrored: false,
        isInterrupted: false,
      },
    })
    // One text, outermost: no row of columns for the label to be squeezed in.
    const row = await ui.find({ type: 'Text' })

    expect((await ui.drawn()).type).toBe('Text')
    expect(row?.props.wrap).toBe('wrap')
    expect(row?.text).toBe(`☐ Added an item for you: ${XCODE_LONG.title}`)
  })
})

describe('the pane and /open-items', () => {
  test('/open-items opens the pane with the keyboard, or says there is nothing', async ($, on) => {
    const { world } = seat(on)
    await start($)

    expect((await runTasks($)).text).toBe('No items for you right now.')

    await $.tool.call(KEY_TASK)
    await runTasks($)

    expect(world.opens.at(-1)?.focus).toBe(true)
  })

  test('a field open on a surface that draws one leaves the task its buttons on the phone', async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    const phone = await $.ui.mount({ ...PANE, surface: 'mobile' })

    expect(await ui.find({ type: 'Input' })).toBeDefined()
    // A question has no Done; with no field, the phone draws no Long answer… either.
    expect((await phone.findAll({ type: 'Button' })).map(button => button.props.label)).toEqual(['Later', 'Back', 'Hide'])
  })

  test('Hide closes the pane and the status line keeps the count', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'hide' })

    expect(world.isPaneOpen).toBe(false)
    expect(world.status).toBe('☐ 1 action · /open-items')
  })
})

describe('the list screen', () => {
  /** An item a session saved, as v0.2 holds it. */
  const listed = (id: number, kind: TaskKind, title: string, fields: Partial<Task> = {}): Task => ({
    ...(asItems([{ ...ROTATE, id, kind, title, why: 'Needed before the release.', ...(kind === 'decision' ? { options: ['Yes', 'No'] } : {}) }])[0] as Task),
    ...fields,
  })

  /** Thirty actions: a list longer than an 18-row pane. */
  const LONG_LIST = Array.from({ length: 30 }, (_, i) => listed(i + 1, 'action', `Rotate deploy key number ${i + 1}`))

  /** The person's arrow key over a body the engine has rows to scroll. */
  const arrow = (by: 1 | -1) => ({ component: 'Pane', requestId: 'open-items', offset: 1, by, bodyRows: 18, contentRows: 33, origin: { kind: 'person' } }) as const

  test('the list shows one line per item, grouped, LATER last', async ($, on) => {
    seat(
      on,
      earlierItems([
        listed(1, 'info', 'The migration ran clean'),
        listed(2, 'decision', 'Ship the feed rewrite this week', { state: 'later' }),
        listed(3, 'action', 'Create 3 dev tokens (steps inside)'),
        listed(4, 'question', 'Which cloud project holds the uploader?'),
        listed(5, 'decision', 'Merge the slow-test split with the override label, or wait for a reviewer on Thursday?'),
      ]),
    )
    await start($)

    const ui = await $.ui.mount(inline(60))
    const text = (await ui.find({ type: 'Box' }))?.text ?? ''
    const at = ['DECISIONS', 'QUESTIONS', 'ACTIONS', 'INFO', 'LATER'].map(label => text.indexOf(label))
    const rows = (await ui.findAll({ type: 'Button' })).filter(button => button.key?.startsWith('row-'))

    // Each item once, oldest first in its section; the one put off only under LATER.
    expect(rows.map(row => row.key)).toEqual(['row-5', 'row-4', 'row-3', 'row-1', 'row-2'])
    expect(at.every(i => i >= 0)).toBe(true)
    expect(at).toEqual([...at].sort((a, b) => a - b))
    expect(await textOf(ui, 'section-DECISIONS')).not.toContain('Ship the feed')
    expect(await textOf(ui, 'section-LATER')).toContain('#2 Ship the feed rewrite this week')
    // One line each, a title too long for it cut short.
    expect(rows.every(row => rowsOf(row.text, 58) === 1)).toBe(true)
    expect(await textOf(ui, 'row-5')).toMatch(/^#5 Merge the slow-test split .*…$/)
    expect(await textOf(ui, 'row-4')).toBe('#4 Which cloud project holds the uploader?')
  })

  test('a row with a new Claude reply shows ●', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call({ tool: REPLY, id: 1, text: 'Which scheme do you build?' })
    const ui = await $.ui.mount(PANE)

    expect(await textOf(ui, 'row-1')).toContain('●')
    expect(world.status).toBe('☐ 1 question · ● 1 reply · /open-items')
  })

  test('a row after the user\'s reply shows "waiting for Claude" and leaves the status count', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    await $.tool.call(XCODE_TASK)
    await $.prompt.submit(typed('↳ Answer to #2: Two failures'))
    const ui = await $.ui.mount(PANE)

    expect(await textOf(ui, 'row-2')).toContain('⋯ waiting for Claude')
    expect(await textOf(ui, 'row-1')).not.toContain('waiting for Claude')
    expect(world.status).toBe('☐ 1 action · /open-items')
  })

  test('Enter on row-9 opens item 9 before item 5', async ($, on) => {
    const { world } = seat(on, earlierItems([listed(5, 'decision', 'Ship the feed rewrite this week'), listed(9, 'question', 'Which cloud project holds the uploader?')]))
    await start($)

    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-9' })

    expect(world.screen).toEqual({ kind: 'item', id: 9 })
    expect(await textOf(ui, 'item-9')).toContain('Which cloud project holds the uploader?')
    expect(await ui.find({ key: 'row-5' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'option-1' })).toBeUndefined()
  })

  test('rows asked for the list never exceed 18 inline', async ($, on) => {
    const { world } = seat(on, earlierItems(LONG_LIST.slice(0, 2)))
    await start($)

    await runTasks($)
    await $.ui.mount(inline(60))
    // The head, ACTIONS, a row for each item, and the foot.
    expect(world.opens.at(-1)?.rows).toBe(5)

    for (const item of LONG_LIST.slice(2)) {
      await $.tool.call({ ...KEY_TASK, title: item.title })
    }

    expect(world.opens.at(-1)?.rows).toBe(18)
  })

  test('an arrow moves the focus to the next or previous row, across a section label, and nowhere past the first or last', () => {
    const order = focusOrderOf([listed(1, 'question', 'Which cloud project holds the uploader?'), listed(2, 'decision', 'Ship the feed rewrite this week'), listed(3, 'question', 'Which region?')])

    expect(order).toEqual(['row-2', 'row-1', 'row-3', 'hide'])
    expect(arrowTargetOf(order, 'row-1', 1)).toBe('row-3')
    expect(arrowTargetOf(order, 'row-3', -1)).toBe('row-1')
    // From the last decision to the first question, over the QUESTIONS label.
    expect(arrowTargetOf(order, 'row-2', 1)).toBe('row-1')
    expect(arrowTargetOf(order, 'row-1', -1)).toBe('row-2')
    expect(arrowTargetOf(order, 'row-2', -1)).toBeUndefined()
    expect(arrowTargetOf(order, 'hide', 1)).toBeUndefined()
    // A ring on nothing of the list's starts on its first row.
    expect(arrowTargetOf(order, undefined, 1)).toBe('row-2')
    expect(arrowTargetOf(order, 'reply-1', -1)).toBe('row-2')
  })

  test('arrows the engine sums into one move take the ring a row for each, as far as the first or last row', () => {
    const rows = ['row-1', 'row-2', 'row-3', 'row-4', 'row-5', 'row-6']

    expect(arrowTargetOf(rows, 'row-1', 4)).toBe('row-5')
    expect(arrowTargetOf(rows, 'row-5', -2)).toBe('row-3')
    expect(arrowTargetOf(rows, 'row-5', 4)).toBe('row-6')
    expect(arrowTargetOf(rows, 'row-2', -4)).toBe('row-1')
    expect(arrowTargetOf(rows, 'row-6', 4)).toBeUndefined()
  })

  test('arrows in a long list that come before the ring has moved each move on from the last target', async ($, on) => {
    seat(on, earlierItems(LONG_LIST))
    await start($)

    await runTasks($)
    await $.ui.mount(inline(60))

    // A held ↓: the second arrow finds the ring on Hide, the last stop, and the body scrolls.
    await $.ui.focus(ringTo('row-30'))
    expect((await $.ui.scroll(arrow(1))).deny).toBeDefined()
    expect((await $.ui.scroll(arrow(1))).deny).toBeUndefined()

    // A fast ↓↑ comes back to row-1, past which an ↑ scrolls the body.
    await $.ui.focus(ringTo('row-1'))
    expect((await $.ui.scroll(arrow(1))).deny).toBeDefined()
    expect((await $.ui.scroll(arrow(-1))).deny).toBeDefined()
    expect((await $.ui.scroll(arrow(-1))).deny).toBeUndefined()
  })

  test('an arrow in a long list does not scroll the body; a wheel tick, an arrow past the first or last row and a short list scroll as before', async ($, on) => {
    const { world } = seat(on, earlierItems(LONG_LIST))
    await start($)

    await runTasks($)
    await $.ui.mount(inline(60))

    // The ring's move itself is the live harness's to check: the kit answers no plugin's `$.ui.focus`.
    await $.ui.focus(ringTo('row-1'))
    expect((await $.ui.scroll(arrow(1))).deny).toBeDefined()
    await $.ui.focus(ringTo('row-2'))
    expect((await $.ui.scroll(arrow(-1))).deny).toBeDefined()
    // Arrows the engine summed while it waited on this hook.
    await $.ui.focus(ringTo('row-1'))
    expect((await $.ui.scroll({ ...arrow(1), by: 4 })).deny).toBeDefined()
    expect(world.scrolls).toEqual([])

    expect((await $.ui.scroll({ ...arrow(1), pointer: { column: 3, row: 4 } })).deny).toBeUndefined()
    await $.ui.focus(ringTo('row-1'))
    expect((await $.ui.scroll(arrow(-1))).deny).toBeUndefined()
    await $.ui.focus(ringTo('hide'))
    expect((await $.ui.scroll(arrow(1))).deny).toBeUndefined()
    expect((await $.ui.scroll({ ...arrow(1), contentRows: 5 })).deny).toBeUndefined()
    expect(world.scrolls).toEqual([
      { by: 1, origin: 'person' },
      { by: -1, origin: 'person' },
      { by: 1, origin: 'person' },
      { by: 1, origin: 'person' },
    ])
  })
})

/** A second task that takes an answer, as XCODE_TASK does. */
const ANDROID_TASK = { ...XCODE_TASK, title: 'Run the Android tests on your phone, paste the failures' } as const

/** The pane's focus ring moving onto `element`, as the person's click or Tab moves it. */
function ringTo(element: string) {
  return {
    component: 'Pane',
    requestId: 'open-items',
    plugin: 'open-items',
    element,
    origin: { kind: 'person' },
  } as const
}

describe('the reply field', () => {
  test("the item screen draws a reply field of the item's own, labelled for the terminal to add its colon", async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(ANDROID_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    const field = await ui.find({ type: 'Input', key: 'reply-1' })

    expect([field?.props.label, field?.props.placeholder, field?.props.autoFocus]).toEqual(['Reply', 'Enter sends it to Claude', undefined])
  })

  test('a reply held for looking like a secret says what to do instead: Done for an action, a reply without it otherwise', async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(KEY_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: KEY_SHAPED })
    expect(await textOf(ui, 'held')).toContain('Put it where it belongs and reply without it instead.')

    await ui.press({ key: 'back' })
    await ui.press({ key: 'row-2' })
    await ui.input({ key: 'reply-2', text: KEY_SHAPED })
    expect(await textOf(ui, 'held')).toContain('Put it where it belongs and press Done instead.')

    const bridged = await $.prompt.submit(typed(`↳ Answer to #1: ${KEY_SHAPED}`))
    expect(bridged.drop).toBe("This looks like a secret, so it wasn't sent. Put it where it belongs, then reply on #1 without it.")
  })

  test('a held answer comes back to its field on Edit', async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: KEY_SHAPED, kind: 'change' })
    await ui.input({ key: 'reply-1', text: KEY_SHAPED })
    await ui.press({ key: 'edit' })

    expect((await ui.find({ type: 'Input', key: 'reply-1' }))?.props.value).toBe(KEY_SHAPED)
  })

  test('typed in, the field keeps the value it opened with: one drawn anew puts its text back, keys typed since lost', async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'LoginTests', kind: 'change' })
    // The pane draws again while the user types: Claude adds another item.
    await $.tool.call(ANDROID_TASK)

    expect((await ui.find({ type: 'Input', key: 'reply-1' }))?.props.value).toBe('')
  })

  test('hidden and opened again, the field holds what was typed in it', async ($, on) => {
    const { clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'Use the staging creds', kind: 'change' })
    await clock.settle()
    await ui.press({ key: 'hide' })
    await ui.unmount()
    await runTasks($)
    const again = await $.ui.mount(PANE)

    expect((await again.find({ type: 'Input', key: 'reply-1' }))?.props.value).toBe('Use the staging creds')
  })

  test("hidden and opened again while the engine can't list its panes, the field holds what was typed in it", async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'Use the staging creds', kind: 'change' })
    await clock.settle()
    await ui.press({ key: 'hide' })
    await ui.unmount()
    world.isPanesFailing = true
    await runTasks($)
    const again = await $.ui.mount(PANE)

    expect((await again.find({ type: 'Input', key: 'reply-1' }))?.props.value).toBe('Use the staging creds')
  })

  test('with no draft to draw again, the pane opens without asking which panes are open', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await runTasks($)

    expect(world.opens).toHaveLength(2)
    expect(world.panesAsked).toBe(0)
  })

  test('a client attaching draws the field with what is typed in it, and leaves a field drawn elsewhere the value it opened with', async ($, on) => {
    const { clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'Use the staging creds', kind: 'change' })
    await clock.settle()
    await $.session.attach({ surface: 'desktop', clientId: 'laptop' })
    const laptop = await $.ui.mount({ ...PANE, surface: 'desktop' })
    // The pane draws again: Claude adds another item.
    await $.tool.call(ANDROID_TASK)

    expect((await laptop.find({ type: 'Input', key: 'reply-1' }))?.props.value).toBe('Use the staging creds')
    expect((await ui.find({ type: 'Input', key: 'reply-1' }))?.props.value).toBe('')
  })

  test('a second client of a surface draws the field with what is typed in it', async ($, on) => {
    const { clock } = seat(on)
    await start($)
    await $.session.attach({ surface: 'desktop', clientId: 'laptop' })

    await $.tool.call(XCODE_TASK)
    const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await desktop.press({ key: 'row-1' })
    await desktop.input({ key: 'reply-1', text: 'Use the staging creds', kind: 'change' })
    await clock.settle()
    // The desktop app opens on another computer, and draws the pane.
    await $.session.attach({ surface: 'desktop', clientId: 'office' })
    await desktop.redraw()

    expect((await desktop.find({ type: 'Input', key: 'reply-1' }))?.props.value).toBe('Use the staging creds')
  })

  test('typed in, the field asks for the rows its text wraps to, and for one row less once the keys leave it', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    // At 70 columns either hint takes one row beside Back and Hide.
    const ui = await $.ui.mount(inline(70))
    // The field takes the ring as the item opens.
    await ui.press({ key: 'row-1' })
    const rows = world.opens.at(-1)?.rows ?? 0

    // 56 columns for the text beside `Reply: ` and ` ⏎ send`, one kept for the cursor: three rows.
    await ui.input({
      key: 'reply-1',
      text: 'LoginTests.testExpiredToken failed, and CartTests.testCouponRounding failed with a rounding error',
      kind: 'change',
    })
    expect(world.opens.at(-1)?.rows).toBe(rows + 2)

    // Out of the keys, the text is cut to one row; the label, squeezed, wraps onto a second.
    await ui.redraw({ ...inline(70).props, isFocused: false })
    expect(world.opens.at(-1)?.rows).toBe(rows + 1)

    // Back in them, the ring is where it was.
    await ui.redraw(inline(70).props)
    expect(world.opens.at(-1)?.rows).toBe(rows + 2)

    // Tab moves the keys on to Back, and Shift+Tab brings them back.
    await $.ui.focus(ringTo('back'))
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(rows + 1)

    await $.ui.focus(ringTo('reply-1'))
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(rows + 2)
  })

  test('hidden and opened again, the ring starts on nothing, and a key typed in the field puts it there: the field asks for the rows its text wraps to', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(inline(60))
    await ui.press({ key: 'row-1' })
    await $.ui.focus(ringTo('reply-1'))
    await clock.settle()
    const rows = world.opens.at(-1)?.rows ?? 0
    await ui.input({
      key: 'reply-1',
      text: 'LoginTests.testExpiredToken failed, and CartTests.testCouponRounding failed with a rounding error',
      kind: 'change',
    })
    expect(world.opens.at(-1)?.rows).toBe(rows + 2)

    // Opened again, the field holds the draft, cut to one row and its label squeezed onto a second.
    await ui.press({ key: 'hide' })
    await ui.unmount()
    await runTasks($)
    const again = await $.ui.mount(inline(60))
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(rows + 1)

    // A key typed in the field says the ring is there.
    await again.input({ key: 'reply-1', text: 'LoginTests.testExpiredToken failed, and CartTests.testCouponRounding failed with rounding', kind: 'change' })
    expect(world.opens.at(-1)?.rows).toBe(rows + 2)
  })

  test('a key typed as a move of the ring re-sizes the pane, the pane asks for the rows the key leaves', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(inline(60))
    await ui.press({ key: 'row-1' })
    const rows = world.opens.at(-1)?.rows ?? 0
    await ui.input({ key: 'reply-1', text: 'LoginTests.testExpiredToken failed, and CartTests.testCouponRounding failed', kind: 'change' })
    expect(world.opens.at(-1)?.rows).toBe(rows + 1)

    // Tab moves the keys on to Back, and that re-size reads slowly; the
    // person comes back to the field and types meanwhile.
    world.slowRead = 'screen'
    world.readMs = 100
    await $.ui.focus(ringTo('back'))
    await clock.settle()
    const typing = ui.input({
      key: 'reply-1',
      text: 'LoginTests.testExpiredToken failed, and CartTests.testCouponRounding failed with a rounding error',
      kind: 'change',
    })
    await clock.settle()
    await clock.advance(100)
    await typing
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(rows + 2)
  })

  test('a placeholder longer than the field is cut to its row', async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(inline(32))
    await ui.press({ key: 'row-1' })

    expect((await ui.find({ type: 'Input', key: 'reply-1' }))?.props.placeholder).toBe('Enter sends it to…')
  })
})

describe('the item screen', () => {
  const DECISION = { ...PAGING_TASK, recommended: 'Cursor' } as const
  const INFO = { tool: ADD, title: 'The migration ran clean', detail: 'Nothing for you to do.', kind: 'info' } as const

  /** An item a session saved, as v0.2 holds it. */
  const saved = (id: number, fields: Partial<Task> = {}): Task => ({
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
  })

  /** The person's arrow key over a body the engine has rows to scroll. */
  const arrow = (by: 1 | -1) => ({ component: 'Pane', requestId: 'open-items', offset: 1, by, bodyRows: 18, contentRows: 33, origin: { kind: 'person' } }) as const

  const keysOf = async (ui: Pick<Mounted<'terminal', 'Pane'>, 'findAll'>) => (await ui.findAll({ type: 'Button' })).map(button => button.key)

  test('the item screen shows the whole thread with line breaks', async ($, on) => {
    seat(
      on,
      earlierItems([
        saved(1, {
          title: 'Create 3 dev tokens',
          doneWhen: 'The tokens are in the vault.\nEach expires in 30 days.',
          link: 'https://example.com/plan#tokens',
          thread: [
            { from: 'claude', text: 'Step one: open the console.\nStep two: make the tokens.\nStep three: save them.', atMs: NOW - 240_000 },
            { from: 'user', text: 'Which\u0007 console?\n\tThe old one?', atMs: NOW - 120_000 },
            { from: 'claude', text: 'The new one.\nIts link is at the top.', atMs: NOW - 60_000 },
            { from: 'claude', text: '', event: 'changed', atMs: NOW - 60_000 },
          ],
        }),
      ]),
    )
    await start($)

    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })

    expect((await textOf(ui, 'msg-0')).split('\n')).toEqual(['Step one: open the console.', 'Step two: make the tokens.', 'Step three: save them.'])
    // Control characters other than a line break are made safe to draw.
    expect(await textOf(ui, 'msg-1')).toBe('Which  console?\n The old one?')
    expect(await textOf(ui, 'msg-2')).toBe('The new one.\nIts link is at the top.')
    expect(await textOf(ui, 'msg-3')).toBe('Claude changed the item · 1m')
    expect(await textOf(ui, 'thread')).toMatch(/Claude · 4m.*You · 2m.*Claude · 1m/s)
    expect((await ui.find({ type: 'Text', text: /^Done when:/ }))?.text).toBe('Done when: The tokens are in the vault.\nEach expires in 30 days.')
    expect((await ui.find({ type: 'Link' }))?.props.href).toBe('https://example.com/plan#tokens')
  })

  test('on an action item, typing "done already" into the open item\'s field and pressing Enter sends a reply, and no Done is pressed', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call({ tool: ADD, kind: 'action', title: 'Add the key', detail: 'Needed.' })
    const ui = await $.ui.mount(inline(24))
    await ui.press({ key: 'row-1' })
    // The ring is in the field as the item opens: `⏎ send` squeezes under it at 24 columns.
    const rows = world.opens.at(-1)?.rows ?? 0
    await $.ui.focus(ringTo('back'))
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(rows - 1)

    await $.ui.focus(ringTo('reply-1'))
    await ui.input({ key: 'reply-1', text: 'd', kind: 'change' })
    await ui.input({ key: 'reply-1', text: 'done already', kind: 'change' })
    await ui.input({ key: 'reply-1', text: 'done already' })
    await clock.advance(1000)
    await clock.settle()

    expect(itemOf(world, 1)?.state).toBe('open')
    expect(itemOf(world, 1)?.thread.at(-1)).toEqual({ from: 'user', text: 'done already', atMs: NOW })
    expect(world.submitted).toEqual([`${ONE}#1 Add the key: ${REPLY_WORDS}\ndone already`])
    expect(world.screen).toEqual({ kind: 'item', id: 1 })
  })

  test('opening an item clears its ●', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call({ tool: REPLY, id: 1, text: 'Which scheme do you build?' })
    const ui = await $.ui.mount(PANE)
    expect(await textOf(ui, 'row-1')).toContain('●')

    await ui.press({ key: 'row-1' })
    expect(itemOf(world, 1)?.hasNewReply).toBe(false)
    expect(world.status).toBe('☐ 1 question · /open-items')

    await ui.press({ key: 'back' })
    expect(await textOf(ui, 'row-1')).not.toContain('●')
  })

  test('Back returns to the list', async ($, on) => {
    const { world } = seat(on, earlierItems(Array.from({ length: 30 }, (_, i) => saved(i + 1))))
    await start($)

    await runTasks($)
    const ui = await $.ui.mount(inline(60))
    await ui.press({ key: 'row-30' })
    expect(world.screen).toEqual({ kind: 'item', id: 30 })

    await ui.press({ key: 'back' })
    expect(world.screen).toEqual({ kind: 'list' })
    expect(await ui.find({ key: 'item-30' })).toBeUndefined()
    expect(await ui.find({ key: 'row-30' })).toBeDefined()
    // The ring is on the row just left: ↓ goes on to Hide, the last stop, and the next one scrolls the body.
    expect((await $.ui.scroll(arrow(1))).deny).toBeDefined()
    expect((await $.ui.scroll(arrow(1))).deny).toBeUndefined()
  })

  test('an item closed from its screen leaves the ring on the row drawn after it, or before it when it was the last', async ($, on) => {
    const drawn = ['row-1', 'row-2', 'row-3', 'hide']

    expect(rowBackTo(2, drawn, ['row-1', 'row-3', 'hide'])).toBe('row-3')
    expect(rowBackTo(3, drawn, ['row-1', 'row-2', 'hide'])).toBe('row-2')
    // Back, or Later: the item keeps its row.
    expect(rowBackTo(2, drawn, drawn)).toBe('row-2')
    expect(rowBackTo(1, ['row-1', 'hide'], ['hide'])).toBeUndefined()

    seat(on, earlierItems(Array.from({ length: 30 }, (_, i) => saved(i + 1))))
    await start($)
    await runTasks($)
    const ui = await $.ui.mount(inline(60))
    await ui.press({ key: 'row-30' })
    await ui.press({ key: 'done' })

    // On row-29: ↓ goes on to Hide, the last stop, and the next one scrolls the body.
    expect((await $.ui.scroll(arrow(1))).deny).toBeDefined()
    expect((await $.ui.scroll(arrow(1))).deny).toBeUndefined()
  })

  test('buttons by kind: options + Later for a decision, Done + Later for an action, Seen for info', async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(DECISION)
    await $.tool.call(XCODE_TASK)
    await $.tool.call(KEY_TASK)
    await $.tool.call(INFO)
    const ui = await $.ui.mount(PANE)
    const screenOf = async (id: number) => {
      await ui.press({ key: `row-${id}` })
      const buttons = (await ui.findAll({ type: 'Button' })).map(button => `${button.key} ${button.props.hotkey ?? '-'} ${button.props.label}`)
      const field = (await ui.find({ type: 'Input' }))?.key
      await ui.press({ key: 'back' })

      return { buttons, field }
    }

    expect(await screenOf(1)).toEqual({
      buttons: ['option-1 1 Cursor (recommended)', 'option-2 2 Offset, capped at 10k', 'later l Later', 'long - Long answer…', 'back b Back', 'hide - Hide'],
      field: 'reply-1',
    })
    expect(await screenOf(2)).toEqual({ buttons: ['later l Later', 'long - Long answer…', 'back b Back', 'hide - Hide'], field: 'reply-2' })
    expect(await screenOf(3)).toEqual({ buttons: ['done d Done', 'later l Later', 'long - Long answer…', 'back b Back', 'hide - Hide'], field: 'reply-3' })
    expect(await screenOf(4)).toEqual({ buttons: ['seen d Seen', 'back b Back', 'hide - Hide'], field: undefined })
  })

  test('an item in LATER keeps its buttons', async ($, on) => {
    seat(on, earlierItems([saved(1, { kind: 'decision', options: ['Ship it', 'Hold'], state: 'later' })]))
    await start($)

    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })

    expect(await keysOf(ui)).toEqual(['option-1', 'option-2', 'long', 'back', 'hide'])
    expect(await ui.find({ type: 'Input', key: 'reply-1' })).toBeDefined()
  })

  test('a press on a drawing from before Claude closed the item sends nothing and says it is closed', async ($, on) => {
    const { world, clock } = seat(on)
    const held = holdingPresses(on)
    await start($)

    await $.tool.call(DECISION)
    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    held.isOn = true
    const pressed = ui.press({ key: 'option-1' })
    await $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn' })
    held.letGo()
    await pressed
    await clock.advance(1000)
    await clock.settle()

    expect(itemOf(world, 1)?.state).toBe('withdrawn')
    expect(world.submitted).toEqual([])
    expect(world.appended).toEqual([])
    expect(world.toasts.at(-1)).toBe("Item #1 isn't open any more, so your response wasn't saved.")
    expect(world.screen).toEqual({ kind: 'list' })
  })

  test('a press of an option Claude has changed since the drawing sends nothing and says the item changed', async ($, on) => {
    const { world, clock } = seat(on)
    const held = holdingPresses(on)
    await start($)

    await $.tool.call(DECISION)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'Is the feed ordered by time?', kind: 'change' })
    held.isOn = true
    const pressed = ui.press({ key: 'option-2' })
    await $.tool.call({ tool: REPLY, id: 1, text: 'Two other ways now.', options: ['Keyset', 'Offset, capped at 1k'] })
    held.letGo()
    await pressed
    await clock.advance(1000)
    await clock.settle()

    expect(itemOf(world, 1)?.state).toBe('open')
    expect(itemOf(world, 1)?.update).toBe('none')
    expect(world.submitted).toEqual([])
    expect(world.toasts.at(-1)).toBe("Item #1 changed since the pane showed it, so your choice wasn't saved. Look at its options again.")
    expect(world.screen).toEqual({ kind: 'item', id: 1 })
    expect((await ui.find({ type: 'Button', key: 'option-1' }))?.props.label).toBe('Keyset')

    // The draft stays with the item.
    await ui.press({ key: 'back' })
    await ui.press({ key: 'row-1' })
    expect((await ui.find({ type: 'Input', key: 'reply-1' }))?.props.value).toBe('Is the feed ordered by time?')
  })

  test('a 40-message thread inline at 18 rows asks for at most 18 rows and keeps the back Button with hotkey b', async ($, on) => {
    const thread = Array.from({ length: 40 }, (_, i): Message => ({ from: i % 2 === 0 ? 'claude' : 'user', text: `${'word '.repeat(799)}words`, atMs: NOW - 40_000 + i }))
    const { world } = seat(on, earlierItems([saved(1, { thread }), saved(2)]))
    await start($)

    await runTasks($)
    const ui = await $.ui.mount(inline(60))
    expect(world.opens.at(-1)?.rows).toBe(5)

    await ui.press({ key: 'row-1' })
    const back = await ui.find({ type: 'Button', key: 'back' })

    expect(world.opens.at(-1)?.rows).toBe(18)
    expect([back?.props.hotkey, back?.props.label]).toEqual(['b', 'Back'])
    // One drawing draws 100,000 characters: the detail and the newest messages, and a line for those between.
    expect(await textOf(ui, 'msg-0')).toHaveLength(4000)
    expect(await textOf(ui, 'earlier')).toBe('21 earlier messages are not shown: the thread is too long for the pane.')
    expect(await ui.find({ key: 'msg-21' })).toBeUndefined()
    expect(await textOf(ui, 'msg-22')).toHaveLength(4000)
    expect(await textOf(ui, 'msg-39')).toHaveLength(4000)
  })

  test("the reply field is keyed per item, so a draft never lands in another item's field", async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(ANDROID_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'LoginTests.testExpiredToken failed', kind: 'change' })
    await ui.press({ key: 'back' })
    await ui.press({ key: 'row-2' })

    expect(await ui.find({ type: 'Input', key: 'reply-1' })).toBeUndefined()
    expect((await ui.find({ type: 'Input', key: 'reply-2' }))?.props.value).toBe('')

    await ui.press({ key: 'back' })
    await ui.press({ key: 'row-1' })

    expect((await ui.find({ type: 'Input', key: 'reply-1' }))?.props.value).toBe('LoginTests.testExpiredToken failed')
  })

  test('a reply clears the ● of its item: the row shows ⋯ waiting for Claude alone', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call({ tool: REPLY, id: 1, text: 'Which scheme do you build?' })
    await $.prompt.submit(typed('↳ Answer to #1: The App scheme'))
    const ui = await $.ui.mount(PANE)

    expect(itemOf(world, 1)?.hasNewReply).toBe(false)
    expect(await textOf(ui, 'row-1')).toContain('⋯ waiting for Claude')
    expect(await textOf(ui, 'row-1')).not.toContain('●')
  })

  test('after an option, Done, Seen or Later the pane shows the list; after a reply it stays on the item', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(DECISION)
    await $.tool.call(KEY_TASK)
    await $.tool.call(INFO)
    await $.tool.call({ ...DECISION, title: 'Pick a cache for /feed' })
    const ui = await $.ui.mount(PANE)

    await ui.press({ key: 'row-1' })
    await ui.press({ key: 'later' })
    expect(world.screen).toEqual({ kind: 'list' })
    expect(await textOf(ui, 'section-LATER')).toContain('#1 Pick a pagination strategy')

    await ui.press({ key: 'row-2' })
    await ui.input({ key: 'reply-2', text: 'The vault is locked; who has the key?' })
    expect(world.screen).toEqual({ kind: 'item', id: 2 })
    expect((await ui.find({ type: 'Input', key: 'reply-2' }))?.props.value).toBe('')

    await ui.press({ key: 'done' })
    expect(world.screen).toEqual({ kind: 'list' })

    await ui.press({ key: 'row-3' })
    await ui.press({ key: 'seen' })
    expect(world.screen).toEqual({ kind: 'list' })

    await ui.press({ key: 'row-4' })
    await ui.press({ key: 'option-1' })
    expect(world.screen).toEqual({ kind: 'list' })
    expect(await keysOf(ui)).toEqual(['row-1', 'hide'])
  })
})

describe('responding', () => {
  const QUESTION = { ...ROTATE, id: 1, title: XCODE_TASK.title, why: XCODE_TASK.detail, kind: 'question' } as const
  const ACTION = { ...ROTATE, id: 2, title: KEY_TASK.title, why: KEY_TASK.detail, doneWhen: KEY_TASK.done_when } as const

  /** The store as a session left #1 answered with `answer` and #2 open, the answer never told to Claude: as a send that failed leaves it. */
  function unsent(answer = 'LoginTests.testExpiredToken failed') {
    return earlierItems(asItems([QUESTION, ACTION]).map(item => (item.id === 1 ? movedBy(item, { text: answer }, NOW) : item)))
  }

  test('Done while Claude is idle is sent to Claude as a message, and the pane closes', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.press({ key: 'done' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toHaveLength(1)
    expect(world.submitted[0]).toBe('My response to an item you gave me (Open items):\n\n#1 Add STRIPE_SECRET_KEY to .env: Done.')
    expect(world.isPaneOpen).toBe(false)
    expect(world.status).toBeUndefined()
  })

  test('a saved answer riding a typed prompt that a hook beneath drops waits for the next one', async ($, on) => {
    const { world } = seat(on, unsent())
    await start($)

    world.refusingTyped = 'Blocked by your organization.'
    const blocked = await $.prompt.submit(typed('now the cart'))

    expect(blocked.drop).toBe('Blocked by your organization.')
    // The engine shows why the prompt didn't enter; the answer waits, as it did.
    expect(world.toasts).toEqual([])
    expect(itemOf(world, 1)?.update).toBe('pending')

    world.refusingTyped = undefined
    const next = await $.prompt.submit(typed('now the cart'))

    expect(next.context?.[0]).toContain('LoginTests.testExpiredToken failed')
    expect(itemOf(world, 1)?.update).toBe('delivered')
  })

  test('a saved answer that a hook beneath takes out of a typed prompt waits for the next one, and a toast says so', async ($, on) => {
    const { world } = seat(on, unsent())
    await start($)

    world.isStripping = true
    const stripped = await $.prompt.submit(typed('now the cart'))

    expect(stripped.context).toBeUndefined()
    expect(world.toasts.at(-1)).toBe("Claude didn't get your response to #1: a hook took it out of the prompt. It's saved, and goes to Claude with the next message.")
    expect(itemOf(world, 1)?.update).toBe('pending')

    world.isStripping = false
    const next = await $.prompt.submit(typed('now the cart'))

    expect(next.context?.[0]).toContain('LoginTests.testExpiredToken failed')
  })

  test('a saved answer a hook beneath takes out of a typed prompt that quotes its head still waits for the next one', async ($, on) => {
    const { world } = seat(on, unsent())
    await start($)

    world.isStripping = true
    const stripped = await $.prompt.submit(typed('Earlier you wrote "#1 open: Run xcodebuild test on your Mac, paste the failures." Why?'))

    expect(stripped.context).toBeUndefined()
    expect(itemOf(world, 1)?.update).toBe('pending')
  })

  test('a saved answer that a hook beneath rewrites as it rides a typed prompt reaches Claude', async ($, on) => {
    const { world } = seat(on, unsent('LoginTests.testExpiredToken failed with token abc123'))
    await start($)

    world.rewriting = text => text.replace('abc123', '******')
    const next = await $.prompt.submit(typed('now the cart'))

    expect(next.context?.[0]).toContain('LoginTests.testExpiredToken failed with token ******')
    expect(world.toasts).toEqual([])
    expect(itemOf(world, 1)?.update).toBe('delivered')
  })

  test('of two saved answers riding a typed prompt, the one a hook beneath takes out waits for the next', async ($, on) => {
    const decision = { ...ROTATE, id: 2, title: PAGING_TASK.title, why: PAGING_TASK.detail, kind: 'decision', options: PAGING_TASK.options }
    const items = asItems([QUESTION, decision, { ...ACTION, id: 3 }]).map(item =>
      item.id === 3 ? item : movedBy(item, item.id === 1 ? { text: 'LoginTests.testExpiredToken failed' } : { text: 'Cursor', event: 'chose' }, NOW),
    )
    const { world } = seat(on, earlierItems(items))
    await start($)

    // A hook beneath cuts #2's line out of what rides along.
    world.rewriting = text => text.split('\n').filter(line => !line.startsWith('#2 ')).join('\n')
    const next = await $.prompt.submit(typed('now the cart'))

    expect(next.context?.[0]).toContain('LoginTests.testExpiredToken failed')
    expect(next.context?.[0]).not.toContain('#2 ')
    expect(world.toasts.at(-1)).toBe("Claude didn't get your response to #2: a hook took it out of the prompt. It's saved, and goes to Claude with the next message.")
    expect(itemOf(world, 2)?.update).toBe('pending')

    world.rewriting = undefined
    const again = await $.prompt.submit(typed('and the docs'))

    expect(again.context?.[0]).toContain('#2 resolved: Pick a pagination strategy for /feed. The user chose: Cursor')
    expect(again.context?.[0]).not.toContain('LoginTests.testExpiredToken failed')
  })

  test("a response a hook beneath takes out of Claude's message goes with the next prompt: the turns after that message send nothing again", async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    // A hook beneath masks the key's name in every prompt, the plugin's own among them.
    world.masking = text => text.replaceAll('STRIPE_SECRET_KEY', '*****')
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.press({ key: 'done' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toHaveLength(1)
    expect(world.toasts.at(-1)).toBe("Claude didn't get your response to #1: a hook took it out of the prompt. It's saved, and goes to Claude with the next message.")

    // The turn that message starts ends, and another after it.
    for (const turnId of ['t1', 't2']) {
      await $.turn.start({ text: '', turnId })
      await $.turn.complete({ ...DONE, turnId })
      await clock.settle()
    }

    expect(world.submitted).toHaveLength(1)
    expect(itemOf(world, 1)?.update).toBe('pending')

    world.masking = undefined
    const next = await $.prompt.submit(typed('and the docs'))

    expect(next.context?.[0]).toContain('#1 resolved: Add STRIPE_SECRET_KEY to .env.')
    expect(itemOf(world, 1)?.update).toBe('delivered')
  })

  test('a typed prompt that fails beneath keeps its own error, and its answer waits, though the store fails too', async ($, on) => {
    const { world } = seat(on, unsent())
    await start($)

    world.isTypedFailing = true
    world.isStoreFailing = true
    await expect($.prompt.submit(typed('now the cart'))).rejects.toThrow('no implementation for prompt.submit')

    expect(world.toasts.at(-1)).toContain("Claude didn't get your response to #1: no implementation for prompt.submit")
    expect(world.toasts.at(-1)).toContain("It's saved, and goes to Claude with the next message.")
    expect(itemOf(world, 1)?.update).toBe('pending')

    world.isTypedFailing = false
    world.isStoreFailing = false
    const next = await $.prompt.submit(typed('now the cart'))

    expect(next.context?.[0]).toContain('LoginTests.testExpiredToken failed')
  })

  test('a prompt typed while an answer joins the turn carries no second copy of it', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(KEY_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    // The row takes a moment to join the conversation, and the user types meanwhile.
    world.appendMs = 500
    await ui.input({ key: 'reply-1', text: 'LoginTests.testExpiredToken failed' })
    await clock.advance(800)
    const typedMeanwhile = await $.prompt.submit(typed('and the cart', 't1'))
    await clock.advance(500)
    await clock.settle()

    expect(typedMeanwhile.context).toEqual(['Open items: 2 open, 1 unread answer; call list_items.'])
    expect(world.appended.filter(row => row.type === 'user')).toHaveLength(1)
    expect(world.status).toBe('☐ 1 action · /open-items')
  })

  test('an answer the running turn refuses goes as a prompt, which the engine runs once the turn ends', async ($, on) => {
    const { world, clock } = seat(on)
    world.refusingRows = 'No conversation to append to.'
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'CartTests.testCouponRounding' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.appended).toEqual([])
    expect(world.submitted).toEqual([`${ONE}#1 Run xcodebuild test on your Mac, paste the failures: ${REPLY_WORDS}\nCartTests.testCouponRounding`])
    expect(world.toasts).toEqual([])
  })

  test("a response whose prompt doesn't enter stays saved, and goes with the next response", async ($, on) => {
    const { world, clock } = seat(on)
    world.refusing = 'Another plugin held the prompt.'
    await start($)

    await $.tool.call(KEY_TASK)
    await $.tool.call(PAGING_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.press({ key: 'done' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toHaveLength(0)
    expect(world.toasts.at(-1)).toBe("Claude didn't get your response to #1: Another plugin held the prompt. It's saved, and goes to Claude with the next message.")
    expect(itemOf(world, 1)?.update).toBe('pending')

    world.refusing = undefined
    await ui.press({ key: 'row-2' })
    await ui.press({ key: 'option-1' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toEqual([
      'My responses to items you gave me (Open items):\n\n#1 Add STRIPE_SECRET_KEY to .env: Done.\n\n#2 Pick a pagination strategy for /feed: I chose "Cursor".',
    ])
    expect(world.status).toBeUndefined()
  })

  test('an answer that looks like a secret is held', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: KEY_SHAPED })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toHaveLength(0)
    expect(await textOf(ui, 'held')).toContain('looks like a secret')
  })

  test('an answer over 4000 characters is not sent, and a toast names the limit', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'x'.repeat(4001) })
    await clock.advance(1000)
    await clock.settle()

    expect(world.toasts.at(-1)).toContain('4001 characters')
    expect(world.toasts.at(-1)).toContain('the most is 4000')
    expect(world.submitted).toEqual([])
    expect(itemOf(world, 1)?.thread).toHaveLength(1)
    expect(await ui.find({ type: 'Input', key: 'reply-1' })).toBeDefined()
  })

  test('an answer over 4000 characters in the prompt box is held, as a secret is: nothing is sent or kept', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const sent = await $.prompt.submit(typed(`↳ Answer to #1: ${'x'.repeat(4001)}`))
    await clock.advance(1000)
    await clock.settle()

    expect(sent.drop).toContain('the most is 4000')
    expect(world.submitted).toEqual([])
    expect(itemOf(world, 1)?.thread).toHaveLength(1)
  })

  test('list_items shows a saved answer and marks it heard', async ($, on) => {
    const { world } = seat(on, unsent('Two failures'))
    await start($)

    const listed = await $.tool.call({ tool: LIST })
    expect(String((listed as { result?: unknown }).result)).toContain('Two failures')
    expect(itemOf(world, 1)?.update).toBe('delivered')
  })

  test('list_items for one item marks only that one heard', async ($, on) => {
    const decision = { ...ROTATE, id: 2, title: PAGING_TASK.title, why: PAGING_TASK.detail, kind: 'decision', options: PAGING_TASK.options }
    const items = asItems([QUESTION, decision]).map(item => movedBy(item, item.id === 1 ? { text: 'Two failures' } : { text: 'Cursor', event: 'chose' }, NOW))
    const { world } = seat(on, earlierItems(items))
    await start($)

    const listed = await $.tool.call({ tool: LIST, id: 1 })
    expect(String((listed as { result?: unknown }).result)).toContain('Two failures')
    expect([itemOf(world, 1)?.update, itemOf(world, 2)?.update]).toEqual(['delivered', 'pending'])
  })

  test('a response that comes in while list_items reads is not marked heard: it goes later', async ($, on) => {
    const { world, clock } = seat(on, unsent('Two failures'))
    await start($)

    await $.turn.start({ text: 'go', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-2' })
    // list_items reads the task list late: Done on #2 lands meanwhile, and
    // its write of #1 heard reads the list again.
    world.slowRead = 'tasks'
    world.readMs = 500
    const listed = $.tool.call({ tool: LIST })
    await clock.advance(1)
    await ui.press({ key: 'done' })
    await clock.advance(500)
    const result = String(((await listed) as { result?: unknown }).result)

    expect(result).toContain('Two failures')
    expect(result).toContain('#2 open')
    expect(itemOf(world, 2)?.update).toBe('pending')

    await clock.advance(1000)
    await clock.settle()

    expect(world.appended[0]?.text).toBe(`${ONE}#2 Add STRIPE_SECRET_KEY to .env: Done.`)
  })

  test('a withdraw that meets an answer given a moment before leaves the answer, and Claude hears it', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    // The withdraw reads the task list late: Done lands meanwhile.
    world.slowRead = 'tasks'
    world.readMs = 500
    const withdrawn = $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn', note: 'Found the key in the vault' })
    await clock.advance(1)
    await ui.press({ key: 'row-1' })
    await ui.press({ key: 'done' })
    await clock.advance(500)

    expect(((await withdrawn) as { deny?: string }).deny).toBe('Item #1 is already resolved; there is nothing to close.')
    expect(world.toasts).toEqual([])

    await clock.advance(1000)
    await clock.settle()

    expect(world.appended[0]?.text).toBe(`${ONE}#1 Add STRIPE_SECRET_KEY to .env: Done.`)
  })

  test('a press from a render older than a withdraw leaves the task withdrawn, and a toast says so', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    // Done reads the task list late: Claude withdraws #1 meanwhile.
    world.slowRead = 'tasks'
    world.readMs = 500
    const pressed = ui.press({ key: 'done' })
    await clock.advance(1)
    await $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn' })
    await clock.advance(500)
    await pressed
    await clock.settle()

    expect(world.toasts.at(-1)).toBe("Item #1 isn't open any more, so your response wasn't saved.")
    expect(world.submitted).toEqual([])
    expect(world.status).toBe('☐ 1 question · /open-items')
  })

  test('Enter with nothing typed asks for an answer, or, entered as Claude withdraws its task, says the task is gone', async ($, on) => {
    const { world } = seat(on)
    // Held, an input reaches its field once the test lets it go.
    let isHeld = false
    let letGo = () => {}
    on('ui.input', async ($, e, next) => {
      if (isHeld) {
        isHeld = false
        await new Promise<void>(resolve => {
          letGo = resolve
        })
      }

      return next(e)
    })
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(ANDROID_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: '' })

    expect(world.toasts.at(-1)).toBe('Type a reply first.')

    isHeld = true
    const entered = ui.input({ key: 'reply-1', text: '' })
    await $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn' })
    letGo()
    await entered

    expect(world.toasts.at(-1)).toBe("Item #1 isn't open any more, so your response wasn't saved.")
  })

  test('Long answer… pressed as Claude withdraws its task says the task is gone, and puts what was typed in the prompt box', async ($, on) => {
    const { world, clock } = seat(on)
    const held = holdingPresses(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(ANDROID_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'LoginTests.testExpiredToken failed', kind: 'change' })
    await clock.settle()
    held.isOn = true
    const pressed = ui.press({ key: 'long' })
    await $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn' })
    held.letGo()
    await pressed

    expect(world.toasts.at(-1)).toBe("Item #1 isn't open any more, so your response wasn't saved. What you typed is in the prompt box.")
    expect(world.composer).toBe('LoginTests.testExpiredToken failed')
  })

  test('a row pressed as Claude withdraws its item leaves the pane on the list, and a draft with its own item', async ($, on) => {
    const { world, clock } = seat(on)
    const held = holdingPresses(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(ANDROID_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-2' })
    await ui.input({ key: 'reply-2', text: 'Pixel 8 passes', kind: 'change' })
    await clock.settle()
    await ui.press({ key: 'back' })
    held.isOn = true
    const pressed = ui.press({ key: 'row-1' })
    await $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn' })
    held.letGo()
    await pressed

    expect(await ui.find({ key: 'item-1' })).toBeUndefined()
    expect(await ui.find({ key: 'row-2' })).toBeDefined()
    expect(world.toasts.at(-1)).toBe('Claude withdrew the item: Run xcodebuild test on your Mac, paste the failures')

    await ui.press({ key: 'row-2' })
    expect((await ui.find({ type: 'Input', key: 'reply-2' }))?.props.value).toBe('Pixel 8 passes')
  })

  test('an answer held for looking like a secret, entered as Claude withdraws its task, says the task is gone', async ($, on) => {
    const { world } = seat(on)
    // Held, an input reaches its field once the test lets it go.
    let isHeld = false
    let letGo = () => {}
    on('ui.input', async ($, e, next) => {
      if (isHeld) {
        isHeld = false
        await new Promise<void>(resolve => {
          letGo = resolve
        })
      }

      return next(e)
    })
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(ANDROID_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    isHeld = true
    const entered = ui.input({ key: 'reply-1', text: KEY_SHAPED })
    await $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn' })
    letGo()
    await entered

    expect(world.toasts.at(-1)).toBe("Item #1 isn't open any more, so your response wasn't saved.")
    expect(world.composer).toBe('')
  })

  test('a task withdrawn as the user types for it takes the drafts along, and leaves the prompt box as the user has it', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'LoginTests.testExpiredToken failed', kind: 'change' })
    await clock.settle()
    world.composer = 'Also bump the version'
    await $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn', note: 'Found it in the CI logs' })

    expect(world.composer).toBe('Also bump the version')
    expect(world.toasts.at(-1)).toBe('Claude withdrew the item: Run xcodebuild test on your Mac, paste the failures. Found it in the CI logs')
  })

  test("of two presses from one render, the response that lands first stands, and a toast says the other wasn't saved", async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(PAGING_TASK)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    // Offset reads the task list late: Cursor lands meanwhile.
    world.slowRead = 'tasks'
    world.readMs = 500
    const pressed = ui.press({ key: 'option-2' })
    await clock.advance(1)
    await ui.press({ key: 'option-1' })
    await clock.advance(500)
    await pressed
    await clock.advance(1000)
    await clock.settle()

    expect(world.appended[0]?.text).toBe(`${ONE}#1 Pick a pagination strategy for /feed: I chose "Cursor".`)
    expect(world.toasts).toEqual(["Item #1 isn't open any more, so your response wasn't saved."])
  })

  test('the same press twice from one render answers once, says nothing, and holds back no batch under way', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(PAGING_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    // The first press reads the task list late: the second lands meanwhile, and the batch starts.
    world.slowRead = 'tasks'
    world.readMs = 500
    const pressed = ui.press({ key: 'option-1' })
    await clock.advance(1)
    world.ops = []
    await ui.press({ key: 'option-1' })
    await clock.advance(500)
    await pressed

    // The press that found it answered changed nothing, so wrote nothing.
    expect(world.ops.filter(op => op.startsWith('set'))).toEqual(['set session:session-1'])

    await clock.advance(300)

    expect(world.submitted).toEqual(['My response to an item you gave me (Open items):\n\n#1 Pick a pagination strategy for /feed: I chose "Cursor".'])
    expect(world.toasts).toEqual([])
  })

  test("an answer typed for a task answered meanwhile on another surface isn't saved: a toast says so, and it goes to the prompt box", async ($, on) => {
    const { world, clock } = seat(on)
    world.composer = 'and check the cart'
    await start($)

    await $.tool.call({ ...XCODE_TASK, kind: 'action' })
    const ui = await $.ui.mount(PANE)
    const phone = await $.ui.mount({ ...PANE, surface: 'mobile' })
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'Two failures', kind: 'change' })
    await clock.settle()
    // The answer reads the task list late: Done on the phone lands meanwhile.
    world.slowRead = 'tasks'
    world.readMs = 500
    const answered = ui.input({ key: 'reply-1', text: 'Two failures' })
    await clock.advance(1)
    await phone.press({ key: 'done' })
    await clock.advance(500)
    await answered
    await clock.advance(1000)

    expect(world.toasts).toEqual(["Item #1 isn't open any more, so your response wasn't saved. What you typed is in the prompt box."])
    expect(world.composer).toBe('and check the cart\nTwo failures')
    expect(world.submitted).toEqual(['My response to an item you gave me (Open items):\n\n#1 Run xcodebuild test on your Mac, paste the failures: Done.'])
  })

  test('an answer held for looking like a secret, sent anyway as its task is answered elsewhere, stays out of the prompt box', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call({ ...XCODE_TASK, kind: 'action' })
    const ui = await $.ui.mount(PANE)
    const phone = await $.ui.mount({ ...PANE, surface: 'mobile' })
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: KEY_SHAPED })
    await clock.settle()
    // Send anyway reads the task list late: Done on the phone lands meanwhile.
    world.slowRead = 'tasks'
    world.readMs = 500
    const sent = ui.press({ key: 'send-anyway' })
    await clock.advance(1)
    await phone.press({ key: 'done' })
    await clock.advance(500)
    await sent

    expect(world.toasts).toEqual(["Item #1 isn't open any more, so your response wasn't saved."])
    expect(world.composer).toBe('')
  })
})

describe('long answers in the prompt box', () => {
  test('typed while Claude is idle, the prompt is the answer', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.press({ key: 'long' })
    expect(world.composer).toBe('↳ Answer to #1: ')

    const sent = await $.prompt.submit(typed('↳ Answer to #1: LoginTests.testExpiredToken\nCartTests.testCouponRounding'))

    expect(sent.text).toContain(`#1 Run xcodebuild test on your Mac, paste the failures: ${REPLY_WORDS}\nLoginTests.testExpiredToken\nCartTests.testCouponRounding`)
  })

  test('a draft goes with Long answer… into the prompt box, and the field opens empty after', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'LoginTests.testExpiredToken', kind: 'change' })
    await ui.press({ key: 'long' })

    expect(world.composer).toBe('↳ Answer to #1: LoginTests.testExpiredToken')
    // The field would go on showing what moved: the pane goes back to the list.
    expect(world.screen).toEqual({ kind: 'list' })

    await ui.press({ key: 'row-1' })
    expect((await ui.find({ type: 'Input', key: 'reply-1' }))?.props.value).toBe('')
  })

  test('typed while Claude is idle and dropped by a hook beneath, the answer is kept to send', async ($, on) => {
    const { world } = seat(on)
    world.refusingTyped = 'Blocked by your organization.'
    await start($)

    await $.tool.call(XCODE_TASK)
    const blocked = await $.prompt.submit(typed('↳ Answer to #1: Two failures'))

    expect(blocked.drop).toBe('Blocked by your organization.')
    // The engine shows why; the toast says the answer is kept.
    expect(world.toasts.at(-1)).toBe("Claude didn't get your response to #1. It's saved, and goes to Claude with the next message.")
    expect(itemOf(world, 1)?.update).toBe('pending')
  })

  test('typed while Claude is idle and a response is about to go, the prompt carries both', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    // Done goes in a moment, with whatever else is pressed by then.
    await ui.press({ key: 'row-1' })
    await ui.press({ key: 'done' })
    world.setMs = 1000
    const sending = $.prompt.submit(typed('↳ Answer to #2: Two failures'))
    await clock.advance(3000)
    const sent = await sending
    await clock.settle()

    expect(sent.text).toContain('#1 Add STRIPE_SECRET_KEY to .env: Done.')
    expect(sent.text).toContain(`#2 Run xcodebuild test on your Mac, paste the failures: ${REPLY_WORDS}\nTwo failures`)
    expect(world.submitted).toEqual([])
  })

  test('typed while Claude is idle after the pane sent the same answer, it goes once', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'Two failures' })
    await clock.advance(1000)
    await clock.settle()
    const sent = await $.prompt.submit(typed('↳ Answer to #1: Two failures'))

    expect(sent.drop).toBe('Your answer to #1 already went to Claude.')
    expect(world.submitted).toEqual([`${ONE}#1 Run xcodebuild test on your Mac, paste the failures: ${REPLY_WORDS}\nTwo failures`])
  })

  test('typed while Claude works, it joins the running turn at once, and the prompt does not enter', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const result = await $.prompt.submit(typed('↳ Answer to #1: Two failures', 't1'))
    await clock.advance(1000)
    await clock.settle()

    expect(result.drop).toBe('Your answer to #1 goes to Claude now.')
    expect(world.appended[0]?.text).toBe(`${ONE}#1 Run xcodebuild test on your Mac, paste the failures: ${REPLY_WORDS}\nTwo failures`)
    expect(world.submitted).toEqual([])
    expect(itemOf(world, 1)).toEqual(expect.objectContaining({ state: 'open', isWaitingForClaude: true }))
  })

  test('typed while Claude works, an answer to a task Claude withdraws meanwhile goes as typed', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.turn.start({ text: 'go', turnId: 't1' })
    // The prompt reads the task list late: Claude withdraws #1 meanwhile.
    world.slowRead = 'tasks'
    world.readMs = 500
    const sending = $.prompt.submit(typed('↳ Answer to #1: Two failures', 't1'))
    await clock.advance(1)
    await $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn' })
    await clock.advance(500)
    const sent = await sending
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()

    expect(sent.drop).toBeUndefined()
    expect(sent.text).toBe('↳ Answer to #1: Two failures')
    expect(sent.context).toBeUndefined()
    expect(world.submitted).toEqual([])
  })
})

describe('delivery', () => {
  const INFO = { tool: ADD, title: 'The migration ran clean', detail: 'Nothing for you to do; the schema is current.', kind: 'info' } as const

  const resultOf = (call: unknown) => call as { result?: string; deny?: string }

  /** The reply on item #1, Run xcodebuild…, as Claude reads it. */
  const repliedOn1 = (text: string) => `${ONE}#1 Run xcodebuild test on your Mac, paste the failures: ${REPLY_WORDS}\n${text}`

  test('an answer while another item is open goes at once', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(PAGING_TASK)
    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.press({ key: 'option-1' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toEqual([`${ONE}#1 Pick a pagination strategy for /feed: I chose "Cursor".`])
    expect(world.appended).toEqual([])
  })

  test('a reply mid-turn is appended at once', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'Two failures' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.appended).toEqual([
      { type: 'user', text: repliedOn1('Two failures') },
      { type: 'system', text: 'Sent your response to #1 to Claude' },
    ])
    expect(world.submitted).toEqual([])
  })

  test("an appended answer still unread at the main turn's end wakes Claude", async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(KEY_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'Two failures' })
    await clock.advance(1000)
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()

    expect(world.submitted).toEqual([WAKE_UP])

    // A step of the turn reads the row: that turn ends without a wake-up.
    await $.turn.start({ text: WAKE_UP, turnId: 't2' })
    await ui.press({ key: 'back' })
    await ui.press({ key: 'row-2' })
    await ui.press({ key: 'done' })
    await clock.advance(1000)
    await step($, 't2')
    await $.turn.complete({ ...DONE, turnId: 't2' })
    await clock.settle()

    expect(world.appended.filter(row => row.type === 'user').map(row => row.text)).toEqual([repliedOn1('Two failures'), `${ONE}#2 Add STRIPE_SECRET_KEY to .env: Done.`])
    expect(world.submitted).toEqual([WAKE_UP])
  })

  test('an answer appended as the main turn ends wakes Claude', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    // The row takes a moment to join the conversation, and the turn ends meanwhile.
    world.appendMs = 500
    await ui.input({ key: 'reply-1', text: 'Two failures' })
    await clock.advance(800)
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.appended[0]?.text).toBe(repliedOn1('Two failures'))
    expect(world.submitted).toEqual([WAKE_UP])
  })

  test("a subagent's turn.start does not clear an unread append", async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'Two failures' })
    await clock.advance(1000)
    await $.turn.start({ text: 'Run the tests', turnId: 'tester-1', agentId: 'tester' })
    await step($, 'tester-1', 'tester')
    await $.turn.complete({ ...DONE, turnId: 'tester-1', agentId: 'tester' })
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()

    expect(world.appended[0]?.text).toBe(repliedOn1('Two failures'))
    expect(world.submitted).toEqual([WAKE_UP])
  })

  test('a reply never closes the item', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(PAGING_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'Which one is faster?' })
    await clock.advance(1000)
    await clock.settle()

    expect(itemOf(world, 1)).toEqual(expect.objectContaining({ state: 'open', isWaitingForClaude: true, update: 'delivered' }))
    expect(world.submitted).toEqual([`${ONE}#1 Pick a pagination strategy for /feed: ${REPLY_WORDS}\nWhich one is faster?`])

    await $.turn.start({ text: '', turnId: 't1' })
    await ui.input({ key: 'reply-1', text: 'And which one is cheaper?' })
    await clock.advance(1000)
    await clock.settle()

    expect(itemOf(world, 1)).toEqual(expect.objectContaining({ state: 'open', isWaitingForClaude: true }))
    expect(await ui.find({ type: 'Button', key: 'option-1' })).toBeDefined()
  })

  test('a composer-bridge answer is a reply and keeps the item open', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const sent = await $.prompt.submit(typed('↳ Answer to #1: Two failures'))

    expect(sent.text).toBe(repliedOn1('Two failures'))
    expect(itemOf(world, 1)).toEqual(expect.objectContaining({ state: 'open', isWaitingForClaude: true, update: 'delivered' }))
  })

  test('the same answer typed again in the prompt box mid-turn leaves the batch under way to send it once', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'Two failures' })
    const again = await $.prompt.submit(typed('↳ Answer to #1: Two failures', 't1'))
    await clock.advance(1000)
    await clock.settle()

    expect(again.drop).toBe('Your answer to #1 goes to Claude now.')
    expect(world.appended.filter(row => row.type === 'user').map(row => row.text)).toEqual([repliedOn1('Two failures')])
  })

  test('before any main turn event, an answer goes as a prompt', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    // A subagent's turn says nothing of the main loop's.
    await $.turn.start({ text: 'Run the tests', turnId: 'tester-1', agentId: 'tester' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.press({ key: 'done' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toEqual([`${ONE}#1 Add STRIPE_SECRET_KEY to .env: Done.`])
    expect(world.appended).toEqual([])
  })

  test('presses within 800 ms go as one message', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(PAGING_TASK)
    await $.tool.call(KEY_TASK)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.press({ key: 'option-1' })
    await clock.advance(500)
    await ui.press({ key: 'row-2' })
    await ui.press({ key: 'done' })
    await clock.advance(799)

    expect(world.appended).toEqual([])

    await clock.advance(1)
    await clock.settle()

    expect(world.appended.filter(row => row.type === 'user').map(row => row.text)).toEqual([
      'My responses to items you gave me (Open items):\n\n#1 Pick a pagination strategy for /feed: I chose "Cursor".\n\n#2 Add STRIPE_SECRET_KEY to .env: Done.',
    ])
    expect(world.submitted).toEqual([])
  })

  test("every prompt not of the mod's own origin carries the reminder while items are open", async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(KEY_TASK)
    await $.tool.call(INFO)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'Two failures' })
    await clock.advance(1000)
    await clock.settle()

    // The info item asks nothing, so it is not counted; the reply waits for Claude.
    const reminder = 'Open items: 2 open, 1 unread answer; call list_items.'
    expect((await $.prompt.submit(typed('now the cart'))).context).toEqual([reminder])
    expect((await $.prompt.submit(HAND_BACK)).context).toEqual([reminder])
    // The mod's own prompt is the answer itself.
    expect(world.ownContexts).toEqual([undefined])
    expect((await $.prompt.context({ blocks: [] })).blocks).toEqual([])

    await $.tool.call({ tool: CLOSE, id: 1, as: 'resolved', note: 'Fixed both' })
    await $.tool.call({ tool: CLOSE, id: 2, as: 'withdrawn' })

    expect((await $.prompt.submit(typed('and the docs'))).context).toBeUndefined()
  })

  test("a press the batch holds goes in the user's own words: an unrelated prompt and list_items leave it to the batch", async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(PAGING_TASK)
    await $.tool.call(XCODE_TASK)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.press({ key: 'option-1' })
    const handBack = await $.prompt.submit({ ...HAND_BACK, turnId: 't1' })
    const listed = resultOf(await $.tool.call({ tool: LIST }))
    await clock.advance(1000)
    await clock.settle()

    expect(handBack.context).toEqual(['Open items: 1 open, 0 unread answers; call list_items.'])
    expect(listed.result).toContain('chose "Cursor"')
    expect(world.appended[0]?.text).toBe(`${ONE}#1 Pick a pagination strategy for /feed: I chose "Cursor".`)
  })

  test('a press is held through its store write: an unrelated prompt and list_items leave it to the batch', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(PAGING_TASK)
    await $.tool.call(XCODE_TASK)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    // The press's write takes a second: a hand-back and list_items land meanwhile.
    world.setMs = 1000
    const pressed = ui.press({ key: 'option-1' })
    await clock.advance(1)
    const handBack = $.prompt.submit({ ...HAND_BACK, turnId: 't1' })
    const listed = $.tool.call({ tool: LIST })
    await clock.advance(1)

    expect(itemOf(world, 1)?.update).toBe('pending')

    await clock.advance(1000)
    await pressed
    world.setMs = 0
    await clock.advance(2000)
    await clock.settle()

    expect((await handBack).context).toEqual(['Open items: 1 open, 0 unread answers; call list_items.'])
    expect(resultOf(await listed).result).toContain('chose "Cursor"')
    expect(world.appended[0]?.text).toBe(`${ONE}#1 Pick a pagination strategy for /feed: I chose "Cursor".`)
  })

  test('an answer appended to a turn the user stops wakes nothing: the next prompt reads it', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(KEY_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'Two failures' })
    await clock.advance(1000)
    await $.turn.complete({ ...DONE, turnId: 't1', reason: 'aborted', isAborted: true })
    await clock.settle()

    expect(world.appended[0]?.text).toBe(repliedOn1('Two failures'))
    expect(world.submitted).toEqual([])

    // Nor does a row that goes in as the user stops the turn.
    await $.turn.start({ text: 'go on', turnId: 't2' })
    world.appendMs = 500
    await ui.press({ key: 'back' })
    await ui.press({ key: 'row-2' })
    await ui.press({ key: 'done' })
    await clock.advance(800)
    await $.turn.complete({ ...DONE, turnId: 't2', reason: 'aborted', isAborted: true })
    await clock.advance(1000)
    await clock.settle()

    expect(world.appended.filter(row => row.type === 'user').at(-1)?.text).toBe(`${ONE}#2 Add STRIPE_SECRET_KEY to .env: Done.`)
    expect(world.submitted).toEqual([])
  })

  test('a secret pasted as a reply is held and not sent', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: KEY_SHAPED })
    const bridged = await $.prompt.submit(typed(`↳ Answer to #1: ${KEY_SHAPED}`, 't1'))
    await clock.advance(1000)
    await clock.settle()

    expect(await textOf(ui, 'held')).toContain('looks like a secret')
    expect(bridged.drop).toContain("This looks like a secret, so it wasn't sent.")
    expect(world.appended).toEqual([])
    expect(world.submitted).toEqual([])
    expect(itemOf(world, 1)?.thread).toHaveLength(1)
  })

  test('a v0.1 Seen saved unsent sends nothing with the next response: no bare head line', async ($, on) => {
    const seen = { ...ROTATE, id: 1, kind: 'info', title: INFO.title, state: 'seen', update: 'pending' }
    const { world, clock } = seat(on, earlier([seen, { ...ROTATE, id: 2 }]))
    await start($)

    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-2' })
    await ui.press({ key: 'done' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toEqual([`${ONE}#2 Rotate the leaked token in Vault: Done.`])
    expect(itemOf(world, 1)?.update).toBe('delivered')
  })

  test('a v0.1 Seen saved unsent sends nothing beside the next prompt: no bare head line', async ($, on) => {
    const seen = { ...ROTATE, id: 1, kind: 'info', title: INFO.title, state: 'seen', update: 'pending' }
    const { world } = seat(on, earlier([seen, { ...ROTATE, id: 2 }]))
    await start($)

    const sent = await $.prompt.submit(typed('go on'))

    expect(sent.context).toEqual(['Open items: 1 open, 0 unread answers; call list_items.'])
    expect(itemOf(world, 1)?.update).toBe('delivered')
  })
})

describe('the system prompt', () => {
  const COMPOSE = {
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['terminal'],
    outputStyle: null,
  } as const

  test('the system prompt carries a short copy of the steering, where add_item can be reached', async ($, on) => {
    seat(on)
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }] }))
    await start($)

    const offered = await $.prompt.compose({ ...COMPOSE, tools: ['Bash', ADD], traits: [] })
    const deferred = await $.prompt.compose({ ...COMPOSE, tools: ['Bash', 'ToolSearch'], traits: [] })
    const without = await $.prompt.compose({ ...COMPOSE, tools: ['Bash'], traits: [] })
    const steering = offered.sections.at(-1)

    expect(steering?.id).toBe('open-items:steering')
    expect(steering?.scope).toBe('session')
    for (const rule of ['live chat', 'reply_item', 'close_item', 'answered in chat', 'Before the session ends']) {
      expect(steering?.text).toContain(rule)
    }
    expect(steering?.text).not.toContain('withdraw_item')
    expect(deferred.sections.at(-1)?.id).toBe('open-items:steering')
    expect(without.sections).toHaveLength(1)
  })

  test('bare and print sessions get no section', async ($, on) => {
    seat(on)
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }] }))
    await start($)

    for (const trait of ['bare', 'print'] as const) {
      const composed = await $.prompt.compose({ ...COMPOSE, tools: ['Bash', ADD], traits: [trait] })

      expect(composed.sections.map(section => section.id)).toEqual(['intro'])
    }
  })
})

describe('the mod\'s own tools', () => {
  const SIX = [ADD, REPLY, CLOSE, LIST, HANDOFF, TAKE]

  const descriptionOf = (world: ReturnType<typeof seat>['world'], name: string) => world.tools.find(tool => tool.name === name)?.description ?? ''

  test('every tool.call hook matches one of the six tools', () => {
    const calls: { event: string; matcher: unknown }[] = []
    const record = ((event: string, ...rest: unknown[]) => {
      calls.push({ event, matcher: typeof rest[0] === 'object' ? rest[0] : undefined })
    }) as unknown as On

    register(record, {})

    const matchers = calls.filter(call => call.event === 'tool.call').map(call => (call.matcher as { tool?: string } | undefined)?.tool)

    expect([...new Set(matchers)].sort()).toEqual([...SIX].sort())
  })

  test('add_item, reply_item, close_item, list_items are not deferred; handoff_items and take_items are', async ($, on) => {
    seat(on)
    let isDeferredBelow = true
    on('tool.describe', ($, e) => ({ description: e.description, isDeferred: isDeferredBelow }))
    await start($)

    for (const below of [true, false]) {
      isDeferredBelow = below

      for (const tool of SIX) {
        const described = await $.tool.describe({ tool, description: 'From the server.', isDeferred: true, provider: { plugin: 'open-items', tier: 'user' } })

        expect(described).toEqual({ description: 'From the server.', isDeferred: tool === HANDOFF || tool === TAKE })
      }
    }
  })

  test('every tool but list_items refuses a subagent', async ($, on) => {
    seat(on)
    await start($)
    await $.tool.call(XCODE_TASK)

    const calls = [
      { ...KEY_TASK },
      { tool: REPLY, id: 1, text: 'Which test file?' },
      { tool: CLOSE, id: 1, as: 'withdrawn' },
      { tool: HANDOFF },
      { tool: TAKE, code: 'abc123' },
    ] as const

    for (const call of calls) {
      const refused = (await $.tool.call({ ...call, agentId: 'agent-1' })) as { deny?: string }

      expect(refused.deny, call.tool).toContain('Only the main agent')
    }

    const listed = (await $.tool.call({ tool: LIST, agentId: 'agent-1' })) as { result?: string; deny?: string }

    expect(listed.deny).toBeUndefined()
    expect(listed.result).toContain('#1 open')
  })

  test('every tool description is at most 4096 characters', async ($, on) => {
    const { world } = seat(on)
    await start($)

    expect(world.tools.map(tool => `mcp__open-items__${tool.name}`).sort()).toEqual([...SIX].sort())
    for (const tool of world.tools) {
      expect(tool.description.length, tool.name).toBeLessThanOrEqual(4096)
    }
  })

  test("add_item's description carries the live-chat rule and the session-end rule", async ($, on) => {
    const { world } = seat(on)
    await start($)

    expect(descriptionOf(world, 'add_item')).toContain('live chat')
    expect(descriptionOf(world, 'add_item')).toContain('Before the session ends')
  })

  test('reply_item and close_item carry the rule for an answer in the chat, and handoff_items says how to pass the code', async ($, on) => {
    const { world } = seat(on)
    await start($)

    expect(descriptionOf(world, 'reply_item')).toContain('answered in chat')
    expect(descriptionOf(world, 'close_item')).toContain('answered in chat')
    expect(descriptionOf(world, 'handoff_items')).toContain('take_items')
  })
})

describe('saving', () => {
  const DAY_MS = 24 * 60 * 60_000
  const MINE = ROTATE

  function savedIdsOf(world: ReturnType<typeof seat>['world'], sessionId = 'session-1') {
    return (world.store[`session:${sessionId}`] as { tasks: { id: number }[] } | undefined)?.tasks.map(task => task.id)
  }

  test('restores open items and unsent answers when the same session starts again', async ($, on) => {
    const choose = { ...MINE, id: 1, title: PAGING_TASK.title, why: PAGING_TASK.detail, kind: 'decision', options: PAGING_TASK.options }
    const items = asItems([choose, { ...MINE, id: 2 }])
    const { world } = seat(on, earlierItems(items.map(item => (item.id === 2 ? movedBy(item, DONE_PRESS, NOW) : item))))
    await start($)

    expect(world.opens).toHaveLength(1)
    expect((await $.prompt.submit(typed('go on'))).context?.[0]).toContain('#2 resolved: Rotate the leaked token in Vault.')
  })

  test("writes the session's key on every change", async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)

    expect(world.store['session:session-1']).toEqual({
      version: 2,
      tasks: [expect.objectContaining({ id: 1, title: KEY_TASK.title, state: 'open', thread: [{ from: 'claude', text: KEY_TASK.detail, atMs: NOW }] })],
      nextId: 2,
      savedMs: NOW,
      lastActiveMs: NOW,
      folder: '/repo',
      taken: [],
    })

    await $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn' })

    // A closed item keeps its number, title and state, without its thread.
    expect(world.store['session:session-1']).toEqual({
      version: 2,
      tasks: [expect.objectContaining({ id: 1, title: KEY_TASK.title, state: 'withdrawn', thread: [] })],
      nextId: 2,
      savedMs: NOW,
      lastActiveMs: NOW,
      folder: '/repo',
      taken: [],
    })
  })

  test('saves a resolved item whole until Claude hears of it, then without its thread', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)
    const savedOf = (id: number) => (world.store['session:session-1'] as { tasks: Task[] }).tasks.find(task => task.id === id)

    await $.tool.call(PAGING_TASK)
    await $.tool.call(KEY_TASK)
    const pane = await $.ui.mount(PANE)
    await pane.press({ key: 'row-1' })
    await pane.press({ key: 'option-1' })
    expect(savedIdsOf(world)).toEqual([1, 2])
    expect(savedOf(1)?.thread).toHaveLength(2)

    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toHaveLength(1)
    expect(savedIdsOf(world)).toEqual([1, 2])
    expect(savedOf(1)).toEqual(expect.objectContaining({ state: 'resolved', update: 'delivered', thread: [] }))
  })

  test('deletes saved sessions older than 30 days at start', async ($, on) => {
    const savedAt = (savedMs: number) => ({ tasks: [MINE], nextId: 8, savedMs })
    const { world } = seat(on, { 'session:session-old': savedAt(NOW - 31 * DAY_MS), 'session:session-new': savedAt(NOW - DAY_MS) })
    await start($)

    expect(Object.keys(world.store)).toEqual(['session:session-new'])
  })

  test("a code reload keeps the session's folder, though the session has moved", async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    world.cwd = '/repo/elsewhere'
    await $.session.start({ cwd: '/repo/elsewhere', surface: 'terminal', isInteractive: true })
    await $.tool.call(XCODE_TASK)

    expect(folderOf(world, 'session-1')).toBe('/repo')
  })

  test('the session /clear starts takes the folder it starts in', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    world.cwd = '/repo/worktree'
    await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } })
    world.sessionId = 'session-2'
    await clock.advance(1)
    await $.tool.call(XCODE_TASK)

    expect(folderOf(world, 'session-1')).toBe('/repo')
    expect(folderOf(world, 'session-2')).toBe('/repo/worktree')
  })

  for (const [format, value, folder] of [
    ['v0.2', { version: 2, tasks: asItems([ROTATE]), nextId: 8, savedMs: NOW, lastActiveMs: NOW, folder: '/old', taken: [] }, '/old'],
    ['v0.1', { tasks: [ROTATE], nextId: 8, savedMs: NOW }, '/repo/now'],
  ] as const) {
    test(`a resume keeps the folder a ${format} key saved, or takes the one it runs in`, async ($, on) => {
      const { world, clock } = seat(on, { 'session:session-2': value })
      await start($)

      await $.tool.call(KEY_TASK)
      world.cwd = '/repo/now'
      await $.session.end({ reason: 'resume', sessionId: 'session-1', resume: { id: 'session-1' } })
      world.sessionId = 'session-2'
      await clock.advance(1)
      await $.tool.call(XCODE_TASK)

      expect(folderOf(world, 'session-2')).toBe(folder)
    })
  }

  test('a session that never held an item leaves no key', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.session.end({ reason: 'prompt_input_exit', sessionId: 'session-1', resume: { id: 'session-1' } })

    expect(world.store).toEqual({})
  })

  test('a session that could not read its key writes nothing over it', async ($, on) => {
    const saved = { tasks: [MINE], nextId: 8, savedMs: NOW }
    const { world } = seat(on, { 'session:session-1': saved })
    world.isStoreFailing = true
    await start($)
    world.isStoreFailing = false

    await $.tool.call(KEY_TASK)

    expect(world.store['session:session-1']).toEqual(saved)
  })

  test('a code reload keeps newer state', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    // The second item never reaches the store: the key holds only the first.
    world.isWriteFailing = true
    await $.tool.call(XCODE_TASK)
    await start($)

    expect(world.status).toBe('could not save · ☐ 1 question · 1 action · /open-items')
  })

  test('a stuck store holds a tool call 5 s at most', async ($, on) => {
    const { world, clock } = seat(on, { 'session:session-1': { tasks: [MINE], nextId: 8, savedMs: NOW } })
    await start($)

    // Every write takes a minute.
    world.setMs = 60_000
    let isWithdrawn = false
    const withdrawn = $.tool.call({ tool: CLOSE, id: 7, as: 'withdrawn' }).then(result => {
      isWithdrawn = true
      return result
    })
    await clock.advance(4000)
    expect(isWithdrawn).toBe(false)
    await clock.advance(1000)
    expect(isWithdrawn).toBe(true)
    expect(String(((await withdrawn) as { result?: unknown }).result)).toContain('Withdrew item #7')

    // Nothing after it waits: the clock stands still here.
    const added = await $.tool.call(XCODE_TASK)
    expect(String((added as { result?: unknown }).result)).toContain('Added item #8')
  })

  test("a store stuck at start holds the tools back until the session's items are read", async ($, on) => {
    const { world, clock } = seat(on, { 'session:session-1': { tasks: [MINE], nextId: 8, savedMs: NOW } })
    world.isStuck = true
    const started = start($)
    await clock.advance(5000)
    await started

    for (const call of [KEY_TASK, { tool: LIST }, { tool: CLOSE, id: 7, as: 'withdrawn' }] as const) {
      const refused = await $.tool.call(call)
      expect((refused as { deny?: string }).deny).toBe("Open items is still loading this session's items. Try again in a moment.")
    }

    world.unstick?.()
    await clock.settle()
    const added = await $.tool.call(KEY_TASK)

    expect(String((added as { result?: unknown }).result)).toContain('Added item #8')
    expect(savedIdsOf(world)).toEqual([7, 8])
  })

  test('a session whose start read failed saves once the store answers', async ($, on) => {
    const { world } = seat(on)
    world.isStoreFailing = true
    await start($)
    world.isStoreFailing = false

    await $.tool.call(KEY_TASK)

    expect(savedIdsOf(world)).toEqual([1])
  })

  test('deletes a saved key that holds no saved session at start', async ($, on) => {
    const { world } = seat(on, { 'session:junk': 'not a saved session', 'session:session-new': { tasks: [MINE], nextId: 8, savedMs: NOW } })
    await start($)

    expect(Object.keys(world.store)).toEqual(['session:session-new'])
  })

  test('an ending session writes its key once and reads nothing', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    world.ops = []
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 'session-1', resume: { id: 'session-1' } })

    // No read: the exit's budget is short.
    expect(world.ops).toEqual(['set session:session-1'])
  })

  test('an ending session goes on without its write when the store is stuck', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    world.setMs = 60_000
    let isEnded = false
    const ending = $.session.end({ reason: 'prompt_input_exit', sessionId: 'session-1', resume: { id: 'session-1' } }).then(ended => {
      isEnded = true
      return ended
    })
    await clock.advance(5000)

    expect(isEnded).toBe(true)
    expect(await ending).toEqual({ sessionId: 'session-1' })
  })

  test('a session that ends before its saved items are read opens no pane for them', async ($, on) => {
    const { world, clock } = seat(on, { 'session:session-1': { tasks: [MINE], nextId: 8, savedMs: NOW } })
    world.isStuck = true
    const started = start($)
    await clock.advance(5000)
    await started
    const ending = $.session.end({ reason: 'prompt_input_exit', sessionId: 'session-1', resume: { id: 'session-1' } })
    await clock.advance(5000)
    await ending

    world.unstick?.()
    await clock.settle()

    expect(world.opens).toEqual([])
  })

  test('after /clear the pane holds no item and the first item is #1', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    await $.tool.call(XCODE_TASK)
    await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } })
    // The engine names the session /clear starts only once the end's hooks are done.
    world.sessionId = 'session-2'
    await clock.advance(1)

    expect(world.status).toBeUndefined()
    expect(world.items).toEqual([])

    const added = await $.tool.call(PAGING_TASK)

    expect(String((added as { result?: unknown }).result)).toContain('Added item #1')
    expect(world.store['session:session-1']).toEqual({
      version: 2,
      tasks: [expect.objectContaining({ id: 1, title: KEY_TASK.title }), expect.objectContaining({ id: 2, title: XCODE_TASK.title })],
      nextId: 3,
      savedMs: NOW,
      lastActiveMs: NOW,
      endedMs: NOW,
      folder: '/repo',
      taken: [],
    })
    expect(world.store['session:session-2']).toEqual({
      version: 2,
      tasks: [expect.objectContaining({ id: 1, title: PAGING_TASK.title })],
      nextId: 2,
      savedMs: NOW + 1,
      // The session /clear started was last active as it started.
      lastActiveMs: NOW,
      folder: '/repo',
      taken: [],
    })
  })

  for (const reason of ['clear', 'resume'] as const) {
    test(`after a ${reason} end the engine never names a new session for, nothing writes over the ended session's key`, async ($, on) => {
      const { world, clock } = seat(on)
      await start($)

      await $.tool.call(KEY_TASK)
      await $.session.end({ reason, sessionId: 'session-1', resume: { id: 'session-1' } })
      await clock.advance(5000)
      const saved = {
        version: 2,
        tasks: [expect.objectContaining({ id: 1, title: KEY_TASK.title })],
        nextId: 2,
        savedMs: NOW,
        lastActiveMs: NOW,
        endedMs: NOW,
        folder: '/repo',
        taken: [],
      }

      expect(world.status).toBeUndefined()

      const added = await $.tool.call(XCODE_TASK)
      await clock.advance(5000)

      expect(String((added as { result?: unknown }).result)).toContain('Added item #1')
      expect(world.status).toBe('☐ 1 question · /open-items')
      expect(world.store).toEqual({ 'session:session-1': saved })
    })
  }

  test('the session /clear starts takes the id the engine names a moment after the end', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } })
    await clock.advance(50)
    world.sessionId = 'session-2'
    await clock.advance(1000)
    await $.tool.call(XCODE_TASK)

    expect(savedIdsOf(world)).toEqual([1])
    expect((world.store['session:session-1'] as { tasks: { title: string }[] }).tasks[0]?.title).toBe(KEY_TASK.title)
    expect(savedIdsOf(world, 'session-2')).toEqual([1])
  })

  test('a pane slow to open as the session starts holds the start up 5 s at most, and the store not at all', async ($, on) => {
    const { world, clock } = seat(on, { 'session:session-1': { tasks: [MINE], nextId: 8, savedMs: NOW } })
    world.openMs = 30_000
    let isStarted = false
    void start($).then(() => {
      isStarted = true
    })
    await clock.advance(4000)
    expect(isStarted).toBe(false)
    await clock.advance(1000)
    expect(isStarted).toBe(true)

    // Nothing waits for the pane: the clock stands still here.
    world.openMs = 0
    const added = await $.tool.call(KEY_TASK)

    expect(String((added as { result?: unknown }).result)).toContain('Added item #8')
    expect(savedIdsOf(world)).toEqual([7, 8])
  })

  test('a resume into a session with no saved key holds no item', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    await $.session.end({ reason: 'resume', sessionId: 'session-1', resume: { id: 'session-1' } })
    world.sessionId = 'session-2'
    await clock.advance(1)

    expect(world.status).toBeUndefined()
    expect(world.items).toEqual([])
    expect(world.store['session:session-2']).toBeUndefined()

    const added = await $.tool.call(XCODE_TASK)

    expect(String((added as { result?: unknown }).result)).toContain('Added item #1')
    expect(savedIdsOf(world, 'session-2')).toEqual([1])
    expect(savedIdsOf(world)).toEqual([1])
  })

  test('a resume into a saved session restores it', async ($, on) => {
    const theirs = ROTATE
    const { world, clock } = seat(on, { 'session:session-2': { tasks: [theirs], nextId: 8, savedMs: NOW } })
    await start($)

    await $.tool.call(KEY_TASK)
    await $.session.end({ reason: 'resume', sessionId: 'session-1', resume: { id: 'session-1' } })
    world.sessionId = 'session-2'
    await clock.advance(1)

    const ui = await $.ui.mount(PANE)
    expect(world.status).toBe('☐ 1 action · /open-items')
    expect(world.isPaneOpen).toBe(true)
    expect(await textOf(ui, 'row-7')).toContain(ROTATE.title)
    expect(await textOf(ui, 'row-1')).toBe('')

    const added = await $.tool.call(XCODE_TASK)

    expect(String((added as { result?: unknown }).result)).toContain('Added item #8')
  })

  test('a start read still out at /clear takes nothing into the session /clear starts', async ($, on) => {
    const saved = { tasks: [MINE], nextId: 8, savedMs: NOW }
    const { world, clock } = seat(on, { 'session:session-1': saved })
    world.isStuck = true
    const started = start($)
    await clock.advance(5000)
    await started
    // Set first: the end waits on the stuck store here, and the new session's id is read once it is done.
    world.sessionId = 'session-2'
    const cleared = $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } })
    await clock.advance(5000)
    await cleared

    const added = await $.tool.call(KEY_TASK)
    expect(String((added as { result?: unknown }).result)).toContain('Added item #1')

    world.unstick?.()
    await clock.settle()

    const ui = await $.ui.mount(PANE)
    expect(await textOf(ui, 'row-1')).toContain(KEY_TASK.title)
    expect(await textOf(ui, 'row-7')).toBe('')
    expect(world.store['session:session-1']).toEqual(saved)
    expect(savedIdsOf(world, 'session-2')).toEqual([1])
  })

  test('a start read still out at /clear takes nothing in when the engine never names a new session', async ($, on) => {
    const saved = { tasks: [MINE], nextId: 8, savedMs: NOW }
    const { world, clock } = seat(on, { 'session:session-1': saved })
    world.isStuck = true
    const started = start($)
    await clock.advance(5000)
    await started
    const cleared = $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } })
    await clock.advance(5000)
    await cleared
    // The engine never names a new id: the process goes on as the ended session after the id reads.
    await clock.advance(1000)

    world.unstick?.()
    await clock.settle()

    const ui = await $.ui.mount(PANE)
    expect(await textOf(ui, 'item-7')).toBe('')
  })

  test('after /clear an answer saved for later stays with the session it was given in', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(KEY_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    // The answer's write takes a minute: it is still out as the session ends.
    world.setMs = 60_000
    const answered = ui.input({ key: 'reply-1', text: 'LoginTests.testExpiredToken failed' })
    await clock.advance(5000)
    await answered
    await $.turn.complete({ ...DONE, turnId: 't1' })
    world.sessionId = 'session-2'
    const cleared = $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } })
    await clock.advance(5000)
    await cleared
    await clock.settle()

    expect(await $.prompt.submit(typed('hello'))).toEqual({ text: 'hello' })
    expect((await $.prompt.context({ blocks: [] })).blocks).toEqual([])
    expect(world.submitted).toEqual([])

    await clock.advance(60_000)

    expect((world.store['session:session-1'] as { tasks: unknown[] } | undefined)?.tasks).toEqual([
      expect.objectContaining({
        id: 1,
        state: 'open',
        update: 'pending',
        isWaitingForClaude: true,
        thread: [expect.objectContaining({ from: 'claude' }), expect.objectContaining({ from: 'user', text: 'LoginTests.testExpiredToken failed' })],
      }),
      expect.objectContaining({ id: 2, state: 'open' }),
    ])
  })

  test('a failed store write shows "open-items: could not save" until a write succeeds', async ($, on) => {
    const { world } = seat(on)
    await start($)

    world.isWriteFailing = true
    await $.tool.call(KEY_TASK)
    const ui = await $.ui.mount(PANE)

    expect(await textOf(ui, 'unsaved')).toBe('open-items: could not save')
    expect(world.status).toBe('could not save · ☐ 1 action · /open-items')

    world.isWriteFailing = false
    await $.tool.call(XCODE_TASK)

    expect(await ui.find({ key: 'unsaved' })).toBeUndefined()
    expect(world.status).toBe('☐ 1 question · 1 action · /open-items')
  })
})

const OLD = 'session:session-old'
const NEW = 'session:session-new'
const OWN = 'session:session-1'
const HOUR_MS = 60 * 60_000
const CODE = 'k3x9q2'

/** An item a session saved, as v0.2 holds it. */
function savedItem(id: number, fields: Partial<Task> = {}): Task {
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
function keyed(tasks: readonly Task[], fields: Partial<Saved> = {}): Saved {
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
function codeIn(result: string | undefined): string {
  return /Hand-off code: ([a-z0-9]{6})\./.exec(result ?? '')?.[1] ?? ''
}

function answerOf(call: unknown) {
  return call as { result?: string; deny?: string }
}

async function buttonsOf(ui: Pick<Mounted<'terminal', 'Pane'>, 'findAll'>): Promise<(string | undefined)[]> {
  return (await ui.findAll({ type: 'Button' })).map(button => button.key)
}

describe('hand-off', () => {
  /** A decision and a question another session handed off with CODE a minute ago; the question was put off for later. */
  const HANDED = keyed(
    [
      savedItem(5, { kind: 'decision', title: 'Merge PR 787 with the override label?', options: ['Merge', 'Wait'], state: 'handing-off' }),
      savedItem(8, {
        kind: 'question',
        title: 'Which cloud project holds the uploader?',
        state: 'handing-off',
        thread: [
          { from: 'claude', text: 'The deploy needs its name.', atMs: NOW - 240_000 },
          { from: 'user', text: '', event: 'later', atMs: NOW - 120_000 },
        ],
      }),
    ],
    { handoff: { code: CODE, atMs: NOW - 60_000 } },
  )

  test('handoff_items marks open and Later items, returns a code, and the pane shows "Moving to a new session" with no buttons', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(PAGING_TASK)
    await $.tool.call(XCODE_TASK)
    await $.tool.call(KEY_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-2' })
    await ui.press({ key: 'later' })
    await ui.press({ key: 'row-3' })
    await ui.press({ key: 'done' })

    const handed = answerOf(await $.tool.call({ tool: HANDOFF }))
    const code = codeIn(handed.result)

    expect(code).toMatch(/^[a-z0-9]{6}$/)
    expect(handed.result).toBe(`Marked 2 items for the next session. Hand-off code: ${code}. Put the code in the successor's prompt; it calls take_items with it.`)
    expect([1, 2, 3].map(id => itemOf(world, id)?.state)).toEqual(['handing-off', 'handing-off', 'resolved'])
    expect(world.store[OWN]).toEqual(expect.objectContaining({ handoff: { code, atMs: NOW } }))
    expect(await textOf(ui, 'moving')).toContain('Moving to a new session')
    expect(await textOf(ui, 'moving')).toContain(PAGING_TASK.title)
    expect(await buttonsOf(ui)).toEqual(['hide'])
    expect(world.status).toBeUndefined()

    // A later write keeps the hand-off: an item added after it stays this session's own.
    await $.tool.call({ tool: ADD, title: 'Renew the TLS certificate', detail: 'It expires on Friday.', kind: 'action' })
    expect(world.store[OWN]).toEqual(expect.objectContaining({ handoff: { code, atMs: NOW } }))
    expect(itemOf(world, 4)?.state).toBe('open')
  })

  test("an answer appended after Claude's last model request moves with the item as unread", async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.turn.start({ text: 'go on', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'Two failures' })
    await clock.advance(1000)
    expect(world.appended.filter(row => row.type === 'user')).toHaveLength(1)

    const code = codeIn(answerOf(await $.tool.call({ tool: HANDOFF })).result)
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()

    // The old Claude is not woken for an answer that moved on.
    expect(world.submitted).toEqual([])
    expect(itemOf(world, 1)).toEqual(expect.objectContaining({ state: 'handing-off', update: 'pending' }))

    // The successor, simulated by the session /clear starts, takes the answer as unread.
    await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } })
    world.sessionId = 'session-2'
    await clock.advance(1)
    const taken = answerOf(await $.tool.call({ tool: TAKE, code }))

    expect(taken.result).toContain(`#1 open: ${XCODE_TASK.title}. The user replied`)
    expect(taken.result).toContain('Two failures')
    expect(itemOf(world, 1)).toEqual(expect.objectContaining({ state: 'open', update: 'delivered', isWaitingForClaude: true }))
  })

  test('reply_item on an item handed off says the new session answers it, not to add it again', async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call({ tool: HANDOFF })
    const refused = answerOf(await $.tool.call({ tool: REPLY, id: 1, text: 'Which test file?' }))

    expect(refused.deny).toBe('Item #1 went to a new session; that session answers it now.')
  })

  test('take_items moves the items with their numbers and says "N items moved from the previous session"', async ($, on) => {
    const { world } = seat(on, { [OLD]: HANDED })
    await start($)

    const taken = answerOf(await $.tool.call({ tool: TAKE, code: CODE }))

    expect(taken.result).toContain(`Took 2 items from the previous session (hand-off code ${CODE}).`)
    expect(taken.result).toContain('#5 open · decision')
    expect(taken.result).toContain('#8 later · question')
    expect(taken.result).toContain('The deploy needs its name.')
    expect(taken.result).not.toContain('(was #')
    expect(world.toasts).toContain('2 items moved from the previous session')
    expect(world.items.map(task => [task.id, task.state])).toEqual([
      [5, 'open'],
      [8, 'later'],
    ])
    expect(itemOf(world, 5)?.thread.at(-1)).toEqual(expect.objectContaining({ event: 'took' }))
    expect(world.store[OWN]).toEqual(
      expect.objectContaining({
        nextId: 9,
        taken: [{ code: CODE, fromKey: OLD, ids: [{ was: 5, now: 5 }, { was: 8, now: 8 }] }],
      }),
    )
    expect(world.store[OLD]).toEqual(HANDED)

    const ui = await $.ui.mount(PANE)
    expect(await textOf(ui, 'row-5')).toContain('Merge PR 787')
    expect(await textOf(ui, 'row-8')).toContain('Which cloud project')
  })

  test('a number the successor already uses is renumbered, and the result maps old to new', async ($, on) => {
    const mine = [1, 2, 3, 4, 5].map(id => savedItem(id, { title: `Check runner number ${id}` }))
    const { world } = seat(on, { [OWN]: keyed(mine), [OLD]: HANDED })
    await start($)

    const taken = answerOf(await $.tool.call({ tool: TAKE, code: CODE }))

    expect(taken.result).toContain('#6 (was #5) open · decision')
    expect(taken.result).toContain('#8 later · question')
    expect(taken.result).not.toContain('#8 (was')
    expect(itemOf(world, 6)?.title).toBe('Merge PR 787 with the override label?')
    expect(itemOf(world, 5)?.title).toBe('Check runner number 5')

    const added = answerOf(await $.tool.call(XCODE_TASK))

    expect(added.result).toContain('Added item #9')
    // Each write keeps what the key took.
    expect((world.store[OWN] as Saved).taken).toEqual([{ code: CODE, fromKey: OLD, ids: [{ was: 5, now: 6 }, { was: 8, now: 8 }] }])
  })

  test('take_items with a wrong code takes nothing', async ($, on) => {
    const { world } = seat(on, { [OLD]: HANDED })
    await start($)

    const refused = answerOf(await $.tool.call({ tool: TAKE, code: 'zzzzzz' }))

    expect(refused.deny).toBe('No items to take with hand-off code zzzzzz.')
    expect(world.items).toEqual([])
    expect(world.store[OWN]).toBeUndefined()
    expect(world.store[OLD]).toEqual(HANDED)
  })

  test('the old session shows its items as moved once another key took its code', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(PAGING_TASK)
    await $.tool.call(XCODE_TASK)
    const code = codeIn(answerOf(await $.tool.call({ tool: HANDOFF })).result)
    const ui = await $.ui.mount(PANE)
    expect(await textOf(ui, 'moving')).toContain('Moving to a new session')

    // The successor, another process, writes its own key only.
    world.store[NEW] = keyed([savedItem(1), savedItem(2)], { taken: [{ code, fromKey: OWN, ids: [{ was: 1, now: 1 }, { was: 2, now: 2 }] }] })
    await $.turn.start({ text: 'is it done?', turnId: 't1' })

    expect(world.items.map(task => task.state)).toEqual(['moved', 'moved'])
    expect(world.toasts).toContain('2 items moved to a new session')
    expect(world.isPaneOpen).toBe(false)
    expect(world.store[OWN]).toEqual(expect.objectContaining({ tasks: [expect.objectContaining({ id: 1, state: 'moved', thread: [] }), expect.objectContaining({ id: 2, state: 'moved', thread: [] })] }))
    expect(world.store[OWN]).not.toHaveProperty('handoff')
  })

  test('a press on a moved item sends nothing and says it moved', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(PAGING_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    // Another session took it as a leftover, while this one sat idle for 12 hours.
    world.store[NEW] = keyed([savedItem(1)], { taken: [{ code: '', fromKey: OWN, ids: [{ was: 1, now: 1 }] }] })
    await ui.press({ key: 'option-1' })
    await clock.advance(1000)
    await clock.settle()

    expect(itemOf(world, 1)?.state).toBe('moved')
    expect(world.submitted).toEqual([])
    expect(world.appended).toEqual([])
    expect(world.toasts.at(-1)).toBe("Item #1 moved to a new session, so your response wasn't saved.")
  })

  test('a press on an item drawn before the hand-off sends nothing and says it moved', async ($, on) => {
    const { world, clock } = seat(on)
    const held = holdingPresses(on)
    await start($)

    await $.tool.call(PAGING_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    held.isOn = true
    const pressed = ui.press({ key: 'option-1' })
    await $.tool.call({ tool: HANDOFF })
    held.letGo()
    await pressed
    await clock.advance(1000)
    await clock.settle()

    expect(itemOf(world, 1)?.state).toBe('handing-off')
    expect(world.submitted).toEqual([])
    expect(world.toasts.at(-1)).toBe("Item #1 moved to a new session, so your response wasn't saved.")
  })

  test('two sessions writing at once keep both keys whole', async ($, on) => {
    const { world, clock } = seat(on, { [OLD]: HANDED })
    await start($)

    // The successor's write takes a minute; the old session writes its own key meanwhile.
    world.setMs = 60_000
    const taking = $.tool.call({ tool: TAKE, code: CODE })
    await clock.advance(1)
    const oldWrites = { ...HANDED, tasks: [...HANDED.tasks, savedItem(9, { title: 'Renew the TLS certificate' })], nextId: 10, savedMs: NOW + 1, lastActiveMs: NOW + 1 }
    world.store[OLD] = oldWrites
    await clock.advance(60_000)
    await taking

    expect(world.store[OLD]).toEqual(oldWrites)
    expect(world.store[OWN]).toEqual(
      expect.objectContaining({
        tasks: [expect.objectContaining({ id: 5, state: 'open' }), expect.objectContaining({ id: 8, state: 'later' })],
        taken: [{ code: CODE, fromKey: OLD, ids: [{ was: 5, now: 5 }, { was: 8, now: 8 }] }],
      }),
    )
  })

  test('a take whose items sit in two keys is not offered again', async ($, on) => {
    // The old session ended before it learned of the take: its key still says handing-off.
    const old = { ...HANDED, handoff: { code: CODE, atMs: NOW - 2 * HOUR_MS }, endedMs: NOW - HOUR_MS, lastActiveMs: NOW - HOUR_MS }
    const successor = keyed([savedItem(5), savedItem(8)], { taken: [{ code: CODE, fromKey: OLD, ids: [{ was: 5, now: 5 }, { was: 8, now: 8 }] }] })
    const { world } = seat(on, { [OLD]: old, [NEW]: successor })
    await start($)
    await $.turn.start({ text: 'go on', turnId: 't1' })
    const ui = await $.ui.mount(PANE)

    expect(await ui.find({ key: 'offer' })).toBeUndefined()
    expect(world.isPaneOpen).toBe(false)
    expect(leftoversIn(world.store, '/repo', OWN, NOW)).toEqual([])
    expect(answerOf(await $.tool.call({ tool: TAKE, code: CODE })).deny).toBe(`The items of hand-off code ${CODE} were taken already.`)
  })

  test('--resume of a session whose items moved does not bring them back', async ($, on) => {
    const old = { ...HANDED, endedMs: NOW - 30_000 }
    const successor = keyed([savedItem(5), savedItem(8)], { taken: [{ code: CODE, fromKey: OLD, ids: [{ was: 5, now: 5 }, { was: 8, now: 8 }] }] })
    const { world, clock } = seat(on, { [OLD]: old, [NEW]: successor })
    await start($)

    await $.session.end({ reason: 'resume', sessionId: 'session-1', resume: { id: 'session-1' } })
    world.sessionId = 'session-old'
    await clock.advance(1)
    const ui = await $.ui.mount(PANE)

    expect(world.items.map(task => task.state)).toEqual(['moved', 'moved'])
    expect(world.status).toBeUndefined()
    expect(await ui.find({ key: 'moving' })).toBeUndefined()
    expect(await ui.find({ key: 'row-5' })).toBeUndefined()
    expect(world.store[OLD]).toEqual(expect.objectContaining({ tasks: [expect.objectContaining({ id: 5, state: 'moved' }), expect.objectContaining({ id: 8, state: 'moved' })] }))
    expect(world.store[OLD]).not.toHaveProperty('handoff')
  })
})

describe('leftovers', () => {
  test("a worker session in the same folder is not offered the live COO's items", async ($, on) => {
    const { world } = seat(on, { [OLD]: keyed([savedItem(1), savedItem(2)], { lastActiveMs: NOW - 300_000 }) })
    await start($)
    await $.turn.start({ text: 'run the tests', turnId: 't1' })
    const ui = await $.ui.mount(PANE)

    expect(await ui.find({ key: 'offer' })).toBeUndefined()
    expect(world.isPaneOpen).toBe(false)
  })

  test('items of an ended session are offered with Take and Dismiss; Take moves them and tells Claude; Dismiss drops them for good', async ($, on) => {
    const answered = savedItem(2, {
      kind: 'question',
      title: 'Which region holds the bucket?',
      thread: [
        { from: 'claude', text: 'The backup job needs it.', atMs: NOW - 240_000 },
        { from: 'user', text: 'eu-west-1', atMs: NOW - 60_000 },
      ],
      isWaitingForClaude: true,
      update: 'pending',
    })
    const ended = keyed([savedItem(1), answered], { endedMs: NOW - HOUR_MS, lastActiveMs: NOW - HOUR_MS })
    const { world, clock } = seat(on, { [OLD]: ended })
    await start($)
    const ui = await $.ui.mount(PANE)

    expect(world.isPaneOpen).toBe(true)
    expect(await textOf(ui, 'offer')).toContain('2 items left by an earlier session')
    expect(await buttonsOf(ui)).toEqual(['take', 'dismiss', 'hide'])

    await ui.press({ key: 'take' })
    await clock.settle()

    expect(world.items.map(task => [task.id, task.state])).toEqual([
      [1, 'open'],
      [2, 'open'],
    ])
    expect(world.submitted).toHaveLength(1)
    expect(world.submitted[0]).toContain('I took 2 items left by an earlier session')
    expect(world.submitted[0]).toContain('Which region holds the bucket?')
    expect(world.submitted[0]).toContain('eu-west-1')
    expect(world.store[OLD]).toEqual(ended)
    expect((world.store[OWN] as Saved).taken).toEqual([{ code: '', fromKey: OLD, ids: [{ was: 1, now: 1 }, { was: 2, now: 2 }] }])
    expect(await ui.find({ key: 'offer' })).toBeUndefined()

    world.store['session:session-gone'] = keyed([savedItem(1, { title: 'Renew the TLS certificate' })], { endedMs: NOW })
    await $.turn.start({ text: 'go on', turnId: 't1' })
    expect(await textOf(ui, 'offer')).toContain('1 item left by an earlier session')

    await ui.press({ key: 'dismiss' })
    await clock.settle()

    expect(itemOf(world, 3)).toEqual(expect.objectContaining({ title: 'Renew the TLS certificate', state: 'withdrawn', note: 'dismissed' }))
    expect(world.submitted).toHaveLength(1)
    expect(world.appended).toEqual([])
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await $.turn.start({ text: 'and now?', turnId: 't2' })
    expect(await ui.find({ key: 'offer' })).toBeUndefined()
    // No other session in the folder is offered them either.
    expect(leftoversIn(world.store, '/repo', 'session:session-9', NOW)).toEqual([])
  })

  test("after /clear the earlier conversation's items are offered at once, never moved on their own", async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    await $.tool.call(XCODE_TASK)
    await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } })
    world.sessionId = 'session-2'
    await clock.advance(1)
    const ui = await $.ui.mount(PANE)

    expect(world.isPaneOpen).toBe(true)
    expect(await textOf(ui, 'offer')).toContain('2 items left by an earlier session')
    expect(world.items).toEqual([])
    expect(world.store[OWN]).toEqual(
      expect.objectContaining({ endedMs: NOW, tasks: [expect.objectContaining({ id: 1, state: 'open' }), expect.objectContaining({ id: 2, state: 'open' })] }),
    )

    await clock.advance(HOUR_MS)
    await $.turn.start({ text: 'go on', turnId: 't1' })

    expect(world.items).toEqual([])
    expect(world.store['session:session-2']).toBeUndefined()
  })

  test('--resume of an ended session clears endedMs, so its items are not offered elsewhere', async ($, on) => {
    const { world, clock } = seat(on, { [OLD]: keyed([savedItem(1)], { endedMs: NOW - HOUR_MS, lastActiveMs: NOW - HOUR_MS }) })
    await start($)
    const ui = await $.ui.mount(PANE)
    expect(await textOf(ui, 'offer')).toContain('1 item left by an earlier session')

    await $.session.end({ reason: 'resume', sessionId: 'session-1', resume: { id: 'session-1' } })
    world.sessionId = 'session-old'
    await clock.advance(1)

    expect(world.store[OLD]).not.toHaveProperty('endedMs')
    expect((world.store[OLD] as Saved).lastActiveMs).toBe(NOW)
    expect(leftoversIn(world.store, '/repo', 'session:session-9', NOW + 1)).toEqual([])
    expect(await ui.find({ key: 'offer' })).toBeUndefined()
    expect(await textOf(ui, 'row-1')).toContain('Rotate deploy key number 1')
  })

  test('an unclaimed hand-off becomes leftovers after 30 minutes', async ($, on) => {
    const handed = keyed([savedItem(1, { state: 'handing-off' }), savedItem(2, { state: 'handing-off' })], { handoff: { code: CODE, atMs: NOW } })
    const { clock } = seat(on, { [OLD]: handed })
    await start($)
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ key: 'offer' })).toBeUndefined()

    await clock.advance(30 * 60_000)
    // No timer: nothing is checked until the next turn.
    expect(await ui.find({ key: 'offer' })).toBeUndefined()
    await $.turn.start({ text: 'go on', turnId: 't1' })

    expect(await textOf(ui, 'offer')).toContain('2 items left by an earlier session')
  })

  test('a hand-off nobody took for 30 minutes is offered back to the old session; Take puts its items back and tells Claude', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(PAGING_TASK)
    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-2' })
    await ui.press({ key: 'later' })
    await clock.advance(1000)
    await clock.settle()
    await $.tool.call({ tool: HANDOFF })
    await clock.advance(30 * 60_000)
    await $.turn.start({ text: 'did it move?', turnId: 't1' })
    await $.turn.complete({ ...DONE, turnId: 't1' })

    expect(await textOf(ui, 'moving')).toContain('No session took them in 30 minutes.')

    await ui.press({ key: 'take-back' })
    await clock.settle()

    expect(world.items.map(task => task.state)).toEqual(['open', 'later'])
    expect(world.store[OWN]).not.toHaveProperty('handoff')
    expect(world.submitted.at(-1)).toContain('so I took them back')
    expect(await ui.find({ key: 'moving' })).toBeUndefined()
  })

  test('Take pressed on an unclaimed hand-off that Claude handed off again since takes nothing back', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(PAGING_TASK)
    const code = codeIn(answerOf(await $.tool.call({ tool: HANDOFF })).result)
    await clock.advance(30 * 60_000)
    await $.turn.start({ text: 'did it move?', turnId: 't1' })
    await $.turn.complete({ ...DONE, turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    expect(await textOf(ui, 'moving')).toContain('No session took them in 30 minutes.')

    // A new successor is on its way with the same code.
    await $.tool.call({ tool: HANDOFF })
    await ui.press({ key: 'take-back' })
    await clock.settle()

    expect(itemOf(world, 1)?.state).toBe('handing-off')
    expect(world.store[OWN]).toEqual(expect.objectContaining({ handoff: { code, atMs: NOW + 30 * 60_000 } }))
    expect(world.submitted).toEqual([])
  })
})

describe('the README example', () => {
  test('two answers while Claude works reach it at once as one message, and the third after it stops goes as its own', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.turn.start({ text: 'Get our Stripe webhooks library ready to open-source.', turnId: 't1' })
    await $.tool.call({
      tool: ADD,
      title: 'Add STRIPE_SECRET_KEY to .env',
      detail: "The integration tests run against Stripe's test mode and need it.",
      done_when: "It's in .env. Don't paste it here.",
      kind: 'action',
    })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.press({ key: 'done' })
    expect(world.status).toBeUndefined()

    await $.tool.call({
      tool: ADD,
      title: 'Decide whether to make the repo public',
      detail: 'npm will link to it, and its whole git history becomes public. I found no secrets in it.',
      kind: 'decision',
      options: ['Make it public', 'Keep it private'],
    })
    await ui.press({ key: 'row-2' })
    await ui.press({ key: 'option-1' })

    await $.tool.call({
      tool: ADD,
      title: "Choose the package's name on npm",
      detail: 'stripe-webhooks is taken. The name goes in package.json and the README.',
      kind: 'question',
    })
    expect(world.status).toBe('☐ 1 question · /open-items')
    await clock.advance(1000)

    expect(world.appended.filter(row => row.type === 'user').map(row => row.text)).toEqual([
      [
        'My responses to items you gave me (Open items):',
        '',
        '#1 Add STRIPE_SECRET_KEY to .env: Done.',
        '',
        '#2 Decide whether to make the repo public: I chose "Make it public".',
      ].join('\n'),
    ])
    expect(world.submitted).toHaveLength(0)

    // Claude stops before a step reads the row: a prompt wakes it for it.
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()
    expect(world.submitted).toEqual([WAKE_UP])

    await ui.press({ key: 'row-3' })
    await ui.input({ key: 'reply-3', text: '@acme/stripe-hooks' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toEqual([WAKE_UP, `${ONE}#3 Choose the package's name on npm: ${REPLY_WORDS}\n@acme/stripe-hooks`])
    expect(world.status).toBeUndefined()
  })
})

describe('knowing whether Claude works', () => {
  test('a turn another loop begins and ends under its agent id leaves Claude idle', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    await $.turn.start({ text: 'fix it', turnId: 't1' })
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await $.turn.start({ text: '', turnId: 'side', agentId: 'side-request' })
    await $.turn.complete({ ...DONE, turnId: 'side', agentId: 'side-request' })

    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.press({ key: 'done' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toHaveLength(1)
    expect(world.appended).toEqual([])
  })
})

describe('the four kinds', () => {
  const DECISION = {
    tool: ADD,
    title: 'Ship the feed rewrite this week',
    detail: 'It unblocks the mobile release.',
    kind: 'decision',
    options: ['Yes', 'Not yet'],
    recommended: 'Yes',
  } as const

  const INFO = { tool: ADD, title: 'The migration ran clean', detail: 'Nothing for you to do; the schema is current.', kind: 'info' } as const

  const resultOf = (call: unknown) => call as { result?: string; deny?: string }

  test('a decision shows its options, the recommended one marked', async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(DECISION)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })

    const labelOf = async (key: string) => {
      const button = await ui.find({ type: 'Button', key })

      return `${button?.props.hotkey}: ${button?.props.label}`
    }

    expect(await labelOf('option-1')).toBe('1: Yes (recommended)')
    expect(await labelOf('option-2')).toBe('2: Not yet')
    // "Other…" is the reply field.
    expect(await ui.find({ type: 'Input', key: 'reply-1' })).toBeDefined()
  })

  test('a recommended value that is not an option is refused', async ($, on) => {
    seat(on)
    await start($)

    const refused = resultOf(await $.tool.call({ ...DECISION, recommended: 'Maybe' }))

    expect(refused.deny).toContain('recommended')
  })

  test('choosing the recommended option answers with the plain option', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(DECISION)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.press({ key: 'option-1' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toEqual(['My response to an item you gave me (Open items):\n\n#1 Ship the feed rewrite this week: I chose "Yes".'])
  })

  test('an option resolves the decision, and its thread records the choice', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(DECISION)
    const pane = await $.ui.mount(PANE)
    await pane.press({ key: 'row-1' })
    await pane.press({ key: 'option-2' })
    const task = itemOf(world, 1)

    expect(task?.state).toBe('resolved')
    expect(task?.thread.at(-1)).toEqual({ from: 'user', text: 'Not yet', event: 'chose', atMs: NOW })
    expect(task?.update).toBe('pending')
  })

  test('Done resolves the action, and its thread records it', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    const pane = await $.ui.mount(PANE)
    await pane.press({ key: 'row-1' })
    await pane.press({ key: 'done' })
    const task = itemOf(world, 1)

    expect(task?.state).toBe('resolved')
    expect(task?.thread.at(-1)).toEqual({ from: 'user', text: '', event: 'done', atMs: NOW })
    expect(task?.update).toBe('pending')
  })

  test('Seen resolves the info item, its thread records it, and Claude hears nothing', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(INFO)
    const pane = await $.ui.mount(PANE)
    await pane.press({ key: 'row-1' })
    await pane.press({ key: 'seen' })
    const task = itemOf(world, 1)

    expect(task?.state).toBe('resolved')
    expect(task?.thread.at(-1)).toEqual({ from: 'user', text: '', event: 'seen', atMs: NOW })
    expect(task?.update).toBe('none')
  })

  test('Later moves the item to later, its thread records it, and Claude goes on without it', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(DECISION)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.press({ key: 'later' })
    await clock.advance(1000)
    await clock.settle()
    const task = itemOf(world, 1)

    expect(task?.state).toBe('later')
    expect(task?.thread.at(-1)).toEqual({ from: 'user', text: '', event: 'later', atMs: NOW })
    expect(world.submitted).toEqual(['My response to an item you gave me (Open items):\n\n#1 Ship the feed rewrite this week: Later. Go on without it.'])
    // It stays, and keeps its options: the user can still answer it.
    expect(world.status).toBe('☐ 1 later · /open-items')
    expect(world.screen).toEqual({ kind: 'list' })
    await ui.press({ key: 'row-1' })
    expect(await ui.find({ type: 'Button', key: 'option-1' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'later' })).toBeUndefined()
  })

  test('a reply keeps the item open, its thread holds the reply, and the item waits for Claude', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'Two failures' })
    await clock.advance(1000)
    await clock.settle()
    const task = itemOf(world, 1)

    expect(task?.state).toBe('open')
    expect(task?.isWaitingForClaude).toBe(true)
    expect(task?.thread.at(-1)).toEqual({ from: 'user', text: 'Two failures', atMs: NOW })
    expect(world.submitted).toEqual([`${ONE}#1 Run xcodebuild test on your Mac, paste the failures: ${REPLY_WORDS}\nTwo failures`])
    expect(await textOf(ui, 'item-1')).toContain('waiting for Claude')
    expect(world.status).toBeUndefined()
  })

  test('a reply, then Done: the second message tells Claude of Done only', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    // A question has no Done: an action of the same title.
    await $.tool.call({ ...XCODE_TASK, kind: 'action' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'Two failures' })
    await clock.advance(1000)
    await clock.settle()
    await ui.press({ key: 'done' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toEqual([
      `${ONE}#1 Run xcodebuild test on your Mac, paste the failures: ${REPLY_WORDS}\nTwo failures`,
      `${ONE}#1 Run xcodebuild test on your Mac, paste the failures: Done.`,
    ])
  })

  test('Later, then an option: the second message tells Claude of the option only', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(DECISION)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.press({ key: 'later' })
    await clock.advance(1000)
    await clock.settle()
    await ui.press({ key: 'row-1' })
    await ui.press({ key: 'option-1' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toEqual([
      'My response to an item you gave me (Open items):\n\n#1 Ship the feed rewrite this week: Later. Go on without it.',
      'My response to an item you gave me (Open items):\n\n#1 Ship the feed rewrite this week: I chose "Yes".',
    ])
  })

  test('a second reply whose message does not enter goes again, without the first', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    // A question has no Done: an action of the same title.
    await $.tool.call({ ...XCODE_TASK, kind: 'action' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'Two failures' })
    await clock.advance(1000)
    await clock.settle()

    world.refusing = 'Another plugin held the prompt.'
    await ui.input({ key: 'reply-1', text: 'And CartTests.testCouponRounding' })
    await clock.advance(1000)
    await clock.settle()
    world.refusing = undefined
    await ui.press({ key: 'done' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toEqual([
      `${ONE}#1 Run xcodebuild test on your Mac, paste the failures: ${REPLY_WORDS}\nTwo failures`,
      `${ONE}#1 Run xcodebuild test on your Mac, paste the failures: ${REPLY_WORDS}\nAnd CartTests.testCouponRounding\n#1 Run xcodebuild test on your Mac, paste the failures: Done.`,
    ])
  })

  test('an answer written in the prompt box is a reply too', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.prompt.submit(typed('↳ Answer to #1: LoginTests.testExpiredToken\nCartTests.testCouponRounding'))
    const task = itemOf(world, 1)

    expect(task?.state).toBe('open')
    expect(task?.isWaitingForClaude).toBe(true)
    expect(task?.thread.at(-1)).toEqual({ from: 'user', text: 'LoginTests.testExpiredToken\nCartTests.testCouponRounding', atMs: NOW })
  })

  test('an info item has one Seen button and sends nothing to Claude', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(INFO)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })

    const seen = await ui.find({ type: 'Button', key: 'seen' })
    expect([seen?.props.hotkey, seen?.props.label]).toEqual(['d', 'Seen'])
    expect(await ui.find({ type: 'Button', key: 'later' })).toBeUndefined()
    await ui.press({ key: 'seen' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toEqual([])
    expect(world.appended).toEqual([])
    expect(world.status).toBeUndefined()
    expect(world.isPaneOpen).toBe(false)
  })

  test('a sixth info item drops none: info items stay until Seen', async ($, on) => {
    const { world } = seat(on)
    await start($)

    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(resultOf(await $.tool.call({ ...INFO, title: `Note number ${n}` })).result).toContain(`Added item #${n}`)
    }

    const ui = await $.ui.mount(PANE)

    expect(await textOf(ui, 'row-1')).toContain('Note number 1')
    expect(await textOf(ui, 'row-6')).toContain('Note number 6')
    expect(world.status).toBe('☐ 6 info · /open-items')
  })

  test('an info item stays out of the context Claude reads', async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(INFO)
    await $.tool.call(XCODE_TASK)
    const sent = await $.prompt.submit(typed('go on'))

    expect(sent.context).toEqual(['Open items: 1 open, 0 unread answers; call list_items.'])
  })

  test('the status line counts by kind', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(DECISION)
    await $.tool.call({ ...XCODE_TASK, title: 'First question' })
    await $.tool.call({ ...XCODE_TASK, title: 'Second question' })
    await $.tool.call(INFO)
    await $.tool.call({ ...INFO, title: 'Another note' })

    expect(world.status).toBe('☐ 1 decision · 2 questions · 2 info · /open-items')

    await $.tool.call(KEY_TASK)

    expect(world.status).toBe('☐ 1 decision · 2 questions · 1 action · 2 info · /open-items')
  })

  test('withdrawn with "answered in chat" leaves the pane', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn', note: 'answered in chat' })

    expect(world.isPaneOpen).toBe(false)
    expect(world.status).toBeUndefined()
    expect(world.toasts.at(-1)).toContain('answered in chat')
  })

  test('a resumed decision with a recommended option comes back', async ($, on) => {
    const decision = {
      ...ROTATE,
      id: 1,
      title: DECISION.title,
      why: DECISION.detail,
      kind: 'decision',
      options: DECISION.options,
      recommended: 'Yes',
    }
    const { world } = seat(on, earlier([decision]))
    await start($)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })

    expect(world.status).toBe('☐ 1 decision · /open-items')
    expect((await ui.find({ type: 'Button', key: 'option-1' }))?.props.label).toBe('Yes (recommended)')
  })

  test('a seen info item is not brought back by a resumed session', async ($, on) => {
    const seen = { ...ROTATE, id: 1, kind: 'info', state: 'seen' }
    const { world } = seat(on, earlier([seen]))
    await start($)

    expect(world.status).toBeUndefined()
  })
})

describe('the pane groups items by kind', () => {
  const DECISION = {
    tool: ADD,
    title: 'Ship the feed rewrite this week',
    detail: 'It unblocks the mobile release.',
    kind: 'decision',
    options: ['Yes', 'Not yet'],
  } as const
  const INFO = { tool: ADD, title: 'The migration ran clean', detail: 'Nothing for you to do.', kind: 'info' } as const

  test('the pane draws sections in order, empty ones left out', async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(INFO)
    await $.tool.call(XCODE_TASK)
    await $.tool.call(DECISION)
    const ui = await $.ui.mount(PANE)
    const text = (await ui.find({ type: 'Box' }))?.text ?? ''
    const at = (needle: string) => text.indexOf(needle)

    const order = ['DECISIONS', DECISION.title, 'QUESTIONS', XCODE_TASK.title, 'INFO', INFO.title].map(at)
    expect(order.every(i => i >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(text).not.toContain('ACTIONS')
    expect(await textOf(ui, 'head')).toBe('☐ 1 decision · 1 question · 1 info')
  })

  test('after the open item closes, the pane shows the list', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(INFO)
    await $.tool.call(XCODE_TASK)
    await $.tool.call(DECISION)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.press({ key: 'seen' })

    expect(world.screen).toEqual({ kind: 'list' })
    expect(await ui.find({ type: 'Button', key: 'seen' })).toBeUndefined()
    expect((await ui.findAll({ type: 'Button' })).map(button => button.key)).toEqual(['row-3', 'row-2', 'hide'])
  })

  test('rows count the section headers, LATER among them', () => {
    const task = (id: number, kind: 'decision' | 'question' | 'info') => ({ ...ROTATE, id, kind, title: `Item number ${id}`, why: 'A reason.', ...(kind === 'decision' ? { options: ['Ship it', 'Hold'] } : {}) })
    const view = {
      shown: asItems([task(1, 'info'), task(2, 'question'), task(3, 'decision')]),
      screen: { kind: 'list' },
      held: null,
      draft: '',
      nowMs: NOW,
      canType: true,
      isFocused: true,
      isTyping: false,
    } as const
    const later = asItems([task(2, 'question')]).map(item => ({ ...item, state: 'later' as const }))

    expect(rowsFor(view, 60, 99)).toBe(ROWS_THREE_KINDS)
    expect(rowsFor({ ...view, shown: asItems([task(2, 'question')]) }, 60, 99)).toBe(ROWS_ONE_KIND)
    expect(rowsFor({ ...view, shown: [...asItems([task(1, 'info')]), ...later] }, 60, 99)).toBe(ROWS_ONE_KIND + 2)
  })

  test('a long-answer prompt naming an info item goes through as typed', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(INFO)
    const sent = await $.prompt.submit(typed('↳ Answer to #1: Thanks'))

    expect(sent.text).toBe('↳ Answer to #1: Thanks')
    expect(world.submitted).toEqual([])
    expect(world.status).toBe('☐ 1 info · /open-items')
  })
})

describe('the alert', () => {
  const ask = (kind: 'decision' | 'question' | 'action', title: string) => ({ tool: ADD, title, detail: 'Needed.', kind, ...(kind === 'decision' ? { options: ['Yes', 'No'] } : {}) }) as const
  const DECISION = ask('decision', 'Ship the feed rewrite this week')
  const QUESTION = ask('question', 'Which branch is the release cut from')

  test('a decision added while the person is away alerts once', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await clock.advance(180_000)
    await $.tool.call(DECISION)
    await $.tool.call(QUESTION)
    await clock.settle()

    expect(world.notices).toEqual([{ text: DECISION.title, title: 'Open items' }])
  })

  test('the next turn can alert again', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call(DECISION)
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await $.turn.start({ text: 'go on', turnId: 't2' })
    await $.tool.call(QUESTION)
    await clock.settle()

    expect(world.notices.map(one => one.text)).toEqual([DECISION.title, QUESTION.title])
  })

  test('no alert for info', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call({ tool: ADD, title: 'The migration ran clean', detail: 'Nothing to do.', kind: 'info' })
    await clock.settle()

    expect(world.notices).toEqual([])
  })

  test("no alert within 2 minutes of the person's prompt", async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.prompt.submit(typed('hello'))
    await clock.advance(30_000)
    await $.tool.call(DECISION)
    await clock.settle()

    expect(world.notices).toEqual([])
  })

  test("a prompt from the phone also counts as the person's", async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'bridge' } })
    await clock.advance(30_000)
    await $.tool.call(DECISION)
    await clock.settle()

    expect(world.notices).toEqual([])
  })

  test('no alert within 2 minutes of a pane press', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call({ tool: ADD, title: 'The migration ran clean', detail: 'Nothing to do.', kind: 'info' })
    await clock.advance(180_000)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.press({ key: 'seen' })
    await clock.advance(30_000)
    await $.tool.call(QUESTION)
    await clock.settle()

    expect(world.notices).toEqual([])
  })

  test('a title with quotes and a newline reaches notify as one clipped line', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(ask('decision', 'Merge "PR #18"\nnow?'))
    await clock.settle()

    expect(world.notices.map(one => one.text)).toEqual(['Merge "PR #18" now?'])
  })

  test('a refused notify does not fail add_item', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    world.refusingNotify = 'muted'
    const added = (await $.tool.call(DECISION)) as { result?: string; deny?: string }
    await clock.settle()

    expect(added.deny).toBeUndefined()
    expect(added.result).toContain('#1')
    expect(world.notices).toHaveLength(1)
  })

  test('a Claude reply alerts like a new item', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call(QUESTION)
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await $.turn.start({ text: 'go on', turnId: 't2' })
    await $.tool.call({ tool: REPLY, id: 1, text: 'The release branch is named release.' })
    await $.turn.complete({ ...DONE, turnId: 't2' })
    await clock.settle()

    expect(world.notices.map(one => one.text)).toEqual([QUESTION.title, `Claude replied: ${QUESTION.title}`])

    const pane = await $.ui.mount(PANE)

    await pane.press({ key: 'row-1' })

    await clock.advance(30_000)
    await $.turn.start({ text: 'go on', turnId: 't3' })
    await $.tool.call({ tool: REPLY, id: 1, text: 'Its last tag is v2.3.0.' })
    await clock.settle()

    expect(world.notices).toHaveLength(2)
  })
})

describe('threads', () => {
  const DECISION = {
    tool: ADD,
    title: 'Ship the feed rewrite this week',
    detail: 'It unblocks the mobile release.',
    kind: 'decision',
    options: ['Yes', 'Not yet'],
    recommended: 'Yes',
  } as const

  const resultOf = (call: unknown) => call as { result?: string; deny?: string }

  /** An open question as v0.2 saves it, with `thread`. */
  const itemWith = (id: number, thread: readonly Message[]): Task => ({
    id,
    kind: 'question',
    title: `Question number ${id}`,
    thread,
    state: 'open',
    isWaitingForClaude: false,
    hasNewReply: false,
    update: 'none',
    createdMs: NOW,
    updatedMs: NOW,
  })

  test("reply_item adds Claude's message, keeps the item open, and marks it hasNewReply", async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'Two failures' })
    await clock.advance(1000)
    await clock.settle()
    const replied = resultOf(await $.tool.call({ tool: REPLY, id: 1, text: 'Which test file are they in?\nI need the path.' }))
    const task = itemOf(world, 1)

    expect(replied.deny).toBeUndefined()
    expect(replied.result).toContain('#1')
    expect(task?.state).toBe('open')
    expect(task?.thread.at(-1)).toEqual({ from: 'claude', text: 'Which test file are they in?\nI need the path.', atMs: NOW + 1000 })
    expect(task?.hasNewReply).toBe(true)
    expect(task?.isWaitingForClaude).toBe(false)
    expect(world.status).toBe('☐ 1 question · ● 1 reply · /open-items')
  })

  test("after Claude's reply, the user's next answer reaches Claude, in the same millisecond too", async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.prompt.submit(typed('↳ Answer to #1: Two failures'))
    await $.tool.call({ tool: REPLY, id: 1, text: 'Which test file are they in?' })
    const sent = await $.prompt.submit(typed('↳ Answer to #1: CartTests.swift'))

    expect(sent.text).toBe(`${ONE}#1 Run xcodebuild test on your Mac, paste the failures: ${REPLY_WORDS}\nCartTests.swift`)
  })

  test('reply_item tells Claude of an answer the user gave meanwhile, which then is not sent again', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    await ui.input({ key: 'reply-1', text: 'Two failures' })
    await clock.advance(100)

    const replied = resultOf(await $.tool.call({ tool: REPLY, id: 1, text: 'Which test file are they in?' }))
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.advance(1000)
    await clock.settle()

    expect(replied.result).toContain('Two failures')
    expect(itemOf(world, 1)?.update).toBe('delivered')
    expect(world.appended).toEqual([])
    expect(world.submitted).toEqual([])
  })

  test('reply_item changes the options in place and logs a changed event', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(DECISION)
    const changed = resultOf(await $.tool.call({ tool: REPLY, id: 1, options: ['Ship Tuesday', 'Ship Friday', 'Hold'], recommended: 'Ship Friday' }))
    const task = itemOf(world, 1)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })

    expect(changed.deny).toBeUndefined()
    expect(world.items).toHaveLength(1)
    expect(task?.options).toEqual(['Ship Tuesday', 'Ship Friday', 'Hold'])
    expect(task?.recommended).toBe('Ship Friday')
    expect(task?.thread.at(-1)).toEqual({ from: 'claude', text: '', event: 'changed', atMs: NOW })
    expect((await ui.find({ type: 'Button', key: 'option-2' }))?.props.label).toBe('Ship Friday (recommended)')

    // A recommended option the new options leave out goes with it.
    await $.tool.call({ tool: REPLY, id: 1, options: ['Ship now', 'Hold'] })

    expect(itemOf(world, 1)?.recommended).toBeUndefined()
  })

  test('reply_item refuses an id that is not a whole number, and a recommended that is not an option', async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(DECISION)
    await $.tool.call(XCODE_TASK)

    expect(resultOf(await $.tool.call({ tool: REPLY, id: 1.5, text: 'Hello' })).deny).toContain('whole number')
    expect(resultOf(await $.tool.call({ tool: CLOSE, id: 1.5, as: 'withdrawn' })).deny).toContain('whole number')
    expect(resultOf(await $.tool.call({ tool: REPLY, id: 9, text: 'Hello' })).deny).toBe('No item #9.')
    expect(resultOf(await $.tool.call({ tool: REPLY, id: 1, recommended: 'Maybe' })).deny).toContain('recommended must be one of the options')
    expect(resultOf(await $.tool.call({ tool: REPLY, id: 1, recommended: 'Not yet' })).deny).toBeUndefined()
    expect(resultOf(await $.tool.call({ tool: REPLY, id: 2, options: ['Yes', 'No'] })).deny).toContain('for a decision only')
  })

  test("list_items shows each item's state, whether it waits, and its thread's last 3 messages; with id, the whole thread", async ($, on) => {
    const thread: Message[] = [
      { from: 'claude', text: 'Which branch is the release cut from?', atMs: NOW },
      { from: 'user', text: 'main, I think', atMs: NOW + 1 },
      { from: 'claude', text: 'main has two release tags.\nWhich one?', atMs: NOW + 2 },
      { from: 'user', text: 'v2.3.0', atMs: NOW + 3 },
    ]
    seat(on, earlierItems([{ ...itemWith(1, thread), isWaitingForClaude: true, update: 'delivered', heardMs: NOW + 3 }]))
    await start($)

    const listed = resultOf(await $.tool.call({ tool: LIST })).result ?? ''
    const whole = resultOf(await $.tool.call({ tool: LIST, id: 1 })).result ?? ''

    expect(listed).toStartWith('#1 open · question')
    expect(listed).toContain('waits for you')
    expect(listed).not.toContain('Which branch is the release cut from?')
    expect(listed).toContain('main has two release tags.\n')
    expect(listed).toContain('Which one?')
    expect(listed).toContain('v2.3.0')
    expect(whole).toContain('Which branch is the release cut from?')
  })

  test('close_item resolved is refused until the thread holds a message from the user', async ($, on) => {
    const asked = itemWith(1, [{ from: 'claude', text: 'Which branch is the release cut from?', atMs: NOW }])
    const answered = itemWith(2, [
      { from: 'claude', text: 'Which tag is the release?', atMs: NOW },
      { from: 'user', text: 'v2.3.0', atMs: NOW + 1 },
    ])
    const putOff = itemWith(3, [
      { from: 'claude', text: 'Which day do we ship?', atMs: NOW },
      { from: 'user', text: '', event: 'later', atMs: NOW + 1 },
    ])
    const { world } = seat(
      on,
      earlierItems([asked, { ...answered, isWaitingForClaude: true, update: 'delivered', heardMs: NOW + 1 }, { ...putOff, state: 'later', update: 'delivered', heardMs: NOW + 1 }]),
    )
    await start($)

    for (const id of [1, 3]) {
      expect(resultOf(await $.tool.call({ tool: CLOSE, id, as: 'resolved' })).deny).toContain('no answer from the user yet')
      expect(itemOf(world, id)?.state).not.toBe('resolved')
    }

    const resolved = resultOf(await $.tool.call({ tool: CLOSE, id: 2, as: 'resolved', note: 'The release is v2.3.0' }))

    expect(resolved.deny).toBeUndefined()
    expect(itemOf(world, 2)?.state).toBe('resolved')
    expect(itemOf(world, 2)?.note).toBe('The release is v2.3.0')
  })

  test('close_item withdrawn with note "answered in chat"', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const closed = resultOf(await $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn', note: 'answered in chat' }))

    expect(closed.result).toContain('#1')
    expect(itemOf(world, 1)?.state).toBe('withdrawn')
    expect(itemOf(world, 1)?.note).toBe('answered in chat')
    expect(world.toasts.at(-1)).toBe('Claude withdrew the item: Run xcodebuild test on your Mac, paste the failures. answered in chat')
  })

  test('close_item refuses an item already closed, and a state it does not know; reply_item refuses a closed item', async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)

    expect(resultOf(await $.tool.call({ tool: CLOSE, id: 1, as: 'done' })).deny).toContain('"resolved" or "withdrawn"')

    await $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn' })

    expect(resultOf(await $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn' })).deny).toContain('already withdrawn')
    expect(resultOf(await $.tool.call({ tool: REPLY, id: 1, text: 'One more thing' })).deny).toContain('already withdrawn')
  })
})

describe('the live-chat gate', () => {
  const LIVE = 'live chat: ask in the chat'
  const NOTE = 'This looks like a live chat: if the user is here and replying, withdraw it with close_item and ask in the chat.'
  const ANDROID = { ...XCODE_TASK, title: 'Paste the Android test failures' } as const

  const resultOf = (call: unknown) => call as { result?: string; deny?: string }

  /** A Bash or Monitor result as the engine appends it, at door `tool-result`; in a subagent's conversation with `agentId`. */
  const rowOf = (tool: 'Bash' | 'Monitor', text: string, agentId?: string): SessionAppendInput => ({
    message: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: `call-${tool}`, content: text }] },
    door: 'tool-result',
    origin: { kind: 'tool', tool },
    uuid: `row-${tool}-${text.length}`,
    ...(agentId === undefined ? {} : { agentId }),
  })

  const shellStarted = (id: string) => `Command running in background with ID: ${id}. Output is being written to: /tmp/tasks/${id}.output. You will be notified when it completes.`
  const monitorStarted = (id: string) => `Monitor started (task ${id}, expires in 1m unless the command exits first). You will be notified on each event.`

  /** A task notification, as the engine words one: an end carries a status, a monitor's event none. */
  const notified = (id: string, body: string): PromptSubmitInput => ({
    text: `<task-notification>\n<task-id>${id}</task-id>\n${body}\n</task-notification>`,
    wait: false,
    origin: { kind: 'task-notification' },
  })
  const ENDED = '<status>completed</status>\n<summary>Background command "npm run e2e" completed (exit code 0)</summary>'
  const EVENT = '<summary>Monitor event: "the build log"</summary>\n<event>step 2 of 5</event>'

  /** A row of a conversation that ran before the mod saw it. */
  const ROW: SessionMessage = { role: 'assistant', text: 'The tests pass.', toolUses: [] }

  async function twoTyped($: Engine) {
    await $.prompt.submit(typed("Let's brainstorm a name for the CLI"))
    await $.prompt.submit(typed('I like the short ones'))
  }

  test('a brainstorm: an add after the second typed prompt, no agent running, is refused; 5 minutes on, it is added', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await twoTyped($)

    expect(resultOf(await $.tool.call(XCODE_TASK)).deny).toBe(LIVE)
    expect(world.items).toEqual([])

    await clock.advance(300_000)

    expect(resultOf(await $.tool.call(XCODE_TASK)).result).toContain('Added item #1')
  })

  test('a COO first turn: an add before the first agent is allowed', async ($, on) => {
    seat(on)
    await start($)

    await $.prompt.submit(typed('/coo run the release checklist'))
    const added = resultOf(await $.tool.call(XCODE_TASK))

    expect(added.result).toContain('Added item #1')
    expect(added.result).not.toContain(NOTE)
  })

  test('a pane press, then an add with no agent running, is allowed', async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    await twoTyped($)
    const pane = await $.ui.mount(PANE)
    await pane.press({ key: 'row-1' })
    await pane.press({ key: 'done' })

    expect(resultOf(await $.tool.call(XCODE_TASK)).result).toContain('Added item #2')
  })

  test('two long answers through the composer bridge, no agent running, are allowed', async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(ANDROID)
    await $.prompt.submit(typed('↳ Answer to #1: LoginTests.testExpiredToken'))
    await $.prompt.submit(typed('↳ Answer to #2: CartTest.kt, line 40'))

    expect(resultOf(await $.tool.call(KEY_TASK)).result).toContain('Added item #3')
  })

  test('two typed prompts while a background shell command runs are allowed, and refused once it ends', async ($, on) => {
    seat(on)
    await start($)

    await $.prompt.submit(typed('Run the e2e suite in the background'))
    await $.session.append(rowOf('Bash', shellStarted('baq8qimnb')))
    // The wording of a command the user moved to the background with ctrl+B.
    await $.session.append(rowOf('Bash', 'Command was manually backgrounded by user with ID: bk3x9. Output is being written to: /tmp/tasks/bk3x9.output.'))
    await $.prompt.submit(typed('While it runs, which flags did we pass?'))
    const added = resultOf(await $.tool.call(XCODE_TASK))

    expect(added.result).toContain('Added item #1')
    expect(added.result).not.toContain(NOTE)

    await $.prompt.submit(notified('baq8qimnb', ENDED))

    expect(resultOf(await $.tool.call(ANDROID)).result).toContain('Added item #2')

    await $.prompt.submit(notified('bk3x9', ENDED))

    expect(resultOf(await $.tool.call(KEY_TASK)).deny).toBe(LIVE)
  })

  test('typed, press, typed is allowed', async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.prompt.submit(typed('What do you need from the tests?'))
    const pane = await $.ui.mount(PANE)
    await pane.press({ key: 'row-1' })
    await $.prompt.submit(typed('I will run them after lunch'))

    expect(resultOf(await $.tool.call(ANDROID)).result).toContain('Added item #2')
  })

  test('two typed prompts while an agent runs are allowed, and refused once it is done', async ($, on) => {
    const { world } = seat(on)
    await start($)

    const agent: AgentInfo = { id: 'agent-1', description: 'Review the diff', type: 'general-purpose', status: 'running' }
    world.agents = [agent]
    await twoTyped($)

    expect(resultOf(await $.tool.call(XCODE_TASK)).result).toContain('Added item #1')

    world.agents = [{ ...agent, status: 'completed' }]

    expect(resultOf(await $.tool.call(ANDROID)).deny).toBe(LIVE)
  })

  test('two typed prompts while an agent waits on its own background work are allowed', async ($, on) => {
    const { world } = seat(on)
    await start($)

    world.agents = [{ id: 'agent-1', description: 'Run the e2e suite', type: 'general-purpose', status: 'waiting' }]
    await twoTyped($)

    expect(resultOf(await $.tool.call(XCODE_TASK)).result).toContain('Added item #1')
  })

  test('two typed prompts while an agent has not started yet are allowed', async ($, on) => {
    const { world } = seat(on)
    await start($)

    world.agents = [{ id: 'agent-1', description: 'Review the diff', type: 'general-purpose', status: 'pending' }]
    await twoTyped($)

    expect(resultOf(await $.tool.call(XCODE_TASK)).result).toContain('Added item #1')
  })

  test('a monitor counts until its stream ends, not at its first event', async ($, on) => {
    seat(on)
    await start($)

    await $.session.append(rowOf('Monitor', monitorStarted('bh1vck1dz')))
    await twoTyped($)

    expect(resultOf(await $.tool.call(XCODE_TASK)).result).toContain('Added item #1')

    await $.prompt.submit(notified('bh1vck1dz', EVENT))

    expect(resultOf(await $.tool.call(ANDROID)).result).toContain('Added item #2')

    await $.prompt.submit(notified('bh1vck1dz', ENDED))

    expect(resultOf(await $.tool.call(KEY_TASK)).deny).toBe(LIVE)
  })

  test('a shell command a subagent started does not count once that subagent is done', async ($, on) => {
    seat(on)
    await start($)

    await $.session.append(rowOf('Bash', shellStarted('b7k2'), 'agent-1'))
    await twoTyped($)

    expect(resultOf(await $.tool.call(XCODE_TASK)).deny).toBe(LIVE)
  })

  test('a background start whose id cannot be read: the item is added, with the live-chat note', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.session.append(rowOf('Bash', 'Command running in background as job 12; its output goes to /tmp/tasks/12.output.'))
    await twoTyped($)
    const added = resultOf(await $.tool.call(XCODE_TASK))

    expect(added.result).toContain('Added item #1')
    expect(added.result).toEndWith(NOTE)
    expect(world.items).toHaveLength(1)
  })

  test('after a code reload, which loses what ran before it, the item is added with the live-chat note', async ($, on) => {
    seat(on)
    await start($)

    await start($)
    await twoTyped($)

    expect(resultOf(await $.tool.call(XCODE_TASK)).result).toEndWith(NOTE)
  })

  test('a mod loaded mid-session, in a conversation that holds rows: the item is added with the live-chat note', async ($, on) => {
    const { world } = seat(on)
    world.messages = [ROW]
    await start($)

    await twoTyped($)

    expect(resultOf(await $.tool.call(XCODE_TASK)).result).toEndWith(NOTE)
  })

  test('a process started with --resume: the item is added with the live-chat note', async ($, on) => {
    const { world } = seat(on, earlierItems(asItems([ROTATE])))
    world.messages = [ROW]
    await start($)

    expect(world.status).toBe('☐ 1 action · /open-items')

    await twoTyped($)

    expect(resultOf(await $.tool.call(XCODE_TASK)).result).toEndWith(NOTE)
  })

  test('after a resume, the item is added with the live-chat note', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.session.end({ reason: 'resume', sessionId: 'session-1', resume: { id: 'session-2' } })
    world.sessionId = 'session-2'
    await clock.advance(1)
    await twoTyped($)

    expect(resultOf(await $.tool.call(XCODE_TASK)).result).toEndWith(NOTE)
  })

  test('when the agents cannot be listed, the item is added with the live-chat note', async ($, on) => {
    const { world } = seat(on)
    await start($)

    world.isAgentListFailing = true
    await twoTyped($)

    expect(resultOf(await $.tool.call(XCODE_TASK)).result).toEndWith(NOTE)
  })

  test('the gate reads tool-result rows and passes each on unchanged', async ($, on) => {
    seat(on)
    await start($)

    const row = rowOf('Bash', shellStarted('baq8qimnb'))
    const stored = await $.session.append(row)

    expect(stored).toEqual({ message: row.message, uuid: row.uuid })
  })
})
