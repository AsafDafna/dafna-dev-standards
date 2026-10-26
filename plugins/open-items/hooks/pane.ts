import type { Held, Message, Screen, Task, TaskKind } from '../types'
import { DONE, LATER, MAX_DETAIL, MAX_OPTION, PRESSED, SEEN, choseOf, isActive, waitingOf } from './tasks'
import type { Move } from './tasks'
import { ago, cellsOf, clip, clipCells, linesRowsOf, plural, printable, printableLines, rowsOf } from './text'

/**
 * The longest title the pane and the transcript draw. `add_item` takes
 * titles of at most MAX_TITLE characters; this bounds what an older version
 * left in the store, never a title added now.
 */
export const MAX_SHOWN_TITLE = 300

/** The columns between two buttons in a row of them. */
export const BUTTON_GAP = 3

/** The cells before a task's text: its glyph, `☐ `. */
const GLYPH_CELLS = 2

/** The cells a list row is indented under its section's label. */
export const ROW_INDENT = 2

/** The fewest columns the terminal gives a focused field's text, however narrow the pane. */
const MIN_FIELD_COLUMNS = 12

/**
 * What the Open items pane draws from: the items, the screen, and what each
 * row's words depend on. The render hook and `rowsFor` both read it, so the
 * rows asked for are the rows drawn.
 */
export type PaneView = {
  shown: readonly Task[]
  screen: Screen
  held: Held | null
  /** The draft in the reply field of the item on screen. */
  draft: string
  nowMs: number
  /** The surface draws a text field (the mobile app draws none yet). */
  canType: boolean
  isFocused: boolean
  /** The reply field has the keys: the terminal wraps what is typed there. */
  isTyping: boolean
  /** How many items other sessions left that the pane offers to take; none when absent. */
  offered?: number
  /** No session took this session's hand-off in time: the pane offers its items back. */
  isUnclaimed?: boolean
  isSaveFailing?: boolean
  /** The items another session took while this process ran: the pane says where they went. */
  moved?: readonly Task[]
  /** How many items `take_items` just brought from the previous session. */
  arrived?: number
}

const KIND_SECTIONS: readonly { kind: TaskKind; label: string }[] = [
  { kind: 'decision', label: 'DECISIONS' },
  { kind: 'question', label: 'QUESTIONS' },
  { kind: 'action', label: 'ACTIONS' },
  { kind: 'info', label: 'INFO' },
]

/**
 * The list's sections: the open items of `shown` by kind, then LATER, the
 * empty ones left out, each oldest first. Each item is in one section only.
 */
export function groupsOf(shown: readonly Task[]): { label: string; tasks: Task[] }[] {
  return [
    ...KIND_SECTIONS.map(({ kind, label }) => ({ label, tasks: shown.filter(task => task.state === 'open' && task.kind === kind) })),
    { label: 'LATER', tasks: shown.filter(task => task.state === 'later') },
  ].filter(group => group.tasks.length > 0)
}

/** The items `handing-off`, oldest first: drawn read-only, as no press there could reach the Claude they go to. */
export function movingOf(shown: readonly Task[]): Task[] {
  return shown.filter(task => task.state === 'handing-off')
}

export const MOVING_LABEL = 'Moving to a new session'
export const MOVED_LABEL = 'Moved to a new session'
export const UNCLAIMED_NOTE = 'No session took them in 30 minutes.'
export const TAKE_BACK = { key: 'take-back', label: 'Take' } as const
export const OFFER_BUTTONS = [
  { key: 'take', label: 'Take' },
  { key: 'dismiss', label: 'Dismiss' },
] as const
export const SAVE_FAILED = 'open-items: could not save'

/** `2 items left by an earlier session`; undefined when none are offered. */
export function offerOf(view: Pick<PaneView, 'offered'>): string | undefined {
  return view.offered === undefined || view.offered === 0 ? undefined : `${plural(view.offered, 'item')} left by an earlier session`
}

/** `2 items moved from the previous session`; undefined when none did. */
export function arrivedOf(view: Pick<PaneView, 'arrived'>): string | undefined {
  return view.arrived === undefined || view.arrived === 0 ? undefined : `${plural(view.arrived, 'item')} moved from the previous session`
}

/** `#5 Merge #787…`: a row drawn read-only, cut to one line of `columns`. */
export function readOnlyRowOf(task: Task, columns: number): string {
  return clipCells(`#${task.id} ${nameOf(task)}`, Math.max(1, columns - ROW_INDENT))
}

