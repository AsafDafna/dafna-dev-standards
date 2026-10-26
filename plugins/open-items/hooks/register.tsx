import { atom, read, update } from 'claude-code'
import type { AgentStatus, EngineInterface, PromptSubmitResult, Register, RenderElement, RenderSurface, StateValue, Timer, ToolSpec } from 'claude-code'

import type { Editing, Saved, Task } from '../types'
import {
  DONE,
  LATER,
  MAX_NOTE,
  MAX_TITLE,
  SEEN,
  addedOf,
  answerIn,
  bridgeOf,
  choseOf,
  closedAs,
  contextOf,
  digestOf,
  hasAnswerIn,
  isActive,
  isOpenAsk,
  isRepeatOf,
  isShown,
  isUnanswered,
  listOf,
  looksSecret,
  messageOf,
  movedBy,
  newsHeadOf,
  newsOf,
  overLimitOf,
  ownHeadOf,
  parseAsk,
  parseClose,
  parseReply,
  repliedBy,
  replyErrorOf,
  replyOf,
  sameAsk,
  statusOf,
  toldOf,
  waitsOnUser,
} from './tasks'
import type { Move } from './tasks'
import {
  ANSWER_LABEL,
  BUTTON_GAP,
  HELD,
  HIDE,
  MAX_SHOWN_TITLE,
  actionsOf as actionsFor,
  ageOf,
  answerButtonsOf,
  answerPlaceholderOf,
  detailOf,
  doneWhenOf,
  fieldKeyOf,
  firstOf,
  groupsOf,
  headlineOf,
  hintOf,
  nameOf,
  placeholderOf,
  rowsFor,
  savedOf,
  selectedOf,
  sendNowOf,
  submitLabelOf,
  titleOf,
  unsentOf,
} from './pane'
import type { PaneView } from './pane'
import { isExpired, isSavedKey, keyOf, savedIn, trimmed } from './saved'
import { numbersOf, printable } from './text'

const PLUGIN = 'open-items'

/** An ask alerts only when the person has been quiet this long. */
const ALERT_QUIET_MS = 120_000

const ADD = 'mcp__open-items__add_item'
const REPLY = 'mcp__open-items__reply_item'
const CLOSE = 'mcp__open-items__close_item'
const LIST = 'mcp__open-items__list_items'
const HANDOFF = 'mcp__open-items__handoff_items'
const TAKE = 'mcp__open-items__take_items'

/** The hand-off pair waits behind ToolSearch: the hand-off steps load it. */
const DEFERRED: readonly string[] = [HANDOFF, TAKE]

/** The states of an agent whose work has not ended: `pending` has not started, and `waiting` waits on background work of its own. */
const AT_WORK: readonly AgentStatus[] = ['pending', 'running', 'waiting']

/** How recent the user's last typed prompt is in a live chat. */
const LIVE_CHAT_MS = 300_000

const LIVE_CHAT = 'live chat: ask in the chat'

/** Ends `add_item`'s result when the live-chat gate cannot tell whether background work runs. */
const LIVE_CHAT_NOTE = 'This looks like a live chat: if the user is here and replying, withdraw it with close_item and ask in the chat.'

/**
 * A short copy of the rules the tool descriptions carry, at the end of the
 * system prompt where it loads: on some seats only the descriptions reach Claude.
 */
const STEERING = [
  'Open items: while background agents, shell commands or monitors run, or after the user went quiet, put every ask for the user in their Open items pane with mcp__open-items__add_item. In a live chat, ask in the chat only.',
  'One item per ask: answer the user and change the item with reply_item, and close it with close_item when it is resolved. When the user answers in the chat instead, close it as withdrawn with the note "answered in chat".',
  'Before the session ends, resolve, record or hand off every open and Later item.',
  'If an Open items tool call fails, ask in the chat.',
].join('\n')

/** Resolutions pressed this close together go to Claude as one message. */
const BATCH_MS = 800

/** The longest a person, or Claude, waits on the store: what it doesn't answer by then finishes on its own. */
const STORE_WAIT_MS = 5000

/**
 * After /clear or a resume, how many times, this far apart, the new
 * session's id is read while the engine still names the one that ended.
 */
const NEW_ID_READS = 3
const NEW_ID_GAP_MS = 100

/** What a tool answers while the session's saved items are still being read at its start. */
const LOADING = "Open items is still loading this session's items. Try again in a moment."

/** The pane the items wait in, and the command that opens it. */
const PANE = 'open-items'
const PANE_TITLE = 'Open items'
const MAX_PANE_ROWS = 18

/** How a surface draws the pane: its body's width, whether it draws a field and holds the keys, and whether it seats the pane inline. */
type Seat = Pick<PaneView, 'canType' | 'isFocused'> & { columns: number; isInline: boolean }

/** What goes under the selected item: an open field, across the pane's body, and the buttons, in the item's indent. */
type Controls = readonly [field: RenderElement | null, buttons: RenderElement | null]

/** An 80-column terminal's main screen: the pane's seat until a surface draws it. */
const FIRST_SEAT: Seat = { columns: 76, canType: true, isFocused: false, isInline: true }

/** `seats` with `seat` among them: of seats alike but for their width, the narrowest stays, as it takes the most rows. */
function seatsWith(seats: readonly Seat[], seat: Seat): readonly Seat[] {
  const alike = seats.find(other => isAlike(other, seat))

  return alike !== undefined && alike.columns <= seat.columns ? seats : [...seats.filter(other => other !== alike), seat]
}

function isAlike(one: Seat, other: Seat): boolean {
  return one.canType === other.canType && one.isFocused === other.isFocused && one.isInline === other.isInline
}

const TOOLS: readonly ToolSpec[] = [
  {
    name: 'add_item',
    description: [
      "Put an item in the user's Open items pane. It stays there until the user acts on it. Their response reaches you as a message, or when you call list_items. An item does not block: you keep working while it waits.",
      '',
      'Kinds:',
      '- decision: the user picks one of 2 to 4 options. Mark the option you suggest with recommended.',
      "- question: you need the user's words (an error, a log, test results).",
      '- action: the user does something on their machine or on an account you cannot reach, then marks it done.',
      '- info: something the user must see (a failure, a finding that changes their plan). It asks nothing, and no response reaches you.',
      '',
      'When to add an item:',
      '- Add an item for every ask while background agents, shell commands or monitors run, or after the user went quiet. While background work runs, add the item and write no chat text about it until the batch ends.',
      '- In a live chat, ask in the chat only. A live chat is a back-and-forth: the user typed their last two prompts in the chat, the last one a short time ago, and no background work runs. There, add_item refuses with "live chat: ask in the chat".',
      "- Add only what is the user's: a decision that is theirs, a question only they can answer, an action only they can do, or a finding they must see. Ask no unnecessary questions.",
      '- One item per ask. Never add the same ask again: change the item in place with reply_item. list_items shows what is open.',
      '- When only the user\'s consent is missing (for example, to run a command), add a decision with options such as "Run it" and "Don\'t", not an action. Then one press lets you go on.',
      '- AskUserQuestion is the blocking kind: use it only for what you need before you can go on.',
      '',
      'How to write an item:',
      '- Write the title and the detail in plain, simple English. Make them self-contained, so the user understands them without the chat. Use no internal IDs.',
      '- Write the title as an imperative of under 80 characters. Put the rest in the detail.',
      '- Write numbers that are not item numbers without "#": "PR 787", not "#787". "#5" always means item 5.',
      '- The detail keeps its line breaks, up to 4000 characters. If you can publish artifact pages, put tables, diffs and long step lists on the one artifact page of the session, and give the URL of its section in link.',
      '- For a secret, ask the user to put it where it belongs and to mark the item done. Never ask them to paste it.',
      '',
      'Before the session ends, resolve, record or hand off every open and Later item. To record an item, write it and its state in the hand-off file or in the final summary of the session, then close it with close_item as withdrawn, with the note "recorded in <where>". To give the items to a new session, use handoff_items.',
      '',
      'If an Open items tool call fails, ask in the chat.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['decision', 'question', 'action', 'info'],
          description:
            "decision: the user picks one of the options. question: you need the user's words. action: the user does something and marks it done. info: something the user must see; it asks nothing.",
        },
        title: {
          type: 'string',
          description: 'What the user should do, as an imperative in plain English that is clear without the chat. Under 80 characters.',
        },
        detail: {
          type: 'string',
          description: 'What you need from the user and why, in full and self-contained. It keeps its line breaks, up to 4000 characters.',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 4,
          description: 'For decision only: 2 to 4 short options.',
        },
        recommended: {
          type: 'string',
          description: 'For decision only: the option you suggest, spelled exactly as in options.',
        },
        done_when: {
          type: 'string',
          description: "Optional, for action only: what counts as done. For a secret: \"It is in .env. Don't paste it here.\"",
        },
        link: {
          type: 'string',
          description: 'Optional: the URL of the section of the session\'s artifact page that holds the long detail.',
        },
      },
      required: ['kind', 'title', 'detail'],
    },
  },
  {
    name: 'reply_item',
    description: [
      "Add your message to the thread of an item, change the item in place, or both. The item stays open: a reply never closes it. The user reads the thread in their Open items pane.",
      '',
      '- When the user replies on an item, answer in the item with reply_item, not in the chat.',
      '- To change the ask, change the item in place: a new title, options, recommended option, done_when or link. Never add a new item for the same ask. Say in text why you changed it.',
      '- When the user answers in the chat instead of in the item, close the item with close_item as withdrawn, with the note "answered in chat".',
      '- When the user pressed Later, go on without the item. It stays in the pane until they act on it, and you can still reply on it.',
      '- Close the item with close_item when it is resolved.',
      '- Write in plain, simple English, self-contained, with no internal IDs. Write numbers that are not item numbers without "#".',
      '- text keeps its line breaks, up to 4000 characters. Put tables, diffs and long step lists on the artifact page of the session and give its URL in link.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: "The item's number." },
        text: { type: 'string', description: 'Your message to the user, up to 4000 characters. It keeps its line breaks.' },
        title: { type: 'string', description: 'A new title, under 80 characters.' },
        options: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 4,
          description: 'For a decision only: new options, 2 to 4. A recommended option that is not among them is dropped.',
        },
        recommended: { type: 'string', description: 'For a decision only: the option you suggest, spelled exactly as in its options.' },
        link: { type: 'string', description: 'A new URL for the long detail.' },
        done_when: { type: 'string', description: 'For an action: what counts as done, now.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'close_item',
    description: [
      "Close an item, so it leaves the user's Open items pane. The user sees your note.",
      '',
      '- as "resolved": the answer of the user in the thread settles the item. You can resolve an item only after the user wrote in its thread.',
      '- as "withdrawn": you no longer need the item (you found another way, or the plan changed), the user answered in the chat (note "answered in chat"), or you recorded it before the session ends (note "recorded in <where>").',
      '- When the user pressed an option or Done, the item is closed already. Do not close it again.',
      '- When the user replies, answer in the item with reply_item. Close the item when nothing more is needed: do not leave a settled item open.',
      '- When the user answers in the chat instead of in the item, close it as withdrawn with the note "answered in chat".',
      '- Before the session ends, resolve, record or hand off every open and Later item.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: "The item's number." },
        as: { type: 'string', enum: ['resolved', 'withdrawn'], description: 'resolved: the user answered it. withdrawn: you no longer need it.' },
        note: { type: 'string', description: 'One short line the user sees, up to 200 characters: "answered in chat", "recorded in <where>", or why.' },
      },
      required: ['id', 'as'],
    },
  },
  {
    name: 'list_items',
    description: [
      'List the items you gave the user: the state of each item, whether the user replied and waits for you, whether they opened your last reply, and the last 3 entries of its thread. With id, one item with its whole thread.',
      'Call it when you need the result of an item, when told an answer is saved for you, or before you add an item, so you do not add the same ask twice.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        show: {
          type: 'string',
          enum: ['updates', 'open', 'all'],
          description: 'updates (the default): open items and responses you have not seen. open: open and Later items only. all: every item of this session.',
        },
        id: { type: 'number', description: 'One item, with its whole thread, by its number.' },
      },
    },
  },
  {
    name: 'handoff_items',
    description: [
      'Mark every open and Later item for the session that takes over from this one. It returns how many items, and a short hand-off code.',
      'Call it before you start the new session. Put the code in the prompt of the new session; its first step calls take_items with the code. Without the code, no session can take the items.',
    ].join(' '),
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'take_items',
    description: [
      'Take the items a previous session handed off to this one, with the hand-off code from your prompt.',
      'It moves the items, with their threads, to this session, and gives you the number, kind, title and thread of each item and the answers you have not read.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'The hand-off code from your prompt.' },
      },
      required: ['code'],
    },
  },
]

