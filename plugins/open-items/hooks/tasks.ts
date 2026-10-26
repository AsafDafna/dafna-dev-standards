import type { Message, Task, TaskKind, ThreadEvent } from '../types'
import { ago, oneLine, plural, sizeOf } from './text'

export const MAX_TITLE = 80
export const MAX_OPTION = 60
/** The longest detail, done-when or thread message Claude writes: the tools refuse a longer one, and cut nothing. */
export const MAX_DETAIL = 4000
/** The longest note Claude closes an item with: one line the user reads in a toast. */
export const MAX_NOTE = 200
/** How many of a thread's last entries `list_items` shows, when it is not asked for one item. */
const TAIL = 3
/** Answers longer than this are named in a digest, not quoted. */
const MAX_INLINE_ANSWER = 2000

export const KINDS: readonly TaskKind[] = ['decision', 'question', 'action', 'info']

/** Still the user's to act on, any kind: open, or put off for later. */
export function isActive(task: Task): boolean {
  return task.state === 'open' || task.state === 'later'
}

/** Open or later, and asks something of the user: every kind but `info`. */
export function isOpenAsk(task: Task): boolean {
  return isActive(task) && task.kind !== 'info'
}

/** What the pane's head and the status line count: not yet replied to, or replied to and answered by Claude since. */
export function waitsOnUser(task: Task): boolean {
  return isActive(task) && !task.isWaitingForClaude
}

/** In the Open items pane: the user's to act on, or moving to a new session. */
export function isShown(task: Task): boolean {
  return isActive(task) || task.state === 'handing-off'
}

/** Marked for another session, or taken by one: this session's Claude is told nothing more of it. */
export function isAway(task: Task): boolean {
  return task.state === 'handing-off' || task.state === 'moved'
}

/** The state `task` had before it was handed off: only the user's Later makes an item `later`, and nothing makes it open again. */
export function stateBefore(task: Task): 'open' | 'later' {
  return task.state === 'later' || task.thread.some(message => message.from === 'user' && message.event === 'later') ? 'later' : 'open'
}

/**
 * The numbers items taken from other sessions get, numbered `incoming` there,
 * where this session holds `held` and counts on from `nextId`: each keeps its
 * own unless this session uses it, else gets the next free number. A number
 * past the highest held and below `nextId` is in use: an item added meanwhile has it.
 */
export function numbersFor(held: readonly number[], nextId: number, incoming: readonly number[]): { was: number; now: number }[] {
  const used = new Set(held)

  for (let id = Math.max(0, ...held) + 1; id < nextId; id += 1) {
    used.add(id)
  }

  const kept = incoming.map(was => {
    const isFree = !used.has(was)
    used.add(was)
    return isFree
  })
  let next = nextId

  return incoming.map((was, i) => {
    if (kept[i]) {
      return { was, now: was }
    }

    while (used.has(next)) {
      next += 1
    }

    used.add(next)

    return { was, now: next }
  })
}

/** `task` as it arrives in this session as #`id` at `atMs`: open or Later as it was before the hand-off, its old number noted when it changed. */
export function arrivedAs(task: Task, id: number, atMs: number): Task {
  return { ...task, id, state: stateBefore(task), updatedMs: atMs, ...(id === task.id ? {} : { note: `was #${task.id} in the session it moved from` }) }
}

/** `task` with the event that it moved here at `atMs`, by Claude's take (`claude`) or the user's. */
export function tookBy(task: Task, from: Message['from'], atMs: number): Task {
  return { ...task, thread: [...task.thread, { from, text: '', event: 'took', atMs }] }
}

/** A title as two near-identical asks compare equal. */
export function sameAsk(a: string, b: string): boolean {
  const norm = (s: string) => oneLine(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' '))

  return norm(a) === norm(b)
}

export type Ask = Pick<Task, 'kind' | 'title' | 'doneWhen' | 'options' | 'recommended' | 'link'> & { detail: string }

export type Reply = {
  id: number
  text?: string
  change?: Partial<Pick<Task, 'title' | 'options' | 'recommended' | 'link' | 'doneWhen'>>
}

