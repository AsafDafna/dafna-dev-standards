import type { EngineInterface, PromptSubmitResult } from 'claude-code'

import type { Task } from '../types'
import { hasNewsIn, isActive, isRepeatOf, isStale, messageOf, movedBy, newsHeadOf, ownHeadOf } from './tasks'
import type { Move } from './tasks'
import { numbersOf, printable } from './text'
import { change, claim, edit, live, settle } from './state'
import type { DropNote, Entered } from './state'

/** Resolutions pressed this close together go to Claude as one message. */
export const BATCH_MS = 800

/** The prompt that wakes Claude for an answer its turn ended without reading. */
export const WAKE_UP = 'I answered an item while you were finishing your reply; my answer is above.'

/** Whether the batch under way, or a press still writing, sends `task`'s update. */
export function isHeld(task: Task): boolean {
  return live.batchIds.has(task.id) || live.writing.has(task.id)
}

/**
 * Passes on a prompt that carries `due` to Claude, where `isCarried` looks
 * for each; the caller claimed them, so no other path sends them meanwhile.
 * Those that don't enter with it (a hook beneath dropped it or took them
 * out, or it failed) wait again for the next send, and a toast says so, as
 * `onDrop` says for a drop.
 */
export async function passOn<R extends PromptSubmitResult>(
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
export function inWords(entered: Entered, task: Task): boolean {
  return entered.text.includes(ownHeadOf(task))
}

/** Whether a prompt that entered carries an update in a digest beside its words (`#5 done: <title>.`), read as `inWords` reads them. */
export function inDigest(entered: Entered, task: Task): boolean {
  return (entered.context ?? []).some(block => block.includes(newsHeadOf(task)))
}

/**
 * Gives back updates that never reached Claude, to go with the next send,
 * and says so as `note` says. It never throws: `passOn` keeps the prompt's
 * own error.
 */
export async function giveBack($: EngineInterface, lost: readonly Task[], note: DropNote, reason?: string) {
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

  $.ui.toast(`Claude didn't get your response to ${which}${why}. It's saved, and goes to Claude with the next message.`, {
    timeoutMs: 8000,
  })
}

/**
 * Gives back updates that never reached Claude, `lost` as they stood before
 * they were claimed: they wait again, and Claude counts as told only of what
 * it was told before.
 */
export async function undelivered($: EngineInterface, lost: readonly Task[]) {
  await change($, list =>
    list.map(task => {
      const was = lost.find(one => one.id === task.id)

      return was === undefined ? task : { ...task, update: task.update === 'delivered' ? 'pending' : task.update, heardMs: was.heardMs }
    }),
  )
}

/**
 * The user's `move` on a task, which the batch sends Claude. Resolves the
 * task as it stood, as `edit` does: one no longer open stays as it is.
 */
export async function resolve($: EngineInterface, id: number, move: Move) {
  // Pending from the edit on, it is held until the batch holds it: else a
  // prompt's digest or list_items could take it while the store writes.
  live.writing.set(id, (live.writing.get(id) ?? 0) + 1)

  try {
    const was = await edit($, id, (task, nowMs) => (isStale(task, move) ? task : movedBy(task, move, nowMs)))

    if (isStale(was, move)) {
      return was
    }

    const isNew = was !== undefined && isActive(was) && !isRepeatOf(was, move)
    await settle($, id)

    // A move that changes nothing sends nothing new, and holds back no batch under way.
    if (isNew) {
      sendSoon($, id)
    }

    return was
  } finally {
    const left = (live.writing.get(id) ?? 1) - 1

    if (left > 0) {
      live.writing.set(id, left)
    } else {
      live.writing.delete(id)
    }
  }
}

/** Sends item `id`'s update with the others pressed within BATCH_MS of the last. */
export function sendSoon($: EngineInterface, id: number) {
  live.batchIds.add(id)
  armBatch($)
}

/** Starts the batch's BATCH_MS over. */
export function armBatch($: EngineInterface) {
  live.batch?.cancel()
  live.batch = $.clock.after(BATCH_MS, () => {
    const ids = [...live.batchIds]
    cancelBatch()
    void deliver($, ids).catch(() => undefined)
  })
}

export function cancelBatch() {
  live.batch?.cancel()
  live.batch = null
  live.batchIds.clear()
}

/**
 * Hands Claude the updates of items `ids`, with any other no batch holds (one
 * a send gave back): a row the running main turn reads at its next request,
 * or else the user's prompt, which the engine runs once Claude is idle.
 */
export async function deliver($: EngineInterface, ids: readonly number[]) {
  // A move Claude is never told of (a Seen v0.1 saved unsent) counts as told, and says nothing.
  const due = (await claim($, task => ids.includes(task.id) || !isHeld(task))).filter(hasNewsIn)

  if (due.length === 0) {
    return
  }

  const which = due.map(task => task.id)

  await handOver($, messageOf(due), due, which, inWords, `Sent your response to ${numbersOf(which)} to Claude`)
}

/**
 * Hands Claude `text` about items `ids`, which carries the updates `due`
 * claimed, as `isCarried` finds them: a row the running main turn reads at
 * its next request, or else the user's prompt, which the engine runs once
 * Claude is idle. A row that went in is followed by `notice`, for the user.
 */
export async function handOver(
  $: EngineInterface,
  text: string,
  due: readonly Task[],
  ids: readonly number[],
  isCarried: (entered: Entered, task: Task) => boolean,
  notice?: string,
) {
  const isTaken =
    live.mainTurn === true &&
    (await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } }).then(
      appended => appended.deny === undefined,
      () => false,
    ))

  if (!isTaken) {
    await passOn($, due, isCarried, 'why', () => $.prompt.submit({ text, asUser: true })).catch(() => undefined)
    return
  }

  // A turn the user stopped while the row went in leaves it unread for the next prompt.
  if (live.mainTurn === true || live.wasStopped) {
    for (const id of ids) {
      if (!live.unreadAppend.has(id)) {
        live.unreadAppend.set(id, due.find(task => task.id === id))
      }
    }

    $.ui.invalidate('ui.render')
  } else {
    // The turn ended while the row went in.
    wakeUp($)
  }

  if (notice !== undefined) {
    await $.session.append({ message: { type: 'system', content: [{ type: 'text', text: notice }] } }).catch(() => undefined)
  }
}

/** Starts a turn for the answers that joined the main turn after its last request. */
export function wakeUp($: EngineInterface) {
  clearUnread($)
  void $.prompt.submit({ text: WAKE_UP, asUser: true }).catch(() => undefined)
}

/** Forgets the rows no step has read, and redraws the pane's sent line, which no render input carries. */
export function clearUnread($: EngineInterface) {
  if (live.unreadAppend.size > 0) {
    live.unreadAppend.clear()
    $.ui.invalidate('ui.render')
  }
}

/** Whether a prompt that entered carries an update in its words as its news (`#5 open: <title>.`), read as `inWords` reads them. */
export function inNews(entered: Entered, task: Task): boolean {
  return entered.text.includes(newsHeadOf(task))
}