const tasks = atom({ plugin: 'open-items', key: 'tasks' } as const, [] as readonly Task[])
const nextId = atom({ plugin: 'open-items', key: 'nextId' } as const, 1)
const selectedId = atom({ plugin: 'open-items', key: 'selectedId' } as const, null as number | null)
const editing = atom({ plugin: 'open-items', key: 'editing' } as const, null as Editing | null)
const restoredFor = atom({ plugin: 'open-items', key: 'restoredFor' } as const, null as string | null)
const folder = atom({ plugin: 'open-items', key: 'folder' } as const, null as string | null)
const isWorking = atom({ plugin: 'open-items', key: 'isWorking' } as const, false)
/** The remote clients attached, by surface, as the state's contract declares them. */
type Roster = StateValue<'open-items', 'clients'>
/** The roster, kept where a reload of the code finds it. */
const clients = atom({ plugin: 'open-items', key: 'clients' } as const, {} as Roster)

/**
 * Send now goes to Claude as a message (`auto` while it is idle), Save for
 * later waits (`auto` while it works) until its turn ends with every task
 * answered, a later answer while it is idle, or the user's next prompt.
 */
type How = 'auto' | 'now' | 'later'

/**
 * What a toast says when a prompt carrying updates is dropped: why (`why`,
 * the mod's own prompt, which the user didn't type), only that they're kept
 * (`kept`, an answer the user typed, whose drop the engine shows), or nothing
 * (`nothing`, the user's own prompt, which they rode: they wait as before).
 */
type DropNote = 'why' | 'kept' | 'nothing'

/** A prompt as it entered: its words, and the blocks that go beside them. */
type Entered = { text: string; context?: readonly string[] }

/** What the module tracks beside `$.state`; a hot reload starts it over. */
const live = {
  sessionId: '',
  /** When the person last typed a prompt or used the pane. */
  lastPersonMs: 0,
  /** An alert went out in the main loop's current turn; one per turn. */
  alertedTurn: false,
  /** A Send now row joined the running turn and no step has read it yet. */
  isUnread: false,
  /** A Send now the running turn could not take: it goes once the turn ends. */
  isSendingAtEnd: false,
  /** What the user has typed in each field so far, by `fieldKeyOf`. */
  drafts: new Map<string, string>(),
  /**
   * What was typed in each answer field as its task closed, by `fieldKeyOf`:
   * a button pressed on a drawing from before the task closed answers with it.
   */
  closed: new Map<string, string>(),
  /**
   * What each surface draws each field with, by `fieldKeyOf`: the draft as
   * the surface first drew it. It stays put while the field is typed in, as a
   * value drawn anew puts the field's text back to it, keys typed meanwhile
   * lost. A surface that forgets what its fields hold (the pane closed, or a
   * client of it came) draws them with the draft again.
   */
  drawn: new Map<RenderSurface, Map<string, string>>(),
  batch: null as Timer | null,
  /** How many sessions of the process have ended: a start read that lands after its session ended opens no pane. */
  ends: 0,
  /** Responses a prompt entered without, by `updateKeyOf`: they go with Send now, the next prompt or another response, never alone as a turn ends. */
  held: new Set<string>(),
  /** The session whose saved items are being read at its start: until the read settles, the tools refuse, as it replaces the items. */
  loading: null as string | null,
  /** The session whose start read failed: a write reads its key first, and writes only where none is saved. */
  unread: null as string | null,
  /** The store work asked for and not yet done: each piece waits for the one before. */
  queue: Promise.resolve() as Promise<unknown>,
  /** Store work a wait gave up on, not settled yet: while there is any, nothing waits on the store. */
  stalled: 0,
  /** The roster's writes asked for and not yet done: each waits for the one before (see `rostered`). */
  rosterQueue: Promise.resolve() as Promise<unknown>,
  /**
   * Turns begun and not yet ended. A loop other than main's (an engine side
   * request, a teammate) may begin one whose `turn.complete` carries an agent
   * id: each ends by its own id.
   */
  turns: new Set<string>(),
  /** Whether a turn runs, in the engine's own word (the band's `isWorking`), once it has said. */
  engineWorking: undefined as boolean | undefined,
  /**
   * How each surface drawing the pane draws it, by `e.surface`: as it last
   * did, or, drawn by two clients or more, every way since one came or went
   * (by `seatsWith`), since a render names no client.
   */
  seats: new Map<RenderSurface, readonly Seat[]>(),
  /** Surfaces a client left while others stay: the next drawing there starts their seats over. */
  startingOver: new Set<RenderSurface>(),
  /** How many times each surface's last client has left: a drawing under way as one did keeps no seat there. */
  emptied: new Map<RenderSurface, number>(),
  /** The key of the element the pane's focus ring last moved onto. */
  ring: undefined as string | undefined,
  /** The rows the pane last asked for. */
  rows: 0,
  /** How many times the mod closed the pane: a re-size under way leaves it closed (see `fit`). */
  closes: 0,
  /** The re-sizes keys and ring moves asked for and not yet done: each waits for the one before (see `refit`). */
  refitQueue: Promise.resolve() as Promise<unknown>,
  /** The user's last two inputs, oldest first: what `isLiveChat` reads. */
  inputs: [] as readonly UserInput[],
  /**
   * The ids of the main loop's background shell commands and monitors
   * started and not yet ended; null when the mod cannot know them, as it did
   * not see them all start.
   */
  background: null as Set<string> | null,
}

/** One of the user's inputs: a prompt typed in the chat, a long answer through the composer bridge, or a press in the pane. */
type UserInput = { kind: 'typed' | 'bridge' | 'press'; atMs: number }

function noteInput(kind: UserInput['kind'], atMs: number) {
  live.inputs = [...live.inputs, { kind, atMs }].slice(-2)
}

/**
 * Whether the user chats live with Claude, so `add_item` refuses: their last
 * two inputs were prompts typed in the chat, the last one under LIVE_CHAT_MS
 * ago, no agent is at work (AT_WORK), and no background shell command or
 * monitor runs. 'unknown' when the rest holds but what runs cannot be told.
 */