export type Close = { id: number; as: 'resolved' | 'withdrawn'; note?: string }

const LINK = /^https:\/\/\S+$/

const ID_ERROR = "id is required: the item's number, a whole number."

function idIn(args: Record<string, unknown>): number | undefined {
  const id = args['id']

  return typeof id === 'number' && Number.isInteger(id) ? id : undefined
}

/** `args[key]` as typed, its line breaks kept: '' when it is no text. */
function textIn(args: Record<string, unknown>, key: string): string {
  const value = args[key]

  return typeof value === 'string' ? value.trim() : ''
}

function lineIn(args: Record<string, unknown>, key: string): string {
  const value = args[key]

  return typeof value === 'string' ? oneLine(value) : ''
}

function optionsIn(raw: unknown[]): string[] {
  return raw.filter((o): o is string => typeof o === 'string').map(oneLine).filter(o => o !== '')
}

function titleErrorOf(title: string): string | undefined {
  return title.length > MAX_TITLE ? `title is ${title.length} characters; keep it under ${MAX_TITLE} and put the rest in detail.` : undefined
}

/** What is wrong with the longer texts, the options and the link of an ask or a reply; undefined when nothing is. */
function errorIn(fields: { texts: Record<string, string>; options: readonly string[] | undefined; link: string }): string | undefined {
  for (const [name, text] of Object.entries(fields.texts)) {
    if (text.length > MAX_DETAIL) {
      return `${name} is ${text.length} characters; keep it to ${MAX_DETAIL} or fewer.`
    }
  }

  if (fields.options?.some(o => o.length > MAX_OPTION)) {
    return `keep each option under ${MAX_OPTION} characters.`
  }

  return fields.link !== '' && !LINK.test(fields.link) ? 'link must be a URL that starts with https://.' : undefined
}

/** Reads `add_item`'s arguments, or says what is wrong with them. */
export function parseAsk(args: Record<string, unknown>): Ask | { error: string } {
  const title = lineIn(args, 'title')
  const detail = textIn(args, 'detail')
  const doneWhen = textIn(args, 'done_when')
  const recommended = lineIn(args, 'recommended')
  const link = lineIn(args, 'link')
  const kind = args['kind'] ?? 'action'
  const options = optionsIn(Array.isArray(args['options']) ? args['options'] : [])

  if (title === '') {
    return { error: 'title is required: what the user should do, as an imperative.' }
  }

  const titleError = titleErrorOf(title)

  if (titleError !== undefined) {
    return { error: titleError }
  }

  if (detail === '') {
    return { error: 'detail is required: what you need from the user, and why.' }
  }

  if (!KINDS.includes(kind as TaskKind)) {
    return { error: 'kind must be "decision", "question", "action" or "info".' }
  }

  if (kind === 'decision' && (options.length < 2 || options.length > 4)) {
    return { error: 'a decision needs 2 to 4 options.' }
  }

  const error = errorIn({ texts: { detail, done_when: doneWhen }, options, link })

  if (error !== undefined) {
    return { error }
  }

  if (kind === 'decision' && recommended !== '' && !options.includes(recommended)) {
    return { error: 'recommended must be one of the options, spelled the same.' }
  }

  return {
    kind: kind as TaskKind,
    title,
    detail,
    ...(doneWhen === '' ? {} : { doneWhen }),
    ...(kind === 'decision' ? { options } : {}),
    ...(kind === 'decision' && recommended !== '' ? { recommended } : {}),
    ...(link === '' ? {} : { link }),
  }
}

/**
 * Reads `reply_item`'s arguments: Claude's message, a change to the item, or
 * both; or says what is wrong with them. Whether the change fits the item is
 * `replyErrorOf`'s to say.
 */