/** The keys the list's focus ring walks, in the order drawn: the offer's buttons, each row, Take for an unclaimed hand-off, then Hide. */
export function focusOrderOf(shown: readonly Task[], view: Pick<PaneView, 'offered' | 'isUnclaimed'> = {}): string[] {
  return [
    ...(offerOf(view) === undefined ? [] : OFFER_BUTTONS.map(button => button.key)),
    ...groupsOf(shown).flatMap(group => group.tasks.map(task => `row-${task.id}`)),
    ...(view.isUnclaimed === true && movingOf(shown).length > 0 ? [TAKE_BACK.key] : []),
    'hide',
  ]
}

/**
 * Where `by` arrows move the ring from `current` over `keys`, down when
 * positive: `|by|` keys on, no further than the first or the last; none
 * when the ring is there already; the first when it is on none of them.
 */
export function arrowTargetOf(keys: readonly string[], current: string | undefined, by: number): string | undefined {
  const at = current === undefined ? -1 : keys.indexOf(current)
  const to = Math.min(keys.length - 1, Math.max(0, at + by))

  return at === -1 ? keys[0] : to === at ? undefined : keys[to]
}

/**
 * The row the ring goes back to on the list from item `id`'s screen: its own,
 * or, the item closed, the row drawn after it, else before it, in `drawn`
 * (the ring's keys as that screen's list had them).
 */
export function rowBackTo(id: number, drawn: readonly string[], now: readonly string[]): string | undefined {
  const own = `row-${id}`
  const at = drawn.indexOf(own)
  const rows = (keys: readonly string[]) => keys.filter(key => key.startsWith('row-') && now.includes(key))

  if (now.includes(own)) {
    return own
  }

  return at === -1 ? undefined : (rows(drawn.slice(at + 1))[0] ?? rows(drawn.slice(0, at)).at(-1))
}

/** The item whose screen the pane shows, while it is the user's to act on; else the list. */
export function screenOf(view: Pick<PaneView, 'shown' | 'screen'>): 'list' | { id: number } {
  const { screen } = view

  return screen.kind === 'item' && view.shown.some(task => task.id === screen.id && isActive(task)) ? { id: screen.id } : 'list'
}

/** The item on screen, as `screenOf` finds it; undefined on the list. */
export function openTaskOf(view: Pick<PaneView, 'shown' | 'screen'>): Task | undefined {
  const screen = screenOf(view)

  return screen === 'list' ? undefined : view.shown.find(task => task.id === screen.id)
}

/** The pane's head: `☐ 1 decision · 2 questions · ● 1 reply · 1 later`, or `⋯ 1 waiting for Claude`. */
export function headlineOf(view: PaneView): { glyph: string; headline: string } {
  return waitingOf(view.shown)
}

/** A task's whole title, safe to draw. */
export function nameOf(task: Task): string {
  return printable(task.title, MAX_SHOWN_TITLE)
}

/** `#3 Rotate the token`: a task's number and its whole title. */
export function titleOf(task: Task): string {
  return `#${task.id} ${nameOf(task)}`
}

/** `  3m`, drawn dim after an open item's title, and `· waiting for Claude` once the user replied. */
export function ageOf(task: Task, view: Pick<PaneView, 'nowMs'>): string {
  return `  ${ago(view.nowMs - task.createdMs)}${task.isWaitingForClaude ? ' · waiting for Claude' : ''}`
}

const NEW_REPLY_MARK = '  ●'
const WAITING_MARK = '  ⋯ waiting for Claude'

/** What a list row draws after its title: a reply of Claude's the user has not opened, and whether the item waits for Claude. */
export function marksOf(task: Task): { newReply: string; waiting: string } {
  return { newReply: task.hasNewReply ? NEW_REPLY_MARK : '', waiting: task.isWaitingForClaude ? WAITING_MARK : '' }
}

/**
 * `#5  Merge #787…`: a list row's number, as wide as the list's widest, and
 * its title cut so the row, marks and all, takes one line of `columns`.
 */