async function isLiveChat($: EngineInterface, nowMs: number): Promise<boolean | 'unknown'> {
  const [before, last] = live.inputs

  if (before?.kind !== 'typed' || last?.kind !== 'typed' || nowMs - last.atMs >= LIVE_CHAT_MS) {
    return false
  }

  const agents = await $.agent.list().catch(() => undefined)

  if (agents?.some(agent => AT_WORK.includes(agent.status))) {
    return false
  }

  return agents === undefined || live.background === null ? 'unknown' : live.background.size === 0
}

/**
 * Notes a background start that a Bash or Monitor result reports, in the
 * words of Claude Code 2.1.310. A start whose id cannot be read leaves what
 * runs unknown.
 */
function noteStart(tool: string, text: string | undefined) {
  if (text === undefined || live.background === null) {
    return
  }

  if (tool !== 'Monitor' && !(tool === 'Bash' && /^Command\b[^\n]*\bbackground/i.test(text))) {
    return
  }

  const id = (tool === 'Monitor' ? /^Monitor started \(task ([\w-]+)/ : /(?:with ID: |\(ID: )([\w-]+)/).exec(text)?.[1]
  live.background = id === undefined ? null : live.background.add(id)
}

/** Drops the tasks a notification reports ended: an end carries a status, a monitor's event none. */
function noteEnds(text: string) {
  for (const [, block = ''] of text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
    const id = /<task-id>([^<]+)<\/task-id>/.exec(block)?.[1]

    if (id !== undefined && block.includes('<status>')) {
      live.background?.delete(id)
    }
  }
}

/** The text of a tool's result row, unless the tool failed. */
function resultTextOf(content: readonly Record<string, unknown>[]): string | undefined {
  const block = content.find(one => one['type'] === 'tool_result')
  const inner = block?.['content']

  if (block === undefined || block['is_error'] === true) {
    return undefined
  }

  if (typeof inner === 'string') {
    return inner
  }

  return Array.isArray(inner) ? inner.map(part => (typeof part?.text === 'string' ? part.text : '')).join('\n') : undefined
}

/** Whether Claude is at work: the engine's word when it has given one, else the turns begun and not ended. */
function working(): boolean {
  return live.engineWorking ?? live.turns.size > 0
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const tool of TOOLS) {
      await $.tool.register(tool)
    }

    await $.command.register({ name: 'open-items', description: 'Show the items Claude gave you' })
    await update($, folder, known => known ?? e.cwd)
    // Background tasks may have started unseen in a conversation that holds
    // rows already (a resume, or the mod loaded mid-session), or before a
    // reload of the code, which finds the session read (see `takeUp`).
    const isReload = (await read($, restoredFor)) === (await $.session.id())
    const isFresh = !isReload && (await $.session.messages().then(rows => rows.length === 0, () => false))
    live.background = isFresh ? new Set() : null
    live.inputs = []
    await restore($)

    return next(e)
  })

  // Every change already saved the session's key: the end writes it once
  // more, for a change whose write failed. The exit's budget is short, and
  // the end waits for the write only through half of what is left.
  on('session.end', async ($, e, next) => {
    live.ends += 1
    const written = persist($).catch(() => undefined)
    const leftMs = next.budget.remainingMs

    await (Number.isFinite(leftMs) ? Promise.race([written, $.clock.sleep(leftMs / 2)]) : written)

    const ended = await next(e)

    // After /clear or a resume the process goes on as another session, with
    // no session.start; the engine names it only once this hook is done.
    if (e.reason === 'clear') {
      $.clock.after(0, () => void startCleared($, e.sessionId))
    } else if (e.reason === 'resume') {
      $.clock.after(0, () => void startResumed($, e.sessionId))
    }

    return ended
  })

  on('command.run', { command: 'open-items' }, async $ => {
    if ((await read($, tasks)).filter(isShown).length === 0) {
      return { text: 'No items for you right now.' }
    }

    await show($, true)

    return {}
  })

  // The four tools of every turn stay in the prompt's list, descriptions and
  // all, where an MCP tool would wait behind ToolSearch: their descriptions
  // carry the steering, the one prompt text that reaches Claude on every seat.
  for (const tool of [ADD, REPLY, CLOSE, LIST, HANDOFF, TAKE]) {
    on('tool.describe', { tool }, async ($, e, next) => ({ ...(await next(e)), isDeferred: DEFERRED.includes(tool) }))
  }

  on('tool.call', { tool: ADD }, async ($, e) => {
    if (e.agentId !== undefined) {
      return { deny: 'Only the main agent adds items for the user. Say what you need from the user in your result instead.' }
    }

    const ask = parseAsk(e as unknown as Record<string, unknown>)

    if ('error' in ask) {
      return { deny: ask.error }
    }

    if (live.loading !== null) {
      return { deny: LOADING }
    }

    const nowMs = await $.clock.now()
    const isLive = await isLiveChat($, nowMs)

    if (isLive === true) {
      return { deny: LIVE_CHAT }
    }

    const active = (await read($, tasks)).filter(isActive)
    const same = active.find(task => sameAsk(task.title, ask.title))

    if (same !== undefined) {
      return { result: `Item #${same.id} already asks the user for this ("${same.title}"); nothing new was added.` }
    }

    const id = (await update($, nextId, n => n + 1)) - 1
    const { detail, ...fields } = ask
    const task: Task = {
      id,
      ...fields,
      thread: [{ from: 'claude', text: detail, atMs: nowMs }],
      state: 'open',
      isWaitingForClaude: false,
      hasNewReply: false,
      update: 'none',
      createdMs: nowMs,
      updatedMs: nowMs,
    }

    await change($, list => [...list, task])
    await reselect($)
    await update($, selectedId, chosen => chosen ?? id)
    const title = printable(task.title, MAX_TITLE)
    await present($, task, nowMs, { toast: `Claude added an item for you: ${title}. See /open-items`, notice: title })

    return { result: isLive === 'unknown' ? `${addedOf(task)} ${LIVE_CHAT_NOTE}` : addedOf(task) }
  })

  on('tool.call', { tool: REPLY }, async ($, e) => {
    if (e.agentId !== undefined) {
      return { deny: 'Only the main agent replies on items. Say what you need from the user in your result instead.' }
    }

    const reply = parseReply(e as unknown as Record<string, unknown>)

    if ('error' in reply) {
      return { deny: reply.error }
    }

    if (live.loading !== null) {
      return { deny: LOADING }
    }

    // A move of the user's Claude has not heard would go unsent once Claude's
    // reply follows it in the thread: the result tells it instead.
    const found = await edit($, reply.id, (task, nowMs) =>
      replyErrorOf(task, reply) === undefined ? repliedBy(task.update === 'pending' ? toldOf(task) : task, reply, nowMs) : task,
    )

    if (found === undefined) {
      return { deny: `No item #${reply.id}.` }
    }

    const error = replyErrorOf(found, reply)

    if (error !== undefined) {
      return { deny: error }
    }

    const title = printable(found.title, MAX_TITLE)
    await present($, found, await $.clock.now(), { toast: `Claude replied on an item: ${title}. See /open-items`, notice: `Claude replied: ${title}` })
    const unheard = found.update === 'pending' ? `\nThe user had already responded on it, which you had not heard:\n${newsOf(found)}` : ''

    return {
      result: `Added your reply to item #${found.id}. It stays open in the user's Open items pane; their response reaches you as a message, or through list_items.${unheard}`,
    }
  })

  on('tool.call', { tool: CLOSE }, async ($, e) => {
    if (e.agentId !== undefined) {
      return { deny: 'Only the main agent closes items.' }
    }

    const close = parseClose(e as unknown as Record<string, unknown>)

    if ('error' in close) {
      return { deny: close.error }
    }

    if (live.loading !== null) {
      return { deny: LOADING }
    }

    const isRefused = (task: Task) => close.as === 'resolved' && !hasAnswerIn(task)
    const found = await edit($, close.id, task => (isRefused(task) ? task : closedAs(task, close)))

    if (found === undefined) {
      return { deny: `No item #${close.id}.` }
    }

    if (!isActive(found)) {
      return { deny: `Item #${found.id} is already ${found.state}; there is nothing to close.` }
    }

    if (isRefused(found)) {
      return {
        deny: `Item #${found.id} has no answer from the user yet, so it cannot be resolved. Wait for their answer, or close it as withdrawn if you no longer need it.`,
      }
    }

    // Its fields go with it, and what was typed in them: put in the prompt
    // box unasked, it would join whatever the user is writing there.
    await settle($, found.id)
    const why = close.note === undefined ? '' : `. ${printable(close.note, MAX_NOTE)}`
    const action = close.as === 'resolved' ? 'Claude marked the item resolved' : 'Claude withdrew the item'
    $.ui.toast(`${action}: ${printable(found.title, MAX_TITLE)}${why}`, { timeoutMs: 8000 })

    return { result: `${close.as === 'resolved' ? 'Resolved' : 'Withdrew'} item #${found.id}; it is gone from the user's Open items pane.` }
  })

  on('tool.call', { tool: LIST }, async ($, e) => {
    if (live.loading !== null) {
      return { deny: LOADING }
    }

    const args = e as unknown as Record<string, unknown>
    const id = typeof args['id'] === 'number' ? args['id'] : undefined
    const scope = args['show'] === 'open' || args['show'] === 'all' ? args['show'] : 'updates'
    const list = await read($, tasks)

    const picked =
      id !== undefined
        ? list.filter(task => task.id === id)
        : scope === 'all'
          ? list
          : scope === 'open'
            ? list.filter(isActive)
            : list.filter(isShown)

    if (id !== undefined && picked.length === 0) {
      return { result: `No item #${id}.` }
    }

    // A subagent's read tells the main agent nothing. Claude hears the
    // responses this shows: one that came in after it read goes later.
    if (e.agentId === undefined) {
      await claim($, task => picked.some(one => one.id === task.id && one.update === 'pending'))
    }

    return { result: listOf(picked, await $.clock.now(), id !== undefined) }
  })

  for (const tool of [HANDOFF, TAKE] as const) {
    on('tool.call', { tool }, async ($, e) => ({ deny: e.agentId === undefined ? 'Not ready yet.' : 'Only the main agent hands items off.' }))
  }

  // Observes only: the mod hooks no tool of Claude Code's own, so it reads a
  // background start from the main loop's result row. A subagent's background
  // work counts while the subagent runs, which `$.agent.list()` tells.
  on('session.append', { door: 'tool-result' }, async ($, e, next) => {
    try {
      if (e.agentId === undefined && e.origin.kind === 'tool') {
        noteStart(e.origin.tool, resultTextOf(e.message.content))
      }
    } catch {
      live.background = null
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      live.alertedTurn = false
    }

    live.isUnread = false
    live.turns.add(e.turnId)
    await syncWorking($)

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      live.isUnread = false
    }

    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    // Main's turn ending ends every turn; another loop's ends its own.
    if (e.agentId === undefined) {
      live.alertedTurn = false
      live.turns.clear()
      live.engineWorking = false
    } else {
      live.turns.delete(e.turnId)
    }

    await syncWorking($)

    if (e.agentId === undefined) {
      // Answers saved while Claude worked go now that it's free, unless an
      // ask is still unanswered: then they go with that last answer, together.
      // One a prompt entered without goes with them, but sends nothing alone.
      const all = await read($, tasks)
      const isAllAnswered = all.some(task => task.update === 'pending' && !live.held.has(updateKeyOf(task))) && !all.some(isUnanswered)

      if (live.isSendingAtEnd || isAllAnswered) {
        live.isSendingAtEnd = false
        // This message wakes Claude, which reads any row it missed above it.
        live.isUnread = false
        void send($, true)
      } else if (live.isUnread) {
        // A Send now that joined the turn during its final reply sits in the
        // conversation with no step left to read it: wake Claude up for it.
        live.isUnread = false
        void $.prompt.submit({ text: 'I answered an item while you were finishing your reply; my answer is above.', asUser: true })
      }
    }

    return result
  })

  // Draws nothing and passes the band on: it only reads the engine's word on
  // whether a turn runs, which no turn event gives for every loop.
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (live.engineWorking !== e.props.isWorking) {
      live.engineWorking = e.props.isWorking
      $.clock.after(0, () => void syncWorking($))
    }

    return next(e)
  })

  on('ui.press', { plugin: PLUGIN }, async ($, e, next) => {
    live.lastPersonMs = await $.clock.now()
    noteInput('press', live.lastPersonMs)

    return next(e)
  })

  on('ui.input', { plugin: PLUGIN }, async ($, e, next) => {
    if (e.kind === 'submit') {
      live.lastPersonMs = await $.clock.now()
      noteInput('press', live.lastPersonMs)
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'plugin' && e.origin.name === PLUGIN) {
      return next(e)
    }

    const bridged = answerIn(e.text)

    // A prompt from the Remote Control bridge (a phone) is one the user typed in the chat too.
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') {
      live.lastPersonMs = await $.clock.now()
      noteInput(bridged === null ? 'typed' : 'bridge', live.lastPersonMs)
    }

    if (e.origin.kind === 'task-notification') {
      noteEnds(e.text)
    }

    const task = bridged === null ? undefined : (await read($, tasks)).find(one => one.id === bridged.id && isOpenAsk(one))
    let isAnswered = false

    if (bridged !== null && task !== undefined) {
      if (looksSecret(bridged.answer)) {
        return {
          drop: `This looks like a secret, so it wasn't sent. Put it where it belongs, then mark #${task.id} Done.`,
        }
      }

      const overLimit = overLimitOf(task.id, bridged.answer)

      if (overLimit !== undefined) {
        return { drop: overLimit }
      }

      if (e.turnId === undefined) {
        // Claude is idle: this prompt is the answer, sent with every other
        // update Claude has not heard, those a batch was about to send among them.
        live.batch?.cancel()
        live.batch = null
      }

      // An item closed meanwhile (Claude withdrew it, say) keeps no answer:
      // the prompt goes as typed. One with nothing after its head is Done.
      const was = await resolve($, task.id, bridged.answer === '' ? DONE : replyOf(bridged.answer), 'later')
      isAnswered = was !== undefined && isActive(was)

      if (isAnswered && e.turnId !== undefined) {
        const when = (await read($, tasks)).some(isUnanswered) ? 'with your other answers' : 'when this turn ends'

        return {
          drop: `Saved as your answer to #${task.id}. Claude gets it ${when}, or press Send now in /open-items.`,
        }
      }
    }

    const due = await claim($)
    // An item still here has its answer in this prompt, or in another send
    // that took it as it was saved. One gone meanwhile (a /clear) leaves the
    // prompt as typed.
    const isAnswer = isAnswered && task !== undefined && (await read($, tasks)).some(one => one.id === task.id)

    if (isAnswer && due.length === 0) {
      return { drop: `Your answer to #${task.id} already went to Claude.` }
    }

    if (due.length === 0) {
      return next(e)
    }

    if (isAnswer) {
      return passOn($, due, inWords, 'kept', () => next({ ...e, text: messageOf(due) }))
    }

    return passOn($, due, inDigest, 'nothing', () => next({ ...e, context: [...(e.context ?? []), digestOf(due)] }))
  })

  // The steering goes last, on the session's side of the cache boundary,
  // wherever the tool can be reached: offered outright, or found through ToolSearch.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const isReachable = e.tools.some(tool => tool === ADD || tool === 'ToolSearch')

    if (!isReachable || e.traits.includes('print') || e.traits.includes('bare')) {
      return composed
    }

    return { sections: [...composed.sections, { id: 'open-items:steering', text: STEERING, scope: 'session' }] }
  })

  // Read at a conversation's start and again after a compaction: what is
  // still with the user, so Claude neither forgets nor adds it twice.
  on('prompt.context', async ($, e, next) => {
    const result = await next(e)
    const shown = (await read($, tasks)).filter(task => isShown(task) && task.kind !== 'info')

    if (shown.length === 0) {
      return result
    }

    return { ...result, blocks: [...result.blocks, { name: 'openItems', text: contextOf(shown) }] }
  })

  on('ui.render', { component: 'ToolUse', props: { tool: ADD } }, ($, e, next) => {
    const input = e.props.input as Record<string, unknown> | null | undefined
    const title = typeof input?.['title'] === 'string' ? input['title'] : ''

    if (title === '' || e.props.isErrored || e.props.isInterrupted) {
      return next(e)
    }

    const { Text } = $.ui.resolve(e)

    return (
      // One text, so the label keeps its words whole and the title wraps after it.
      <Text wrap="wrap">
        <Text color="yellow">{'☐ '}</Text>
        <Text bold>{'Added an item for you: '}</Text>
        {printable(title, MAX_SHOWN_TITLE)}
      </Text>
    )
  })

  // A second client on a surface (two phones) draws the pane at a width of
  // its own, and its fields with what is typed in them so far: it is counted
  // before it draws.
  on('session.attach', async ($, e, next) => {
    live.drawn.delete(e.surface)
    await rostered($, all => ({ ...all, [e.surface]: [...new Set(all[e.surface]).add(e.clientId)] }))
    return next(e)
  })

  // A client gone, the pane fits the ones left, which draw it again as the
  // roster changes: no render says which of its surface's seats was its own,
  // so they start over, and go with the last client. Both happen ahead of the
  // write that wakes the drawings, which fit the pane to what is left.
  on('session.detach', async ($, e, next) => {
    await rostered($, all => {
      const left = (all[e.surface] ?? []).filter(id => id !== e.clientId)

      if (left.length > 0) {
        live.startingOver.add(e.surface)
      } else {
        live.seats.delete(e.surface)
        live.emptied.set(e.surface, (live.emptied.get(e.surface) ?? 0) + 1)
      }

      return { ...all, [e.surface]: left }
    })

    return next(e)
  })

  // The ring on the open field lets the terminal wrap what is typed there:
  // the pane asks for the rows that takes, and for one row once it leaves.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)

    if (moved.deny === undefined) {
      live.ring = e.element
      void refit($)
    }

    return moved
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const emptied = live.emptied.get(e.surface)
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    // The mobile app draws no field yet: answers and reasons wait for a surface
    // that does. The engine fills an element a surface lacks with one that draws
    // nothing, so the surface says, not the table.
    const Input = e.surface !== 'mobile' && 'Input' in elements ? elements.Input : undefined
    const view = await paneView($, { canType: Input !== undefined, isFocused: e.props.isFocused })

    // The pane asks for the rows its tree takes at the width each surface
    // draws it in: a long title wraps, and a pane sized for one row would cut
    // off the rest.
    const columns = e.props.bodyColumns
    const seat: Seat = { columns, canType: view.canType, isFocused: view.isFocused, isInline: e.props.placement === 'inline' }
    // Drawn by two clients, a surface keeps how each drew it, or each one's
    // drawing would resize the pane against the other's: as a render names
    // neither, every way it was drawn since a client came or went. One drawn
    // as the surface's last client left keeps no seat, which nothing there
    // would draw again to take back.
    const isShared = ((await read($, clients))[e.surface]?.length ?? 0) > 1
    // A surface that docks the pane it seated inline asks for the rows of
    // those that still seat it inline.
    const wasInline = (live.seats.get(e.surface) ?? []).some(one => one.isInline)

    if (live.emptied.get(e.surface) === emptied) {
      const kept = live.startingOver.delete(e.surface) ? [] : (live.seats.get(e.surface) ?? [])
      live.seats.set(e.surface, isShared ? seatsWith(kept, seat) : [seat])
    }

    const { shown, editing: field, isWorking: working } = view

    // The pane is closing: it asks for no rows, which would open it again.
    if (shown.length === 0) {
      return <Text dimColor>No items for you right now.</Text>
    }

    if (seat.isInline || wasInline) {
      const rows = await rowsWanted($, view)

      if (rows !== live.rows) {
        void fit($, rows)
      }
    }

    const groups = groupsOf(shown.filter(isActive))
    const saved = unsentOf(shown)
    const selected = selectedOf(view)
    const head = headlineOf(view)

    // The glyph keeps its cells beside a title that wraps.
    const glyph = (
      <Box flexShrink={0}>
        <Text color="yellow">{'☐ '}</Text>
      </Box>
    )

    // The title and its age are one text, so a long title wraps under itself
    // and the age follows it, never squeezed into a column of its own.
    const titleText = (task: Task, isBold: boolean) => (
      <Text wrap="wrap">
        <Text bold={isBold}>{titleOf(task)}</Text>
        <Text dimColor>{ageOf(task, view)}</Text>
      </Text>
    )

    const actionsOf = (task: Task) => (
      <Box key="actions" flexDirection="row" flexWrap="wrap" columnGap={BUTTON_GAP}>
        {actionsFor(task, view.canType).map(action => (
          <Button
            key={action.key}
            plain
            hotkey={action.hotkey}
            label={action.label}
            onPress={() => {
              if (action.option !== undefined) {
                return respond($, task.id, choseOf(action.option), 'auto')
              }

              if (action.key === 'seen') {
                return markSeen($, task.id)
              }

              if (action.key === 'answer') {
                return startEditing($, task.id)
              }

              return respond($, task.id, action.key === 'later' ? LATER : DONE, 'auto')
            }}
          />
        ))}
      </Box>
    )

    const answerField = (task: Task, held: string | undefined): Controls => {
      if (Input === undefined) {
        return [null, null]
      }

      if (held !== undefined) {
        return [
          null,
          <Box key="held" flexDirection="column">
            <Text color="yellow" wrap="wrap">
              {HELD}
            </Text>
            <Box flexDirection="row" flexWrap="wrap" columnGap={BUTTON_GAP}>
              <Button key="edit" plain label="Edit" onPress={() => startEditing($, task.id)} />
              <Button key="send-anyway" plain label="Send anyway" onPress={() => answer($, task.id, held, 'auto', true)} />
            </Box>
          </Box>,
        ]
      }

      const key = fieldKeyOf({ id: task.id, field: 'answer' })
      const submitLabel = submitLabelOf(view)
      const [otherWay, long, cancel] = answerButtonsOf(view)

      return [
        <Input
          key={key}
          label={ANSWER_LABEL}
          placeholder={placeholderOf(answerPlaceholderOf(view), ANSWER_LABEL, submitLabel, columns)}
          value={fieldValueOf(e.surface, key)}
          submitLabel={submitLabel}
          autoFocus
          onInput={value => typed($, key, value)}
          onSubmit={value => answer($, task.id, value, 'auto')}
        />,
        <Box key="buttons" flexDirection="row" flexWrap="wrap" columnGap={BUTTON_GAP}>
          <Button key="other-way" plain label={otherWay} onPress={() => answerTyped($, task.id, working ? 'now' : 'later')} />
          <Button key="long" plain label={long} onPress={() => longAnswer($, task.id)} />
          <Button key="cancel" plain label={cancel} onPress={() => stopEditing($)} />
        </Box>,
      ]
    }

    const selectedRows = (task: Task) => {
      // A field open on a surface that draws one: elsewhere the item keeps its buttons.
      const isEditing = view.canType && field !== null && field.id === task.id
      const [input, buttons]: Controls = isEditing ? answerField(task, field.held) : [null, actionsOf(task)]
      const doneWhen = doneWhenOf(task)

      // The terminal sizes a field by the pane's body, whatever box holds it:
      // it goes out of the item's indent, across the body's whole width.
      return (
        <Box key={`task-${task.id}`} flexDirection="column" flexShrink={0}>
          <Box flexDirection="row">
            {glyph}
            {titleText(task, true)}
          </Box>
          <Box flexDirection="column" paddingLeft={2}>
            <Text wrap="wrap">{detailOf(task)}</Text>
            {doneWhen === undefined ? null : (
              <Text dimColor wrap="wrap">
                {doneWhen}
              </Text>
            )}
          </Box>
          {input}
          <Box flexDirection="column" paddingLeft={2}>
            {buttons}
          </Box>
        </Box>
      )
    }

    const itemRow = (task: Task) =>
      task.id === selected?.id ? (
        selectedRows(task)
      ) : (
        <Box key={`task-${task.id}`} flexDirection="row" flexShrink={0}>
          {glyph}
          <Box flexShrink={0}>
            <Button key={`select-${task.id}`} plain dimColor label={`#${task.id}`} onPress={() => select($, task.id)} />
          </Box>
          <Text dimColor wrap="wrap">
            {` ${nameOf(task)}${ageOf(task, view)}`}
          </Text>
        </Box>
      )

    const sectionRows = groups.map((group, i) => (
      <Box key={`section-${group.label}`} flexDirection="column" flexShrink={0} marginTop={i === 0 ? 0 : 1}>
        <Text bold color="yellow">
          {group.label}
        </Text>
        {group.tasks.map(itemRow)}
      </Box>
    ))

    const savedRows = saved.map((task, i) => (
      <Box key={`saved-${task.id}`} flexDirection="row" flexShrink={0}>
        <Box flexShrink={0}>
          <Text color="green">{'✓ '}</Text>
        </Box>
        <Text dimColor wrap="wrap">
          {savedOf(task)}
        </Text>
        <Box flexShrink={0} marginLeft={2}>
          <Button key={`send-${task.id}`} plain {...sendNowOf(i)} onPress={() => sendNow($)} />
        </Box>
      </Box>
    ))

    return (
      <Box flexDirection="column">
        <Box key="head" flexDirection="row" flexShrink={0}>
          <Text wrap="wrap">
            <Text color={shown.some(waitsOnUser) ? 'yellow' : 'gray'}>{head.glyph}</Text>
            <Text bold>{head.headline}</Text>
            <Text dimColor>{head.note}</Text>
          </Text>
        </Box>
        <Box key="tasks" flexDirection="column" marginTop={1} flexShrink={0}>
          {sectionRows}
          {savedRows}
        </Box>
        <Box key="foot" flexDirection="row" marginTop={1} columnGap={BUTTON_GAP} flexShrink={0}>
          <Text dimColor wrap="wrap">
            {hintOf(view)}
          </Text>
          <Box flexShrink={0}>
            <Button key="hide" plain dimColor role="dismiss" label={HIDE} onPress={() => closePane($)} />
          </Box>
        </Box>
      </Box>
    )
  })
}