export function parseReply(args: Record<string, unknown>): Reply | { error: string } {
  const id = idIn(args)
  const text = textIn(args, 'text')
  const title = lineIn(args, 'title')
  const doneWhen = textIn(args, 'done_when')
  const recommended = lineIn(args, 'recommended')
  const link = lineIn(args, 'link')
  const options = Array.isArray(args['options']) ? optionsIn(args['options']) : undefined

  if (id === undefined) {
    return { error: ID_ERROR }
  }

  if (options !== undefined && (options.length < 2 || options.length > 4)) {
    return { error: 'a decision needs 2 to 4 options.' }
  }

  const error = titleErrorOf(title) ?? errorIn({ texts: { text, done_when: doneWhen }, options, link })

  if (error !== undefined) {
    return { error }
  }

  if (options !== undefined && recommended !== '' && !options.includes(recommended)) {
    return { error: 'recommended must be one of the options, spelled the same.' }
  }

  const change = {
    ...(title === '' ? {} : { title }),
    ...(options === undefined ? {} : { options }),
    ...(recommended === '' ? {} : { recommended }),
    ...(link === '' ? {} : { link }),
    ...(doneWhen === '' ? {} : { doneWhen }),
  }
  const isChanged = Object.keys(change).length > 0

  if (text === '' && !isChanged) {
    return { error: 'reply_item needs text or a change: a message for the user, or a new title, options, recommended, link or done_when.' }
  }

  return { id, ...(text === '' ? {} : { text }), ...(isChanged ? { change } : {}) }
}

/** Why Claude's `reply` cannot go on `task`; undefined when it can. */
export function replyErrorOf(task: Task, reply: Reply): string | undefined {
  const change = reply.change ?? {}

  if (isAway(task)) {
    return `Item #${task.id} went to a new session; that session answers it now.`
  }

  if (!isActive(task)) {
    return `Item #${task.id} is already ${task.state}; add a new item if you need more from the user.`
  }

  if (task.kind !== 'decision' && (change.options !== undefined || change.recommended !== undefined)) {
    return 'options and recommended are for a decision only.'
  }

  return change.recommended !== undefined && !(change.options ?? task.options ?? []).includes(change.recommended)
    ? 'recommended must be one of the options, spelled the same.'
    : undefined
}

/**
 * `task` after Claude's `reply` at `atMs`: the change and the message in its
 * thread, the user's turn again, and a recommended option kept only while it
 * is one of the options.
 */
export function repliedBy(task: Task, reply: Reply, atMs: number): Task {
  const { recommended, ...changed } = { ...task, ...reply.change }
  const entries: Message[] = [
    ...(reply.change === undefined ? [] : [{ from: 'claude' as const, text: '', event: 'changed' as const, atMs }]),
    ...(reply.text === undefined ? [] : [{ from: 'claude' as const, text: reply.text, atMs }]),
  ]

  return {
    ...changed,
    ...(recommended !== undefined && changed.options?.includes(recommended) ? { recommended } : {}),
    thread: [...task.thread, ...entries],
    isWaitingForClaude: false,
    hasNewReply: true,
  }
}

/** Reads `close_item`'s arguments, or says what is wrong with them. */
export function parseClose(args: Record<string, unknown>): Close | { error: string } {
  const id = idIn(args)
  const as = args['as']
  const note = lineIn(args, 'note')

  if (id === undefined) {
    return { error: ID_ERROR }
  }

  if (as !== 'resolved' && as !== 'withdrawn') {
    return { error: 'as must be "resolved" or "withdrawn".' }
  }

  if (note.length > MAX_NOTE) {
    return { error: `note is ${note.length} characters; keep it to ${MAX_NOTE} or fewer.` }
  }

  return { id, as, ...(note === '' ? {} : { note }) }
}

/** Whether the user wrote in `task`'s thread: a press is no answer. */
export function hasAnswerIn(task: Task): boolean {
  return task.thread.some(message => message.from === 'user' && message.event === undefined)
}

/** `task` closed by Claude. A move by the user that Claude has not heard yet stays pending, so Claude is still told of it. */
export function closedAs(task: Task, close: Close): Task {
  return {
    ...task,
    state: close.as,
    isWaitingForClaude: false,
    update: task.update === 'pending' ? 'pending' : 'delivered',
    ...(close.note === undefined ? {} : { note: close.note }),
  }
}

