import { atom, read, update } from 'claude-code'
import type { EngineInterface, ToolCallResult } from 'claude-code'

import type { Offer, Taken, Task } from '../types'
import { arrivedAs, isActive, isShown, isSide, leftTakenOf, numbersFor, stateBefore, takenBackOf, takenByCodeOf, toldOf, tookBy } from './tasks'
import { workingHelperOf } from './side'
import { afterHelpers, disarm, pump, stopHelper, tasksNow, unsentOf, writeLog } from './helper'
import { offerOf } from './pane'
import { handedOffIn, isUnclaimed, keyOf, leftoversIn, savedIn, takenCodes, takenFrom } from './saved'
import { plural } from './text'
import {
  ARRIVED_INITIAL,
  FOLDER_INITIAL,
  HEADER_INITIAL,
  LOADING,
  NEXT_ID_INITIAL,
  OFFER_INITIAL,
  TASKS_INITIAL,
  awaited,
  change,
  claim,
  live,
  persist,
  readStore,
  refresh,
  settle,
  show,
  withOwnTaken,
} from './state'
import type { Source } from './state'
import { handOver, inNews } from './delivery'

export const CODE_LENGTH = 6
export const CODE_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'
export const CODE_SHAPE = new RegExp(`^[${CODE_CHARS}]{${CODE_LENGTH}}$`)

/** What a tool answers when the store cannot be read, which a hand-off needs. */
export const STORE_DOWN = 'Open items could not read the store, so nothing changed. Try again in a moment.'

const tasks = atom({ plugin: 'open-items', key: 'tasks' } as const, TASKS_INITIAL)
const nextId = atom({ plugin: 'open-items', key: 'nextId' } as const, NEXT_ID_INITIAL)
const folder = atom({ plugin: 'open-items', key: 'folder' } as const, FOLDER_INITIAL)
const header = atom({ plugin: 'open-items', key: 'header' } as const, HEADER_INITIAL)
const offer = atom({ plugin: 'open-items', key: 'offer' } as const, OFFER_INITIAL)
const arrived = atom({ plugin: 'open-items', key: 'arrived' } as const, ARRIVED_INITIAL)

export async function handOffItems($: EngineInterface, e: { agentId?: string }): Promise<ToolCallResult> {
  if (e.agentId !== undefined) {
    return { deny: 'Only the main agent hands items off.' }
  }

  if (live.loading !== null) {
    return { deny: LOADING }
  }

  const all = await readStore($)

  if (all === undefined) {
    return { deny: STORE_DOWN }
  }

  await noteMoved($, all, live.sessionId)

  if (!(await read($, tasks)).some(task => isActive(task) || task.state === 'handing-off')) {
    return { result: 'There are no open or Later items to hand off.' }
  }

  const nowMs = await $.clock.now()
  const { handoff } = await read($, header)
  // A second call keeps the code a successor may hold already.
  const code = handoff !== undefined && !takenCodes(all).has(handoff.code) ? handoff.code : newCode(all)
  let handed: number[] = []

  // A helper whose start is in flight is stopped too, and none starts before the items are marked.
  await afterHelpers(async () => {
    for (const helperId of (await tasksNow($)).flatMap(task => workingHelperOf(task) ?? [])) {
      disarm(helperId)
      await stopHelper($, helperId)
    }

    const unread = new Map(live.unreadAppend)

    await update($, header, now => ({ ...now, handoff: { code, atMs: nowMs } }))
    await change($, list => {
      handed = list.filter(isActive).map(task => task.id)

      // A stopped helper's question is asked again where the item goes, or here after a Take back.
      return handed.length === 0 ? list : list.map(task => (isActive(task) ? handedOff(workingHelperOf(task) === undefined ? task : unsentOf(task), unread, nowMs) : task))
    })
  })

  if (handed.length === 0) {
    await awaited($, persist($))
  }

  // Read by no model request, those answers go with their items: the old Claude is not woken for them.
  for (const id of handed) {
    live.unreadAppend.delete(id)
  }

  for (const id of handed) {
    await settle($, id)
  }

  const count = (await read($, tasks)).filter(task => task.state === 'handing-off').length

  return {
    result: `Marked ${plural(count, 'item')} for the next session. Hand-off code: ${code}. Put the code in the successor's prompt; it calls take_items with it.`,
  }
}

