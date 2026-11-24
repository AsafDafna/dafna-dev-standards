import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface, ToolSpec } from 'claude-code'

import type { Header, Held, Offer, Screen, Task } from '../types'
import {
  DONE,
  MAX_ASK,
  MAX_NOTE,
  MAX_TITLE,
  SEEN,
  addedOf,
  answerIn,
  bridgeOf,
  closedAs,
  digestOf,
  hasAnswerIn,
  hasNewsIn,
  isActive,
  isAway,
  isOpenAsk,
  isRepeatOf,
  isShown,
  isSide,
  isStale,
  listOf,
  looksSecret,
  messageOf,
  movedBy,
  newsOf,
  overLimitOf,
  parseAsk,
  parseClose,
  parseReply,
  reminderOf,
  repliedBy,
  replyErrorOf,
  replyOf,
  sameAsk,
  toldOf,
  waitingOf,
  waitsOnUser,
} from './tasks'
import type { Move } from './tasks'
import {
  ASK_BAR,
  BACK,
  BUTTON_GAP,
  EMPTY_LINE,
  FOCUS_BACKGROUND,
  HELD_BUTTONS,
  HIDE,
  KIND_COLOR,
  LINK_LABEL,
  LONG_ANSWER,
  MAX_SHOWN_TITLE,
  MOVED_LABEL,
  MOVING_LABEL,
  NEW_HELD,
  NEW_SIDE,
  OFFER_BUTTONS,
  RECOMMENDED_MARK,
  ROW_INDENT,
  SAVE_FAILED,
  SPEAKER_COLOR,
  SUBMIT_LABEL,
  TAKE_BACK,
  UNCLAIMED_NOTE,
  arrivedOf,
  arrowTargetOf,
  doneWhenOf,
  entriesOf,
  focusOrderOf,
  groupsOf,
  hasHead,
  hasReplyField,
  headerLineOf,
  heldNoticeOf,
  heldOf,
  hiddenOf,
  hintOf,
  insteadOf,
  isEmptyList,
  itemButtonsOf,
  linkOf,
  marksOf,
  movingOf,
  nameOf,
  numberCellsOf,
  offerOf,
  openTaskOf,
  placeholderOf,
  readOnlyRowOf,
  replyFieldOf,
  replyKeyOf,
  rowBackTo,
  rowTitleOf,
  sentLineOf,
} from './pane'
import type { Action, Entry } from './pane'
import { isExpired, keyOf, savedIn, trimmed } from './saved'
import { workingHelperOf } from './side'
import { printable } from './text'
import {
  ARRIVED_INITIAL,
  CLIENTS_INITIAL,
  FIRST_SEAT,
  FOLDER_INITIAL,
  HEADER_INITIAL,
  HELD_INITIAL,
  LIST_SCREEN,
  LOADING,
  NEXT_ID_INITIAL,
  OFFER_INITIAL,
  RESTORED_FOR_INITIAL,
  SAVE_FAILING_INITIAL,
  TASKS_INITIAL,
  awaited,
  change,
  claim,
  dropExpired,
  edit,
  fit,
  forget,
  hidePane,
  isOpenNow,
  live,
  noteActive,
  paneView,
  persist,
  present,
  queued,
  redrawn,
  refit,
  refresh,
  ringMoved,
  rostered,
  rowsWanted,
  seatsWith,
  settle,
  show,
} from './state'
import type { Seat } from './state'
import { LIVE_CHAT, LIVE_CHAT_NOTE, isLiveChat, noteEnds, noteInput, noteStart, resultTextOf } from './gate'
import { armBatch, cancelBatch, clearUnread, inDigest, inWords, isHeld, passOn, resolve, sendSoon, wakeUp } from './delivery'
import { dismissLeft, handOffItems, scan, takeBack, takeItems, takeLeft } from './handoff'
import { askNew, doneSide, helperHooks, refusalOf, registerHelper, revive, sendQuestions, takeRiding, tasksNow } from './helper'

const PLUGIN = 'open-items'
// The same as state.ts's: a hook matcher reads only a literal or a const of this file.
const PANE = 'open-items'

const ADD = 'mcp__open-items__add_item'
const REPLY = 'mcp__open-items__reply_item'
const CLOSE = 'mcp__open-items__close_item'
const LIST = 'mcp__open-items__list_items'
const HANDOFF = 'mcp__open-items__handoff_items'
const TAKE = 'mcp__open-items__take_items'

/** The hand-off pair waits behind ToolSearch: the hand-off steps load it. */
const DEFERRED: readonly string[] = [HANDOFF, TAKE]

/**
 * After /clear or a resume, how many times, this far apart, the new
 * session's id is read while the engine still names the one that ended.
 */
const NEW_ID_READS = 3
const NEW_ID_GAP_MS = 100