/** What the user did with an item, as its thread records it: a reply has no event. */
export type Move = Pick<Message, 'text' | 'event'>

export const DONE: Move = { text: '', event: 'done' }
export const SEEN: Move = { text: '', event: 'seen' }
export const LATER: Move = { text: '', event: 'later' }

export function choseOf(option: string): Move {
  return { text: option, event: 'chose' }
}

export function replyOf(text: string): Move {
  return { text }
}

/** Whether `move` is the user's last word on `task`: a second press, or one answer sent twice. */
export function isRepeatOf(task: Task | undefined, move: Move): boolean {
  const last = task?.thread.at(-1)

  return last !== undefined && last.from === 'user' && last.event === move.event && last.text === move.text
}

/**
 * `task` after the user's `move` at `atMs`, Claude's last reply counted as
 * read; the same task when the move repeats their last. A move in the same
 * millisecond as the user's one before it, a reply of Claude's between them
 * or not, takes the next, so `heardMs` tells the two apart.
 */
export function movedBy(task: Task, move: Move, atMs: number): Task {
  if (isRepeatOf(task, move)) {
    return task
  }

  const before = task.thread.findLast(message => message.from === 'user')
  const thread = [...task.thread, { from: 'user' as const, ...move, atMs: before === undefined ? atMs : Math.max(atMs, before.atMs + 1) }]
  const moved = { ...task, thread, hasNewReply: false }

  switch (move.event) {
    case undefined:
      return { ...moved, isWaitingForClaude: true, update: 'pending' }
    case 'later':
      return { ...moved, state: 'later', update: 'pending' }
    case 'seen':
      return { ...moved, state: 'resolved' }
    default:
      return { ...moved, state: 'resolved', update: 'pending' }
  }
}

/** Whether `move` picks an option the active `task` no longer offers: Claude changed its options since the pane drew them. */
export function isStale(task: Task | undefined, move: Move): boolean {
  return task !== undefined && isActive(task) && move.event === 'chose' && !(task.options ?? []).includes(move.text)
}

const SPOKEN: readonly (ThreadEvent | undefined)[] = [undefined, 'chose', 'done', 'later']

/** The user's replies and presses since Claude's last message, oldest first: what Claude has had no word on. */
function movesOf(task: Task): readonly Message[] {
  return task.thread.slice(task.thread.findLastIndex(message => message.from === 'claude') + 1).filter(move => SPOKEN.includes(move.event))
}

/** Of `movesOf(task)`, those Claude has not been told of yet. */
function unheardOf(task: Task): readonly Message[] {
  return movesOf(task).filter(move => task.heardMs === undefined || move.atMs > task.heardMs)
}

/** `task` once Claude has been told of every move on it so far. */
export function toldOf(task: Task): Task {
  const last = task.thread.findLast(message => message.from === 'user')

  return { ...task, update: 'delivered', ...(last === undefined ? {} : { heardMs: last.atMs }) }
}

/** Why the user's answer to item `id` is not sent: it is longer than MAX_DETAIL. Undefined when it fits. */
export function overLimitOf(id: number, text: string): string | undefined {
  return text.length > MAX_DETAIL
    ? `Your answer to #${id} is ${text.length} characters, so it wasn't sent: the most is ${MAX_DETAIL}. Shorten it, or put the rest in a file and give Claude its path.`
    : undefined
}

/** What a reply's head adds, so Claude does not take the reply as the item's end. */
const STAYS_OPEN = '(the item stays open; answer in it with reply_item, or close it with close_item)'

/** A move as a digest tells it: a long reply named, and `list_items` pointed at. */
function newsLineOf(task: Task, move: Message): string {
  switch (move.event) {
    case undefined:
      return move.text.length > MAX_INLINE_ANSWER
        ? `The user's reply (${sizeOf(move.text.length)}) is saved: call list_items with id ${task.id} to read it. The item stays open.`
        : `The user replied ${STAYS_OPEN}:\n${move.text}`
    case 'chose':
      return `The user chose: ${move.text}`
    case 'later':
      return 'The user pressed Later: go on without it.'
    default:
      return ''
  }
}

