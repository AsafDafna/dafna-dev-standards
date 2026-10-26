import type { Message, Task, TaskKind, ThreadEvent } from '../types'
import { ago, oneLine, plural, sizeOf } from './text'

export const MAX_TITLE = 80
export const MAX_OPTION = 60
/** The longest detail, done-when or thread message Claude writes: the tools refuse a longer one, and cut nothing. */
export const MAX_DETAIL = 4000
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

/** An ask the user has not answered or put off: `turn.complete` in register.tsx holds saved answers back while one is left. */
export function isUnanswered(task: Task): boolean {
  return task.state === 'open' && task.kind !== 'info' && !task.isWaitingForClaude
}

/** In the Open items pane: the user's to act on, moving to a new session, or acted on and not yet told to Claude. */
export function isShown(task: Task): boolean {
  return isActive(task) || task.state === 'handing-off' || task.update === 'pending'
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

const LINK = /^https?:\/\/\S+$/

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

/** Reads `reply_item`'s arguments: Claude's message, a change to the item, or both; or says what is wrong with them. */
export function parseReply(args: Record<string, unknown>): Reply | { error: string } {
  const id = args['id']
  const text = textIn(args, 'text')
  const title = lineIn(args, 'title')
  const doneWhen = textIn(args, 'done_when')
  const recommended = lineIn(args, 'recommended')
  const link = lineIn(args, 'link')
  const options = Array.isArray(args['options']) ? optionsIn(args['options']) : undefined

  if (typeof id !== 'number') {
    return { error: "id is required: the item's number." }
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
 * `task` after the user's `move` at `atMs`; the same task when the move
 * repeats their last. A move in the same millisecond as the user's one
 * before it takes the next, so `heardMs` tells the two apart.
 */
export function movedBy(task: Task, move: Move, atMs: number): Task {
  if (isRepeatOf(task, move)) {
    return task
  }

  const last = task.thread.at(-1)
  const thread = [...task.thread, { from: 'user' as const, ...move, atMs: last?.from === 'user' ? Math.max(atMs, last.atMs + 1) : atMs }]

  switch (move.event) {
    case undefined:
      return { ...task, thread, isWaitingForClaude: true, update: 'pending' }
    case 'later':
      return { ...task, thread, state: 'later', update: 'pending' }
    case 'seen':
      return { ...task, thread, state: 'resolved' }
    default:
      return { ...task, thread, state: 'resolved', update: 'pending' }
  }
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

function detailIn(task: Task): string {
  return task.thread[0]?.text ?? ''
}

/** A move as a digest tells it; `isFull` quotes a long answer whole, where a digest names it and points at `list_items`. */
function newsLineOf(task: Task, move: Message, isFull: boolean): string {
  switch (move.event) {
    case undefined:
      return !isFull && move.text.length > MAX_INLINE_ANSWER
        ? `The user's answer (${sizeOf(move.text.length)}) is saved: call list_items with id ${task.id} to read it.`
        : `The user's answer:\n${move.text}`
    case 'chose':
      return `The user chose: ${move.text}`
    case 'later':
      return 'The user pressed Later: go on without it.'
    default:
      return ''
  }
}

/**
 * What the user did with an item, after its head; '' when there is nothing
 * more to say. `isFull` (`list_items`) tells all they said since Claude's last
 * message; a digest tells only what Claude has not been told of.
 */
function bodyOf(task: Task, isFull: boolean): string {
  const lines = (isFull ? movesOf(task) : unheardOf(task))
    .map(move => newsLineOf(task, move, isFull))
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

/** One task's news for Claude: `#5 resolved: <title>.` and what the user said. */
export function newsOf(task: Task, isFull: boolean): string {
  const body = bodyOf(task, isFull)

  return `${newsHeadOf(task)}${body === '' ? '' : ` ${body}`}`
}

/** How what the user did with a task opens, in their own words: `#5 <title>:` */
export function ownHeadOf(task: Task): string {
  return `#${task.id} ${task.title}:`
}

function ownWordOf(move: Message): string {
  switch (move.event) {
    case undefined:
      return move.text
    case 'chose':
      return `I chose "${move.text}".`
    case 'later':
      return 'Later. Go on without it.'
    default:
      return 'Done.'
  }
}

/** What the user did with an item that Claude has not been told of, in their own words: a reply starts on a line of its own. */
function ownWordsOf(task: Task): string {
  const moves = unheardOf(task)
  const head = ownHeadOf(task)

  if (moves.length === 0) {
    return head
  }

  return `${head}${moves[0]?.event === undefined ? '\n' : ' '}${moves.map(ownWordOf).join('\n')}`
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
  const lines = due.map(task => newsOf(task, false))

  return `Item updates since you last checked (Open items):\n${lines.join('\n')}`
}

/** Read after a compaction or at a session's start: what is still with the user. */
export function contextOf(shown: readonly Task[]): string {
  const lines = shown.map(task => (isActive(task) ? `#${task.id} ${task.state}: ${task.title}. ${detailIn(task)}` : newsOf(task, false)))

  return [
    'Items you gave the user, through the Open items tools (add_item, list_items, withdraw_item):',
    ...lines,
    'The user sees them in their Open items pane, or with /open-items. Withdraw any you no longer need.',
  ].join('\n')
}

/** `list_items`'s answer. */
export function listOf(tasks: readonly Task[], nowMs: number): string {
  if (tasks.length === 0) {
    return 'No items match.'
  }

  return tasks
    .map(task => {
      const age = ago(nowMs - task.createdMs)
      const detail = isActive(task)
        ? [
            `Detail: ${detailIn(task)}`,
            task.doneWhen ? `Done when: ${task.doneWhen}` : '',
            task.options ? `Options: ${task.options.join(' | ')}` : '',
            task.recommended ? `Recommended: ${task.recommended}` : '',
          ]
        : []

      return [`#${task.id} ${task.state} · added ${age === 'now' ? 'just now' : `${age} ago`} · ${task.title}`, ...detail, ...bodyOf(task, true).split('\n')]
        .filter(line => line.trim() !== '')
        .join('\n  ')
    })
    .join('\n\n')
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

/** The status line under the prompt: what waits on the user by kind, and responses not sent yet; nothing when neither is left. */
export function statusOf(shown: readonly Task[]): string | undefined {
  if (!shown.some(task => waitsOnUser(task) || task.update === 'pending')) {
    return undefined
  }

  const { glyph, headline, note } = waitingOf(shown)

  return `${glyph}${headline}${note} · /open-items`
}

/**
 * What waits among `shown`, as the pane's head and the status line lead with
 * it: `☐ 1 decision · 2 questions · 1 not sent yet` (what waits on the user,
 * by kind), `✓ 1 not sent yet` with none of that, or `⋯ 1 waiting for Claude`
 * with only replies Claude has not answered; the responses named `noun` where
 * there's room.
 */
export function waitingOf(shown: readonly Task[], noun?: string): { glyph: string; headline: string; note: string } {
  const asks = shown.filter(waitsOnUser)
  const saved = shown.filter(task => task.update === 'pending').length

  if (asks.length > 0) {
    // "info" keeps its form for any count.
    const kinds = KINDS.map(kind => ({ kind, count: asks.filter(task => task.kind === kind).length }))
      .filter(({ count }) => count > 0)
      .map(({ kind, count }) => (kind === 'info' ? `${count} info` : plural(count, kind)))
      .join(' · ')

    return { glyph: '☐ ', headline: kinds, note: saved > 0 ? ` · ${saved} not sent yet` : '' }
  }

  if (saved > 0) {
    return { glyph: '✓ ', headline: `${noun === undefined ? saved : plural(saved, noun)} not sent yet`, note: '' }
  }

  return { glyph: '⋯ ', headline: `${shown.filter(isActive).length} waiting for Claude`, note: '' }
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