const TOOLS: readonly ToolSpec[] = [
  {
    name: 'add_item',
    description: [
      "Put an item in the user's Open items pane. It stays until the user acts on it, and you keep working while it waits. The response reaches you as a message, or through list_items.",
      '',
      'When to add an item:',
      '- While background agents, shell commands or monitors run, add an item for a short ask: a detail of about 5 sentences or a short list. The `ask` line and the option notes do not count. A longer ask waits for the chat recap. Do not repeat the item in the chat.',
      "- When no background work runs, ask in the chat. add_item refuses in a live chat: the user's last two inputs were typed prompts, the last under five minutes ago, and no background work runs.",
      "- Add only what is the user's: their decision, a question only they can answer, an action only they can do, or a finding they must see.",
      '- One item per ask. To change an ask, use reply_item, not a new item.',
      '- When only the user\'s consent is missing, add a decision ("Run it" / "Don\'t"), not an action.',
      '- AskUserQuestion is the blocking kind: use it only for what you need before you can go on.',
      '',
      'How to write an item:',
      '- Plain, simple English, clear without the chat, with no internal IDs.',
      '- An imperative title, the ask in `ask`, a note for each option, and the rest in a short detail.',
      '- Numbers that are not item numbers have no "#": "PR 787", not "#787".',
      "- If you can publish artifact pages, put tables, diffs and long step lists on the session's one artifact page, and give the URL of its section in link.",
      '- For a secret, ask the user to put it where it belongs and mark the item done. Do not ask them to paste it.',
      '',
      'Before the session ends, resolve, record or hand off every open and Later item. To record one, write it and its state in the hand-off file or the final summary, then close it as withdrawn with the note "recorded in <where>". To hand items off, call handoff_items; the new session calls take_items. If they are not callable yet, load handoff_items and take_items with ToolSearch. Side questions (kind side) are the user\'s: leave them out.',
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
            "decision: the user picks one of 2 to 4 options; mark the one you suggest with recommended. question: you need the user's words (an error, a log, test results). action: the user does something you cannot do, then marks it done. info: something the user must see; it asks nothing, and no response reaches you.",
        },
        title: { type: 'string', description: 'Under 80 characters.' },
        detail: {
          type: 'string',
          description: 'What the user needs to know and why, in about 5 sentences or a short list. Markdown shows formatted. Do not repeat the options here. Up to 4000 characters.',
        },
        ask: {
          type: 'string',
          description:
            'One sentence, under 150 characters, shown first: for a decision or a question, what the user answers; for an action, what the user must do; for info, what the user must know. Required for a decision.',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 4,
          description: 'For decision only: short options.',
        },
        option_notes: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 4,
          description: 'For decision only, and required there: one line per option, in the order of options, under 120 characters, on what the option means for the user.',
        },
        recommended: { type: 'string', description: 'For decision only: spelled exactly as in options.' },
        done_when: { type: 'string', description: 'Optional, for action only: what counts as done.' },
        link: { type: 'string', description: 'Optional: a URL for the long detail.' },
      },
      required: ['kind', 'title', 'detail'],
    },
  },
  {
    name: 'reply_item',
    description: [
      "Add a message to an item's thread, change the item in place, or both. A reply does not close the item.",
      '',
      '- When the user replies on an item, answer there with reply_item, not in the chat.',
      "- A side question is the user's question to a helper. When its helper asks you something, answer it with text only, and change nothing because of it.",
      '- To change the ask, change the item in place (title, ask, options, option_notes, recommended, done_when or link), and say in text why.',
      '- After the user pressed Later, go on without the item. It stays in the pane, and you can still reply on it.',
      '- Write as "How to write an item" in add_item says.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: "The item's number." },
        text: { type: 'string', description: 'Your message to the user. It keeps its line breaks, up to 4000 characters.' },
        title: { type: 'string', description: 'A new title, under 80 characters.' },
        ask: { type: 'string', description: 'A new ask: one sentence, under 150 characters.' },
        options: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 4,
          description: 'For a decision: new options. A recommended option that is not among them is dropped.',
        },
        option_notes: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 4,
          description: 'For a decision: one note per option, in order. New options need new notes.',
        },
        recommended: { type: 'string', description: 'For a decision: spelled exactly as in its options.' },
        link: { type: 'string', description: 'A new URL for the long detail.' },
        done_when: { type: 'string', description: 'For an action: what counts as done now.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'close_item',
    description: [
      "Close an item, so it leaves the user's Open items pane. The user sees your note.",
      '',
      '- Close an item once it is settled.',
      '- When the user answers in the chat instead of in the item, close it as withdrawn with the note "answered in chat".',
      '- An item the user closed with an option or Done is closed already; do not close it again.',
      "- Before the session ends, resolve, record or hand off every open and Later item. Side questions are the user's: leave them out.",
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: "The item's number." },
        as: {
          type: 'string',
          enum: ['resolved', 'withdrawn'],
          description: 'resolved: only after the user wrote in its thread. withdrawn: you no longer need it, the user answered in the chat, or you recorded it.',
        },
        note: { type: 'string', description: 'One short line the user sees, up to 200 characters: "answered in chat", "recorded in <where>", or why.' },
      },
      required: ['id', 'as'],
    },
  },
  {
    name: 'list_items',
    description: [
      'List the items you gave the user: the state of each, whether the user replied and waits for you, whether they opened your last reply, and the last 3 entries of its thread.',
      "Call it to get an item's result, when told an answer is saved for you, or before you add an item.",
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

const tasks = atom({ plugin: 'open-items', key: 'tasks' } as const, TASKS_INITIAL)
const nextId = atom({ plugin: 'open-items', key: 'nextId' } as const, NEXT_ID_INITIAL)
const screen = atom({ plugin: 'open-items', key: 'screen' } as const, LIST_SCREEN)
const held = atom({ plugin: 'open-items', key: 'held' } as const, HELD_INITIAL)
const restoredFor = atom({ plugin: 'open-items', key: 'restoredFor' } as const, RESTORED_FOR_INITIAL)
const folder = atom({ plugin: 'open-items', key: 'folder' } as const, FOLDER_INITIAL)
/** The roster, kept where a reload of the code finds it. */
const clients = atom({ plugin: 'open-items', key: 'clients' } as const, CLIENTS_INITIAL)
const header = atom({ plugin: 'open-items', key: 'header' } as const, HEADER_INITIAL)
const offer = atom({ plugin: 'open-items', key: 'offer' } as const, OFFER_INITIAL)
const saveFailing = atom({ plugin: 'open-items', key: 'isSaveFailing' } as const, SAVE_FAILING_INITIAL)
const arrived = atom({ plugin: 'open-items', key: 'arrived' } as const, ARRIVED_INITIAL)

/** Whether Claude has a part in `task`: any item but a side question, and a side question while its helper's question waits for Claude. */
const concernsClaude = (task: Task) => !isSide(task) || task.side?.toMain?.kind === 'question'

/** What `list_items` gives: item `id`, or the items `show` names, `updates` when it names none. */
function pickedOf(list: readonly Task[], id: number | undefined, show: unknown): readonly Task[] {
  if (id !== undefined) {
    return list.filter(task => task.id === id)
  }

  switch (show) {
    case 'all':
      return list
    case 'open':
      return list.filter(task => isActive(task) && concernsClaude(task))
    default:
      return list.filter(task => (isShown(task) || task.update === 'pending') && concernsClaude(task))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const tool of TOOLS) {
      await $.tool.register(tool)
    }

    await $.command.register({ name: 'open-items', description: 'Show the items Claude gave you', immediate: true })
    await $.command.register({ name: 'side', description: 'Leave a side question for a helper; Claude goes on', argumentHint: '[#N] <question>', immediate: true })
    await registerHelper($)
    await update($, folder, known => known ?? e.cwd)
    await noteActive($)
    // Background tasks may have started unseen in a conversation with rows already (a resume, the mod
    // loaded mid-session), or before a reload of the code, which finds the session read (see `takeUp`).
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
    // Its answers stay unsent in its key: a prompt sent now could reach the session /clear starts.
    cancelBatch()
    live.ends += 1
    const endedMs = await $.clock.now()
    await update($, header, now => ({ ...now, endedMs }))
    const written = persist($).catch(() => undefined)
    const leftMs = next.budget.remainingMs

    await (Number.isFinite(leftMs) ? Promise.race([written, $.clock.sleep(leftMs / 2)]) : written)

    const ended = await next(e)

    // After /clear or a resume the process goes on as another session, with
    // no session.start; the engine names it only once this hook is done.
    if (e.reason === 'clear') {
      $.clock.after(0, () => void startCleared($, e.sessionId).catch(() => undefined))
    } else if (e.reason === 'resume') {
      $.clock.after(0, () => void startResumed($, e.sessionId).catch(() => undefined))
    }

    return ended
  })

  on('command.run', { command: 'open-items' }, async $ => {
    // Set before the pane draws, so its first drawing has the field; a pane not placed is not kept.
    live.isKeptOpen = true
    live.isKeptOpen = await show($, true)

    return {}
  })

  helperHooks(on)

  // The four tools of every turn stay in the prompt's list, where an MCP tool would wait behind ToolSearch:
  // their descriptions carry the steering, the one prompt text that reaches Claude on every seat.
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

    const active = (await read($, tasks)).filter(task => isActive(task) && !isSide(task))
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

    // A move by the user that Claude has not heard is never sent once Claude's
    // reply follows it in the thread, so this result tells Claude of it.
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

    // The user asked the helper, not Claude, so Claude's answer opens no pane and alerts no one.
    if (isSide(found)) {
      $.ui.toast(`Claude answered side question #${found.id}. See /open-items`)

      return { result: `Added your answer to side question #${found.id}. The user reads it in the item.` }
    }

    // `found` is the item before the reply, which may rename it.
    const title = printable(reply.change?.title ?? found.title, MAX_TITLE)
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

    const isRefused = (task: Task) => isSide(task) || (close.as === 'resolved' && !hasAnswerIn(task))
    const found = await edit($, close.id, task => (isRefused(task) ? task : closedAs(task, close)))

    if (found === undefined) {
      return { deny: `No item #${close.id}.` }
    }

    if (isSide(found)) {
      return { deny: 'Only the user closes a side question (Done).' }
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
    const picked = pickedOf(await read($, tasks), id, args['show'])

    if (id !== undefined && picked.length === 0) {
      return { result: `No item #${id}.` }
    }

    // Only the main agent's read tells Claude the responses it shows, and not one held for the batch:
    // the batch sends that one in the user's own words, which auto mode reads as their consent.
    if (e.agentId === undefined) {
      await claim($, task => !isHeld(task) && picked.some(one => one.id === task.id && one.update === 'pending'))
    }

    return { result: listOf(picked, await $.clock.now(), id !== undefined) }
  })

  on('tool.call', { tool: HANDOFF }, ($, e) => handOffItems($, e))

  on('tool.call', { tool: TAKE }, ($, e) => takeItems($, e))

  // Observes only: the mod hooks no tool of Claude Code's own, so it reads a background start from the main
  // loop's result row. A subagent's background work counts while the subagent runs (`$.agent.list()`).
  on('session.append', { door: 'tool-result' }, async ($, e, next) => {
    const tool = e.origin.kind === 'tool' ? e.origin.tool : undefined

    if (e.agentId === undefined && (tool === 'Bash' || tool === 'Monitor')) {
      try {
        noteStart(tool, resultTextOf(e.message.content))
      } catch {
        live.background = null
      }
    }

    return next(e)
  })

  // Only the main loop's events say whether Claude reads an appended row: a
  // subagent's turns read their own conversation.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      live.alertedTurn = false
      live.mainTurn = true
      live.wasStopped = false
      clearUnread($)
      await noteActive($)
      await awaited($, Promise.all([scan($), persist($)]))
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      clearUnread($)
    }

    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId === undefined) {
      live.alertedTurn = false
      live.mainTurn = false
      live.wasStopped = e.reason === 'aborted'

      // A row that joined the turn during its last request has no step left to read it. After the user's Esc it
      // stays unread until the next prompt reads it, and a helper's question rides that prompt: a send would start the turn they just stopped.
      if (!live.wasStopped) {
        if (live.unreadAppend.size > 0) {
          wakeUp($)
        }

        void sendQuestions($)
      }
    }

    return result
  })

  on('ui.press', { plugin: PLUGIN }, ($, e, next) => pressedOn($, e.element, () => next(e)))

  on('ui.input', { plugin: PLUGIN }, ($, e, next) => (e.kind === 'submit' ? pressedOn($, e.element, () => next(e)) : next(e)))

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'plugin' && e.origin.name === PLUGIN) {
      return next(e)
    }

    // A prompt from the Remote Control bridge (a phone) is one the user typed in the chat too. A slash
    // command is no back-and-forth with Claude, so the live-chat gate does not count it.
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    const isTyped = isPerson && e.command === undefined
    // Only the user's own prompt answers an item: from any other origin (a hand-back, a notification,
    // another plugin) the move would reach Claude in the user's words, as their consent.
    const bridged = isTyped ? answerIn(e.text) : null

    if (isPerson) {
      live.lastPersonMs = await $.clock.now()
    }

    if (e.origin.kind === 'task-notification') {
      noteEnds(e.text)
    }

    const items = bridged === null ? [] : await read($, tasks)
    const side = bridged === null ? undefined : items.find(one => one.id === bridged.id && isSide(one))

    // An answer meant for a helper would reach Claude in the user's words, as their consent. Dropped, it
    // reached no one, so the live-chat gate does not count it either.
    if (side !== undefined) {
      const drop = isActive(side)
        ? `#${side.id} is a side question: use /side #${side.id} <text>, or its field in /open-items.`
        : isAway(side)
          ? unsavedOf(side.id, true)
          : `#${side.id} is a closed side question: ask a new one with /side.`

      return { drop }
    }

    if (isTyped) {
      noteInput(bridged === null ? 'typed' : 'bridge', live.lastPersonMs)
    }

    const task = bridged === null ? undefined : items.find(one => one.id === bridged.id && isOpenAsk(one))
    let isAnswered = false

    if (bridged !== null && task !== undefined) {
      if (looksSecret(bridged.answer)) {
        return {
          drop: `This looks like a secret, so it wasn't sent. Put it where it belongs, then ${insteadOf(task.kind, task.id)}.`,
        }
      }

      const overLimit = overLimitOf(task.id, bridged.answer)

      if (overLimit !== undefined) {
        return { drop: overLimit }
      }

      // While Claude is idle, this prompt is the answer, sent with every other update Claude has not
      // heard, the batch's among them: the batch waits until the prompt is known to be one.
      const isPaused = e.turnId === undefined && live.batch !== null

      if (isPaused) {
        live.batch?.cancel()
        live.batch = null
      }

      // An item closed meanwhile (Claude withdrew it, say) keeps no answer:
      // the prompt goes as typed. One with nothing after its head is Done.
      const was = await resolve($, task.id, bridged.answer === '' ? DONE : replyOf(bridged.answer))
      isAnswered = was !== undefined && isActive(was)

      // Typed over a running turn, the prompt may wait for the turn to end:
      // the batch takes the answer into the turn instead.
      if (isAnswered && e.turnId !== undefined) {
        const now = (await read($, tasks)).find(one => one.id === task.id)

        if (now?.update !== 'pending') {
          return { drop: `Your answer to #${task.id} already went to Claude.` }
        }

        // The same answer again, after a send gave it back: no batch holds it.
        if (!isHeld(now)) {
          sendSoon($, task.id)
        }

        return { drop: `Your answer to #${task.id} goes to Claude now.` }
      }

      if (isAnswered) {
        cancelBatch()
      } else if (isPaused) {
        armBatch($)
      }
    }

    // What the batch sends goes in the user's own words, not beside a prompt
    // that is not theirs (a task notification, a hand-back).
    const due = (await claim($, one => !isHeld(one))).filter(hasNewsIn)
    // An item still here has its answer in this prompt, or in another send
    // that took it as it was saved. One gone meanwhile (a /clear) leaves the
    // prompt as typed.
    const isAnswer = isAnswered && task !== undefined && (await read($, tasks)).some(one => one.id === task.id)

    if (isAnswer && due.length === 0) {
      return { drop: `Your answer to #${task.id} already went to Claude.` }
    }

    // Some seats skip this mod's prompt.context and session.compact hooks, so
    // a line on every prompt is what reminds a Claude past a compaction.
    const list = await read($, tasks)
    const reminder = reminderOf(list.filter(one => !isAway(one)), isHeld)
    // A helper's note, or its question held back, goes to the main session only beside the user's own words.
    const riding = isTyped ? await takeRiding($).catch(() => undefined) : undefined
    const context = [
      ...(e.context ?? []),
      ...(due.length > 0 && !isAnswer ? [digestOf(due)] : []),
      ...(riding === undefined ? [] : [riding.context]),
      ...(reminder === undefined ? [] : [reminder]),
    ]
    const entered = { ...e, ...(isAnswer ? { text: messageOf(due) } : {}), ...(context.length > 0 ? { context } : {}) }
    const pass = () => (due.length === 0 ? next(entered) : isAnswer ? passOn($, due, inWords, 'kept', () => next(entered)) : passOn($, due, inDigest, 'nothing', () => next(entered)))

    // One that a hook beneath dropped or took out of the context, or a prompt that failed, leaves it for the next typed prompt.
    return riding === undefined ? pass() : riding.carry(pass)
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

  // Closed by the person's close mark too, the pane is no longer one they keep open.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)

    if (closed.deny === undefined) {
      live.isKeptOpen = false
    }

    return closed
  })

  // The ring on the reply field lets the terminal wrap what is typed there:
  // the pane asks for the rows that takes, and for one row once it leaves.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const was = live.ring
    const moved = await next(e)

    if (moved.deny === undefined) {
      live.ring = e.element
      void refit($)
    }

    ringMoved($, was, e.element)

    return moved
  })

  // In a list longer than the pane, the engine spends an arrow on scrolling the body: here it moves the ring
  // a row instead (arrows summed into one `by`, and a page key, as many rows), and the window follows.
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    const isKey = e.origin.kind === 'person' && e.pointer === undefined && e.by !== 0 && e.contentRows > e.bodyRows
    const view = isKey ? await paneView($, FIRST_SEAT) : undefined
    const to = view !== undefined && openTaskOf(view) === undefined ? arrowTargetOf(focusOrderOf(view.shown, view), live.ring, e.by) : undefined

    if (to === undefined) {
      return next(e)
    }

    // Set before the move lands, so a held key's next arrow moves on from here; put back if the engine
    // refuses the move and no later one came (a call that fails leaves it, as `toList` does).
    const was = live.ring
    live.ring = to

    void $.ui
      .focus({ requestId: PANE, key: to })
      .then(moved => {
        if (moved.deny === undefined) {
          return $.ui.scroll({ in: PANE, to: { key: to } })
        }

        if (live.ring === to) {
          live.ring = was
        }
      })
      .catch(() => undefined)

    return { deny: 'An arrow moves the focus between the rows of the list.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const emptied = live.emptied.get(e.surface)
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Link, Markdown } = elements
    // The mobile app draws no field yet: replies wait for a surface that does. The engine fills an element
    // a surface lacks with one that draws nothing, so the surface says, not the table.
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

    const { shown, moved = [] } = view

    // The pane is closing: it asks for no rows, which would open it again.
    if (!live.isKeptOpen && isEmptyList(view)) {
      return <Text dimColor>{EMPTY_LINE}</Text>
    }

    if (seat.isInline || wasInline) {
      const rows = await rowsWanted($, view)

      if (rows !== live.rows) {
        void fit($, rows)
      }
    }

    const hint = (
      <Text dimColor wrap="wrap">
        {hintOf(view)}
      </Text>
    )
    const hide = (
      <Box flexShrink={0}>
        <Button key="hide" plain dimColor role="dismiss" label={HIDE} onPress={() => hidePane($)} />
      </Box>
    )
    const unsaved =
      view.isSaveFailing === true ? (
        <Box key="unsaved" flexShrink={0}>
          <Text color="red" wrap="wrap">
            {SAVE_FAILED}
          </Text>
        </Box>
      ) : null
    const heldNotice = (notice: string, onEdit: () => Promise<void>, onSend: () => Promise<void>) => (
      <Box key="held" flexDirection="column">
        <Text color="yellow" wrap="wrap">
          {notice}
        </Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={BUTTON_GAP}>
          <Button key="edit" plain label={HELD_BUTTONS[0]} onPress={onEdit} />
          <Button key="send-anyway" plain label={HELD_BUTTONS[1]} onPress={onSend} />
        </Box>
      </Box>
    )
    const task = openTaskOf(view)

    if (task !== undefined) {
      const key = replyKeyOf(task.id)
      const link = linkOf(task)
      const doneWhen = doneWhenOf(task)
      const heldText = heldOf(task, view)
      const thread = entriesOf(task, view.nowMs)
      const [detail, ...newest] = thread.entries
      const sent = sentLineOf(task, view)
      const { choices, buttons } = itemButtonsOf(task)
      const isField = hasReplyField(task, view)
      const drawn = focusOrderOf(shown)
      const color = KIND_COLOR[task.kind]
      const headerLine = headerLineOf(task, view)
      const field = replyFieldOf(task)
      const button = (action: Action) => (
        <Button
          key={action.key}
          plain
          hotkey={action.hotkey}
          label={action.label}
          onPress={() => (isSide(task) ? closeSide($, task.id, drawn) : pressOn($, task.id, action.move, drawn))}
        />
      )

      // A Text keeps no key: each entry's Box holds it.
      const entry = ({ i, head, text, look }: Entry) => [
        ...(head === undefined
          ? []
          : [
              <Box key={`head-${i}`} flexDirection="column" marginTop={1}>
                <Text wrap="wrap">
                  <Text bold color={SPEAKER_COLOR[head.who]}>
                    {head.who}
                  </Text>
                  <Text dimColor>{` · ${head.age}`}</Text>
                </Text>
              </Box>,
            ]),
        <Box key={`msg-${i}`} flexDirection="column" marginTop={head === undefined && i > 0 ? 1 : 0}>
          {look === 'markdown' ? (
            <Markdown text={text} />
          ) : (
            <Text dimColor={look === 'event'} wrap="wrap">
              {text}
            </Text>
          )}
        </Box>,
      ]

      return (
        <Box flexDirection="column">
          {unsaved}
          <Box key={`item-${task.id}`} flexDirection="column" flexShrink={0}>
            <Box key="header" flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
              <Text>
                <Text backgroundColor={color} color="inverseText" bold>
                  {headerLine.label}
                </Text>
                <Text dimColor>{headerLine.rest}</Text>
              </Text>
              <Text bold wrap="wrap">
                {nameOf(task)}
              </Text>
            </Box>
            {task.askLine === undefined ? null : (
              <Box key="ask" flexDirection="row" marginTop={1}>
                <Box flexShrink={0}>
                  <Text color={color}>{ASK_BAR}</Text>
                </Box>
                <Text color={color} bold wrap="wrap">
                  {printable(task.askLine, MAX_ASK)}
                </Text>
              </Box>
            )}
            <Box key="thread" flexDirection="column" marginTop={1}>
              {detail === undefined ? null : entry(detail)}
              {thread.hidden === 0 ? null : (
                <Box key="earlier" flexDirection="column" marginTop={1}>
                  <Text dimColor wrap="wrap">
                    {hiddenOf(thread.hidden)}
                  </Text>
                </Box>
              )}
              {newest.flatMap(entry)}
              {sent === undefined ? null : (
                <Box key="sent" flexDirection="column">
                  <Text dimColor wrap="wrap">
                    {sent}
                  </Text>
                </Box>
              )}
            </Box>
            {link === undefined ? null : (
              <Box key="link" flexDirection="row">
                <Box flexShrink={0}>
                  <Text dimColor>{LINK_LABEL}</Text>
                </Box>
                <Link href={link} />
              </Box>
            )}
            {doneWhen === undefined ? null : <Text wrap="wrap">{doneWhen}</Text>}
            {choices.length === 0 ? null : (
              <Box flexDirection="column" marginTop={1}>
                {choices.map(({ action, note, isRecommended }, i) => (
                  <Box
                    key={`choice-${i + 1}`}
                    flexDirection="column"
                    borderStyle="round"
                    borderColor={isRecommended ? 'success' : 'subtle'}
                    paddingX={1}
                    hover={{ backgroundColor: FOCUS_BACKGROUND }}
                    backgroundColor={e.props.isFocused && live.ring === action.key ? FOCUS_BACKGROUND : undefined}
                  >
                    <Box flexDirection="row" flexWrap="wrap">
                      {button(action)}
                      {isRecommended ? (
                        <Box flexShrink={0}>
                          <Text color="success">{RECOMMENDED_MARK}</Text>
                        </Box>
                      ) : null}
                    </Box>
                    {note === undefined ? null : <Text wrap="wrap">{note}</Text>}
                  </Box>
                ))}
              </Box>
            )}
            {buttons.length === 0 && !isField ? null : (
              <Box key="options" flexDirection="row" flexWrap="wrap" columnGap={BUTTON_GAP} marginTop={1}>
                {buttons.map(button)}
                {/* A long answer goes by the prompt box's bridge, which no side question takes. */}
                {isField && !isSide(task) ? <Button key={LONG_ANSWER.key} plain label={LONG_ANSWER.label} onPress={() => longAnswer($, task.id)} /> : null}
              </Box>
            )}
            {heldText === undefined ? null : heldNotice(heldNoticeOf(task), () => editHeld($, task.id), () => answer($, task.id, heldText, true))}
            {!isField || Input === undefined ? null : (
              <Input
                key={key}
                label={field.label}
                placeholder={placeholderOf(field.placeholder, field.label, SUBMIT_LABEL, columns)}
                value={fieldValueOf(e.surface, key)}
                submitLabel={SUBMIT_LABEL}
                onInput={value => typed($, key, value)}
                onSubmit={value => answer($, task.id, value)}
              />
            )}
          </Box>
          {/* Tab from the reply field goes to Back, the field's next Button. */}
          <Box key="foot" flexDirection="row" columnGap={BUTTON_GAP} flexShrink={0}>
            {hint}
            <Box flexShrink={0}>
              <Button key={BACK.key} plain hotkey={BACK.hotkey} label={BACK.label} onPress={() => toList($, task.id, drawn)} />
            </Box>
            {hide}
          </Box>
        </Box>
      )
    }

    const head = waitingOf(shown)
    const numberCells = numberCellsOf(shown)
    const cameHere = arrivedOf(view)
    const offered = offerOf(view)
    const ownKey = keyOf(live.sessionId)
    const drawnOffer = (await read($, offer)).filter(entry => entry.key !== ownKey)
    const moving = movingOf(shown)
    // A Text keeps no key: each row's Box holds it.
    const readOnlyRows = (prefix: string, items: readonly Task[]) =>
      items.map(one => (
        <Box key={`${prefix}-${one.id}`}>
          <Text dimColor>{readOnlyRowOf(one, columns)}</Text>
        </Box>
      ))

    const heldNew = heldOf(NEW_HELD, view)
    // A row is one line, its title cut to fit: the item screen draws it whole.
    const row = (one: Task) => {
      const { newReply, waiting } = marksOf(one, view)

      return (
        <Button key={`row-${one.id}`} plain onPress={() => openItem($, one.id, view.canType)}>
          {rowTitleOf(one, numberCells, columns, view)}
          {newReply === '' ? '' : <Text color="yellow">{newReply}</Text>}
          {waiting === '' ? '' : <Text dimColor>{waiting}</Text>}
        </Button>
      )
    }

    return (
      <Box flexDirection="column">
        {unsaved}
        {cameHere === undefined ? null : (
          <Box key="arrived" flexShrink={0}>
            <Text dimColor wrap="wrap">
              {cameHere}
            </Text>
          </Box>
        )}
        {offered === undefined ? null : (
          <Box key="offer" flexDirection="column" flexShrink={0}>
            <Text wrap="wrap">{offered}</Text>
            <Box flexDirection="row" flexWrap="wrap" columnGap={BUTTON_GAP}>
              {OFFER_BUTTONS.map(button => (
                <Button
                  key={button.key}
                  plain
                  label={button.label}
                  onPress={() => (button.key === 'take' ? takeLeft($, drawnOffer) : dismissLeft($, drawnOffer))}
                />
              ))}
            </Box>
          </Box>
        )}
        {!isEmptyList(view) ? null : (
          <Box key="empty" flexShrink={0}>
            <Text dimColor wrap="wrap">
              {EMPTY_LINE}
            </Text>
          </Box>
        )}
        {!hasHead(shown) ? null : (
          <Box key="head" flexDirection="row" flexShrink={0}>
            <Text wrap="wrap">
              <Text color={shown.some(waitsOnUser) ? 'yellow' : 'gray'}>{head.glyph}</Text>
              <Text bold>{head.headline}</Text>
            </Text>
          </Box>
        )}
        {groupsOf(shown).map(group => (
          <Box key={`section-${group.label}`} flexDirection="column" flexShrink={0}>
            <Text bold color="yellow">
              {group.label}
            </Text>
            <Box flexDirection="column" paddingLeft={ROW_INDENT}>
              {group.tasks.map(row)}
            </Box>
          </Box>
        ))}
        {Input === undefined ? null : (
          <Input
            key={NEW_SIDE.key}
            label={NEW_SIDE.label}
            placeholder={placeholderOf(NEW_SIDE.placeholder, NEW_SIDE.label, NEW_SIDE.submitLabel, columns)}
            value={fieldValueOf(e.surface, NEW_SIDE.key)}
            submitLabel={NEW_SIDE.submitLabel}
            onInput={value => typed($, NEW_SIDE.key, value)}
            onSubmit={value => askTyped($, value)}
          />
        )}
        {heldNew === undefined ? null : heldNotice(heldNoticeOf(NEW_HELD), () => editNew($), () => askHeld($))}
        {moving.length === 0 ? null : (
          <Box key="moving" flexDirection="column" flexShrink={0}>
            <Text bold color="yellow">
              {MOVING_LABEL}
            </Text>
            <Box flexDirection="column" paddingLeft={ROW_INDENT}>
              {readOnlyRows('moving', moving)}
              {view.isUnclaimed !== true ? null : (
                <Box key="unclaimed" flexDirection="column">
                  <Text wrap="wrap">{UNCLAIMED_NOTE}</Text>
                  <Box flexShrink={0}>
                    <Button key={TAKE_BACK.key} plain label={TAKE_BACK.label} onPress={() => takeBack($)} />
                  </Box>
                </Box>
              )}
            </Box>
          </Box>
        )}
        {moved.length === 0 ? null : (
          <Box key="moved" flexDirection="column" flexShrink={0}>
            <Text bold color="yellow">
              {MOVED_LABEL}
            </Text>
            <Box flexDirection="column" paddingLeft={ROW_INDENT}>
              {readOnlyRows('moved', moved)}
            </Box>
          </Box>
        )}
        <Box key="foot" flexDirection="row" columnGap={BUTTON_GAP} flexShrink={0}>
          {hint}
          {hide}
        </Box>
      </Box>
    )
  })
}