/** What the user did with an item that Claude has not been told of, after its head; '' when there is nothing more to say. */
function bodyOf(task: Task): string {
  const lines = unheardOf(task)
    .map(move => newsLineOf(task, move))
    .filter(line => line !== '')

  if (task.state === 'withdrawn') {
    lines.push(task.note ? `You withdrew it: ${task.note}` : 'You withdrew it.')
  }

  return lines.join('\n')
}

/** How a task's news opens: `#5 resolved: <title>.` */
export function newsHeadOf(task: Task): string {
  return `#${task.id} ${task.state}: ${task.title}.`
}

/** Whether the user made a move on `task` that Claude is told of and has not heard: a Seen is never told. */
export function hasNewsIn(task: Task): boolean {
  return unheardOf(task).length > 0
}

/** One task's news for Claude: `#5 resolved: <title>.` and what the user said that Claude has not heard. */
export function newsOf(task: Task): string {
  const body = bodyOf(task)

  return `${newsHeadOf(task)}${body === '' ? '' : ` ${body}`}`
}

/** How what the user did with a task opens, in their own words: `#5 <title>:` */
export function ownHeadOf(task: Task): string {
  return `#${task.id} ${task.title}:`
}

function ownWordOf(move: Message): string {
  switch (move.event) {
    case undefined:
      return `my reply ${STAYS_OPEN}:\n${move.text}`
    case 'chose':
      return `I chose "${move.text}".`
    case 'later':
      return 'Later. Go on without it.'
    default:
      return 'Done.'
  }
}

/** What the user did with an item that Claude has not been told of, in their own words, each move after the item's head. */
function ownWordsOf(task: Task): string {
  return unheardOf(task)
    .map(move => `${ownHeadOf(task)} ${ownWordOf(move)}`)
    .join('\n')
}

/**
 * What reaches Claude as a message: every response it has not heard,
 * whole, in the user's own words, since they are the user's.
 */
export function messageOf(due: readonly Task[]): string {
  const lines = due.map(ownWordsOf)

  return `${due.length === 1 ? 'My response to an item' : 'My responses to items'} you gave me (Open items):\n\n${lines.join('\n\n')}`
}

/** What rides along with the user's next prompt: the updates, long answers named. */
export function digestOf(due: readonly Task[]): string {
  const lines = due.map(newsOf)

  return `Item updates since you last checked (Open items):\n${lines.join('\n')}`
}

/**
 * The line each prompt carries while an ask is open, Later ones too, for a Claude past a compaction. Unread: a move
 * Claude was not told of, or a reply it has not answered or closed; not one `isHeld` is about to send.
 */
export function reminderOf(tasks: readonly Task[], isHeld: (task: Task) => boolean): string | undefined {
  const open = tasks.filter(isOpenAsk).length
  const unread = tasks.filter(task => !isHeld(task) && (task.update === 'pending' || task.isWaitingForClaude)).length

  return open === 0 ? undefined : `Open items: ${open} open, ${plural(unread, 'unread answer')}; call list_items.`
}

/** `just now`, `4m ago`. */
function whenOf(ms: number): string {
  const age = ago(ms)

  return age === 'now' ? 'just now' : `${age} ago`
}

export const PRESSED = { done: 'Done', seen: 'Seen', later: 'Later' } as const

/** A thread entry as `list_items` gives it: a message on the lines under its head, a press or a change on one line. */
function listedEntryOf(message: Message, nowMs: number): string {
  const who = message.from === 'claude' ? 'You' : 'The user'
  const when = whenOf(nowMs - message.atMs)

  switch (message.event) {
    case undefined:
      return `- ${who}, ${when}:\n  ${message.text.split('\n').join('\n  ')}`
    case 'chose':
      return `- ${who} chose "${message.text}", ${when}.`
    case 'changed':
      return `- ${who} changed the item, ${when}.`
    case 'took':
      return `- The item moved here from an earlier session, ${when}.`
    default:
      return `- ${who} pressed ${PRESSED[message.event]}, ${when}.`
  }
}

