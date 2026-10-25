import type { Task } from '../types'

/** How long a session's saved items wait for `claude --resume`: an older key is deleted at the next start. */
export const KEEP_MS = 30 * 24 * 60 * 60_000

const PREFIX = 'session:'

const KINDS: readonly string[] = ['decision', 'question', 'action', 'info']
const STATES: readonly string[] = ['open', 'done', 'rejected', 'withdrawn', 'seen']
const UPDATES: readonly string[] = ['none', 'pending', 'delivered']

/**
 * What a session keeps in the store under its own key: its shown items only,
 * as one JSON file of 4 MiB holds every session's key.
 */
export type Saved = { tasks: readonly Task[]; nextId: number; savedMs: number }

export function keyOf(sessionId: string): string {
  return `${PREFIX}${sessionId}`
}

export function isSavedKey(key: string): boolean {
  return key.startsWith(PREFIX)
}

export function isTask(value: unknown): value is Task {
  const task = value as Record<string, unknown> | null
  const isText = (key: string) => typeof task?.[key] === 'string'
  const options = task?.['options']

  return (
    task !== null &&
    typeof task === 'object' &&
    ['id', 'createdMs', 'updatedMs'].every(key => typeof task[key] === 'number') &&
    ['title', 'why', 'sessionId'].every(isText) &&
    KINDS.includes(task['kind'] as string) &&
    STATES.includes(task['state'] as string) &&
    UPDATES.includes(task['update'] as string) &&
    ['doneWhen', 'answer', 'reason', 'recommended'].every(key => task[key] === undefined || isText(key)) &&
    (options === undefined || (Array.isArray(options) && options.every(option => typeof option === 'string')))
  )
}

/** A stored value as a session's saved items, less any entry that isn't a task; nothing when it isn't one. */
export function savedIn(raw: unknown): Saved | undefined {
  const value = raw as Record<string, unknown> | null

  if (value === null || typeof value !== 'object' || !Array.isArray(value.tasks) || typeof value.nextId !== 'number' || typeof value.savedMs !== 'number') {
    return undefined
  }

  return { tasks: value.tasks.filter(isTask), nextId: value.nextId, savedMs: value.savedMs }
}

export function isExpired(saved: Saved, nowMs: number): boolean {
  return nowMs - saved.savedMs > KEEP_MS
}