/** Keeps the pane's word on whether Claude works (Enter sends, or saves) in step. */
async function syncWorking($: EngineInterface) {
  const now = working()

  await update($, isWorking, () => now)
}

/**
 * Goes on as the session /clear started after `endingId`: it has no saved
 * items to read. One the engine never names starts empty and saves nothing:
 * its writes would go over the ended session's key.
 */
async function startCleared($: EngineInterface, endingId: string) {
  const sessionId = await newIdAfter($, endingId)

  await switchTo($, sessionId ?? endingId)

  if (sessionId !== undefined) {
    await update($, restoredFor, () => sessionId)
  }
}

/** Goes on as the session a resume took up after `endingId`, with the items it saved; as `startCleared` when the engine never names it. */
async function startResumed($: EngineInterface, endingId: string) {
  // Whether the background tasks of a resumed conversation still run is not known.
  live.background = null
  const sessionId = await newIdAfter($, endingId)

  await switchTo($, sessionId ?? endingId)

  if (sessionId !== undefined) {
    await restore($)
  }
}

/** The id the engine names once session `endingId` has ended, read again a moment later while it names that one; undefined if it never changes. */
async function newIdAfter($: EngineInterface, endingId: string): Promise<string | undefined> {
  for (let reads = 1; reads <= NEW_ID_READS; reads += 1) {
    const sessionId = await $.session.id()

    if (sessionId !== endingId) {
      return sessionId
    }

    if (reads < NEW_ID_READS) {
      await $.clock.sleep(NEW_ID_GAP_MS)
    }
  }

  return undefined
}