export function rowTitleOf(task: Task, view: Pick<PaneView, 'shown'>, columns: number): string {
  const widest = Math.max(...groupsOf(view.shown).flatMap(group => group.tasks.map(one => cellsOf(`#${one.id}`))))
  const number = `#${task.id}`.padEnd(widest)
  const { newReply, waiting } = marksOf(task)
  const room = columns - ROW_INDENT - cellsOf(`${number} `) - cellsOf(newReply) - cellsOf(waiting)

  return `${number} ${clipCells(nameOf(task), Math.max(1, room))}`
}

function rowTextOf(task: Task, view: Pick<PaneView, 'shown'>, columns: number): string {
  const { newReply, waiting } = marksOf(task)

  return `${rowTitleOf(task, view, columns)}${newReply}${waiting}`
}

/** A thread entry as the item screen draws it: a message, line breaks kept, under its `head` (`Claude · 4m`); an event on one line. */
export function entryOf(message: Message, nowMs: number): { head?: string; text: string } {
  const who = message.from === 'claude' ? 'Claude' : 'You'
  const age = ago(nowMs - message.atMs)

  switch (message.event) {
    case undefined:
      return { head: `${who} · ${age}`, text: printableLines(message.text, MAX_DETAIL) }
    case 'chose':
      return { text: `${who} chose "${printable(message.text, MAX_OPTION)}" · ${age}` }
    case 'changed':
      return { text: `${who} changed the item · ${age}` }
    case 'took':
      return { text: `The item moved here from an earlier session · ${age}` }
    default:
      return { text: `${who} pressed ${PRESSED[message.event]} · ${age}` }
  }
}

/**
 * The most text the item screen's thread draws: one drawing draws 100,000
 * characters in all (MarkdownLeafProps), and the rest of the screen takes far less.
 */
const THREAD_CHARS = 80_000

export type Entry = { i: number; head?: string; text: string }

/**
 * The entries of `task`'s thread the item screen draws: the detail, then the
 * newest that fit in THREAD_CHARS; `hidden` counts those left out between.
 */
export function entriesOf(task: Task, nowMs: number): { entries: Entry[]; hidden: number } {
  const [detail, ...rest] = task.thread.map((message, i): Entry => ({ i, ...entryOf(message, nowMs) }))
  const size = (entry: Entry) => (entry.head?.length ?? 0) + entry.text.length

  if (detail === undefined) {
    return { entries: [], hidden: 0 }
  }

  let left = THREAD_CHARS - size(detail)
  let from = rest.length

  for (let entry = rest[from - 1]; entry !== undefined && size(entry) <= left; entry = rest[from - 1]) {
    left -= size(entry)
    from -= 1
  }

  return { entries: [detail, ...rest.slice(from)], hidden: from }
}

/** The line in place of the thread entries `entriesOf` leaves out. */
export function hiddenOf(hidden: number): string {
  return `${hidden} earlier ${hidden === 1 ? 'message is' : 'messages are'} not shown: the thread is too long for the pane.`
}

export function doneWhenOf(task: Task): string | undefined {
  return task.doneWhen === undefined ? undefined : `Done when: ${printableLines(task.doneWhen, MAX_DETAIL)}`
}

/** The most a `Link`'s href holds (LinkProps). */
const MAX_LINK = 2048

export const LINK_LABEL = 'Details: '

export function linkOf(task: Task): string | undefined {
  return task.link === undefined ? undefined : printable(task.link, MAX_LINK)
}

/** The item screen's buttons for `task`, each with the move it makes: by its kind, then Later while it is open. */
export function actionsOf(task: Task): { key: string; hotkey: string; label: string; move: Move }[] {
  if (task.kind === 'info') {
    return [{ key: 'seen', hotkey: 'd', label: 'Seen', move: SEEN }]
  }

  const choices =
    task.kind === 'decision' && task.options !== undefined
      ? task.options.map((option, i) => ({
          key: `option-${i + 1}`,
          hotkey: String(i + 1),
          label: `${printable(option, MAX_OPTION)}${option === task.recommended ? ' (recommended)' : ''}`,
          move: choseOf(option),
        }))
      : task.kind === 'question'
        ? []
        : [{ key: 'done', hotkey: 'd', label: 'Done', move: DONE }]

  return [...choices, ...(task.state === 'open' ? [{ key: 'later', hotkey: 'l', label: 'Later', move: LATER }] : [])]
}

// The terminal draws a field's label as `Reply: `.
export const REPLY_LABEL = 'Reply'
export const REPLY_PLACEHOLDER = 'Enter sends it to Claude'

