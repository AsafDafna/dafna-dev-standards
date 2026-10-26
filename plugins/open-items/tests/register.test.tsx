import type { AgentInfo, On, PaneOpenArgs, PromptSubmitInput, SessionAppendInput, ToolSpec } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { fieldRowsOf, rowsFor } from '../hooks/pane'
import { register } from '../hooks/register'
import { savedIn } from '../hooks/saved'
import { DONE as DONE_PRESS, movedBy } from '../hooks/tasks'
import { cellsOf, rowsOf, wrapRows } from '../hooks/text'
import type { Message, Task } from '../types'

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
    /** Set, `$.agent.list()` fails. */
    isAgentListFailing: false,
    /** The tools the plugin registered, as it described them. */
    tools: [] as ToolSpec[],
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
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
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

const ROWS_THREE_KINDS = 15
const ROWS_ONE_KIND = 8

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
    expect(await textOf(ui, 'task-1')).toContain("The webhook test can't run without it.")
    expect(await textOf(ui, 'task-1')).toContain('Done when:')
    expect(await textOf(ui, 'actions')).toContain('Done')
    expect(await textOf(ui, 'actions')).not.toContain('Accept')
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

    await (await $.ui.mount(PANE)).press({ key: 'later' })
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

  test('the pane asks for a row for each row a wrapped title takes, at the width it is drawn in', () => {
    const view = {
      shown: asItems([INSTRUMENTS, XCODE_LONG]),
      selectedId: null,
      editing: null,
      draft: '',
      nowMs: NOW,
      isWorking: false,
      canType: true,
      isFocused: true,
      isTyping: false,
    }

    // A title on one row would ask for 10 rows wherever it is drawn: the
    // rows Claude Code 2.1.296 drew at 36 and 64 columns, as the live check reads them.
    expect(rowsFor(view, 32, 99)).toBe(17)
    expect(rowsFor(view, 60, 99)).toBe(13)
    expect(rowsFor({ ...view, shown: asItems([INSTRUMENTS]) }, 32, 99)).toBe(14)
    expect(rowsFor({ ...view, shown: asItems([INSTRUMENTS]) }, 60, 99)).toBe(11)
    expect(rowsFor(view, 32, 12)).toBe(12)
  })

  test('drawn narrow, the pane opens again as tall as its wrapped titles', async ($, on) => {
    const { world } = seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    await start($)

    await runTasks($)
    const ui = await $.ui.mount(inline(60))
    expect(world.opens.at(-1)?.rows).toBe(13)

    // The terminal narrows: the titles take more rows, and the pane asks for them.
    await ui.redraw(inline(32).props)
    expect(world.opens.at(-1)?.rows).toBe(17)
  })

  test('drawn on two surfaces at once, the pane asks for the rows the narrower takes, and keeps them', async ($, on) => {
    const { world, clock } = seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    await start($)
    await $.session.attach({ surface: 'mobile', clientId: 'phone' })

    await runTasks($)
    const terminal = await $.ui.mount(inline(60))
    const phone = await $.ui.mount({ ...inline(32), surface: 'mobile' })
    expect(world.opens.at(-1)?.rows).toBe(16)

    // Each draws again: the pane asks for nothing new.
    const opens = world.opens.length
    await terminal.redraw(inline(60).props)
    await phone.redraw(inline(32).props)
    expect(world.opens.length).toBe(opens)

    // The phone leaves: the pane fits the terminal.
    await phone.unmount()
    await $.session.detach({ surface: 'mobile', clientId: 'phone', reason: 'detach' })
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(13)
  })

  test('a surface that docks the pane it drew inline leaves it as tall as the surfaces still drawing it inline', async ($, on) => {
    const { world } = seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    await start($)
    await $.session.attach({ surface: 'mobile', clientId: 'phone' })

    await runTasks($)
    const terminal = await $.ui.mount(inline(32))
    await $.ui.mount({ ...inline(60), surface: 'mobile' })
    expect(world.opens.at(-1)?.rows).toBe(17)

    // The terminal widens and docks the pane: the phone's rows are the pane's.
    await terminal.redraw(PANE.props)
    expect(world.opens.at(-1)?.rows).toBe(13)
  })

  test('drawn by two clients of one surface, the pane asks for the rows the narrower takes, and keeps them', async ($, on) => {
    const { world, clock } = seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    await start($)
    await $.session.attach({ surface: 'mobile', clientId: 'tablet' })
    await $.session.attach({ surface: 'mobile', clientId: 'phone' })

    // A render names its surface, not its client: the tablet's and the phone's come as one surface's.
    await runTasks($)
    const mobile = await $.ui.mount({ ...inline(60), surface: 'mobile' })
    await mobile.redraw(inline(32).props)
    expect(world.opens.at(-1)?.rows).toBe(16)

    // Each draws again: the pane asks for nothing new.
    const opens = world.opens.length
    await mobile.redraw(inline(60).props)
    await mobile.redraw(inline(32).props)
    expect(world.opens.length).toBe(opens)

    // The phone leaves: the tablet drawing again, the pane fits it, and
    // follows it as it widens.
    await $.session.detach({ surface: 'mobile', clientId: 'phone', reason: 'detach' })
    await mobile.redraw(inline(60).props)
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(13)

    await mobile.redraw(inline(100).props)
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(11)
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

    expect(world.opens.at(-1)?.rows).toBe(16)
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
    expect(world.opens.at(-1)?.rows).toBe(16)

    // The phone leaves, and the tablet draws the pane again: the pane fits it and the terminal.
    await $.session.detach({ surface: 'mobile', clientId: 'phone', reason: 'detach' })
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(13)
  })

  test('a client of three leaving, the two left draw the pane again, and it fits them', async ($, on) => {
    const { world, clock } = seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    await start($)

    for (const clientId of ['phone', 'tablet', 'laptop']) {
      await $.session.attach({ surface: 'mobile', clientId })
    }

    await runTasks($)
    const mobile = await $.ui.mount({ ...inline(32), surface: 'mobile' })
    await mobile.redraw(inline(60).props)
    await mobile.redraw(inline(50).props)
    expect(world.opens.at(-1)?.rows).toBe(16)

    // The phone leaves. No surface seats the pane inline but theirs, and the
    // narrower of the two drew last.
    await $.session.detach({ surface: 'mobile', clientId: 'phone', reason: 'detach' })
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(13)
  })

  test('two clients of one surface leaving at once, the pane fits the surfaces left', async ($, on) => {
    const { world, clock } = seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    await start($)
    await $.session.attach({ surface: 'mobile', clientId: 'tablet' })
    await $.session.attach({ surface: 'mobile', clientId: 'phone' })

    await runTasks($)
    await $.ui.mount(inline(60))
    const mobile = await $.ui.mount({ ...inline(32), surface: 'mobile' })
    expect(world.opens.at(-1)?.rows).toBe(16)

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
    expect(world.opens.at(-1)?.rows).toBe(13)
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
    expect(world.opens.at(-1)?.rows).toBe(16)

    // The pane draws again before the write that wakes it answers: the two
    // left start their seats over, and once they leave too, the terminal's fit.
    lateMs = 100
    const phoneLeaving = $.session.detach({ surface: 'mobile', clientId: 'phone', reason: 'detach' })
    await clock.advance(100)
    await phoneLeaving
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(13)

    await mobile.unmount()

    for (const clientId of ['tablet', 'laptop']) {
      const leaving = $.session.detach({ surface: 'mobile', clientId, reason: 'detach' })
      await clock.advance(100)
      await leaving
    }

    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(13)
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
    expect(world.opens.at(-1)?.rows).toBe(16)

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
    expect(world.opens.at(-1)?.rows).toBe(16)
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
    expect(world.opens.at(-1)?.rows).toBe(16)

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
    expect(world.opens.at(-1)?.rows).toBe(16)
  })

  test('the last client of a surface leaving as it draws the pane, the pane asks for none of the rows that drawing takes', async ($, on) => {
    const { world, clock } = seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    await start($)
    await $.session.attach({ surface: 'mobile', clientId: 'phone' })

    await runTasks($)
    const terminal = await $.ui.mount(inline(60))
    const mobile = await $.ui.mount({ ...inline(32), surface: 'mobile' })
    expect(world.opens.at(-1)?.rows).toBe(16)

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
    expect(world.opens.at(-1)?.rows).toBe(13)
  })

  test('a client is counted before it first draws the pane', async ($, on) => {
    const { world, clock } = seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    await start($)
    await $.session.attach({ surface: 'mobile', clientId: 'phone' })

    await runTasks($)
    const mobile = await $.ui.mount({ ...inline(32), surface: 'mobile' })
    expect(world.opens.at(-1)?.rows).toBe(16)

    // The tablet draws as it attaches, before the engine is done attaching it.
    world.attachMs = 500
    const attached = $.session.attach({ surface: 'mobile', clientId: 'tablet' })
    await clock.advance(1)
    await mobile.redraw(inline(60).props)
    await clock.advance(500)
    await attached
    await clock.settle()

    expect(world.opens.at(-1)?.rows).toBe(16)
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
    expect(world.opens.at(-1)?.rows).toBe(17)
    expect(world.tasksRead).toBe(1)

    await ui.redraw(inline(100).props)
    await ui.press({ key: 'select-1' })
    await ui.press({ key: 'answer' })
    const rows = world.opens.at(-1)?.rows ?? 0
    world.tasksRead = 0
    await ui.input({
      key: 'answer-1',
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

    expect(world.opens.at(-1)?.rows).toBe(13)
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
    await ui.press({ key: 'answer' })
    const rows = world.opens.at(-1)?.rows ?? 0
    await ui.input({ key: 'answer-1', text: 'Two failures: LoginTests.testExpiredToken and CartTests.testCouponRounding', kind: 'change' })
    expect(world.opens.at(-1)?.rows).toBe(rows + 1)

    // The answer, cut short, takes a row less, and the pane re-sizes reading
    // the tasks late: Claude withdraws the task meanwhile.
    world.slowRead = 'tasks'
    world.readMs = 500
    const typing = ui.input({ key: 'answer-1', text: 'Two failures', kind: 'change' })
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
    await ui.press({ key: 'answer' })
    const rows = world.opens.at(-1)?.rows ?? 0

    // The answer takes a row more, and the surface says late, as it was when
    // asked, that the pane is open: Claude withdraws the task meanwhile.
    world.panesMs = 500
    const typing = ui.input({ key: 'answer-1', text: 'Two failures: LoginTests.testExpiredToken and CartTests.testCouponRounding', kind: 'change' })
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
    await ui.press({ key: 'answer' })

    world.panesMs = 500
    const typing = ui.input({ key: 'answer-1', text: 'Two failures: LoginTests.testExpiredToken and CartTests.testCouponRounding', kind: 'change' })
    await clock.advance(1)
    await ui.press({ key: 'hide' })
    await clock.advance(500)
    await typing
    await clock.settle()

    expect(world.isPaneOpen).toBe(false)
  })

  test('every open task shows its whole title, wrapping, with its age after it in the same text', async ($, on) => {
    seat(on, earlier([INSTRUMENTS, XCODE_LONG]))
    await start($)

    const ui = await $.ui.mount(inline(32))
    // The question is drawn first, so it is the one selected.
    const selected = await ui.find({ type: 'Text', text: /Run xcodebuild/ })
    const other = await ui.find({ type: 'Text', text: /Open Instruments/ })

    expect(selected?.props.wrap).toBe('wrap')
    expect(selected?.text).toBe(`#2 ${XCODE_LONG.title}  3m`)
    expect(other?.props.wrap).toBe('wrap')
    expect(other?.text).toBe(` ${INSTRUMENTS.title}  3m`)
    expect((await ui.find({ type: 'Button', key: 'select-1' }))?.props.label).toBe('#1')
  })

  test('a title past 80 characters, an older version left, is drawn whole', async ($, on) => {
    const title = `Rotate the deploy key ${'and check every runner that holds it '.repeat(3).trim()}`
    seat(on, earlierItems(asItems([{ ...INSTRUMENTS, title }, { ...XCODE_LONG, title }]).map(item => (item.id === 2 ? movedBy(item, DONE_PRESS, NOW) : item))))
    await start($)

    const ui = await $.ui.mount(inline(32))

    expect(title.length).toBeGreaterThan(80)
    expect(await textOf(ui, 'task-1')).toContain(title)
    expect(await textOf(ui, 'saved-2')).toContain(`#2 ${title} · not sent yet`)
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
    // At 28 columns Claude Code 2.1.296 squeezes `⏎ send` under the empty field: 12 rows in all.
    const ui = await $.ui.mount(inline(24))
    await ui.press({ key: 'answer' })
    expect(world.opens.at(-1)?.rows).toBe(13)

    // A short answer leaves the hint room on its row.
    await ui.input({ key: 'answer-2', text: 'abc', kind: 'change' })
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(12)

    await ui.input({ key: 'answer-2', text: 'abcdefghijk', kind: 'change' })
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(13)
  })

  test('an empty field in a narrow pane, hidden and opened again, takes the ring and asks for the row it squeezes onto', async ($, on) => {
    const { world, clock } = seat(on, earlier([{ ...XCODE_LONG, title: 'Paste the failures', why: "I can't run Xcode." }]))
    await start($)

    await runTasks($)
    const ui = await $.ui.mount(inline(24))
    await ui.press({ key: 'answer' })
    // Out of the keys, the field draws no hint: one row.
    await $.ui.focus(ringTo('long'))
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(12)

    // Hidden and opened again, the field's autoFocus takes the ring, and `⏎ send` squeezes under it.
    await ui.press({ key: 'hide' })
    await ui.unmount()
    await runTasks($)
    await $.ui.mount(inline(24))
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(13)
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
    await ui.press({ key: 'answer' })
    const phone = await $.ui.mount({ ...PANE, surface: 'mobile' })

    expect(await ui.find({ type: 'Input' })).toBeDefined()
    expect((await phone.findAll({ type: 'Button' })).map(button => button.props.label)).toEqual(['Done', 'Later', 'Hide'])
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

describe('the answer field', () => {
  test("Answer… opens a field of the task's own, labelled for the terminal to add its colon", async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(ANDROID_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })

    expect((await ui.find({ type: 'Input', key: 'answer-1' }))?.props.label).toBe('Answer')
  })

  test("a draft stays with its task: another task's field opens empty, and the first keeps its own", async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(ANDROID_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'LoginTests.testExpiredToken failed', kind: 'change' })
    await ui.press({ key: 'select-2' })
    await ui.press({ key: 'answer' })

    expect((await ui.find({ type: 'Input', key: 'answer-2' }))?.props.value).toBe('')

    await ui.press({ key: 'select-1' })
    await ui.press({ key: 'answer' })

    expect((await ui.find({ type: 'Input', key: 'answer-1' }))?.props.value).toBe('LoginTests.testExpiredToken failed')
  })

  test('a held answer comes back to its field on Edit', async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: KEY_SHAPED, kind: 'change' })
    await ui.input({ key: 'answer-1', text: KEY_SHAPED })
    await ui.press({ key: 'edit' })

    expect((await ui.find({ type: 'Input', key: 'answer-1' }))?.props.value).toBe(KEY_SHAPED)
  })

  test('typed in, the field keeps the value it opened with: one drawn anew puts its text back, keys typed since lost', async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'LoginTests', kind: 'change' })
    // The pane draws again while the user types: Claude adds another item.
    await $.tool.call(ANDROID_TASK)

    expect((await ui.find({ type: 'Input', key: 'answer-1' }))?.props.value).toBe('')
  })

  test('hidden and opened again, the field holds what was typed in it', async ($, on) => {
    const { clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'Use the staging creds', kind: 'change' })
    await clock.settle()
    await ui.press({ key: 'hide' })
    await ui.unmount()
    await runTasks($)
    const again = await $.ui.mount(PANE)

    expect((await again.find({ type: 'Input', key: 'answer-1' }))?.props.value).toBe('Use the staging creds')
  })

  test("hidden and opened again while the engine can't list its panes, the field holds what was typed in it", async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'Use the staging creds', kind: 'change' })
    await clock.settle()
    await ui.press({ key: 'hide' })
    await ui.unmount()
    world.isPanesFailing = true
    await runTasks($)
    const again = await $.ui.mount(PANE)

    expect((await again.find({ type: 'Input', key: 'answer-1' }))?.props.value).toBe('Use the staging creds')
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
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'Use the staging creds', kind: 'change' })
    await clock.settle()
    await $.session.attach({ surface: 'desktop', clientId: 'laptop' })
    const laptop = await $.ui.mount({ ...PANE, surface: 'desktop' })
    // The pane draws again: Claude adds another item.
    await $.tool.call(ANDROID_TASK)

    expect((await laptop.find({ type: 'Input', key: 'answer-1' }))?.props.value).toBe('Use the staging creds')
    expect((await ui.find({ type: 'Input', key: 'answer-1' }))?.props.value).toBe('')
  })

  test('a second client of a surface draws the field with what is typed in it', async ($, on) => {
    const { clock } = seat(on)
    await start($)
    await $.session.attach({ surface: 'desktop', clientId: 'laptop' })

    await $.tool.call(XCODE_TASK)
    const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await desktop.press({ key: 'answer' })
    await desktop.input({ key: 'answer-1', text: 'Use the staging creds', kind: 'change' })
    await clock.settle()
    // The desktop app opens on another computer, and draws the pane.
    await $.session.attach({ surface: 'desktop', clientId: 'office' })
    await desktop.redraw()

    expect((await desktop.find({ type: 'Input', key: 'answer-1' }))?.props.value).toBe('Use the staging creds')
  })

  test('typed in, the field asks for the rows its text wraps to, and for one row less once the keys leave it', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(inline(60))
    // The field takes the keys as it opens.
    await ui.press({ key: 'answer' })
    const rows = world.opens.at(-1)?.rows ?? 0

    // 45 columns for the text beside `Answer: ` and ` ⏎ send`, one kept for the cursor: three rows.
    await ui.input({
      key: 'answer-1',
      text: 'LoginTests.testExpiredToken failed, and CartTests.testCouponRounding failed with a rounding error',
      kind: 'change',
    })
    expect(world.opens.at(-1)?.rows).toBe(rows + 2)

    // Out of the keys, the text is cut to one row; the label, squeezed, wraps onto a second.
    await ui.redraw({ ...inline(60).props, isFocused: false })
    expect(world.opens.at(-1)?.rows).toBe(rows + 1)

    // Back in them, the ring is where it was.
    await ui.redraw(inline(60).props)
    expect(world.opens.at(-1)?.rows).toBe(rows + 2)

    // Tab moves the keys on, and Shift+Tab brings them back.
    await $.ui.focus(ringTo('other-way'))
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(rows + 1)

    await $.ui.focus(ringTo('answer-1'))
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(rows + 2)
  })

  test('the ring taken by the field unseen, as the pane opens again or a key is typed there, the field asks for the rows its text wraps to', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(inline(60))
    await ui.press({ key: 'answer' })
    const rows = world.opens.at(-1)?.rows ?? 0
    await ui.input({
      key: 'answer-1',
      text: 'LoginTests.testExpiredToken failed, and CartTests.testCouponRounding failed with a rounding error',
      kind: 'change',
    })
    await $.ui.focus(ringTo('long'))
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(rows + 1)

    // Hidden and opened again, the field's autoFocus takes the ring.
    await ui.press({ key: 'hide' })
    await ui.unmount()
    await runTasks($)
    const again = await $.ui.mount(inline(60))
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(rows + 2)

    // A key typed in the field says the ring is there.
    await $.ui.focus(ringTo('long'))
    await clock.settle()
    await again.input({ key: 'answer-1', text: 'LoginTests.testExpiredToken failed, and CartTests.testCouponRounding failed with rounding', kind: 'change' })
    expect(world.opens.at(-1)?.rows).toBe(rows + 2)
  })

  test('opened again, a field takes the ring and asks for the rows its draft wraps to', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(inline(60))
    await ui.press({ key: 'answer' })
    const rows = world.opens.at(-1)?.rows ?? 0
    await ui.input({
      key: 'answer-1',
      text: 'LoginTests.testExpiredToken failed, and CartTests.testCouponRounding failed with a rounding error',
      kind: 'change',
    })
    await $.ui.focus(ringTo('other-way'))
    await clock.settle()
    expect(world.opens.at(-1)?.rows).toBe(rows + 1)

    await ui.press({ key: 'cancel' })
    await ui.press({ key: 'answer' })
    expect(world.opens.at(-1)?.rows).toBe(rows + 2)
  })

  test('a key typed as a move of the ring re-sizes the pane, the pane asks for the rows the key leaves', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(inline(60))
    await ui.press({ key: 'answer' })
    const rows = world.opens.at(-1)?.rows ?? 0
    await ui.input({ key: 'answer-1', text: 'LoginTests.testExpiredToken failed, and CartTests.testCouponRounding failed', kind: 'change' })
    expect(world.opens.at(-1)?.rows).toBe(rows + 1)

    // Tab moves the keys on, and that re-size reads slowly once it has the
    // draft; the person comes back to the field and types meanwhile.
    world.slowRead = 'isWorking'
    world.readMs = 100
    await $.ui.focus(ringTo('other-way'))
    await clock.settle()
    const typing = ui.input({
      key: 'answer-1',
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
    await ui.press({ key: 'answer' })

    expect((await ui.find({ type: 'Input', key: 'answer-1' }))?.props.placeholder).toBe('Enter sends it t…')
  })
})