/**
 * Starts the process over as session `sessionId`: no items, numbered from #1,
 * and nothing kept of the last session's fields, answers, sends or reads.
 * Every write after this goes to its key.
 */
async function switchTo($: EngineInterface, sessionId: string) {
  // Before any wait: a write the store runs meanwhile is this session's,
  // which has read nothing yet, so it writes nothing (see `writeSaved`).
  live.sessionId = sessionId
  live.loading = null
  live.unread = null
  live.drafts.clear()
  live.closed.clear()
  live.drawn.clear()
  live.held.clear()
  live.batch?.cancel()
  live.batch = null
  live.isSendingAtEnd = false
  live.isUnread = false
  const cwd = await $.session.cwd().catch(() => undefined)
  await update($, folder, known => cwd ?? known)
  await update($, restoredFor, () => null)
  await update($, tasks, () => [])
  await update($, nextId, () => 1)
  await update($, selectedId, () => null)
  await update($, editing, () => null)
  await refresh($)
}

/**
 * Takes up the items this session saved, when its key has them (a resumed
 * session), and deletes the keys of sessions saved more than `KEEP_MS` ago.
 * Until the read settles, the tools refuse: an item Claude added meanwhile
 * would go under the items read. A store slow to answer holds up the start
 * 5 seconds at most.
 */