/**
 * One item as `list_items` gives it: its state, what it waits on, and its
 * thread whole (`isWhole`) or its last TAIL entries, with every entry since
 * Claude's last however many that is, so no answer goes unseen.
 */
function listedOf(task: Task, nowMs: number, isWhole: boolean): string {
  const lastOwn = task.thread.findLastIndex(message => message.from === 'claude')
  const shown = task.thread.slice(isWhole ? 0 : Math.max(0, Math.min(task.thread.length - TAIL, lastOwn)))
  const threadHead =
    shown.length === task.thread.length ? 'Thread:' : `Thread, the last ${shown.length} of ${task.thread.length} entries (list_items with id ${task.id} gives all):`
  const lines = [
    task.isWaitingForClaude ? 'The user replied and waits for you: answer in the item with reply_item, or close it with close_item.' : '',
    task.hasNewReply ? 'The user has not opened your last reply yet.' : '',
    task.options ? `Options: ${task.options.join(' | ')}` : '',
    task.recommended ? `Recommended: ${task.recommended}` : '',
    task.doneWhen ? `Done when: ${task.doneWhen}` : '',
    task.link ? `Link: ${task.link}` : '',
    task.note ? `Note: ${task.note}` : '',
    shown.length === 0 ? '' : threadHead,
    ...shown.map(message => listedEntryOf(message, nowMs)),
  ].filter(line => line !== '')

  return [`#${task.id} ${task.state} · ${task.kind} · added ${whenOf(nowMs - task.createdMs)} · ${task.title}`, ...lines.join('\n').split('\n').map(line => `  ${line}`)].join('\n')
}

/** `list_items`'s answer; `isWhole` gives each item's whole thread. */
export function listOf(tasks: readonly Task[], nowMs: number, isWhole = false): string {
  return tasks.length === 0 ? 'No items match.' : tasks.map(task => listedOf(task, nowMs, isWhole)).join('\n\n')
}

/** What tells Claude what to do with items it takes from another session. */
const YOURS = 'answer in each with reply_item, and close each with close_item once it is resolved.'

/** `take_items`'s answer: the items taken by hand-off code `code`, as `tookOf` gives them. */
export function takenByCodeOf(code: string, items: readonly { task: Task; was: number }[], nowMs: number): string {
  return tookOf(`Took ${plural(items.length, 'item')} from the previous session (hand-off code ${code}). They are yours now: ${YOURS}`, items, nowMs)
}

/**
 * What the user's Take sends Claude: the items another session left, as
 * `tookOf` gives them. It goes as the user's prompt, so a frame line marks the
 * threads as the pane's record, not as new words of the user's.
 */
export function leftTakenOf(items: readonly { task: Task; was: number }[], nowMs: number): string {
  return tookOf(
    `I took ${plural(items.length, 'item')} left by an earlier session (Open items). They are yours now: ${YOURS}\n\nTheir threads, as the pane recorded them:`,
    items,
    nowMs,
  )
}

/** What the user's Take sends Claude for the items it handed off that no session took. */
export function takenBackOf(items: readonly { task: Task; was: number }[], nowMs: number): string {
  return tookOf(`No new session took ${plural(items.length, 'item')} you handed off, so I took them back (Open items). They are yours again: ${YOURS}`, items, nowMs)
}

/**
 * `head`, then each item taken whole, as `list_items` gives one, with its
 * number in the session it came from where that differs (`was`), and what the
 * user did that Claude has not heard.
 */
function tookOf(head: string, items: readonly { task: Task; was: number }[], nowMs: number): string {
  const each = items.map(({ task, was }) => {
    const listed = listedOf(task, nowMs, true)
    const numbered = was === task.id ? listed : listed.replace(`#${task.id} `, `#${task.id} (was #${was}) `)

    return hasNewsIn(task) ? `${numbered}\n  Not heard yet: ${newsOf(task).split('\n').join('\n  ')}` : numbered
  })

  return [head, ...each].join('\n\n')
}