describe('responding', () => {
  test('Done while Claude is idle is sent to Claude as a message, and the pane closes', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'done' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toHaveLength(1)
    expect(world.submitted[0]).toBe('My response to an item you gave me (Open items):\n\n#1 Add STRIPE_SECRET_KEY to .env: Done.')
    expect(world.isPaneOpen).toBe(false)
    expect(world.status).toBeUndefined()
  })

  test('an answer while Claude works is saved, and goes when its turn ends', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)

    await ui.press({ key: 'answer' })
    expect((await ui.find({ type: 'Input', key: 'answer-1' }))?.props.placeholder).toBe('Enter saves it; Claude gets it when this turn ends')
    await ui.input({ key: 'answer-1', text: 'LoginTests.testExpiredToken failed' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toHaveLength(0)
    expect(world.appended).toHaveLength(0)
    expect(await textOf(ui, 'saved-1')).toContain('not sent yet')
    // The pane has the room to say what is not sent; the status line says it short.
    expect(await textOf(ui, 'head')).toContain('✓ 1 response not sent yet')
    expect(world.status).toBe('✓ 1 not sent yet · /open-items')

    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()

    expect(world.submitted).toEqual([
      'My response to an item you gave me (Open items):\n\n#1 Run xcodebuild test on your Mac, paste the failures:\nLoginTests.testExpiredToken failed',
    ])
    expect(world.status).toBeUndefined()
  })

  test('with a task still open, a saved answer waits for it, or rides along with the next prompt', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(KEY_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)

    await ui.press({ key: 'answer' })
    expect((await ui.find({ type: 'Input', key: 'answer-1' }))?.props.placeholder).toBe('Enter saves it; Claude gets it with your other answers')
    await ui.input({ key: 'answer-1', text: 'LoginTests.testExpiredToken failed' })
    await clock.advance(1000)
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()

    expect(world.submitted).toHaveLength(0)
    expect(world.status).toBe('☐ 1 action · 1 not sent yet · /open-items')

    const next = await $.prompt.submit(typed('now the cart'))

    expect(next.context?.[0]).toContain('#1 open: Run xcodebuild test on your Mac, paste the failures.')
    expect(next.context?.[0]).toContain('LoginTests.testExpiredToken failed')
  })

  test('a saved answer riding a typed prompt that a hook beneath drops waits for the next one', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(KEY_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'LoginTests.testExpiredToken failed' })
    await clock.advance(1000)
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()

    world.refusingTyped = 'Blocked by your organization.'
    const blocked = await $.prompt.submit(typed('now the cart'))

    expect(blocked.drop).toBe('Blocked by your organization.')
    // The engine shows why the prompt didn't enter; the answer waits, as it did.
    expect(world.toasts).toEqual([])
    expect(world.status).toBe('☐ 1 action · 1 not sent yet · /open-items')

    world.refusingTyped = undefined
    const next = await $.prompt.submit(typed('now the cart'))

    expect(next.context?.[0]).toContain('LoginTests.testExpiredToken failed')
    expect(world.status).toBe('☐ 1 action · /open-items')
  })

  test('a saved answer that a hook beneath takes out of a typed prompt waits for the next one, and a toast says so', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(KEY_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'LoginTests.testExpiredToken failed' })
    await clock.advance(1000)
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()

    world.isStripping = true
    const stripped = await $.prompt.submit(typed('now the cart'))

    expect(stripped.context).toBeUndefined()
    expect(world.toasts.at(-1)).toBe("Claude didn't get your response to #1: a hook took it out of the prompt. It's saved; press Send now in /open-items.")
    expect(world.status).toBe('☐ 1 action · 1 not sent yet · /open-items')

    world.isStripping = false
    const next = await $.prompt.submit(typed('now the cart'))

    expect(next.context?.[0]).toContain('LoginTests.testExpiredToken failed')
  })

  test('a saved answer a hook beneath takes out of a typed prompt that quotes its head still waits for the next one', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(KEY_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'LoginTests.testExpiredToken failed' })
    await clock.advance(1000)
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()

    world.isStripping = true
    const stripped = await $.prompt.submit(typed('Earlier you wrote "#1 open: Run xcodebuild test on your Mac, paste the failures." Why?'))

    expect(stripped.context).toBeUndefined()
    expect(world.status).toBe('☐ 1 action · 1 not sent yet · /open-items')
  })

  test('a saved answer that a hook beneath rewrites as it rides a typed prompt reaches Claude', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(KEY_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'LoginTests.testExpiredToken failed with token abc123' })
    await clock.advance(1000)
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()

    world.rewriting = text => text.replace('abc123', '******')
    const next = await $.prompt.submit(typed('now the cart'))

    expect(next.context?.[0]).toContain('LoginTests.testExpiredToken failed with token ******')
    expect(world.toasts).toEqual([])
    expect(world.status).toBe('☐ 1 action · /open-items')
  })

  test('of two saved answers riding a typed prompt, the one a hook beneath takes out waits for the next', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(PAGING_TASK)
    await $.tool.call(KEY_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'LoginTests.testExpiredToken failed' })
    await ui.press({ key: 'option-1' })
    await clock.advance(1000)
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()

    // A hook beneath cuts #2's line out of what rides along.
    world.rewriting = text => text.split('\n').filter(line => !line.startsWith('#2 ')).join('\n')
    const next = await $.prompt.submit(typed('now the cart'))

    expect(next.context?.[0]).toContain('LoginTests.testExpiredToken failed')
    expect(next.context?.[0]).not.toContain('#2 ')
    expect(world.toasts.at(-1)).toBe("Claude didn't get your response to #2: a hook took it out of the prompt. It's saved; press Send now in /open-items.")
    expect(world.status).toBe('☐ 1 action · 1 not sent yet · /open-items')

    world.rewriting = undefined
    const again = await $.prompt.submit(typed('and the docs'))

    expect(again.context?.[0]).toContain('#2 resolved: Pick a pagination strategy for /feed. The user chose: Cursor')
    expect(again.context?.[0]).not.toContain('LoginTests.testExpiredToken failed')
  })

  test('a response a hook beneath takes out of the message that wakes Claude waits for Send now: the turn that message starts ends without sending it again', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    // A hook beneath masks the key's name in every prompt, the plugin's own among them.
    world.masking = text => text.replaceAll('STRIPE_SECRET_KEY', '*****')
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'done' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toHaveLength(1)
    expect(world.toasts.at(-1)).toBe("Claude didn't get your response to #1: a hook took it out of the prompt. It's saved; press Send now in /open-items.")

    // The turn that message starts ends, and another after it.
    for (const turnId of ['t1', 't2']) {
      await $.turn.start({ text: '', turnId })
      await $.turn.complete({ ...DONE, turnId })
      await clock.settle()
    }

    expect(world.submitted).toHaveLength(1)
    expect(world.status).toBe('✓ 1 not sent yet · /open-items')

    world.masking = undefined
    await ui.press({ key: 'send-1' })
    await clock.settle()

    expect(world.submitted).toHaveLength(2)
    expect(world.status).toBeUndefined()
  })

  test('a typed prompt that fails beneath keeps its own error, and its answer waits, though the store fails too', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(KEY_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'LoginTests.testExpiredToken failed' })
    await clock.advance(1000)
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()

    world.isTypedFailing = true
    world.isStoreFailing = true
    await expect($.prompt.submit(typed('now the cart'))).rejects.toThrow('no implementation for prompt.submit')

    expect(world.toasts.at(-1)).toContain("Claude didn't get your response to #1: no implementation for prompt.submit")
    expect(world.toasts.at(-1)).toContain("It's saved; press Send now in /open-items.")
    expect(world.status).toBe('☐ 1 action · 1 not sent yet · /open-items')

    world.isTypedFailing = false
    world.isStoreFailing = false
    const next = await $.prompt.submit(typed('now the cart'))

    expect(next.context?.[0]).toContain('LoginTests.testExpiredToken failed')
  })

  test("of two saved responses, the first row's Send now answers s and the other a click", async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(PAGING_TASK)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'Two failures' })
    await ui.press({ key: 'option-1' })

    expect((await ui.find({ type: 'Button', key: 'send-1' }))?.props.hotkey).toBe('s')
    expect((await ui.find({ type: 'Button', key: 'send-2' }))?.props.hotkey).toBeUndefined()
  })

  test('Send now while Claude works reaches it in the turn', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)

    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'CartTests.testCouponRounding', kind: 'change' })
    await ui.press({ key: 'other-way' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.appended.map(row => row.type)).toEqual(['user', 'system'])
    expect(world.appended[0]?.text).toContain('CartTests.testCouponRounding')
    expect(world.appended[1]?.text).toBe('Sent your response to #1 to Claude')
    expect(world.toasts).toHaveLength(0)

    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()

    // Claude has the row already, so the answer doesn't go again; but no step
    // read it before the turn ended, so a one-line prompt wakes Claude for it.
    expect(world.submitted).toEqual(['I answered an item while you were finishing your reply; my answer is above.'])
  })

  test('a prompt typed while Send now joins the turn carries no second copy of the answer', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(KEY_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'LoginTests.testExpiredToken failed' })
    await clock.advance(1000)

    // The row takes a moment to join the conversation, and the user types meanwhile.
    world.appendMs = 500
    await ui.press({ key: 'send-1' })
    await clock.settle()
    const typedMeanwhile = await $.prompt.submit(typed('and the cart', 't1'))
    await clock.advance(500)

    expect(typedMeanwhile.context).toBeUndefined()
    expect(world.appended.filter(row => row.type === 'user')).toHaveLength(1)
    expect(world.status).toBe('☐ 1 action · /open-items')
  })

  test('Send now that the running turn refuses goes the moment the turn ends', async ($, on) => {
    const { world, clock } = seat(on)
    world.refusingRows = 'No conversation to append to.'
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)

    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'CartTests.testCouponRounding', kind: 'change' })
    await ui.press({ key: 'other-way' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.toasts.at(-1)).toBe('Claude gets your response to #1 when it finishes this turn.')
    expect(world.appended).toHaveLength(0)
    expect(world.submitted).toHaveLength(0)

    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()

    expect(world.submitted).toHaveLength(1)
    expect(world.submitted[0]).toContain('CartTests.testCouponRounding')
  })

  test('Send now that the running turn refuses as it ends goes at once', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'CartTests.testCouponRounding', kind: 'change' })

    // The row is refused a moment after it goes, and the turn ends meanwhile.
    world.refusingRows = 'No conversation to append to.'
    world.appendMs = 500
    await ui.press({ key: 'other-way' })
    await clock.advance(800)
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.advance(500)
    await clock.settle()

    expect(world.submitted).toHaveLength(1)
    expect(world.submitted[0]).toContain('CartTests.testCouponRounding')
    expect(world.status).toBeUndefined()
  })

  test('Send now pressed twice at once sends the answer once', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'LoginTests.testExpiredToken failed' })
    await clock.advance(1000)

    await Promise.all([ui.press({ key: 'send-1' }), ui.press({ key: 'send-1' })])
    await clock.settle()

    expect(world.appended.filter(row => row.type === 'user')).toHaveLength(1)
  })

  test("a response whose prompt doesn't enter stays saved, and Send now tries again", async ($, on) => {
    const { world, clock } = seat(on)
    world.refusing = 'Another plugin held the prompt.'
    await start($)

    await $.tool.call(KEY_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'done' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toHaveLength(0)
    expect(world.toasts.at(-1)).toBe(
      "Claude didn't get your response to #1: Another plugin held the prompt. It's saved; press Send now in /open-items.",
    )
    expect(world.status).toBe('✓ 1 not sent yet · /open-items')

    world.refusing = undefined
    await runTasks($)
    await ui.press({ key: 'send-1' })
    await clock.settle()

    expect(world.submitted).toEqual(['My response to an item you gave me (Open items):\n\n#1 Add STRIPE_SECRET_KEY to .env: Done.'])
    expect(world.status).toBeUndefined()
  })

  test('an answer that looks like a secret is held', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: KEY_SHAPED })
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
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'x'.repeat(4001) })
    await clock.advance(1000)
    await clock.settle()

    expect(world.toasts.at(-1)).toContain('4001 characters')
    expect(world.toasts.at(-1)).toContain('the most is 4000')
    expect(world.submitted).toEqual([])
    expect(itemOf(world, 1)?.thread).toHaveLength(1)
    expect(await ui.find({ type: 'Input', key: 'answer-1' })).toBeDefined()
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
    const { world } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'Two failures' })

    const listed = await $.tool.call({ tool: LIST })
    expect(String((listed as { result?: unknown }).result)).toContain('Two failures')
    expect(world.status).toBeUndefined()
  })

  test('list_items for one item marks only that one heard', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(PAGING_TASK)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'Two failures' })
    await ui.press({ key: 'option-1' })

    expect(world.status).toBe('✓ 2 not sent yet · /open-items')

    const listed = await $.tool.call({ tool: LIST, id: 1 })
    expect(String((listed as { result?: unknown }).result)).toContain('Two failures')
    expect(world.status).toBe('✓ 1 not sent yet · /open-items')
  })

  test('a response that comes in while list_items reads is not marked heard: it goes later', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(KEY_TASK)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'Two failures' })
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
    expect(world.status).toBe('✓ 1 not sent yet · /open-items')

    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()

    expect(world.submitted).toEqual(['My response to an item you gave me (Open items):\n\n#2 Add STRIPE_SECRET_KEY to .env: Done.'])
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
    await ui.press({ key: 'done' })
    await clock.advance(500)

    expect(((await withdrawn) as { deny?: string }).deny).toBe('Item #1 is already resolved; there is nothing to close.')
    expect(world.toasts).toEqual([])

    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()

    expect(world.submitted).toEqual(['My response to an item you gave me (Open items):\n\n#1 Add STRIPE_SECRET_KEY to .env: Done.'])
  })

  test('a press from a render older than a withdraw leaves the task withdrawn, and a toast says so', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
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

  test('Save for later with nothing typed asks for an answer, or, pressed as Claude withdraws its task, says the task is gone', async ($, on) => {
    const { world } = seat(on)
    const held = holdingPresses(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(ANDROID_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.press({ key: 'other-way' })

    expect(world.toasts.at(-1)).toBe('Type an answer first, or press Cancel.')

    held.isOn = true
    const pressed = ui.press({ key: 'other-way' })
    await $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn' })
    held.letGo()
    await pressed

    expect(world.toasts.at(-1)).toBe("Item #1 isn't open any more, so your response wasn't saved.")
  })

  test('Save for later pressed as Claude withdraws its task puts what was typed in the prompt box', async ($, on) => {
    const { world, clock } = seat(on)
    const held = holdingPresses(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(ANDROID_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'LoginTests.testExpiredToken failed', kind: 'change' })
    await clock.settle()
    // Save for later reaches its button as Claude withdraws the task, the
    // draft gone with it, before the drawing that withdraw wakes.
    held.isOn = true
    const pressed = ui.press({ key: 'other-way' })
    await $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn' })
    held.letGo()
    await pressed

    expect(world.toasts.at(-1)).toBe("Item #1 isn't open any more, so your response wasn't saved. What you typed is in the prompt box.")
    expect(world.composer).toBe('LoginTests.testExpiredToken failed')
  })

  test('Long answer… pressed as Claude withdraws its task says the task is gone, and puts what was typed in the prompt box', async ($, on) => {
    const { world, clock } = seat(on)
    const held = holdingPresses(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(ANDROID_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'LoginTests.testExpiredToken failed', kind: 'change' })
    await clock.settle()
    held.isOn = true
    const pressed = ui.press({ key: 'long' })
    await $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn' })
    held.letGo()
    await pressed

    expect(world.toasts.at(-1)).toBe("Item #1 isn't open any more, so your response wasn't saved. What you typed is in the prompt box.")
    expect(world.composer).toBe('LoginTests.testExpiredToken failed')
  })

  test('a title pressed as Claude withdraws its task leaves the field open on another task', async ($, on) => {
    const { world, clock } = seat(on)
    const held = holdingPresses(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(ANDROID_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'select-2' })
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-2', text: 'Pixel 8 passes', kind: 'change' })
    await clock.settle()
    held.isOn = true
    const pressed = ui.press({ key: 'select-1' })
    await $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn' })
    held.letGo()
    await pressed

    expect(await ui.find({ type: 'Input', key: 'answer-2' })).toBeDefined()
    expect(world.toasts.at(-1)).toBe('Claude withdrew the item: Run xcodebuild test on your Mac, paste the failures')
  })

  test('Save for later pressed as the same answer lands from the prompt box says nothing, as a second press does', async ($, on) => {
    const { world, clock } = seat(on)
    const held = holdingPresses(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(ANDROID_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'Two failures', kind: 'change' })
    await clock.settle()
    held.isOn = true
    const pressed = ui.press({ key: 'other-way' })
    await $.prompt.submit(typed('↳ Answer to #1: Two failures'))
    held.letGo()
    await pressed

    expect(world.toasts).toEqual([])
    expect(world.composer).toBe('')
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
    await ui.press({ key: 'answer' })
    isHeld = true
    const entered = ui.input({ key: 'answer-1', text: KEY_SHAPED })
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
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'LoginTests.testExpiredToken failed', kind: 'change' })
    await ui.press({ key: 'cancel' })
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
    // Offset reads the task list late: Cursor lands meanwhile.
    world.slowRead = 'tasks'
    world.readMs = 500
    const pressed = ui.press({ key: 'option-2' })
    await clock.advance(1)
    await ui.press({ key: 'option-1' })
    await clock.advance(500)
    await pressed
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()

    expect(world.submitted).toEqual(['My response to an item you gave me (Open items):\n\n#1 Pick a pagination strategy for /feed: I chose "Cursor".'])
    expect(world.toasts).toEqual(["Item #1 isn't open any more, so your response wasn't saved."])
  })

  test('the same press twice from one render answers once, says nothing, and holds back no batch under way', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(PAGING_TASK)
    const ui = await $.ui.mount(PANE)
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
    expect(world.ops).toEqual(['set session:session-1'])

    await clock.advance(300)

    expect(world.submitted).toEqual(['My response to an item you gave me (Open items):\n\n#1 Pick a pagination strategy for /feed: I chose "Cursor".'])
    expect(world.toasts).toEqual([])
  })

  test("an answer typed for a task answered meanwhile on another surface isn't saved: a toast says so, and it goes to the prompt box", async ($, on) => {
    const { world, clock } = seat(on)
    world.composer = 'and check the cart'
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    const phone = await $.ui.mount({ ...PANE, surface: 'mobile' })
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'Two failures', kind: 'change' })
    await clock.settle()
    // The answer reads the task list late: Done on the phone lands meanwhile.
    world.slowRead = 'tasks'
    world.readMs = 500
    const answered = ui.input({ key: 'answer-1', text: 'Two failures' })
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

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    const phone = await $.ui.mount({ ...PANE, surface: 'mobile' })
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: KEY_SHAPED })
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

  test('Send now repeating an answer saved for later a moment before sends it', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'Two failures', kind: 'change' })
    await clock.settle()
    // Send now reads the task list late: Enter saves the same answer meanwhile.
    world.slowRead = 'tasks'
    world.readMs = 500
    const pressed = ui.press({ key: 'other-way' })
    await clock.advance(1)
    await ui.input({ key: 'answer-1', text: 'Two failures' })
    await clock.advance(500)
    await pressed
    await clock.advance(1000)
    await clock.settle()

    expect(world.appended.map(row => row.type)).toEqual(['user', 'system'])
    expect(world.appended[0]?.text).toContain('Two failures')
    expect(world.toasts).toEqual([])
  })
})