async function restore($: EngineInterface) {
  const sessionId = await $.session.id()
  const ends = live.ends

  // A reload starts `live` over.
  live.sessionId = sessionId
  live.loading = sessionId
  const restored = queued(() => takeUp($, sessionId)).catch(() => {
    if (live.sessionId === sessionId) {
      live.unread = sessionId
    }

    return false
  })
  void restored.then(() => {
    if (live.loading === sessionId) {
      live.loading = null
    }
  })
  const cleaned = queued(() => dropExpired($)).catch(() => undefined)

  // The pane opens for what was read, unless the session has ended since.
  const shown = restored
    .then(async isKept => {
      if (isKept && (await refresh($)) && live.ends === ends) {
        await show($, false)
      }
    })
    .catch(() => undefined)

  await awaited($, Promise.allSettled([restored, cleaned]))
  await redrawn($, shown)
}

/**
 * Sets the items and the count from session `sessionId`'s key, unless it has
 * expired; resolves whether it did. A reload of the code starts the session
 * again with its state kept, which is newer than its key: it reads nothing.
 */
async function takeUp($: EngineInterface, sessionId: string): Promise<boolean> {
  if ((await read($, restoredFor)) === sessionId) {
    return false
  }

  const saved = savedIn(await $.store.get(keyOf(sessionId)))
  const nowMs = await $.clock.now()

  // A /clear or a resume while the read was out: the state is another session's now.
  if (live.loading !== sessionId) {
    return false
  }

  const isKept = saved !== undefined && !isExpired(saved, nowMs)

  if (isKept) {
    await update($, tasks, () => trimmed(saved, nowMs).tasks)
    await update($, nextId, () => saved.nextId)
    // A v0.1 key saved no folder: the session keeps the one it runs in.
    if (saved.folder !== '') {
      await update($, folder, () => saved.folder)
    }

    await reselect($)
  }

  await update($, restoredFor, () => sessionId)

  return isKept
}

/** Deletes every saved key that has expired or holds no saved session: all of them share the store's one file. */
async function dropExpired($: EngineInterface) {
  const nowMs = await $.clock.now()
  const keys = (await $.store.keys()).filter(isSavedKey)
  const values = await Promise.all(keys.map(key => $.store.get(key)))

  for (const [i, key] of keys.entries()) {
    const saved = savedIn(values[i])

    if (saved === undefined || isExpired(saved, nowMs)) {
      await $.store.delete(key)
    }
  }
}

/** `writeSaved` once the store work asked for before is done, from the state as it stands then. */
function persist($: EngineInterface): Promise<void> {
  return queued(() => writeSaved($))
}

/**
 * Writes the session's items, as `trimmed` keeps them, and its count under
 * its key. Nothing before its first item (most sessions never hold one), nor
 * before the session has read its key, which the write would go over: one
 * whose start read failed reads it here, and writes only where none is saved.
 */
async function writeSaved($: EngineInterface) {
  // Read at one moment: a switch to another session never falls between them.
  const sessionId = live.sessionId
  const [restored, list, count, started] = await Promise.all([read($, restoredFor), read($, tasks), read($, nextId), read($, folder)])

  if ((list.length === 0 && count === 1) || (restored !== sessionId && !(await isUnsaved($, sessionId)))) {
    return
  }

  const nowMs = await $.clock.now()
  const saved: Saved = { version: 2, tasks: list, nextId: count, savedMs: nowMs, lastActiveMs: nowMs, folder: started ?? '', taken: [] }
  await $.store.set(keyOf(sessionId), trimmed(saved, nowMs))
}

/**
 * Reads session `sessionId`'s key again when its start read failed; resolves
 * whether nothing is saved there, which then counts as read. Once the store
 * answers it reads no more: saved items are never written over.
 */
async function isUnsaved($: EngineInterface, sessionId: string): Promise<boolean> {
  if (live.unread !== sessionId) {
    return false
  }

  const saved = savedIn(await $.store.get(keyOf(sessionId)))
  const isFree = saved === undefined || isExpired(saved, await $.clock.now())

  // A switch to another session meanwhile.
  if (live.unread !== sessionId) {
    return false
  }

  live.unread = null

  if (isFree) {
    await update($, restoredFor, () => sessionId)
  }

  return isFree
}

/**
 * Runs store work one piece at a time, in the order asked, so no write of
 * the session's lands after a newer one. No piece asks for another.
 */
function queued<T>(work: () => Promise<T>): Promise<T> {
  const done = live.queue.then(work, work)
  live.queue = done.catch(() => undefined)

  return done
}

/**
 * Writes the roster as `rewrite` has it once the writes asked for before are
 * done, in the order the engine raised them, so a client that leaves and
 * attaches again stays counted. Nothing else writes the roster: `rewrite`
 * runs once, ahead of its write.
 */
function rostered($: EngineInterface, rewrite: (all: Roster) => Roster): Promise<Roster> {
  const done = live.rosterQueue.then(() => update($, clients, rewrite))
  live.rosterQueue = done.catch(() => undefined)

  return done
}

/**
 * Resolves once store `work` settles, or `STORE_WAIT_MS` on: a press, a
 * prompt or a tool call goes on without a store that is slow to answer, and
 * the work finishes on its own, in its place in the queue. Until work given
 * up on settles, nothing waits on the store at all.
 */
async function awaited($: EngineInterface, work: Promise<unknown>) {
  if (live.stalled > 0) {
    return
  }

  if (!(await within($, work))) {
    const settled = () => {
      live.stalled -= 1
    }

    live.stalled += 1
    void work.then(settled, settled)
  }
}

/**
 * Resolves once the redraw that store work leads to settles, `STORE_WAIT_MS`
 * on, or at once while that work was given up on: it is no store work, so a
 * surface slow to open the pane doesn't hold up the store.
 */
async function redrawn($: EngineInterface, shown: Promise<unknown>) {
  if (live.stalled === 0) {
    await within($, shown)
  }
}

/** Resolves once `work` settles, or `STORE_WAIT_MS` on, whichever is first: whether it settled. */
function within($: EngineInterface, work: Promise<unknown>): Promise<boolean> {
  return new Promise(finish => {
    const timer = $.clock.after(STORE_WAIT_MS, () => finish(false))
    const done = () => {
      timer.cancel()
      finish(true)
    }

    void work.then(done, done)
  })
}

/**
 * Changes the item list and, when that changes it (`fn` hands back a new
 * list), saves it. The session's own state is what counts: a write that
 * fails now, the next change or the end makes.
 */
async function change($: EngineInterface, fn: (list: readonly Task[]) => readonly Task[]) {
  let isChanged = false

  // `update` runs `fn` again when another write beat it: the last run counts.
  await update($, tasks, list => {
    const changed = fn(list)
    isChanged = changed !== list
    return changed
  })

  if (isChanged) {
    await awaited($, persist($))
    await refresh($)
  }
}

/**
 * Marks the updates Claude has not heard delivered (every one, or those
 * `isWanted`), in one change of the task list, and resolves them: the path
 * that claims them sends them, and no other finds them waiting meanwhile.
 */
async function claim($: EngineInterface, isWanted: (task: Task) => boolean = () => true): Promise<readonly Task[]> {
  const isDue = (task: Task) => task.update === 'pending' && isWanted(task)
  let due: readonly Task[] = []

  if (!(await read($, tasks)).some(isDue)) {
    return due
  }

  await change($, list => {
    due = list.filter(isDue)

    return list.map(task => (isDue(task) ? toldOf(task) : task))
  })

  return due
}

/**
 * Puts an item new or changed in front of the user: the pane, or a toast
 * where it cannot be seated unasked, and an alert when they have been away;
 * one alert a turn, none for info.
 */
async function present($: EngineInterface, task: Task, nowMs: number, words: { toast: string; notice: string }) {
  if (!(await show($, false))) {
    $.ui.toast(words.toast)
  }

  if (task.kind !== 'info' && !live.alertedTurn && nowMs - live.lastPersonMs >= ALERT_QUIET_MS) {
    live.alertedTurn = true
    $.ui.notify(words.notice, { title: 'Open items' }).catch(() => undefined)
  }
}

/**
 * Keeps the status line in step with the items, and closes the pane once
 * nothing is left in it. Resolves whether anything is shown.
 */
async function refresh($: EngineInterface): Promise<boolean> {
  const shown = (await read($, tasks)).filter(isShown)

  $.ui.status(statusOf(shown))

  if (shown.length === 0) {
    await closePane($).catch(() => undefined)
  }

  return shown.length > 0
}