export async function takeItems($: EngineInterface, e: { agentId?: string }): Promise<ToolCallResult> {
  if (e.agentId !== undefined) {
    return { deny: 'Only the main agent takes items.' }
  }

  const args = e as unknown as Record<string, unknown>
  const code = typeof args['code'] === 'string' ? args['code'].trim().toLowerCase() : ''

  if (!CODE_SHAPE.test(code)) {
    return { deny: `code is required: the ${CODE_LENGTH}-character hand-off code from your prompt.` }
  }

  if (live.loading !== null) {
    return { deny: LOADING }
  }

  const all = await readStore($)

  if (all === undefined) {
    return { deny: STORE_DOWN }
  }

  const found = handedOffIn(all, code, keyOf(live.sessionId))

  if (found === undefined) {
    return { deny: takenCodes(all).has(code) ? `The items of hand-off code ${code} were taken already.` : `No items to take with hand-off code ${code}.` }
  }

  const nowMs = await $.clock.now()
  const source = { key: found.key, code, tasks: found.saved.tasks }
  // The result tells Claude what the user did that it has not heard.
  const came = await takeIn($, [source], arrived => tookBy(arrived.update === 'pending' ? toldOf(arrived) : arrived, 'claude', nowMs))

  await dropOffered($, [source])
  await update($, arrived, () => came.map(({ task }) => task.id))
  await writeLog($)
  void pump($)

  if (!(await show($, false))) {
    $.ui.toast(`${plural(came.length, 'item')} moved from the previous session. See /open-items`)
  }

  return { result: takenByCodeOf(code, came.map(({ arrived, was }) => ({ task: arrived, was })), nowMs) }
}

/**
 * Reads every session's key, or takes `all` read just now, and acts on what
 * other sessions did: this session's items another took are moved, and the
 * items left to take are offered. No timer runs it: the start, each main turn
 * and each press do. A store that fails leaves things as they are.
 */
export async function scan($: EngineInterface, all?: Record<string, unknown>) {
  const sessionId = live.sessionId
  const stored = all === undefined ? await readStore($) : await withOwnTaken($, all)

  if (stored === undefined || live.sessionId !== sessionId) {
    return
  }

  await noteMoved($, stored, sessionId)
  await offerLeftovers($, stored, sessionId)
}

/**
 * Marks moved this session's items another session's key took, and shows
 * where they went. Once a session took its hand-off code, the hand-off is
 * over: an item that take left behind (handed off again meanwhile) is back
 * as it was before.
 */
export async function noteMoved($: EngineInterface, all: Record<string, unknown>, sessionId: string) {
  const { handoff } = await read($, header)
  const taken = takenFrom(all, keyOf(sessionId), handoff)

  if ((taken.ids.size === 0 && !taken.isCodeTaken) || live.sessionId !== sessionId) {
    return
  }

  const isTaken = (task: Task) => isShown(task) && taken.ids.has(task.id)
  const isLeftBehind = (task: Task) => taken.isCodeTaken && task.state === 'handing-off' && !taken.ids.has(task.id)
  const nowMs = await $.clock.now()
  let moved: number[] = []

  if (taken.isCodeTaken) {
    await update($, header, now => ({ ...now, handoff: undefined }))
  }

  await change($, list => {
    moved = list.filter(isTaken).map(task => task.id)

    return moved.length === 0 && !list.some(isLeftBehind)
      ? list
      : list.map(task => {
          if (isTaken(task)) {
            return { ...task, state: 'moved', update: 'none', isWaitingForClaude: false, updatedMs: nowMs }
          }

          return isLeftBehind(task) ? { ...task, state: stateBefore(task), updatedMs: nowMs } : task
        })
  })

  if (moved.length === 0) {
    return
  }

  for (const id of moved) {
    live.moved.add(id)
    await settle($, id)
  }

  await refresh($)

  if (!(await show($, false))) {
    $.ui.toast(`${plural(moved.length, 'item')} moved to a new session. See /open-items`)
  }
}

/**
 * Offers the items other sessions in the folder left, and this session's
 * own hand-off when no session took it in time; opens the pane for an offer
 * that grew.
 */
