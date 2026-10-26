import type { Editing, Screen, Task, TaskKind } from '../types'
import { MAX_DETAIL, MAX_OPTION, isActive, waitingOf } from './tasks'
import { ago, cellsOf, clip, clipCells, printable, rowsOf } from './text'

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
 * What the Open items pane draws from: the items, the screen and which field
 * is open, and what each row's words depend on. The render hook and
 * `rowsFor` both read it, so the rows asked for are the rows drawn.
 */
export type PaneView = {
  shown: readonly Task[]
  screen: Screen
  editing: Editing | null
  /** The draft in the open field. */
  draft: string
  nowMs: number
  /** The surface draws a text field (the mobile app draws none yet). */
  canType: boolean
  isFocused: boolean
  /** The open field has the keys: the terminal wraps what is typed there. */
  isTyping: boolean
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

/** The keys the list's focus ring walks, in the order drawn: each row, then Hide. */
export function focusOrderOf(shown: readonly Task[]): string[] {
  return [...groupsOf(shown).flatMap(group => group.tasks.map(task => `row-${task.id}`)), 'hide']
}

/**
 * Where an arrow moves the ring from `current` over `keys`, `by` 1 down and
 * -1 up: the next or previous key, none past the first or the last, and
 * the first when the ring is on none of them.
 */
export function arrowTargetOf(keys: readonly string[], current: string | undefined, by: 1 | -1): string | undefined {
  const at = current === undefined ? -1 : keys.indexOf(current)

  return at === -1 ? keys[0] : keys[at + by]
}

/** The item whose screen the pane shows, while it is the user's to act on; else the list. */
export function screenOf(view: Pick<PaneView, 'shown' | 'screen'>): 'list' | { id: number } {
  const { screen } = view

  return screen.kind === 'item' && view.shown.some(task => task.id === screen.id && isActive(task)) ? { id: screen.id } : 'list'
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

export function detailOf(task: Task): string {
  return printable(task.thread[0]?.text ?? '', MAX_DETAIL)
}

export function doneWhenOf(task: Task): string | undefined {
  return task.doneWhen === undefined ? undefined : `Done when: ${printable(task.doneWhen, MAX_DETAIL)}`
}

/** The open item's buttons, as `hotkey` and `label`. */
export function actionsOf(task: Task, canType: boolean): { key: string; hotkey: string; label: string; option?: string }[] {
  if (task.kind === 'info') {
    return [{ key: 'seen', hotkey: 'd', label: 'Seen' }]
  }

  const choices =
    task.kind === 'decision' && task.options !== undefined
      ? task.options.map((option, i) => ({
          key: `option-${i + 1}`,
          hotkey: String(i + 1),
          label: `${printable(option, MAX_OPTION)}${option === task.recommended ? ' (recommended)' : ''}`,
          option,
        }))
      : [{ key: 'done', hotkey: 'd', label: 'Done' }]

  const typed = canType ? [{ key: 'answer', hotkey: 'r', label: task.kind === 'decision' ? 'Other…' : 'Answer…' }] : []
  const later = task.state === 'open' ? [{ key: 'later', hotkey: 'l', label: 'Later' }] : []

  return [...choices, ...typed, ...later]
}

// The terminal draws a field's label as `Answer: `.
export const ANSWER_LABEL = 'Answer'
export const HELD =
  'This looks like a secret. Claude and the transcript on disk would see it. Put it where it belongs and press Done instead.'

export const ANSWER_PLACEHOLDER = 'Enter sends it to Claude'

/** The answer field's buttons. */
export const ANSWER_BUTTONS = ['Long answer…', 'Cancel'] as const

/** What Enter does in the answer field, drawn beside it while it has the keys. */
export const SUBMIT_LABEL = 'send'

/** The key of task `id`'s field: its own, so no other task's draft, or the focus, lands in it. */
export function fieldKeyOf(field: Pick<Editing, 'id' | 'field'>): string {
  return `${field.field}-${field.id}`
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

  const rows = text.split('\n').reduce((rows, line) => rows + rowsOf(line, field - 1), 0)
  // The placeholder cut to the field, or the text and the cursor.
  const drawn = text === '' ? field : cellsOf(text) + 1

  return Math.max(rows, isLabelCut(head, drawn + cellsOf(` ⏎ ${submitLabel}`), columns) ? 2 : 1)
}

export function hintOf(view: PaneView): string {
  if (!view.isFocused) {
    return 'Click, or press ctrl+x tab to use the keys'
  }

  return screenOf(view) === 'list' ? '↵ open · ↑↓ move · Esc: back to the prompt' : 'Esc: back to the prompt'
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
 * its title, detail and controls, a blank row, and the foot.
 */
export function rowsFor(view: PaneView, columns: number, max: number): number {
  const width = Math.max(1, columns)
  const screen = screenOf(view)
  const task = screen === 'list' ? undefined : view.shown.find(one => one.id === screen.id)

  return Math.min(max, task === undefined ? listRowsOf(view, width) : itemRowsOf(task, view, width))
}

function listRowsOf(view: PaneView, width: number): number {
  const head = headlineOf(view)
  let rows = rowsOf(`${head.glyph}${head.headline}`, width)

  for (const group of groupsOf(view.shown)) {
    rows += 1

    for (const task of group.tasks) {
      rows += rowsOf(rowTextOf(task, view, width), Math.max(1, width - ROW_INDENT))
    }
  }

  return rows + footRowsOf(view, width, [HIDE])
}

function itemRowsOf(task: Task, view: PaneView, width: number): number {
  const inner = Math.max(1, width - GLYPH_CELLS)
  const doneWhen = doneWhenOf(task)
  const rows =
    rowsOf(`${titleOf(task)}${ageOf(task, view)}`, inner) +
    rowsOf(detailOf(task), inner) +
    (doneWhen === undefined ? 0 : rowsOf(doneWhen, inner)) +
    controlRowsOf(task, view, width, inner)

  return rows + 1 + footRowsOf(view, width, [`${BACK.hotkey}: ${BACK.label}`, HIDE])
}

/** The rows the foot takes: the hint, wrapped beside the `buttons`. */
function footRowsOf(view: PaneView, width: number, buttons: readonly string[]): number {
  return rowsOf(hintOf(view), Math.max(1, width - buttons.reduce((cells, label) => cells + BUTTON_GAP + cellsOf(label), 0)))
}

/** The rows under the open task: its buttons, or its field across the body (`width`) and the buttons under it. */
function controlRowsOf(task: Task, view: PaneView, width: number, inner: number): number {
  const field = view.editing !== null && view.editing.id === task.id ? view.editing : null

  if (field === null || !view.canType) {
    return buttonRowsOf(
      actionsOf(task, view.canType).map(action => `${action.hotkey}: ${action.label}`),
      inner,
    )
  }

  if (field.held !== undefined) {
    return rowsOf(HELD, inner) + buttonRowsOf(['Edit', 'Send anyway'], inner)
  }

  return fieldRowsOf(ANSWER_LABEL, SUBMIT_LABEL, view.draft, view.isTyping, width) + buttonRowsOf(ANSWER_BUTTONS, inner)
}