/** Closes the Open items pane, and has a re-size under way leave it closed. */
function closePane($: EngineInterface): Promise<void> {
  live.closes += 1

  return $.ui.close({ id: PANE })
}

/**
 * Opens the Open items pane sized to what it holds; `isAsked` when the person
 * asked for it (/open-items), so it takes the keyboard. Resolves whether the
 * surface seated it: one opened unasked waits on a narrow terminal.
 */
async function show($: EngineInterface, isAsked: boolean): Promise<boolean> {
  // A closed pane's fields are drawn with their drafts as it opens again:
  // the surfaces forget what they held as it closes. Its ring starts on the
  // open field, which takes it by autoFocus as the pane takes the keys.
  // Asked only when there is a draft to draw or a field open to take the
  // ring; when the engine can't say, they are drawn so anyway, and a field
  // still drawn gets back the text typed in it.
  if (live.drafts.size > 0 || (await read($, editing)) !== null) {
    const panes = await $.ui.panes().catch(() => undefined)

    if (panes === undefined || !panes.some(pane => pane.id === PANE)) {
      live.drawn.clear()
      live.ring = openKeyOf(await read($, editing))
    }
  }

  return openAt($, await rowsWanted($), isAsked)
}

/** Opens the Open items pane `rows` tall, or re-sizes it; resolves whether the surface seated it. */
async function openAt($: EngineInterface, rows: number, isAsked: boolean): Promise<boolean> {
  live.rows = rows
  // The pane is a view of the items: one that can't open costs the user a
  // click on /open-items, never the item itself.
  const opened = await $.ui
    .open({ id: PANE, title: PANE_TITLE, rows, ...(isAsked ? { focus: true as const } : {}) })
    .catch(() => ({ isPlaced: false as const }))

  return opened.isPlaced
}

/** What the pane draws from: the session's state, and what only the surface knows. */
async function paneView($: EngineInterface, surface: Pick<PaneView, 'canType' | 'isFocused'>): Promise<PaneView> {
  const field = await read($, editing)
  const key = openKeyOf(field)
  const state = {
    shown: (await read($, tasks)).filter(isShown),
    selectedId: await read($, selectedId),
    editing: field,
    draft: key === undefined ? '' : (live.drafts.get(key) ?? ''),
    nowMs: await $.clock.now(),
    isWorking: await read($, isWorking),
  }

  return seated(state, surface)
}

/** The pane's `view` as a surface that `canType`, and holds the keys or not, draws it. */
function seated(view: Omit<PaneView, 'canType' | 'isFocused' | 'isTyping'>, surface: Pick<PaneView, 'canType' | 'isFocused'>): PaneView {
  const key = openKeyOf(view.editing)

  return {
    ...view,
    canType: surface.canType,
    isFocused: surface.isFocused,
    isTyping: surface.canType && surface.isFocused && key !== undefined && live.ring === key,
  }
}

/** The key of the field open to type in, unless an answer held there for looking like a secret takes its place. */
function openKeyOf(field: Editing | null): string | undefined {
  return field === null || field.held !== undefined ? undefined : fieldKeyOf(field)
}

/** Re-sizes the pane to `wanted` rows, or else to what it holds now, when it is on screen. */
async function fit($: EngineInterface, wanted?: number) {
  const rows = wanted ?? (await rowsWanted($))
  const closes = live.closes
  // Asked once the rows are known, as the pane re-sizes: one that closed
  // meanwhile, its last task gone, stays closed, as does one closed while
  // the surface answers.
  const panes = await $.ui.panes().catch(() => [])

  if (live.closes === closes && panes.some(pane => pane.id === PANE && pane.isPlaced)) {
    await openAt($, rows, false)
  }
}

/**
 * Re-sizes an inline pane whose rows changed with what nothing draws it
 * again for: a draft growing, the ring moving onto its field or off it.
 * One at a time, in the order asked: each reads the draft and the ring once
 * the one before has asked for its rows, so the last asks for what the last
 * key or move left.
 */
function refit($: EngineInterface): Promise<void> {
  const done = live.refitQueue.then(async () => {
    if (inlineSeats().length === 0) {
      return
    }

    const rows = await rowsWanted($)

    if (rows !== live.rows) {
      await fit($, rows)
    }
  })
  live.refitQueue = done.catch(() => undefined)

  return done
}

/**
 * The rows the pane asks for: the most it takes on a surface seating it
 * inline. It is one height on all of them, and each asking for its own
 * would resize it against the others. From `view` when a render has just
 * read it, else from the state now.
 */
async function rowsWanted($: EngineInterface, view?: PaneView): Promise<number> {
  const inline = inlineSeats()
  const state = view ?? (await paneView($, FIRST_SEAT))

  return Math.max(...(inline.length > 0 ? inline : [FIRST_SEAT]).map(seat => rowsFor(seated(state, seat), seat.columns, MAX_PANE_ROWS)))
}

/** Every way a surface draws the pane inline, where its rows count. */
function inlineSeats(): Seat[] {
  return [...live.seats.values()].flat().filter(seat => seat.isInline)
}

/** Keeps what the user typed in the field keyed `key`, and the rows it takes. */
async function typed($: EngineInterface, key: string, value: string) {
  // Keys typed in a field say the ring is on it, though no move said so.
  live.ring = key
  live.drafts.set(key, value)
  await refit($)
}

/** What `surface` draws the field keyed `key` with: its draft, as the surface first drew it (see `live.drawn`). */
function fieldValueOf(surface: RenderSurface, key: string): string {
  const drawn = live.drawn.get(surface) ?? new Map<string, string>()
  const value = drawn.get(key) ?? live.drafts.get(key) ?? ''

  live.drawn.set(surface, drawn.set(key, value))
  return value
}

/**
 * Changes item `id` with `fn` while it is open or later, and resolves the
 * item as the change found it: one closed meanwhile (Claude withdrew it, or a
 * press from an older render answered it) or gone (a /clear) stays as it is,
 * as does one `fn` hands back unchanged.
 */
async function edit($: EngineInterface, id: number, fn: (task: Task, nowMs: number) => Task): Promise<Task | undefined> {
  const nowMs = await $.clock.now()
  let found: Task | undefined

  await change($, list => {
    found = list.find(task => task.id === id)
    const changed = found !== undefined && isActive(found) ? fn(found, nowMs) : found

    return changed === found ? list : list.map(task => (task.id === id && changed !== undefined ? { ...changed, updatedMs: nowMs } : task))
  })

  return found
}

/**
 * Passes on a prompt that carries `due` to Claude, where `isCarried` looks
 * for each; the caller claimed them, so no other path sends them meanwhile.
 * Those that don't enter with it (a hook beneath dropped it or took them
 * out, or it failed) wait again for the next send, and a toast says so, as
 * `onDrop` says for a drop.
 */
async function passOn<R extends PromptSubmitResult>(
  $: EngineInterface,
  due: readonly Task[],
  isCarried: (entered: Entered, task: Task) => boolean,
  onDrop: DropNote,
  pass: () => Promise<R>,
): Promise<R> {
  let back: { lost: readonly Task[]; note: DropNote; reason?: string } | undefined

  try {
    const result = await pass()

    if (result.drop !== undefined) {
      back = { lost: due, note: onDrop, reason: result.drop }
    } else {
      const lost = due.filter(task => !isCarried(result, task))

      if (lost.length > 0) {
        // The prompt entered, and Claude takes a turn on it: sent again as
        // that turn ends, a response a hook beneath always takes out (or
        // rewords at its head) would go round and round. It waits for Send
        // now, as the toast says, or the next prompt.
        lost.forEach(task => live.held.add(updateKeyOf(task)))
        back = { lost, note: 'why', reason: 'a hook took it out of the prompt' }
      }
    }

    return result
  } catch (error) {
    back = { lost: due, note: 'why', reason: error instanceof Error ? error.message : String(error) }

    throw error
  } finally {
    if (back !== undefined) {
      await giveBack($, back.lost, back.note, back.reason)
    }
  }
}

/**
 * Whether a prompt that entered carries an update in its words, by how the
 * update opens there (`#5 <title>:`): a hook beneath may rewrite what an
 * answer says (mask a secret in it, say); one that takes the update out, or
 * rewords its head, leaves it to send again, since Claude hearing it twice
 * beats not hearing it.
 */
function inWords(entered: Entered, task: Task): boolean {
  return entered.text.includes(ownHeadOf(task))
}

/** The update a task carries, the same through each send and give-back: a new one changes `updatedMs`. */
function updateKeyOf(task: Task): string {
  return `${task.id}@${task.updatedMs}`
}

/** Whether a prompt that entered carries an update in a digest beside its words (`#5 done: <title>.`), read as `inWords` reads them. */
function inDigest(entered: Entered, task: Task): boolean {
  return (entered.context ?? []).some(block => block.includes(newsHeadOf(task)))
}

/**
 * Gives back updates that never reached Claude, to go with the next send,
 * and says so as `note` says. It never throws: `passOn` keeps the prompt's
 * own error.
 */
async function giveBack($: EngineInterface, lost: readonly Task[], note: DropNote, reason?: string) {
  try {
    await undelivered($, lost)
  } catch {
    // `change` sets the session's state before the store and lets a store
    // write fail quietly; nothing else here is expected to throw.
  }

  if (note === 'nothing') {
    return
  }

  const which = numbersOf(lost.map(task => task.id))
  const why = note === 'why' && reason !== undefined ? `: ${printable(reason, 200).replace(/[.!]+$/, '')}` : ''

  $.ui.toast(`Claude didn't get your response to ${which}${why}. It's saved; press Send now in /open-items.`, {
    timeoutMs: 8000,
  })
}