/**
 * Goes on as the session /clear started after `endingId`: it has no saved
 * items to read, and is offered at once those the ended one left. One the
 * engine never names starts empty and saves nothing: its writes would go
 * over the ended session's key.
 */
async function startCleared($: EngineInterface, endingId: string) {
  const sessionId = await newIdAfter($, endingId)
  const working = (await tasksNow($)).flatMap(task => workingHelperOf(task) ?? [])

  await switchTo($, sessionId ?? endingId)

  // The ended session's helpers would run on, unbounded, beside the new session's. Stopped once its items
  // are gone, a stopped report finds none, so it frees no queue for a side question that waited.
  for (const helperId of working) {
    void $.tool.call({ tool: 'TaskStop', task_id: helperId }).catch(() => undefined)
  }

  if (sessionId !== undefined) {
    await update($, restoredFor, () => sessionId)
    await scan($)
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
  cancelBatch()
  live.mainTurn = undefined
  live.wasStopped = false
  live.unreadAppend.clear()
  live.moved.clear()
  live.inputs = []
  // The old session's helpers are gone with it; the quota state stays, as the window is the account's.
  live.helperTimers.forEach(timer => timer.cancel())
  live.helperTimers.clear()
  live.stoppedHelpers.clear()
  const cwd = await $.session.cwd().catch(() => undefined)
  const nowMs = await $.clock.now()
  await update($, folder, known => cwd ?? known)
  await update($, restoredFor, () => null)
  await update($, tasks, () => [])
  await update($, nextId, () => 1)
  await update($, header, (): Header => ({ lastActiveMs: nowMs, taken: [] }))
  await update($, offer, (): Offer => [])
  await update($, saveFailing, () => false)
  await update($, arrived, () => [])
  await update($, screen, () => LIST_SCREEN)
  await update($, held, () => null)
  await refresh($)
}

/**
 * Takes up the items this session saved, when its key has them (a resumed
 * session), and deletes the keys of sessions saved more than `KEEP_MS` ago;
 * then acts on what other sessions did (see `scan`). Until the read settles,
 * the tools refuse: an item Claude added meanwhile would go under the items
 * read. A store slow to answer holds up the start 5 seconds at most.
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
  const scanned = Promise.all([restored, cleaned]).then(async ([isKept, all]) => {
    if (live.ends !== ends || live.sessionId !== sessionId) {
      return false
    }

    // A resumed session's key says at once that it runs again, so no other session offers its items.
    if (isKept) {
      void persist($).catch(() => undefined)
      void revive($).catch(() => undefined)
    }

    await scan($, all)

    return isKept
  })

  // The pane opens for what was read, unless the session has ended since.
  const shown = scanned
    .then(async isKept => {
      if (isKept && (await refresh($)) && live.ends === ends) {
        await show($, false)
      }
    })
    .catch(() => undefined)

  await awaited($, Promise.allSettled([restored, cleaned, scanned]))
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

    // Taken up, an ended session runs again; one that ended while its key was read stays ended.
    await update($, header, (now): Header => ({
      lastActiveMs: nowMs,
      taken: saved.taken,
      ...(saved.handoff === undefined ? {} : { handoff: saved.handoff }),
      ...(now.endedMs === undefined ? {} : { endedMs: now.endedMs }),
    }))
  }

  await update($, restoredFor, () => sessionId)

  return isKept
}

/** Keeps what the user typed in the field keyed `key`, and the rows it takes. */
async function typed($: EngineInterface, key: string, value: string) {
  // Keys typed in a field say the ring is on it, though no move said so.
  const was = live.ring
  live.ring = key
  ringMoved($, was, key)
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
 * Opens item `id`'s screen, the ring in its reply field where the pressed
 * drawing's surface draws one (`canType`), else on Back.
 */
async function openItem($: EngineInterface, id: number, canType: boolean) {
  // Pressed on a drawing from before its item closed, it leaves the pane as it is.
  if (!(await isOpenNow($, id))) {
    return
  }

  // The list's field goes from the screen: back on the list, it is drawn again with its draft.
  forget(replyKeyOf(id))
  forget(NEW_SIDE.key)
  await update($, arrived, ids => (ids.includes(id) ? [] : ids))
  await update($, screen, (): Screen => ({ kind: 'item', id }))
  // A new side question's hold stays: the draft holds no copy of it.
  const kept = await update($, held, now => (now?.id === id || now?.id === 'new' ? now : null))
  await markRead($, id)

  // The engine keeps the ring at the row's place, on whatever the item screen draws there: an option a
  // second Enter would choose. In the field, typed keys stay text (a hotkey there would answer Claude).
  const task = (await read($, tasks)).find(one => one.id === id)
  const key = task !== undefined && hasReplyField(task, { canType, held: kept }) ? replyKeyOf(id) : BACK.key
  const was = live.ring
  live.ring = key
  await fit($)

  void $.ui
    .focus({ requestId: PANE, key })
    .then(moved => {
      if (moved.deny !== undefined && live.ring === key) {
        live.ring = was
        return refit($)
      }
    })
    .catch(() => undefined)
}

/** The user has seen Claude's last reply on item `id`, which its screen shows. */
async function markRead($: EngineInterface, id: number) {
  await edit($, id, task => (task.hasNewReply ? { ...task, hasNewReply: false } : task))
}

/**
 * Back to the list from item `id`'s screen, the ring on the row `rowBackTo`
 * finds from the list as the screen drew it (`drawn`), so the next ↓ goes on
 * from there; a draft stays with its item.
 */
async function toList($: EngineInterface, id: number, drawn: readonly string[] = []) {
  await update($, arrived, () => [])
  await update($, screen, () => LIST_SCREEN)
  await update($, held, now => (now?.id === 'new' ? now : null))
  await markRead($, id)
  const row = rowBackTo(id, drawn, focusOrderOf((await read($, tasks)).filter(isShown)))
  live.ring = row
  await fit($)

  if (row !== undefined) {
    void $.ui.focus({ requestId: PANE, key: row }).catch(() => undefined)
  }
}

/** A press of one of item `id`'s buttons, then the list, unless the press chose an option Claude has changed since. */
async function pressOn($: EngineInterface, id: number, move: Move, drawn: readonly string[]) {
  if (move === SEEN) {
    await markSeen($, id)
  } else if (!(await respond($, id, move))) {
    return
  }

  await toList($, id, drawn)
}

/** Done on side question `id`'s screen, then the list. */
async function closeSide($: EngineInterface, id: number, drawn: readonly string[]) {
  await doneSide($, id)
  await toList($, id, drawn)
}

/**
 * A press on the pane makes the user's `move` on item `id`, as `resolve`
 * does. One Claude withdrew, or the user answered otherwise (on another
 * surface, say), since the pane drew it says so, and what the user typed for
 * it (`typedText`) goes to the prompt box, unless it looks like a secret; one
 * the user's last move already matches (a second press) stays as it is.
 * Resolves false for an option Claude has changed since: nothing is saved.
 */
async function respond($: EngineInterface, id: number, move: Move, typedText = ''): Promise<boolean> {
  const was = await resolve($, id, move)

  if (isStale(was, move)) {
    $.ui.toast(`Item #${id} changed since the pane showed it, so your choice wasn't saved. Look at its options again.`, { timeoutMs: 8000 })

    return false
  }

  if (was === undefined || (!isActive(was) && !isRepeatOf(was, move))) {
    const kept = (await toPromptBox($, typedText)) ? ' What you typed is in the prompt box.' : ''

    $.ui.toast(`${unsavedOf(id, was !== undefined && isAway(was))}${kept}`, { timeoutMs: 8000 })
  }

  return true
}

/** Why the user's response to item `id` wasn't saved: it moved to a new session (`isMoved`), or it closed. */
function unsavedOf(id: number, isMoved: boolean): string {
  return `Item #${id} ${isMoved ? 'moved to a new session' : "isn't open any more"}, so your response wasn't saved.`
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
async function answerTyped($: EngineInterface, id: number) {
  const key = replyKeyOf(id)

  return answer($, id, live.drafts.get(key) ?? live.closed.get(key) ?? '')
}

/** The user looked at info item `id`: it leaves the pane, and Claude hears nothing. */
async function markSeen($: EngineInterface, id: number) {
  if (await edit($, id, (task, nowMs) => movedBy(task, SEEN, nowMs))) {
    await settle($, id)
  }
}

async function answer($: EngineInterface, id: number, text: string, isSecretOk = false) {
  const value = text.trim()
  // Entered or pressed on a drawing from before its task closed, an answer
  // goes to `respond`, which says the task isn't open any more.
  const isOpen = await isOpenNow($, id)

  if (isOpen && value === '') {
    $.ui.toast('Type a reply first.')
    return
  }

  const overLimit = overLimitOf(id, value)

  if (isOpen && overLimit !== undefined) {
    $.ui.toast(overLimit, { timeoutMs: 8000 })
    return
  }

  if (isOpen && !isSecretOk && looksSecret(value)) {
    await update($, held, (): Held => ({ id, text: value }))
    return
  }

  await respond($, id, replyOf(value), value)
}

/** Puts the reply held for looking like a secret back in item `id`'s field, its draft in it, to change it. */
async function editHeld($: EngineInterface, id: number) {
  // Pressed on a drawing from before its item closed, it leaves the pane as it is.
  if (!(await isOpenNow($, id))) {
    return
  }

  const key = replyKeyOf(id)

  forget(key)
  live.ring = key
  await update($, held, () => null)
  await fit($)

  // A field the pane can't focus (it doesn't hold the keyboard) is still a click away.
  void $.ui.focus({ requestId: PANE, key }).then(undefined, () => undefined)
}

async function askTyped($: EngineInterface, value: string) {
  const text = value.trim()

  // v0.2's order: a refused question stays in the field, and a held one can always be sent.
  if (refusalOf(text) === undefined && looksSecret(text)) {
    await update($, held, (): Held => ({ id: 'new', text }))
  } else if (!(await askNew($, text))) {
    return
  }

  live.drafts.delete(NEW_SIDE.key)
  forget(NEW_SIDE.key)
}

/** Takes the new side question held back out of hold, once: a second press on an older drawing finds none. */
async function unheldNew($: EngineInterface): Promise<string | undefined> {
  let text: string | undefined

  await update($, held, now => {
    text = now?.id === 'new' ? now.text : undefined
    return text === undefined ? now : null
  })

  return text
}

async function editNew($: EngineInterface) {
  const text = await unheldNew($)

  if (text === undefined) {
    return
  }

  live.drafts.set(NEW_SIDE.key, text)
  forget(NEW_SIDE.key)
  live.ring = NEW_SIDE.key
  await fit($)
  void $.ui.focus({ requestId: PANE, key: NEW_SIDE.key }).then(undefined, () => undefined)
}

async function askHeld($: EngineInterface) {
  const text = await unheldNew($)

  if (text !== undefined && !(await askNew($, text))) {
    await update($, held, (now): Held | null => now ?? { id: 'new', text })
  }
}

/**
 * Moves a long answer into the prompt box, where the real editor takes
 * pastes and lines, and goes back to the list: a field drawn with the same
 * value keeps its text, so it would go on showing what moved.
 */
async function longAnswer($: EngineInterface, id: number) {
  // Pressed on a drawing from before its item closed, it answers with what
  // was typed, which `respond` puts in the prompt box.
  if (!(await isOpenNow($, id))) {
    return answerTyped($, id)
  }

  const key = replyKeyOf(id)
  const box = await $.prompt.read()
  const draft = live.drafts.get(key) ?? ''
  const text = bridgeOf(id) + [draft, box.text].filter(part => part.trim() !== '').join('\n')
  const filled = await $.prompt.fill({ text, mode: 'replace' })

  if (!filled.isFilled) {
    $.ui.toast("Couldn't open the prompt box for your answer; type it here instead.")
    return
  }

  live.drafts.delete(key)
  await toList($, id)
  $.ui.toast('Write your answer in the prompt box (Esc gets you there), then press Enter.', {
    timeoutMs: 8000,
  })
}

/**
 * A press or a reply on pane element `element`, which `act` carries out: the
 * user is here, and what other sessions did is read before it acts, so an
 * item another session took meanwhile takes no answer here. The live-chat
 * gate counts it, unless it asks or answers a side question: no Claude is in
 * that exchange.
 */
async function pressedOn<R>($: EngineInterface, element: string, act: () => Promise<R>): Promise<R> {
  // The screen before the press, which may leave it; the items only after, so no read of them holds the press back while the pane is drawn anew.
  const pressedOnScreen = await read($, screen)
  live.lastPersonMs = await $.clock.now()
  await noteActive($)
  await awaited($, scan($))

  try {
    return await act()
  } finally {
    if (!(await isSideElement($, element, pressedOnScreen))) {
      noteInput('press', live.lastPersonMs)
    }
  }
}

/**
 * Whether `element`, pressed on `onScreen`, is the field for a new side
 * question or its Edit and Send anyway (the list holds no other), a side
 * question's row or reply field, or anything on its screen.
 */
async function isSideElement($: EngineInterface, element: string, onScreen: Screen): Promise<boolean> {
  const list = await read($, tasks)
  const isSideId = (id: number) => list.some(task => task.id === id && isSide(task))
  const own = /^(?:row|reply)-(\d+)$/.exec(element)
  const isNewHeld = onScreen.kind === 'list' && (element === 'edit' || element === 'send-anyway')

  return element === NEW_SIDE.key || isNewHeld || (own !== null && isSideId(Number(own[1]))) || (onScreen.kind === 'item' && isSideId(onScreen.id))
}
