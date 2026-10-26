import type { Message, Saved, Taken, Task, TaskKind } from '../types'
import { KINDS, isShown } from './tasks'

/** How long a session's saved items wait for `claude --resume`: an older key is deleted at the next start. */
export const KEEP_MS = 30 * 24 * 60 * 60_000

/** How long a closed item stays in its session's key once Claude has heard of it. */
const KEEP_CLOSED_MS = 7 * 24 * 60 * 60_000

/** How long `handing-off` items wait for a session to take them by their code, before any session in the folder is offered them. */
const UNCLAIMED_MS = 30 * 60_000

/** How long a session that has not ended stays quiet before its items are offered to the next session in its folder. */
const STALE_MS = 12 * 60 * 60_000

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
    isOptional(value['options'], isTexts) &&
    isOptional(value['heardMs'], isNumber)
  )
}

type V1Task = Pick<Task, 'id' | 'kind' | 'title' | 'doneWhen' | 'recommended' | 'options' | 'createdMs' | 'updatedMs'> & {
  why: string
  state: string
  answer?: string
}

/** What the user did with a v0.1 task they answered, as its thread records it. */
function moveFromV1(task: V1Task): Message {
  const atMs = task.updatedMs

  if (task.state === 'seen') {
    return { from: 'user', text: '', event: 'seen', atMs }
  }

  if (task.answer === undefined || task.answer === '') {
    return { from: 'user', text: '', event: 'done', atMs }
  }

  return task.kind === 'decision' && task.options?.includes(task.answer)
    ? { from: 'user', text: task.answer, event: 'chose', atMs }
    : { from: 'user', text: task.answer, atMs }
}

/**
 * A task v0.1 saved, as an item: its why is the thread's first message. An
 * open one stays open; an answer the user gave that Claude has not heard
 * (`done` or `seen`, its update pending) is resolved, its move in the thread
 * and still to send. Any other is dropped.
 */
function itemFromV1(value: unknown): Task | undefined {
  if (
    !isFields(value) ||
    !['id', 'createdMs', 'updatedMs'].every(key => isNumber(value[key])) ||
    !isText(value['title']) ||
    !isText(value['why']) ||
    !KINDS.includes(value['kind'] as TaskKind) ||
    !isOptional(value['doneWhen'], isText) ||
    !isOptional(value['recommended'], isText) ||
    !isOptional(value['options'], isTexts) ||
    !isOptional(value['answer'], isText)
  ) {
    return undefined
  }

  const task = value as V1Task
  const isUnsent = (task.state === 'done' || task.state === 'seen') && value['update'] === 'pending'

  if (task.state !== 'open' && !isUnsent) {
    return undefined
  }

  const { id, kind, title, why, doneWhen, recommended, options, createdMs, updatedMs } = task
  const detail: Message = { from: 'claude', text: why, atMs: createdMs }

  return {
    id,
    kind,
    title,
    thread: isUnsent ? [detail, moveFromV1(task)] : [detail],
    ...(doneWhen === undefined ? {} : { doneWhen }),
    ...(options === undefined ? {} : { options }),
    ...(recommended === undefined ? {} : { recommended }),
    state: isUnsent ? 'resolved' : 'open',
    isWaitingForClaude: false,
    hasNewReply: false,
    update: isUnsent ? 'pending' : 'none',
    createdMs,
    updatedMs,
  }
}

function isTaken(value: unknown): value is Taken {
  return (
    isFields(value) &&
    isText(value['code']) &&
    isText(value['fromKey']) &&
    Array.isArray(value['ids']) &&
    value['ids'].every(one => isFields(one) && isNumber(one['was']) && isNumber(one['now']))
  )
}

function isHandoff(value: unknown): value is NonNullable<Saved['handoff']> {
  return isFields(value) && isText(value['code']) && isNumber(value['atMs'])
}