/**
 * Gives back updates that never reached Claude, `lost` as they stood before
 * they were claimed: they wait again, and Claude counts as told only of what
 * it was told before.
 */
async function undelivered($: EngineInterface, lost: readonly Task[]) {
  await change($, list =>
    list.map(task => {
      const was = lost.find(one => one.id === task.id)

      return was === undefined ? task : { ...task, update: task.update === 'delivered' ? 'pending' : task.update, heardMs: was.heardMs }
    }),
  )
}

/**
 * Keeps the selection on a task still open, and drops a field whose task is
 * gone, keeping what was typed for its answer for a press from a drawing
 * from before.
 */
async function settle($: EngineInterface, id: number) {
  const key = fieldKeyOf({ id, field: 'answer' })
  const draft = live.drafts.get(key)

  if (draft !== undefined) {
    live.closed.set(key, draft)
  }

  forget(key)
  live.drafts.delete(key)

  await update($, editing, field => (field?.id === id ? null : field))
  await reselect($)
}

/** After the user's move on selected item `id`, which a reply or Later leaves in the pane, selects the next that waits on them. */
async function moveOn($: EngineInterface, id: number) {
  const next = firstOf((await read($, tasks)).filter(task => task.id !== id && waitsOnUser(task)))

  if (next !== undefined) {
    await update($, selectedId, chosen => (chosen === id ? next.id : chosen))
  }
}

async function reselect($: EngineInterface) {
  const active = (await read($, tasks)).filter(isActive)

  await update($, selectedId, chosen => (active.some(task => task.id === chosen) ? chosen : (firstOf(active)?.id ?? null)))
}

async function select($: EngineInterface, id: number) {
  // Pressed on a drawing from before its task closed, it leaves the pane as
  // it is: a field open on another task stays open.
  if (!(await isOpenNow($, id))) {
    return
  }

  await update($, selectedId, () => id)
  await update($, editing, field => (field?.id === id ? field : null))
  await fit($)
}

/**
 * The user's `move` on a task; `how` says when Claude hears of it. Resolves
 * the task as it stood, as `edit` does: one no longer open stays as it is.
 */
async function resolve($: EngineInterface, id: number, move: Move, how: How) {
  const was = await edit($, id, (task, nowMs) => movedBy(task, move, nowMs))
  const isRepeat = isRepeatOf(was, move)
  const isNew = was !== undefined && isActive(was) && !isRepeat
  await settle($, id)

  if (isNew) {
    await moveOn($, id)
  }

  // A move that changes nothing sends nothing new, and holds back no batch
  // under way; Send now still sends the answer it repeats, saved for later.
  if ((how === 'now' && (isNew || isRepeat)) || (how === 'auto' && isNew && !working())) {
    sendSoon($)
  }

  return was
}

/**
 * A press on the pane makes the user's `move` on item `id`, as `resolve`
 * does. One Claude withdrew, or the user answered otherwise (on another
 * surface, say), since the pane drew it says so, and what the user typed for
 * it (`typedText`) goes to the prompt box, unless it looks like a secret; one
 * the user's last move already matches (a second press) stays as it is.
 */
async function respond($: EngineInterface, id: number, move: Move, how: How, typedText = '') {
  const was = await resolve($, id, move, how)

  if (was === undefined || (!isActive(was) && !isRepeatOf(was, move))) {
    const kept = (await toPromptBox($, typedText)) ? ' What you typed is in the prompt box.' : ''

    $.ui.toast(`Item #${id} isn't open any more, so your response wasn't saved.${kept}`, { timeoutMs: 8000 })
  }
}

/**
 * Puts what was typed for a task that closed in the prompt box, on a line
 * after any draft there, unless it looks like a secret; resolves whether the
 * box took it.
 */
async function toPromptBox($: EngineInterface, text: string): Promise<boolean> {
  if (text === '' || looksSecret(text)) {
    return false
  }

  const box = await $.prompt.read()
  const filled = await $.prompt.fill({ text: box.text === '' ? text : `\n${text}`, mode: 'append' }).catch(() => ({ isFilled: false }))

  return filled.isFilled
}

/**
 * Answers task `id` with what is typed in its field, or, pressed on a
 * drawing from before the task closed, with what was typed before it did.
 */
async function answerTyped($: EngineInterface, id: number, how: How) {
  const key = fieldKeyOf({ id, field: 'answer' })

  return answer($, id, live.drafts.get(key) ?? live.closed.get(key) ?? '', how)
}

/** The user looked at info item `id`: it leaves the pane, and Claude hears nothing. */
async function markSeen($: EngineInterface, id: number) {
  if (await edit($, id, (task, nowMs) => movedBy(task, SEEN, nowMs))) {
    await settle($, id)
  }
}

/** Whether task `id` is open now: one closed meanwhile, or gone, takes no answer. */
async function isOpenNow($: EngineInterface, id: number): Promise<boolean> {
  return (await read($, tasks)).some(task => task.id === id && isActive(task))
}

async function answer($: EngineInterface, id: number, text: string, how: How, isSecretOk = false) {
  const value = text.trim()
  // Entered or pressed on a drawing from before its task closed, an answer
  // goes to `respond`, which says the task isn't open any more.
  const isOpen = await isOpenNow($, id)

  if (isOpen && value === '') {
    $.ui.toast('Type an answer first, or press Cancel.')
    return
  }

  const overLimit = overLimitOf(id, value)

  if (isOpen && overLimit !== undefined) {
    $.ui.toast(overLimit, { timeoutMs: 8000 })
    return
  }

  if (isOpen && !isSecretOk && looksSecret(value)) {
    await update($, editing, (): Editing => ({ id, field: 'answer', held: value }))
    return
  }

  await respond($, id, replyOf(value), how, value)
}

async function startEditing($: EngineInterface, id: number) {
  // Pressed on a drawing from before its task closed, it leaves the pane as it is.
  if (!(await isOpenNow($, id))) {
    return
  }

  const key = fieldKeyOf({ id, field: 'answer' })

  forget(key)
  // The field takes the ring as it opens: by the move below, or by its
  // autoFocus, whose `ui.focus` reaches none of this plugin's hooks.
  live.ring = key
  await update($, selectedId, () => id)
  await update($, editing, (): Editing => ({ id, field: 'answer' }))
  await fit($)

  // A field the pane can't focus (it doesn't hold the keyboard) is still a click away.
  void $.ui.focus({ requestId: PANE, key }).then(undefined, () => undefined)
}

/** Has every surface draw the field keyed `key` afresh, with its draft. */
function forget(key: string) {
  for (const drawn of live.drawn.values()) {
    drawn.delete(key)
  }
}

async function stopEditing($: EngineInterface) {
  await update($, editing, () => null)
  await fit($)
}

/** Moves a long answer into the prompt box, where the real editor takes pastes and lines. */
async function longAnswer($: EngineInterface, id: number) {
  // Pressed on a drawing from before its task closed, it answers as Save for
  // later would: the task isn't open any more.
  if (!(await isOpenNow($, id))) {
    return answerTyped($, id, 'later')
  }

  const key = fieldKeyOf({ id, field: 'answer' })
  const box = await $.prompt.read()
  const draft = live.drafts.get(key) ?? ''
  const text = bridgeOf(id) + [draft, box.text].filter(part => part.trim() !== '').join('\n')
  const filled = await $.prompt.fill({ text, mode: 'replace' })

  if (!filled.isFilled) {
    $.ui.toast("Couldn't open the prompt box for your answer; type it here instead.")
    return
  }

  live.drafts.delete(key)
  await update($, editing, () => null)
  $.ui.toast('Write your answer in the prompt box (Esc gets you there), then press Enter.', {
    timeoutMs: 8000,
  })
}

function sendNow($: EngineInterface) {
  live.batch?.cancel()
  live.batch = null
  void send($)
}

function sendSoon($: EngineInterface) {
  live.batch?.cancel()
  live.batch = $.clock.after(BATCH_MS, () => {
    live.batch = null
    void send($)
  })
}

/**
 * Hands Claude every update it has not heard: a turn of its own while it is
 * idle, a row its running turn reads at the next step while it works.
 * `isTurnOver`: sent as main's turn ends, when Claude is idle whatever the
 * engine's last word on it was.
 */
async function send($: EngineInterface, isTurnOver = false) {
  const due = await claim($)

  if (due.length === 0) {
    return
  }

  const text = messageOf(due)
  const which = numbersOf(due.map(task => task.id))

  if (isTurnOver || !working()) {
    await passOn($, due, inWords, 'why', () => $.prompt.submit({ text, asUser: true })).catch(() => undefined)
    return
  }

  const isTaken = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } }).then(
    appended => appended.deny === undefined,
    () => false,
  )

  if (!isTaken) {
    await undelivered($, due)

    // The turn ended while the row was being refused: they go now.
    if (!working()) {
      void send($, true)
      return
    }

    live.isSendingAtEnd = true
    $.ui.toast(`Claude gets your response to ${which} when it finishes this turn.`)
    return
  }

  live.isUnread = true

  try {
    await $.session.append({ message: { type: 'system', content: [{ type: 'text', text: `Sent your response to ${which} to Claude` }] } })
  } catch {
    // The notice is for the user's eyes only; Claude has the answer either way.
  }
}