describe('long answers in the prompt box', () => {
  test('typed while Claude is idle, the prompt is the answer', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.press({ key: 'long' })
    expect(world.composer).toBe('↳ Answer to #1: ')

    const sent = await $.prompt.submit(typed('↳ Answer to #1: LoginTests.testExpiredToken\nCartTests.testCouponRounding'))

    expect(sent.text).toContain('#1 Run xcodebuild test on your Mac, paste the failures:\nLoginTests.testExpiredToken\nCartTests.testCouponRounding')
  })

  test('a draft goes with Long answer… into the prompt box, and the field opens empty after', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'LoginTests.testExpiredToken', kind: 'change' })
    await ui.press({ key: 'long' })

    expect(world.composer).toBe('↳ Answer to #1: LoginTests.testExpiredToken')

    await ui.press({ key: 'answer' })

    expect((await ui.find({ type: 'Input', key: 'answer-1' }))?.props.value).toBe('')
  })

  test('typed while Claude is idle and dropped by a hook beneath, the answer is kept to send', async ($, on) => {
    const { world } = seat(on)
    world.refusingTyped = 'Blocked by your organization.'
    await start($)

    await $.tool.call(XCODE_TASK)
    const blocked = await $.prompt.submit(typed('↳ Answer to #1: Two failures'))

    expect(blocked.drop).toBe('Blocked by your organization.')
    // The engine shows why; the toast says the answer is kept.
    expect(world.toasts.at(-1)).toBe("Claude didn't get your response to #1. It's saved; press Send now in /open-items.")
    expect(world.status).toBe('✓ 1 not sent yet · /open-items')
  })

  test('typed while Claude is idle and a response is about to go, the prompt carries both', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    // Done goes in a moment, with whatever else is pressed by then.
    await ui.press({ key: 'done' })
    world.setMs = 1000
    const sending = $.prompt.submit(typed('↳ Answer to #2: Two failures'))
    await clock.advance(3000)
    const sent = await sending
    await clock.settle()

    expect(sent.text).toContain('#1 Add STRIPE_SECRET_KEY to .env: Done.')
    expect(sent.text).toContain('#2 Run xcodebuild test on your Mac, paste the failures:\nTwo failures')
    expect(world.submitted).toEqual([])
  })

  test('typed while Claude is idle as Send now takes the same answer, it goes once', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    world.setMs = 1000
    const sending = $.prompt.submit(typed('↳ Answer to #2: Two failures'))
    await clock.settle()
    await ui.press({ key: 'send-2' })
    await clock.advance(3000)
    const sent = await sending
    await clock.settle()

    expect(sent.drop).toBe('Your answer to #2 already went to Claude.')
    expect(world.submitted).toEqual([
      'My response to an item you gave me (Open items):\n\n#2 Run xcodebuild test on your Mac, paste the failures:\nTwo failures',
    ])
  })

  test('typed while Claude works, it is saved instead of sent', async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const result = await $.prompt.submit(typed('↳ Answer to #1: Two failures', 't1'))

    expect(result.drop).toContain('Saved as your answer to #1')

    const listed = await $.tool.call({ tool: LIST })
    expect(String((listed as { result?: unknown }).result)).toContain('Two failures')
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

  test('handoff_items and take_items are not ready yet', async ($, on) => {
    seat(on)
    await start($)

    for (const call of [{ tool: HANDOFF }, { tool: TAKE, code: 'abc123' }] as const) {
      expect(((await $.tool.call(call)) as { deny?: string }).deny).toBe('Not ready yet.')
    }
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

    expect(world.status).toContain('1 not sent yet')
    expect(world.opens).toHaveLength(1)
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
    await (await $.ui.mount(PANE)).press({ key: 'option-1' })
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

    expect(world.status).toBe('☐ 1 question · 1 action · /open-items')
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

  test('after /clear the pane is empty and the first item is #1', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    await $.tool.call(XCODE_TASK)
    await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: { id: 'session-1' } })
    // The engine names the session /clear starts only once the end's hooks are done.
    world.sessionId = 'session-2'
    await clock.advance(1)

    expect(world.status).toBeUndefined()
    expect(world.isPaneOpen).toBe(false)

    const added = await $.tool.call(PAGING_TASK)

    expect(String((added as { result?: unknown }).result)).toContain('Added item #1')
    expect(world.store['session:session-1']).toEqual({
      version: 2,
      tasks: [expect.objectContaining({ id: 1, title: KEY_TASK.title }), expect.objectContaining({ id: 2, title: XCODE_TASK.title })],
      nextId: 3,
      savedMs: NOW,
      lastActiveMs: NOW,
      folder: '/repo',
      taken: [],
    })
    expect(world.store['session:session-2']).toEqual({
      version: 2,
      tasks: [expect.objectContaining({ id: 1, title: PAGING_TASK.title })],
      nextId: 2,
      savedMs: NOW + 1,
      lastActiveMs: NOW + 1,
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

  test('a resume into a session with no saved key shows nothing', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    await $.session.end({ reason: 'resume', sessionId: 'session-1', resume: { id: 'session-1' } })
    world.sessionId = 'session-2'
    await clock.advance(1)

    expect(world.status).toBeUndefined()
    expect(world.isPaneOpen).toBe(false)
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
    expect(await textOf(ui, 'task-7')).toContain(ROTATE.title)
    expect(await textOf(ui, 'task-1')).toBe('')

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
    expect(await textOf(ui, 'task-1')).toContain(KEY_TASK.title)
    expect(await textOf(ui, 'task-7')).toBe('')
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
    expect(await textOf(ui, 'task-7')).toBe('')
  })

  test('after /clear an answer saved for later stays with the session it was given in', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(KEY_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    // The answer's write takes a minute: it is still out as the session ends.
    world.setMs = 60_000
    const answered = ui.input({ key: 'answer-1', text: 'LoginTests.testExpiredToken failed' })
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
})

describe('the README example', () => {
  test('two answers while Claude works, the third after it stops, reach Claude as one message', async ($, on) => {
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
    await ui.press({ key: 'done' })
    expect(world.status).toBe('✓ 1 not sent yet · /open-items')

    await $.tool.call({
      tool: ADD,
      title: 'Decide whether to make the repo public',
      detail: 'npm will link to it, and its whole git history becomes public. I found no secrets in it.',
      kind: 'decision',
      options: ['Make it public', 'Keep it private'],
    })
    await ui.press({ key: 'option-1' })

    await $.tool.call({
      tool: ADD,
      title: "Choose the package's name on npm",
      detail: 'stripe-webhooks is taken. The name goes in package.json and the README.',
      kind: 'question',
    })
    expect(world.status).toBe('☐ 1 question · 2 not sent yet · /open-items')
    await clock.advance(1000)
    expect(world.submitted).toHaveLength(0)

    // #3 is still open when Claude stops, so #1 and #2 wait to go with it.
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()
    expect(world.submitted).toHaveLength(0)

    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-3', text: '@acme/stripe-hooks' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toEqual([
      [
        'My responses to items you gave me (Open items):',
        '',
        '#1 Add STRIPE_SECRET_KEY to .env: Done.',
        '',
        '#2 Decide whether to make the repo public: I chose "Make it public".',
        '',
        "#3 Choose the package's name on npm:",
        '@acme/stripe-hooks',
      ].join('\n'),
    ])
    expect(world.status).toBeUndefined()
  })
})

describe('knowing whether Claude works', () => {
  const BAND = {
    plugin: 'open-items',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} },
  } as const

  test('a turn another loop begins and ends under its agent id leaves Claude idle', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    await $.turn.start({ text: 'fix it', turnId: 't1' })
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await $.turn.start({ text: '', turnId: 'side' })
    await $.turn.complete({ ...DONE, turnId: 'side', agentId: 'side-request' })

    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'done' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toHaveLength(1)
  })

  test("the engine's word that no turn runs wins over a turn that never ended", async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    await $.turn.start({ text: '', turnId: 'never-ends' })
    const band = await $.ui.mount(BAND)
    await band.redraw({ ...BAND.props, isWorking: true })
    await band.redraw({ ...BAND.props, isWorking: false })
    await clock.advance(1)

    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'done' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toHaveLength(1)
    expect(await band.find({ key: 'engine' })).toBeDefined()
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

    const labelOf = async (key: string) => {
      const button = await ui.find({ type: 'Button', key })

      return `${button?.props.hotkey}: ${button?.props.label}`
    }

    expect(await labelOf('option-1')).toBe('1: Yes (recommended)')
    expect(await labelOf('option-2')).toBe('2: Not yet')
    expect(await labelOf('answer')).toBe('r: Other…')
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
    await ui.press({ key: 'option-1' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toEqual(['My response to an item you gave me (Open items):\n\n#1 Ship the feed rewrite this week: I chose "Yes".'])
  })

  test('an option resolves the decision, and its thread records the choice', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(DECISION)
    await (await $.ui.mount(PANE)).press({ key: 'option-2' })
    const task = itemOf(world, 1)

    expect(task?.state).toBe('resolved')
    expect(task?.thread.at(-1)).toEqual({ from: 'user', text: 'Not yet', event: 'chose', atMs: NOW })
    expect(task?.update).toBe('pending')
  })

  test('Done resolves the action, and its thread records it', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(KEY_TASK)
    await (await $.ui.mount(PANE)).press({ key: 'done' })
    const task = itemOf(world, 1)

    expect(task?.state).toBe('resolved')
    expect(task?.thread.at(-1)).toEqual({ from: 'user', text: '', event: 'done', atMs: NOW })
    expect(task?.update).toBe('pending')
  })

  test('Seen resolves the info item, its thread records it, and Claude hears nothing', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(INFO)
    await (await $.ui.mount(PANE)).press({ key: 'seen' })
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
    await ui.press({ key: 'later' })
    await clock.advance(1000)
    await clock.settle()
    const task = itemOf(world, 1)

    expect(task?.state).toBe('later')
    expect(task?.thread.at(-1)).toEqual({ from: 'user', text: '', event: 'later', atMs: NOW })
    expect(world.submitted).toEqual(['My response to an item you gave me (Open items):\n\n#1 Ship the feed rewrite this week: Later. Go on without it.'])
    // It stays, and keeps its options: the user can still answer it.
    expect(world.status).toBe('☐ 1 decision · /open-items')
    expect(await ui.find({ type: 'Button', key: 'option-1' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'later' })).toBeUndefined()
  })

  test('a reply keeps the item open, its thread holds the reply, and the item waits for Claude', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'Two failures' })
    await clock.advance(1000)
    await clock.settle()
    const task = itemOf(world, 1)

    expect(task?.state).toBe('open')
    expect(task?.isWaitingForClaude).toBe(true)
    expect(task?.thread.at(-1)).toEqual({ from: 'user', text: 'Two failures', atMs: NOW })
    expect(world.submitted).toEqual(['My response to an item you gave me (Open items):\n\n#1 Run xcodebuild test on your Mac, paste the failures:\nTwo failures'])
    expect(await textOf(ui, 'task-1')).toContain('waiting for Claude')
    expect(world.status).toBeUndefined()
  })

  test('a reply, then Done: the second message tells Claude of Done only', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'Two failures' })
    await clock.advance(1000)
    await clock.settle()
    await ui.press({ key: 'done' })
    await clock.advance(1000)
    await clock.settle()

    expect(world.submitted).toEqual([
      'My response to an item you gave me (Open items):\n\n#1 Run xcodebuild test on your Mac, paste the failures:\nTwo failures',
      'My response to an item you gave me (Open items):\n\n#1 Run xcodebuild test on your Mac, paste the failures: Done.',
    ])
  })

  test('Later, then an option: the second message tells Claude of the option only', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(DECISION)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'later' })
    await clock.advance(1000)
    await clock.settle()
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

    await $.tool.call(XCODE_TASK)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'Two failures' })
    await clock.advance(1000)
    await clock.settle()

    world.refusing = 'Another plugin held the prompt.'
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'And CartTests.testCouponRounding' })
    await clock.advance(1000)
    await clock.settle()
    world.refusing = undefined
    await ui.press({ key: 'send-1' })
    await clock.settle()

    expect(world.submitted).toEqual([
      'My response to an item you gave me (Open items):\n\n#1 Run xcodebuild test on your Mac, paste the failures:\nTwo failures',
      'My response to an item you gave me (Open items):\n\n#1 Run xcodebuild test on your Mac, paste the failures:\nAnd CartTests.testCouponRounding',
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

    expect(await textOf(ui, 'task-1')).toContain('Note number 1')
    expect(await textOf(ui, 'task-6')).toContain('Note number 6')
    expect(world.status).toBe('☐ 6 info · /open-items')
  })

  test('an unseen info item does not hold back saved answers at turn end', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.tool.call(INFO)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'LoginTests.testExpiredToken failed' })
    await clock.advance(1000)
    expect(world.submitted).toHaveLength(0)

    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()

    expect(world.submitted).toHaveLength(1)
    expect(world.submitted[0]).toContain('LoginTests.testExpiredToken failed')
    expect(world.submitted[0]).not.toContain('migration')
  })

  test('an info item stays out of the context Claude reads', async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(INFO)
    await $.tool.call(XCODE_TASK)
    const context = await $.prompt.context({ blocks: [] })

    const text = JSON.stringify(context)
    expect(text).toContain('Run xcodebuild test')
    expect(text).not.toContain('The migration ran clean')
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
    const text = await textOf(ui, 'tasks')
    const at = (needle: string) => text.indexOf(needle)

    const order = ['DECISIONS', DECISION.title, 'QUESTIONS', XCODE_TASK.title, 'INFO', INFO.title].map(at)
    expect(order.every(i => i >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(text).not.toContain('ACTIONS')
    expect(await textOf(ui, 'head')).toBe('☐ 1 decision · 1 question · 1 info')
  })

  test('after the selected item closes, the first decision is selected', async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(INFO)
    await $.tool.call(XCODE_TASK)
    await $.tool.call(DECISION)
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ type: 'Button', key: 'seen' })).toBeDefined()
    await ui.press({ key: 'seen' })

    expect(await ui.find({ type: 'Button', key: 'option-1' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'seen' })).toBeUndefined()
  })

  test('rows count the section headers', () => {
    const task = (id: number, kind: 'decision' | 'question' | 'info') => ({ ...ROTATE, id, kind, title: `Item number ${id}`, why: 'A reason.', ...(kind === 'decision' ? { options: ['Ship it', 'Hold'] } : {}) })
    const view = {
      shown: asItems([task(1, 'info'), task(2, 'question'), task(3, 'decision')]),
      selectedId: null,
      editing: null,
      draft: '',
      nowMs: NOW,
      isWorking: false,
      canType: true,
      isFocused: true,
      isTyping: false,
    }

    expect(rowsFor(view, 40, 99)).toBe(ROWS_THREE_KINDS)
    expect(rowsFor({ ...view, shown: asItems([task(2, 'question')]) }, 40, 99)).toBe(ROWS_ONE_KIND)
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

    await (await $.ui.mount(PANE)).press({ key: 'answer' })
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
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'Two failures' })
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
    expect(world.status).toBe('☐ 1 question · /open-items')
  })

  test("after Claude's reply, the user's next answer reaches Claude, in the same millisecond too", async ($, on) => {
    seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.prompt.submit(typed('↳ Answer to #1: Two failures'))
    await $.tool.call({ tool: REPLY, id: 1, text: 'Which test file are they in?' })
    const sent = await $.prompt.submit(typed('↳ Answer to #1: CartTests.swift'))

    expect(sent.text).toBe('My response to an item you gave me (Open items):\n\n#1 Run xcodebuild test on your Mac, paste the failures:\nCartTests.swift')
  })

  test('reply_item tells Claude of an answer the user gave meanwhile, which then is not sent again', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)

    await $.tool.call(XCODE_TASK)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'answer' })
    await ui.input({ key: 'answer-1', text: 'Two failures' })
    await clock.advance(1000)
    expect(world.submitted).toEqual([])

    const replied = resultOf(await $.tool.call({ tool: REPLY, id: 1, text: 'Which test file are they in?' }))
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()

    expect(replied.result).toContain('Two failures')
    expect(itemOf(world, 1)?.update).toBe('delivered')
    expect(world.submitted).toEqual([])
  })

  test('reply_item changes the options in place and logs a changed event', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await $.tool.call(DECISION)
    const changed = resultOf(await $.tool.call({ tool: REPLY, id: 1, options: ['Ship Tuesday', 'Ship Friday', 'Hold'], recommended: 'Ship Friday' }))
    const task = itemOf(world, 1)
    const ui = await $.ui.mount(PANE)

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
    await (await $.ui.mount(PANE)).press({ key: 'done' })

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
    await (await $.ui.mount(PANE)).press({ key: 'answer' })
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