/** What Enter does in the reply field, drawn beside it while it has the keys. */
export const SUBMIT_LABEL = 'send'

export const LONG_ANSWER = { key: 'long', label: 'Long answer…' } as const

/** What the user does with an item in place of pasting a secret into it, the item named when `isNamed`: an action has Done, the others a reply. */
export function insteadOf(task: Pick<Task, 'id' | 'kind'>, isNamed = false): string {
  const on = isNamed ? ` on #${task.id}` : ''

  return task.kind === 'action' ? `press Done${on}` : `reply${on} without it`
}

export function heldNoticeOf(task: Task): string {
  return `This looks like a secret. Claude and the transcript on disk would see it. Put it where it belongs and ${insteadOf(task)} instead.`
}

export const HELD_BUTTONS = ['Edit', 'Send anyway'] as const

/** The key of item `id`'s reply field: its own, so no other item's draft, or the focus, lands in it. */
export function replyKeyOf(id: number): string {
  return `reply-${id}`
}

/** The reply to `task` held back for looking like a secret, on a surface that draws fields. */
export function heldOf(task: Task, view: Pick<PaneView, 'canType' | 'held'>): string | undefined {
  return view.canType && view.held?.id === task.id ? view.held.text : undefined
}

/** Whether `task`'s screen draws its reply field: on a surface that draws one, for an item that asks something, no reply held in its place. */
export function hasReplyField(task: Task, view: Pick<PaneView, 'canType' | 'held'>): boolean {
  return view.canType && task.kind !== 'info' && heldOf(task, view) === undefined
}

/**
 * The columns the terminal gives a focused field's text: the pane's body,
 * `columns` across, less the label (`Answer: `) and the hint (` ⏎ send`).
 */
export function fieldColumnsOf(label: string, submitLabel: string, columns: number): number {
  return Math.max(MIN_FIELD_COLUMNS, columns - cellsOf(`${label}: `) - cellsOf(` ⏎ ${submitLabel}`))
}

/** A placeholder cut to one row of its field, focused or not. */
export function placeholderOf(text: string, label: string, submitLabel: string, columns: number): string {
  return clip(text, fieldColumnsOf(label, submitLabel, columns))
}

/**
 * Whether the terminal cuts a label `head` cells wide short, with `rest`
 * cells after it on a row `columns` across, and wraps it onto a second: a row
 * too narrow takes from the label and what follows it each its share of what
 * the row lacks, and rounds where the label ends.
 */
function isLabelCut(head: number, rest: number, columns: number): boolean {
  return Math.round((head * columns) / (head + rest)) < head
}

/**
 * The rows a field takes across the pane's body, `columns` wide, holding
 * `text`. The terminal draws its label, the field and, while it has the
 * keys, the hint on one row, and the label, cut short, wraps onto a second,
 * as does the hint. Typed in, the field wraps the text a column short of it,
 * for the cursor; else it cuts the text, or the placeholder, to one row.
 */
export function fieldRowsOf(label: string, submitLabel: string, text: string, isTyping: boolean, columns: number): number {
  const head = cellsOf(`${label}: `)
  const field = fieldColumnsOf(label, submitLabel, columns)

  if (!isTyping) {
    // The placeholder is cut to the field.
    return isLabelCut(head, text === '' ? field : cellsOf(text), columns) ? 2 : 1
  }

  const rows = linesRowsOf(text, field - 1)
  // The placeholder cut to the field, or the text and the cursor.
  const drawn = text === '' ? field : cellsOf(text) + 1

  return Math.max(rows, isLabelCut(head, drawn + cellsOf(` ⏎ ${submitLabel}`), columns) ? 2 : 1)
}

export function hintOf(view: PaneView): string {
  if (!view.isFocused) {
    return 'Click, or press ctrl+x tab to use the keys'
  }

  const task = openTaskOf(view)

  if (task === undefined) {
    return '↵ open · ↑↓ move · Esc: back to the prompt'
  }

  return hasReplyField(task, view) ? 'Tab: buttons · ↑↓ scroll · Esc: back to the prompt' : '↑↓ scroll · Esc: back to the prompt'
}

export const HIDE = 'Hide'

/** The item screen's way back to the list: Esc is the engine's. */
export const BACK = { key: 'back', hotkey: 'b', label: 'Back' } as const