/** `add_item`'s answer. */
export function addedOf(task: Task): string {
  if (task.kind === 'info') {
    return [
      `Added item #${task.id}: "${task.title}".`,
      'The user sees it in their Open items pane, or with /open-items, until they mark it seen. It asks nothing, so no response reaches you.',
    ].join(' ')
  }

  return [
    `Added item #${task.id}: "${task.title}".`,
    'The user sees it in their Open items pane, or with /open-items, until they act on it. Their response reaches you as a message, or through list_items.',
    'You can carry on with work that does not depend on it.',
  ].join(' ')
}

/**
 * The status line under the prompt: that the last store write failed, and
 * what waits on the user; nothing when neither. The engine heads it with the
 * plugin's name: `open-items: could not save`.
 */
export function statusOf(shown: readonly Task[], isSaveFailing = false): string | undefined {
  const waiting = shown.some(waitsOnUser) ? waitingOf(shown) : undefined
  const parts = [...(isSaveFailing ? ['could not save'] : []), ...(waiting === undefined ? [] : [`${waiting.glyph}${waiting.headline} · /open-items`])]

  return parts.length === 0 ? undefined : parts.join(' · ')
}

/**
 * What waits among `shown`, as the pane's head and the status line lead with
 * it: `☐ 2 decisions · 1 question · ● 1 reply · 1 later` (the open items that
 * wait on the user by kind, Claude's replies they have not opened, and the
 * items put off), or `⋯ 1 waiting for Claude` with only replies Claude has
 * not answered.
 */
export function waitingOf(shown: readonly Task[]): { glyph: string; headline: string } {
  const asks = shown.filter(waitsOnUser)

  if (asks.length > 0) {
    const open = asks.filter(task => task.state === 'open')
    // "info" keeps its form for any count.
    const kinds = KINDS.map(kind => ({ kind, count: open.filter(task => task.kind === kind).length }))
      .filter(({ count }) => count > 0)
      .map(({ kind, count }) => (kind === 'info' ? `${count} info` : plural(count, kind)))
    const replies = asks.filter(task => task.hasNewReply).length
    const later = asks.filter(task => task.state === 'later').length
    const parts = [
      ...kinds,
      ...(replies > 0 ? [`● ${replies} ${replies === 1 ? 'reply' : 'replies'}`] : []),
      ...(later > 0 ? [`${later} later`] : []),
    ]

    return { glyph: '☐ ', headline: parts.join(' · ') }
  }

  return { glyph: '⋯ ', headline: `${shown.filter(isActive).length} waiting for Claude` }
}

const BRIDGE = /^\s*↳?\s*Answer to #(\d+):[ \t]*\n?/i

/** What a long answer written in the prompt box starts with. */
export function bridgeOf(id: number): string {
  return `↳ Answer to #${id}: `
}

/** A prompt that answers a task: the task's id and the answer, or null. */
export function answerIn(text: string): { id: number; answer: string } | null {
  const match = BRIDGE.exec(text)

  return match ? { id: Number(match[1]), answer: text.slice(match[0].length).trim() } : null
}

const SECRET_SHAPES: readonly RegExp[] = [
  /\bsk_(live|test)_[0-9A-Za-z]{10,}/,
  /\bsk-ant-[\w-]{10,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bA(KIA|SIA)[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/,
  /\bxox[abprs]-[\w-]{10,}/,
  /\bAIza[\w-]{30,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/,
]

/**
 * Whether an answer looks like it carries a secret: a known key shape, or a
 * long token mixing upper case, lower case and digits (a git hash, all lower
 * case hex, is not one).
 */
export function looksSecret(text: string): boolean {
  if (SECRET_SHAPES.some(shape => shape.test(text))) {
    return true
  }

  return (text.match(/[A-Za-z0-9+/_=-]{32,}/g) ?? []).some(
    token => /[a-z]/.test(token) && /[A-Z]/.test(token) && /[0-9]/.test(token),
  )
}