export async function offerLeftovers($: EngineInterface, all: Record<string, unknown>, sessionId: string) {
  const ownKey = keyOf(sessionId)
  const nowMs = await $.clock.now()
  const left = leftoversIn(all, (await read($, folder)) ?? '', ownKey, nowMs).map(({ key, saved }) => ({ key, ids: saved.tasks.map(task => task.id) }))
  const { handoff } = await read($, header)
  const own = isUnclaimed(handoff, takenCodes(all), nowMs) ? (await read($, tasks)).filter(task => task.state === 'handing-off').map(task => task.id) : []
  const next: Offer = [...left, ...(own.length === 0 ? [] : [{ key: ownKey, ids: own }])]
  const was = await read($, offer)

  if (live.sessionId !== sessionId || JSON.stringify(was) === JSON.stringify(next)) {
    return
  }

  await update($, offer, () => next)
  const isGrown = next.some(entry => entry.ids.some(id => !was.some(one => one.key === entry.key && one.ids.includes(id))))

  if ((await refresh($)) && isGrown && !(await show($, false))) {
    const count = left.reduce((sum, entry) => sum + entry.ids.length, 0)

    $.ui.toast(`${count === 0 ? 'No session took the items you handed off' : offerOf({ offered: count })}. See /open-items`)
  }
}

/** A hand-off code no key in `all` holds. */
export function newCode(all: Record<string, unknown>): string {
  const used = new Set([...takenCodes(all), ...Object.values(all).flatMap(raw => savedIn(raw)?.handoff?.code ?? [])])
  let code = randomCode()

  while (used.has(code)) {
    code = randomCode()
  }

  return code
}

/** CODE_LENGTH characters of CODE_CHARS from the runtime's random source, which no other session can guess. */
export function randomCode(): string {
  // A byte past the last whole run of the characters would favour the first ones.
  const fair = 256 - (256 % CODE_CHARS.length)
  let code = ''

  while (code.length < CODE_LENGTH) {
    const [byte = fair] = crypto.getRandomValues(new Uint8Array(1))

    if (byte < fair) {
      code += CODE_CHARS.charAt(byte % CODE_CHARS.length)
    }
  }

  return code
}

/**
 * `task` marked for the next session. One whose answer joined a turn no model
 * request read (in `unread`) goes on with that answer not heard; what Claude
 * heard before stays heard.
 */
export function handedOff(task: Task, unread: ReadonlyMap<number, Task | undefined>, atMs: number): Task {
  const handed: Task = { ...task, state: 'handing-off', updatedMs: atMs }

  if (!unread.has(task.id)) {
    return handed
  }

  return { ...handed, update: 'pending', heardMs: (unread.get(task.id) ?? task).heardMs }
}

/**
 * Moves the items of `sources` into this session's key, each numbered by
 * `numbersFor` and made as `make` has it once it arrives (see `arrivedAs`),
 * with a record of what came from which key. Resolves each as it arrived, as
 * made, and with the number it had.
 */
export async function takeIn($: EngineInterface, sources: readonly Source[], make: (arrived: Task) => Task): Promise<{ arrived: Task; task: Task; was: number }[]> {
  const nowMs = await $.clock.now()
  const transcript = (await $.session.info().catch(() => undefined))?.transcriptPath ?? ''
  const incoming = sources.flatMap(source => source.tasks)
  const held = (await read($, tasks)).map(task => task.id)
  let numbers: readonly { was: number; now: number }[] = []

  await update($, nextId, count => {
    numbers = numbersFor(held, count, incoming.map(task => task.id))

    return Math.max(count, ...numbers.map(({ now }) => now + 1))
  })

  const came = incoming.map((task, i) => {
    const arrived = arrivedAs(task, numbers[i]?.now ?? task.id, nowMs, transcript)

    return { arrived, task: make(arrived), was: task.id }
  })
  const records: Taken[] = []
  let at = 0

  for (const { key, code, tasks: taking } of sources) {
    records.push({ code, fromKey: key, ids: numbers.slice(at, at + taking.length) })
    at += taking.length
  }

  // The items before the record of them: a crash between two writes leaves an item in two keys, never in none.
  await update($, tasks, list => [...list, ...came.map(one => one.task)])
  await update($, header, now => ({ ...now, taken: [...now.taken, ...records] }))
  await awaited($, persist($))
  await refresh($)

  return came
}