/** The rows a row of buttons takes in `columns`, wrapping between buttons. */
export function buttonRowsOf(labels: readonly string[], columns: number): number {
  let rows = 1
  let x = 0

  for (const label of labels) {
    const width = cellsOf(label)

    if (x > 0 && x + BUTTON_GAP + width > columns) {
      rows += 1
      x = width
    } else {
      x += (x > 0 ? BUTTON_GAP : 0) + width
    }
  }

  return rows
}

/**
 * The rows the Open items pane's body takes at `columns` cells across, each
 * text wrapped as the pane draws it, at most `max`. The list: the head, each
 * section's label and a row for each of its items, and the foot. An item:
 * its title, thread, link, done-when, buttons and reply field, and the foot.
 */
export function rowsFor(view: PaneView, columns: number, max: number): number {
  const width = Math.max(1, columns)
  const task = openTaskOf(view)

  return Math.min(max, task === undefined ? listRowsOf(view, width) : itemRowsOf(task, view, width))
}

function listRowsOf(view: PaneView, width: number): number {
  const head = headlineOf(view)
  const offer = offerOf(view)
  const arrived = arrivedOf(view)
  const moving = movingOf(view.shown)
  const moved = view.moved ?? []
  const indented = Math.max(1, width - ROW_INDENT)
  let rows = savedRowsOf(view, width) + (arrived === undefined ? 0 : rowsOf(arrived, width))

  if (offer !== undefined) {
    rows += rowsOf(offer, width) + buttonRowsOf(OFFER_BUTTONS.map(button => button.label), width)
  }

  if (view.shown.some(isActive)) {
    rows += rowsOf(`${head.glyph}${head.headline}`, width)
  }

  for (const group of groupsOf(view.shown)) {
    rows += 1

    for (const task of group.tasks) {
      rows += rowsOf(rowTextOf(task, view, width), indented)
    }
  }

  if (moving.length > 0) {
    rows += 1 + moving.length + (view.isUnclaimed === true ? rowsOf(UNCLAIMED_NOTE, indented) + 1 : 0)
  }

  if (moved.length > 0) {
    rows += 1 + moved.length
  }

  return rows + footRowsOf(view, width, [HIDE])
}

/** The rows the line saying the last store write failed takes, when it did. */
function savedRowsOf(view: PaneView, width: number): number {
  return view.isSaveFailing === true ? rowsOf(SAVE_FAILED, width) : 0
}

function itemRowsOf(task: Task, view: PaneView, width: number): number {
  const inner = Math.max(1, width - GLYPH_CELLS)
  const { entries, hidden } = entriesOf(task, view.nowMs)
  const thread = entries.reduce((rows, { head, text }) => rows + (head === undefined ? 0 : rowsOf(head, inner)) + linesRowsOf(text, inner), 0)
  const link = linkOf(task)
  const doneWhen = doneWhenOf(task)
  const isField = hasReplyField(task, view)
  const buttons = [...actionsOf(task).map(action => `${action.hotkey}: ${action.label}`), ...(isField ? [LONG_ANSWER.label] : [])]

  return (
    savedRowsOf(view, width) +
    rowsOf(`${titleOf(task)}${ageOf(task, view)}`, inner) +
    thread +
    (hidden === 0 ? 0 : rowsOf(hiddenOf(hidden), inner)) +
    (link === undefined ? 0 : rowsOf(link, Math.max(1, inner - cellsOf(LINK_LABEL)))) +
    (doneWhen === undefined ? 0 : linesRowsOf(doneWhen, inner)) +
    (buttons.length === 0 ? 0 : buttonRowsOf(buttons, inner)) +
    (heldOf(task, view) === undefined ? 0 : rowsOf(heldNoticeOf(task), inner) + buttonRowsOf(HELD_BUTTONS, inner)) +
    (isField ? fieldRowsOf(REPLY_LABEL, SUBMIT_LABEL, view.draft, view.isTyping, width) : 0) +
    footRowsOf(view, width, [`${BACK.hotkey}: ${BACK.label}`, HIDE])
  )
}

/** The rows the foot takes: the hint, wrapped beside the `buttons`. */
function footRowsOf(view: PaneView, width: number, buttons: readonly string[]): number {
  return rowsOf(hintOf(view), Math.max(1, width - buttons.reduce((cells, label) => cells + BUTTON_GAP + cellsOf(label), 0)))
}
