import type { Message, Saved, Task, TaskKind } from '../types'
import { KINDS } from './tasks'

/** How long a session's saved items wait for `claude --resume`: an older key is deleted at the next start. */
export const KEEP_MS = 30 * 24 * 60 * 60_000

/** How long a closed item stays in its session's key once Claude has heard of it. */
const KEEP_CLOSED_MS = 7 * 24 * 60 * 60_000

const PREFIX = 'session:'

const STATES: readonly string[] = ['open', 'later', 'resolved', 'withdrawn', 'handing-off', 'moved']
const CLOSED: readonly string[] = ['resolved', 'withdrawn', 'moved']
const EVENTS: readonly string[] = ['chose', 'done', 'seen', 'later', 'changed', 'took']
const UPDATES: readonly string[] = ['none', 'pending', 'delivered']

export function keyOf(sessionId: string): string {
  return `${PREFIX}${sessionId}`
}

export function isSavedKey(key: string): boolean {
  return key.startsWith(PREFIX)
}

type Fields = Record<string, unknown>

const isFields = (value: unknown): value is Fields => value !== null && typeof value === 'object'
const isText = (value: unknown): value is string => typeof value === 'string'
const isNumber = (value: unknown): value is number => typeof value === 'number'
const isTexts = (value: unknown): value is string[] => Array.isArray(value) && value.every(isText)

function isOptional<T>(value: unknown, is: (value: unknown) => value is T): value is T | undefined {
  return value === undefined || is(value)
}

function isMessage(value: unknown): value is Message {
  return (
    isFields(value) &&
    (value['from'] === 'claude' || value['from'] === 'user') &&
    isText(value['text']) &&
    isNumber(value['atMs']) &&
    (value['event'] === undefined || EVENTS.includes(value['event'] as string))
  )
}

function isItem(value: unknown): value is Task {
  return (
    isFields(value) &&
    ['id', 'createdMs', 'updatedMs'].every(key => isNumber(value[key])) &&
    isText(value['title']) &&
    KINDS.includes(value['kind'] as TaskKind) &&
    STATES.includes(value['state'] as string) &&
    UPDATES.includes(value['update'] as string) &&
    typeof value['isWaitingForClaude'] === 'boolean' &&
    typeof value['hasNewReply'] === 'boolean' &&
    Array.isArray(value['thread']) &&
    value['thread'].every(isMessage) &&
    ['doneWhen', 'recommended', 'link', 'note'].every(key => isOptional(value[key], isText)) &&
    isOptional(value['options'], isTexts)
  )
}

/** A task v0.1 saved, as an item, when it is still open: its why is the thread's first message. */
function itemFromV1(value: unknown): Task | undefined {
  if (
    !isFields(value) ||
    value['state'] !== 'open' ||
    !['id', 'createdMs', 'updatedMs'].every(key => isNumber(value[key])) ||
    !isText(value['title']) ||
    !isText(value['why']) ||
    !KINDS.includes(value['kind'] as TaskKind) ||
    !isOptional(value['doneWhen'], isText) ||
    !isOptional(value['recommended'], isText) ||
    !isOptional(value['options'], isTexts)
  ) {
    return undefined
  }

  const { id, createdMs, updatedMs, doneWhen, recommended, options } = value as Pick<
    Task,
    'id' | 'createdMs' | 'updatedMs' | 'doneWhen' | 'recommended' | 'options'
  >

  return {
    id,
    kind: value['kind'] as TaskKind,
    title: value['title'],
    thread: [{ from: 'claude', text: value['why'], atMs: createdMs }],
    ...(doneWhen === undefined ? {} : { doneWhen }),
    ...(options === undefined ? {} : { options }),
    ...(recommended === undefined ? {} : { recommended }),
    state: 'open',
    isWaitingForClaude: false,
    hasNewReply: false,
    update: 'none',
    createdMs,
    updatedMs,
  }
}

function isTaken(value: unknown): boolean {
  return (
    isFields(value) &&
    isText(value['code']) &&
    isText(value['fromKey']) &&
    Array.isArray(value['ids']) &&
    value['ids'].every(one => isFields(one) && isNumber(one['was']) && isNumber(one['now']))
  )
}

function isHandoff(value: unknown): value is Saved['handoff'] {
  return isFields(value) && isText(value['code']) && isNumber(value['atMs'])
}

/**
 * A stored value as a session's saved items, less any entry that isn't an
 * item; nothing when it isn't one. A value v0.1 saved (it has no `version`)
 * keeps its open items only, and no folder: only a resume of its session
 * brings them back.
 */
export function savedIn(raw: unknown): Saved | undefined {
  if (!isFields(raw)) {
    return undefined
  }

  const { tasks, nextId, savedMs, lastActiveMs, endedMs, folder, handoff, taken } = raw

  if (!Array.isArray(tasks) || !isNumber(nextId) || !isNumber(savedMs)) {
    return undefined
  }

  if (raw['version'] === undefined) {
    return { version: 2, tasks: tasks.flatMap(task => itemFromV1(task) ?? []), nextId, savedMs, lastActiveMs: savedMs, folder: '', taken: [] }
  }

  if (
    raw['version'] !== 2 ||
    !isNumber(lastActiveMs) ||
    !isOptional(endedMs, isNumber) ||
    !isText(folder) ||
    !isOptional(handoff, isHandoff) ||
    !Array.isArray(taken) ||
    !taken.every(isTaken)
  ) {
    return undefined
  }

  return {
    version: 2,
    tasks: tasks.filter(isItem),
    nextId,
    savedMs,
    lastActiveMs,
    ...(endedMs === undefined ? {} : { endedMs }),
    folder,
    ...(handoff === undefined ? {} : { handoff }),
    taken,
  }
}

export function isExpired(saved: Saved, nowMs: number): boolean {
  return nowMs - saved.savedMs > KEEP_MS
}

/**
 * `saved` as its key keeps it: open, later and handing-off items whole; a
 * closed item without its thread once Claude has heard of it, and gone 7 days
 * after its last change. One Claude has not heard of yet stays whole.
 */
export function trimmed(saved: Saved, nowMs: number): Saved {
  const tasks = saved.tasks.flatMap(task => {
    if (!CLOSED.includes(task.state) || task.update === 'pending') {
      return [task]
    }

    return nowMs - task.updatedMs > KEEP_CLOSED_MS ? [] : [{ ...task, thread: [] }]
  })

  return { ...saved, tasks }
}