export async function dropOffered($: EngineInterface, sources: readonly Source[]) {
  await update($, offer, entries =>
    entries.flatMap(entry => {
      const gone = sources.find(source => source.key === entry.key)?.tasks.map(task => task.id) ?? []
      const ids = entry.ids.filter(id => !gone.includes(id))

      return ids.length === 0 ? [] : [{ ...entry, ids }]
    }),
  )
  await refresh($)
}

/**
 * The items of the offer as the pane drew it (`drawn`) that are still left to
 * take, from the store as it is now. Taken by their hand-off code when they
 * are its items still handing off; else by none. Undefined, and the user
 * told, when nothing is left or the store cannot be read.
 */
export async function stillOffered($: EngineInterface, drawn: Offer): Promise<Source[] | undefined> {
  const all = await readStore($)
  const left = all === undefined ? [] : leftoversIn(all, (await read($, folder)) ?? '', keyOf(live.sessionId), await $.clock.now())
  const sources = left.flatMap(({ key, saved }) => {
    const ids = drawn.find(entry => entry.key === key)?.ids ?? []
    const taking = saved.tasks.filter(task => ids.includes(task.id))
    const code = taking.some(task => task.state === 'handing-off') ? (saved.handoff?.code ?? '') : ''

    return taking.length === 0 ? [] : [{ key, code, tasks: taking }]
  })

  if (sources.length === 0) {
    await notOffered($, all === undefined)
    return undefined
  }

  return sources
}

/** The user's Take on items other sessions left: they move here, and Claude is told of those that are not side questions. */
export async function takeLeft($: EngineInterface, drawn: Offer) {
  const sources = await stillOffered($, drawn)

  if (sources === undefined) {
    return
  }

  const nowMs = await $.clock.now()
  const came = await takeIn($, sources, arrived => tookBy(arrived, 'user', nowMs))

  await dropOffered($, sources)
  await writeLog($)
  void pump($)

  // The text goes in the user's voice: no word of a side question may ride it.
  const claudes = came.filter(({ task }) => !isSide(task))
  const ids = claudes.map(({ task }) => task.id)

  if (ids.length === 0) {
    return
  }

  const due = await claim($, task => ids.includes(task.id))
  await handOver($, leftTakenOf(claudes, nowMs), due, ids, inNews)
}

/** The user's Dismiss on items other sessions left: they close here, as no other session is offered them again, and Claude hears nothing. */
export async function dismissLeft($: EngineInterface, drawn: Offer) {
  const sources = await stillOffered($, drawn)

  if (sources === undefined) {
    return
  }

  await takeIn($, sources, arrived => ({ ...arrived, state: 'withdrawn', note: 'dismissed', update: 'none', isWaitingForClaude: false, hasNewReply: false }))
  await dropOffered($, sources)
}

/** Says a Take or Dismiss found nothing to act on (`isStoreDown`: it could not read the store), and offers what is left. */
export async function notOffered($: EngineInterface, isStoreDown: boolean) {
  $.ui.toast(isStoreDown ? STORE_DOWN : 'Those items are no longer offered, so nothing changed.', { timeoutMs: 8000 })
  await scan($)
}

/** The user's Take on this session's own hand-off no session took: the items are theirs and Claude's again. */
export async function takeBack($: EngineInterface) {
  const ownKey = keyOf(live.sessionId)

  // Pressed on a drawing from before Claude handed them off again, or before a session took them.
  if (!(await read($, offer)).some(entry => entry.key === ownKey)) {
    await notOffered($, false)
    return
  }

  const nowMs = await $.clock.now()
  let back: number[] = []

  await update($, header, now => ({ ...now, handoff: undefined }))
  await change($, list => {
    back = list.filter(task => task.state === 'handing-off').map(task => task.id)

    return back.length === 0 ? list : list.map(task => (task.state === 'handing-off' ? { ...task, state: stateBefore(task), updatedMs: nowMs } : task))
  })
  await update($, offer, entries => entries.filter(entry => entry.key !== ownKey))
  await refresh($)

  if (back.length === 0) {
    return
  }

  await writeLog($)
  void pump($)

  const items = (await read($, tasks)).filter(task => back.includes(task.id) && !isSide(task))
  const ids = items.map(task => task.id)

  if (ids.length === 0) {
    return
  }

  const due = await claim($, task => ids.includes(task.id))
  await handOver($, takenBackOf(items.map(task => ({ task, was: task.id })), nowMs), due, ids, inNews)
}