/**
 * A stored value as a session's saved items, less any item or `taken` entry
 * that isn't one, and its hand-off when that isn't one; nothing when the
 * value isn't a session's. A value v0.1 saved (it has no `version`) keeps its
 * open items and its answers not sent yet (see `itemFromV1`), and no folder:
 * only a resume of its session brings them back.
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

  if (raw['version'] !== 2 || !isNumber(lastActiveMs) || !isOptional(endedMs, isNumber) || !isText(folder)) {
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
    ...(isHandoff(handoff) ? { handoff } : {}),
    taken: Array.isArray(taken) ? taken.filter(isTaken) : [],
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

/** The sessions saved in `all` (each stored value by its key), but the one under `except`. */
function sessionsIn(all: Record<string, unknown>, except?: string): [string, Saved][] {
  return Object.entries(all).flatMap(([key, raw]): [string, Saved][] => {
    const saved = key === except || !isSavedKey(key) ? undefined : savedIn(raw)

    return saved === undefined ? [] : [[key, saved]]
  })
}

function codesIn(sessions: readonly [string, Saved][]): Set<string> {
  return new Set(sessions.flatMap(([, saved]) => saved.taken.map(one => one.code)).filter(code => code !== ''))
}

/** Every hand-off code a session's key says it took items by. */
export function takenCodes(all: Record<string, unknown>): Set<string> {
  return codesIn(sessionsIn(all))
}

/** The numbers of `fromKey`'s items that another session's key says it took or dismissed. */
function takenOf(sessions: readonly [string, Saved][], fromKey: string): Set<number> {
  return new Set(
    sessions.flatMap(([key, saved]) => (key === fromKey ? [] : saved.taken.filter(one => one.fromKey === fromKey).flatMap(one => one.ids.map(id => id.was)))),
  )
}

/**
 * What other sessions took of `ownKey`'s items: their numbers, and whether
 * one took its hand-off code, which takes every item still `handing-off`.
 */
export function takenFrom(all: Record<string, unknown>, ownKey: string, handoff: Saved['handoff']): { ids: Set<number>; isCodeTaken: boolean } {
  const sessions = sessionsIn(all, ownKey)

  return { ids: takenOf(sessions, ownKey), isCodeTaken: handoff !== undefined && codesIn(sessions).has(handoff.code) }
}

/** Whether `handoff` has waited UNCLAIMED_MS and no session took its code (one of `codes`). */
export function isUnclaimed(handoff: Saved['handoff'], codes: ReadonlySet<string>, nowMs: number): boolean {
  return handoff !== undefined && nowMs - handoff.atMs >= UNCLAIMED_MS && !codes.has(handoff.code)
}

/**
 * The items other sessions in `folder` left, each session's under its key:
 * open, Later and `handing-off` items of one that ended or was quiet
 * STALE_MS, and `handing-off` items whose hand-off is unclaimed (see
 * `isUnclaimed`), of any session. Never an item another key took or
 * dismissed, nor one whose hand-off code a key took.
 */
export function leftoversIn(all: Record<string, unknown>, folder: string, ownKey: string, nowMs: number): { key: string; saved: Saved }[] {
  const sessions = sessionsIn(all)
  const codes = codesIn(sessions)

  return sessions.flatMap(([key, saved]) => {
    if (key === ownKey || folder === '' || saved.folder !== folder || isExpired(saved, nowMs)) {
      return []
    }

    const taken = takenOf(sessions, key)
    const isLeft = saved.endedMs !== undefined || nowMs - saved.lastActiveMs >= STALE_MS
    const tasks = saved.tasks.filter(task => {
      if (taken.has(task.id) || !isShown(task)) {
        return false
      }

      return task.state === 'handing-off' && saved.handoff !== undefined ? isUnclaimed(saved.handoff, codes, nowMs) : isLeft
    })

    return tasks.length === 0 ? [] : [{ key, saved: { ...saved, tasks } }]
  })
}

/** The items still `handing-off` under hand-off code `code` in a key but `ownKey`'s, less those a key took; undefined when there are none. */
export function handedOffIn(all: Record<string, unknown>, code: string, ownKey: string): { key: string; saved: Saved } | undefined {
  const sessions = sessionsIn(all)
  const found = sessions.find(([key, saved]) => key !== ownKey && saved.handoff?.code === code)

  if (found === undefined) {
    return undefined
  }

  const [key, saved] = found
  const taken = takenOf(sessions, key)
  const tasks = saved.tasks.filter(task => task.state === 'handing-off' && !taken.has(task.id))

  return tasks.length === 0 ? undefined : { key, saved: { ...saved, tasks } }
}
