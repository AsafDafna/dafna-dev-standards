import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderSurface, StateValue, Timer } from 'claude-code'

import type { Header, Held, Offer, Saved, Screen, Task } from '../types'
import { isActive, isAway, isShown, statusOf, toldOf } from './tasks'
import { hasReplyField, openTaskOf, replyKeyOf, rowsFor } from './pane'
import type { PaneView } from './pane'
import { isExpired, isSavedKey, keyOf, savedIn, trimmed, withTaken } from './saved'
import { clockOf } from './side'

export const PLUGIN = 'open-items'

/** An ask alerts only when the person has been quiet this long. */
export const ALERT_QUIET_MS = 120_000

/** The longest a person, or Claude, waits on the store: what it doesn't answer by then finishes on its own. */
export const STORE_WAIT_MS = 5000

export const LOADING = "Open items is still loading this session's items. Try again in a moment."

/** The pane the items wait in, and the command that opens it. */
export const PANE = 'open-items'
export const PANE_TITLE = 'Open items'
export const MAX_PANE_ROWS = 18
export const LIST_SCREEN: Screen = { kind: 'list' }

/** How a surface draws the pane: its body's width, whether it draws a field and holds the keys, and whether it seats the pane inline. */
export type Seat = Pick<PaneView, 'canType' | 'isFocused'> & { columns: number; isInline: boolean }

/** An 80-column terminal's main screen: the pane's seat until a surface draws it. */
export const FIRST_SEAT: Seat = { columns: 76, canType: true, isFocused: false, isInline: true }

/** `seats` with `seat` among them: of seats alike but for their width, the narrowest stays, as it takes the most rows. */
export function seatsWith(seats: readonly Seat[], seat: Seat): readonly Seat[] {
  const alike = seats.find(other => isAlike(other, seat))

  return alike !== undefined && alike.columns <= seat.columns ? seats : [...seats.filter(other => other !== alike), seat]
}

export function isAlike(one: Seat, other: Seat): boolean {
  return one.canType === other.canType && one.isFocused === other.isFocused && one.isInline === other.isInline
}

export const TASKS_INITIAL: readonly Task[] = []
export const NEXT_ID_INITIAL = 1
export const HELD_INITIAL: Held | null = null
export const RESTORED_FOR_INITIAL: string | null = null
export const FOLDER_INITIAL: string | null = null
/** The remote clients attached, by surface, as the state's contract declares them. */
export type Roster = StateValue<'open-items', 'clients'>
export const CLIENTS_INITIAL: Roster = {}
export const HEADER_INITIAL: Header = { lastActiveMs: 0, taken: [] }
export const OFFER_INITIAL: Offer = []
export const SAVE_FAILING_INITIAL = false
export const ARRIVED_INITIAL: readonly number[] = []

const tasks = atom({ plugin: 'open-items', key: 'tasks' } as const, TASKS_INITIAL)
const nextId = atom({ plugin: 'open-items', key: 'nextId' } as const, NEXT_ID_INITIAL)
const screen = atom({ plugin: 'open-items', key: 'screen' } as const, LIST_SCREEN)
const held = atom({ plugin: 'open-items', key: 'held' } as const, HELD_INITIAL)
const restoredFor = atom({ plugin: 'open-items', key: 'restoredFor' } as const, RESTORED_FOR_INITIAL)
const folder = atom({ plugin: 'open-items', key: 'folder' } as const, FOLDER_INITIAL)
const clients = atom({ plugin: 'open-items', key: 'clients' } as const, CLIENTS_INITIAL)
const header = atom({ plugin: 'open-items', key: 'header' } as const, HEADER_INITIAL)
const offer = atom({ plugin: 'open-items', key: 'offer' } as const, OFFER_INITIAL)
const saveFailing = atom({ plugin: 'open-items', key: 'isSaveFailing' } as const, SAVE_FAILING_INITIAL)
const arrived = atom({ plugin: 'open-items', key: 'arrived' } as const, ARRIVED_INITIAL)

/** Items another session's key holds, to take from it, and the hand-off code they go by ('' for leftovers). */
export type Source = { key: string; code: string; tasks: readonly Task[] }

/**
 * What a toast says when a prompt carrying updates is dropped: why (`why`,
 * the mod's own prompt, which the user didn't type), only that they're kept
 * (`kept`, an answer the user typed, whose drop the engine shows), or nothing
 * (`nothing`, the user's own prompt, which they rode: they wait as before).
 */
export type DropNote = 'why' | 'kept' | 'nothing'

/** A prompt as it entered: its words, and the blocks that go beside them. */
export type Entered = { text: string; context?: readonly string[] }

/** What the module tracks beside `$.state`; a hot reload starts it over. */
export const live = {
  sessionId: '',
  /** When the person last typed a prompt or used the pane. */
  lastPersonMs: 0,
  /** An alert went out in the main loop's current turn; one per turn. */
  alertedTurn: false,
  /** Whether the main loop's turn runs: undefined until the mod has seen it begin or end. */
  mainTurn: undefined as boolean | undefined,
  /** The main loop's last turn ended by the user's interrupt: an answer that joined it waits for the next prompt. */
  wasStopped: false,
  /**
   * The items whose answers joined the running main turn as a row no model
   * request has read yet, each as it stood before that row claimed its update
   * (undefined when the row claimed none): see `handedOff`.
   */
  unreadAppend: new Map<number, Task | undefined>(),
  /** What the user has typed in each reply field so far, by `replyKeyOf`. */
  drafts: new Map<string, string>(),
  /**
   * What was typed in each reply field as its item closed, by `replyKeyOf`:
   * a button pressed on a drawing from before the item closed answers with it.
   */
  closed: new Map<string, string>(),
  /**
   * What each surface draws each field with, by `replyKeyOf`: the draft as
   * the surface first drew it. It stays put while the field is typed in, as a
   * value drawn anew puts the field's text back to it, keys typed meanwhile
   * lost. A surface that forgets what its fields hold (the pane closed, or a
   * client of it came) draws them with the draft again.
   */
  drawn: new Map<RenderSurface, Map<string, string>>(),
  batch: null as Timer | null,
  /** The items the batch under way sends: their updates go in the user's own words, which no other path takes. */
  batchIds: new Set<number>(),
  /** How many presses on each item are still writing, before they reach the batch: held as the batch's are. */
  writing: new Map<number, number>(),
  /** How many sessions of the process have ended: a start read that lands after its session ended opens no pane. */
  ends: 0,
  /** The session whose saved items are being read at its start: until the read settles, the tools refuse, as it replaces the items. */
  loading: null as string | null,
  /** The session whose start read failed: a write reads its key first, and writes only where none is saved. */
  unread: null as string | null,
  /** The store work asked for and not yet done: each piece waits for the one before. */
  queue: Promise.resolve() as Promise<unknown>,
  /** Store work a wait gave up on, not settled yet: while there is any, nothing waits on the store. */
  stalled: 0,
  /** The roster's writes asked for and not yet done: each waits for the one before (see `rostered`). */
  rosterQueue: Promise.resolve() as Promise<unknown>,
  /**
   * How each surface drawing the pane draws it, by `e.surface`: as it last
   * did, or, drawn by two clients or more, every way since one came or went
   * (by `seatsWith`), since a render names no client.
   */
  seats: new Map<RenderSurface, readonly Seat[]>(),
  /** Surfaces a client left while others stay: the next drawing there starts their seats over. */
  startingOver: new Set<RenderSurface>(),
  /** How many times each surface's last client has left: a drawing under way as one did keeps no seat there. */
  emptied: new Map<RenderSurface, number>(),
  /** The key of the element the pane's focus ring last moved onto. */
  ring: undefined as string | undefined,
  /** The rows the pane last asked for. */
  rows: 0,
  /** How many times the mod closed the pane: a re-size under way leaves it closed (see `fit`). */
  closes: 0,
  /** The re-sizes keys and ring moves asked for and not yet done: each waits for the one before (see `refit`). */
  refitQueue: Promise.resolve() as Promise<unknown>,
  /** The user's last two inputs, oldest first: what `isLiveChat` reads. */
  inputs: [] as readonly UserInput[],
  /**
   * The ids of the main loop's background shell commands and monitors
   * started and not yet ended; null when the mod cannot know them, as it did
   * not see them all start.
   */
  background: null as Set<string> | null,
  /** The items another session took while this process ran: the pane draws them where they went, and a reload or another session forgets them. */
  moved: new Set<number>(),
  pumpQueue: Promise.resolve() as Promise<unknown>,
  /** Helpers the mod stopped: their report says nothing in the item. */
  stoppedHelpers: new Set<string>(),
  /** The 10-minute stop of each helper at work, by agent id. */
  helperTimers: new Map<string, Timer>(),
  /** The last write of the side questions' log failed: a helper's prompt holds the log. */
  isLogFailing: false,
  quotaHold: null as QuotaHold | null,
  quotaTimer: null as Timer | null,
  /** The five-hour windows alerted, by their reset time ('' for a window with none). */
  alertedWindows: new Set<string>(),
}

export type QuotaHold = { percent: number; resetsAtMs?: number }

function quotaOf(hold: QuotaHold): NonNullable<PaneView['quota']> {
  return { percent: Math.floor(hold.percent), ...(hold.resetsAtMs !== undefined && { resumesAt: clockOf(hold.resetsAtMs) }) }
}

/** `bridge`: a prompt that answers an item (`↳ Answer to #5:`, see `answerIn`), from any surface. */
export type UserInput = { kind: 'typed' | 'bridge' | 'press'; atMs: number }

/**
 * Deletes every saved key that has expired or holds no saved session: all of
 * them share the store's one file. Resolves the keys left, as `readAll` does.
 */
export async function dropExpired($: EngineInterface): Promise<Record<string, unknown>> {
  const nowMs = await $.clock.now()
  const all = await readAll($)

  for (const [key, raw] of Object.entries(all)) {
    const saved = savedIn(raw)

    if (saved === undefined || isExpired(saved, nowMs)) {
      await $.store.delete(key)
      delete all[key]
    }
  }

  return all
}

/** Every session's key, as `readAll` reads it, with this session's own as `withOwnTaken` has it; undefined when the store cannot be read. */
export async function readStore($: EngineInterface): Promise<Record<string, unknown> | undefined> {
  const all = await readAll($).catch(() => undefined)

  return all === undefined ? undefined : withOwnTaken($, all)
}

/** `all` with this session's `taken` records as its state holds them: items it took are not offered again while their write is out, or after it failed. */
export async function withOwnTaken($: EngineInterface, all: Record<string, unknown>): Promise<Record<string, unknown>> {
  return withTaken(all, keyOf(live.sessionId), (await read($, header)).taken)
}

export async function readAll($: EngineInterface): Promise<Record<string, unknown>> {
  const keys = (await $.store.keys()).filter(isSavedKey)
  const values = await Promise.all(keys.map(key => $.store.get(key)))

  return Object.fromEntries(keys.map((key, i) => [key, values[i]]))
}

/** `writeSaved` once the store work asked for before is done, from the state as it stands then. */
export function persist($: EngineInterface): Promise<void> {
  return queued(() => writeSaved($))
}

/**
 * Writes the session's items, as `trimmed` keeps them, its count and its
 * header under its key. Nothing before its first item (most sessions never
 * hold one), nor before the session has read its key, which the write would
 * go over: one whose start read failed reads it here, and writes only where
 * none is saved. A write that fails is shown until one succeeds.
 */
export async function writeSaved($: EngineInterface) {
  // Read at one moment: a switch to another session never falls between them.
  const sessionId = live.sessionId
  const [restored, list, count, started, head] = await Promise.all([read($, restoredFor), read($, tasks), read($, nextId), read($, folder), read($, header)])

  if ((list.length === 0 && count === 1) || (restored !== sessionId && !(await isUnsaved($, sessionId)))) {
    return
  }

  const nowMs = await $.clock.now()
  const saved: Saved = { version: 2, tasks: list, nextId: count, savedMs: nowMs, ...head, folder: started ?? '' }

  try {
    await $.store.set(keyOf(sessionId), trimmed(saved, nowMs))
  } catch (error) {
    await noteSaved($, false)
    throw error
  }

  await noteSaved($, true)
}

/** Shows that the session's last write failed, or no more once one succeeds. */
export async function noteSaved($: EngineInterface, isSaved: boolean) {
  if ((await read($, saveFailing)) !== isSaved) {
    return
  }

  await update($, saveFailing, () => !isSaved)
  await refresh($)
}

/**
 * Reads session `sessionId`'s key again when its start read failed; resolves
 * whether nothing is saved there, which then counts as read. Once the store
 * answers it reads no more: saved items are never written over.
 */
export async function isUnsaved($: EngineInterface, sessionId: string): Promise<boolean> {
  if (live.unread !== sessionId) {
    return false
  }

  const saved = savedIn(await $.store.get(keyOf(sessionId)))
  const isFree = saved === undefined || isExpired(saved, await $.clock.now())

  // A switch to another session meanwhile.
  if (live.unread !== sessionId) {
    return false
  }

  live.unread = null

  if (isFree) {
    await update($, restoredFor, () => sessionId)
  }

  return isFree
}

/**
 * Runs store work one piece at a time, in the order asked, so no write of
 * the session's lands after a newer one. No piece asks for another.
 */
export function queued<T>(work: () => Promise<T>): Promise<T> {
  const done = live.queue.then(work, work)
  live.queue = done.catch(() => undefined)

  return done
}

/**
 * Writes the roster as `rewrite` has it once the writes asked for before are
 * done, in the order the engine raised them, so a client that leaves and
 * attaches again stays counted. Nothing else writes the roster: `rewrite`
 * runs once, ahead of its write.
 */
export function rostered($: EngineInterface, rewrite: (all: Roster) => Roster): Promise<Roster> {
  const done = live.rosterQueue.then(() => update($, clients, rewrite))
  live.rosterQueue = done.catch(() => undefined)

  return done
}

/**
 * Resolves once store `work` settles, or `STORE_WAIT_MS` on: a press, a
 * prompt or a tool call goes on without a store that is slow to answer, and
 * the work finishes on its own, in its place in the queue. Until work given
 * up on settles, nothing waits on the store at all.
 */
export async function awaited($: EngineInterface, work: Promise<unknown>) {
  if (live.stalled > 0) {
    // The caller may be all that holds `work` (a turn's scan and write): its failure must not go unhandled.
    void work.catch(() => undefined)
    return
  }

  if (!(await within($, work))) {
    const settled = () => {
      live.stalled -= 1
    }

    live.stalled += 1
    void work.then(settled, settled)
  }
}

/**
 * Resolves once the redraw that store work leads to settles, `STORE_WAIT_MS`
 * on, or at once while that work was given up on: it is no store work, so a
 * surface slow to open the pane doesn't hold up the store.
 */
export async function redrawn($: EngineInterface, shown: Promise<unknown>) {
  if (live.stalled === 0) {
    await within($, shown)
  }
}

/** Resolves once `work` settles, or `STORE_WAIT_MS` on, whichever is first: whether it settled. */
export function within($: EngineInterface, work: Promise<unknown>): Promise<boolean> {
  return new Promise(finish => {
    const timer = $.clock.after(STORE_WAIT_MS, () => finish(false))
    const done = () => {
      timer.cancel()
      finish(true)
    }

    void work.then(done, done)
  })
}

/**
 * Changes the item list and, when that changes it (`fn` hands back a new
 * list), saves it. The session's own state is what counts: a write that
 * fails now, the next change or the end makes.
 */
export async function change($: EngineInterface, fn: (list: readonly Task[]) => readonly Task[]) {
  let isChanged = false

  // `update` runs `fn` again when another write beat it: the last run counts.
  await update($, tasks, list => {
    const changed = fn(list)
    isChanged = changed !== list
    return changed
  })

  if (isChanged) {
    await awaited($, persist($))
    await refresh($)
  }
}

/**
 * Marks the updates Claude has not heard delivered (every one, or those
 * `isWanted`), in one change of the task list, and resolves them: the path
 * that claims them sends them, and no other finds them waiting meanwhile.
 * One on an item away to another session is that session's to hear.
 */
export async function claim($: EngineInterface, isWanted: (task: Task) => boolean = () => true): Promise<readonly Task[]> {
  const isDue = (task: Task) => task.update === 'pending' && !isAway(task) && isWanted(task)
  let due: readonly Task[] = []

  if (!(await read($, tasks)).some(isDue)) {
    return due
  }

  await change($, list => {
    due = list.filter(isDue)

    return list.map(task => (isDue(task) ? toldOf(task) : task))
  })

  return due
}

/**
 * Puts an item new or changed in front of the user: the pane, or a toast
 * where it cannot be seated unasked, and an alert when they have been away;
 * one alert a turn, none for info.
 */
export async function present($: EngineInterface, task: Task, nowMs: number, words: { toast: string; notice: string }) {
  if (!(await show($, false))) {
    $.ui.toast(words.toast)
  }

  if (task.kind !== 'info' && !live.alertedTurn && nowMs - live.lastPersonMs >= ALERT_QUIET_MS) {
    live.alertedTurn = true
    $.ui.notify(words.notice, { title: 'Open items' }).catch(() => undefined)
  }
}

/**
 * Keeps the status line in step with the items, and closes the pane once
 * nothing is left in it, no item and no offer. Resolves whether anything is shown.
 */
export async function refresh($: EngineInterface): Promise<boolean> {
  const list = await read($, tasks)
  const isShowing = await hasPane($, list)

  $.ui.status(statusOf(list.filter(isShown), await read($, saveFailing)))

  if (!isShowing) {
    await closePane($).catch(() => undefined)
  }

  return isShowing
}

/** Whether the pane has anything to draw: an item shown, an offer, or items that moved while this process ran. */
export async function hasPane($: EngineInterface, list?: readonly Task[]): Promise<boolean> {
  const items = list ?? (await read($, tasks))

  return items.some(isShown) || movedOf(items).length > 0 || (await read($, offer)).length > 0
}

/** The items another session took while this process ran, which the pane draws where they went. */
export function movedOf(list: readonly Task[]): Task[] {
  return list.filter(task => task.state === 'moved' && live.moved.has(task.id))
}

/** The user's Hide: the pane closes, and the line naming the items just moved here goes. */
export async function hidePane($: EngineInterface) {
  await update($, arrived, () => [])
  await closePane($)
}

/** Closes the Open items pane, and has a re-size under way leave it closed. */
export function closePane($: EngineInterface): Promise<void> {
  live.closes += 1

  return $.ui.close({ id: PANE })
}

/**
 * Opens the Open items pane sized to what it holds; `isAsked` when the person
 * asked for it (/open-items), so it takes the keyboard. Resolves whether the
 * surface seated it: one opened unasked waits on a narrow terminal.
 */
export async function show($: EngineInterface, isAsked: boolean): Promise<boolean> {
  // The surfaces forget a closed pane's fields and ring: it opens again with its fields drawn from their
  // drafts and its ring on nothing. When the engine can't say, a field still drawn gets its draft back.
  if (live.drafts.size > 0 || (await read($, screen)).kind === 'item') {
    const panes = await $.ui.panes().catch(() => undefined)

    if (panes === undefined || !panes.some(pane => pane.id === PANE)) {
      live.drawn.clear()
      live.ring = undefined
    }
  }

  return openAt($, await rowsWanted($), isAsked)
}

/** Opens the Open items pane `rows` tall, or re-sizes it; resolves whether the surface seated it. */
export async function openAt($: EngineInterface, rows: number, isAsked: boolean): Promise<boolean> {
  live.rows = rows
  // The pane is a view of the items: one that can't open costs the user a
  // click on /open-items, never the item itself.
  const opened = await $.ui
    .open({ id: PANE, title: PANE_TITLE, rows, ...(isAsked ? { focus: true as const } : {}) })
    .catch(() => ({ isPlaced: false as const }))

  return opened.isPlaced
}

/** What the pane draws from: the session's state, and what only the surface knows. */
export async function paneView($: EngineInterface, surface: Pick<PaneView, 'canType' | 'isFocused'>): Promise<PaneView> {
  const ownKey = keyOf(live.sessionId)
  const list = await read($, tasks)
  const state = {
    shown: list.filter(isShown),
    held: await read($, held),
    screen: await read($, screen),
    nowMs: await $.clock.now(),
    ...offeredOf(await read($, offer), ownKey),
    isSaveFailing: await read($, saveFailing),
    moved: movedOf(list),
    arrived: (await read($, arrived)).length,
  }
  const task = openTaskOf(state)

  // The draft, the unread rows and the hold are read after every await: a key typed, or a step, while a read is slow counts.
  return seated(
    {
      ...state,
      draft: task === undefined ? '' : (live.drafts.get(replyKeyOf(task.id)) ?? ''),
      unreadIds: [...live.unreadAppend.keys()],
      ...(live.quotaHold !== null && { quota: quotaOf(live.quotaHold) }),
    },
    surface,
  )
}

/** What the pane draws of `entries`: how many items other sessions left, and whether this session's own hand-off waits unclaimed. */
export function offeredOf(entries: Offer, ownKey: string): Pick<PaneView, 'offered' | 'isUnclaimed'> {
  return {
    offered: entries.reduce((count, entry) => count + (entry.key === ownKey ? 0 : entry.ids.length), 0),
    isUnclaimed: entries.some(entry => entry.key === ownKey),
  }
}

/** The pane's `view` as a surface that `canType`, and holds the keys or not, draws it. */
export function seated(view: Omit<PaneView, 'canType' | 'isFocused' | 'isTyping'>, surface: Pick<PaneView, 'canType' | 'isFocused'>): PaneView {
  const task = openTaskOf(view)
  const isField = task !== undefined && hasReplyField(task, { ...view, canType: surface.canType })

  return {
    ...view,
    canType: surface.canType,
    isFocused: surface.isFocused,
    isTyping: surface.isFocused && isField && live.ring === replyKeyOf(task.id),
  }
}

/** Re-sizes the pane to `wanted` rows, or else to what it holds now, when it is on screen. */
export async function fit($: EngineInterface, wanted?: number) {
  const rows = wanted ?? (await rowsWanted($))
  const closes = live.closes
  // Asked once the rows are known, as the pane re-sizes: one that closed
  // meanwhile, its last task gone, stays closed, as does one closed while
  // the surface answers.
  const panes = await $.ui.panes().catch(() => [])

  if (live.closes === closes && panes.some(pane => pane.id === PANE && pane.isPlaced)) {
    await openAt($, rows, false)
  }
}

/**
 * Re-sizes an inline pane whose rows changed with what nothing draws it
 * again for: a draft growing, the ring moving onto its field or off it.
 * One at a time, in the order asked: each reads the draft and the ring once
 * the one before has asked for its rows, so the last asks for what the last
 * key or move left.
 */
export function refit($: EngineInterface): Promise<void> {
  const done = live.refitQueue.then(async () => {
    if (inlineSeats().length === 0) {
      return
    }

    const rows = await rowsWanted($)

    if (rows !== live.rows) {
      await fit($, rows)
    }
  })
  live.refitQueue = done.catch(() => undefined)

  return done
}

/**
 * The rows the pane asks for: the most it takes on a surface seating it
 * inline. It is one height on all of them, and each asking for its own
 * would resize it against the others. From `view` when a render has just
 * read it, else from the state now.
 */
export async function rowsWanted($: EngineInterface, view?: PaneView): Promise<number> {
  const inline = inlineSeats()
  const state = view ?? (await paneView($, FIRST_SEAT))

  return Math.max(...(inline.length > 0 ? inline : [FIRST_SEAT]).map(seat => rowsFor(seated(state, seat), seat.columns, MAX_PANE_ROWS)))
}

/** Every way a surface draws the pane inline, where its rows count. */
export function inlineSeats(): Seat[] {
  return [...live.seats.values()].flat().filter(seat => seat.isInline)
}

/**
 * Draws the pane again when the ring left `was` for `now` and either is an
 * option: its box is lit from `live.ring`, which no render input carries.
 */
export function ringMoved($: EngineInterface, was: string | undefined, now: string | undefined) {
  if ([was, now].some(key => key?.startsWith('option-'))) {
    $.ui.invalidate('ui.render')
  }
}

/**
 * Changes item `id` with `fn` while it is open or later, and resolves the
 * item as the change found it: one closed meanwhile (Claude withdrew it, or a
 * press from an older render answered it) or gone (a /clear) stays as it is,
 * as does one `fn` hands back unchanged.
 */
export async function edit($: EngineInterface, id: number, fn: (task: Task, nowMs: number) => Task): Promise<Task | undefined> {
  const nowMs = await $.clock.now()
  let found: Task | undefined

  await change($, list => {
    found = list.find(task => task.id === id)
    const changed = found !== undefined && isActive(found) ? fn(found, nowMs) : found

    return changed === found ? list : list.map(task => (task.id === id && changed !== undefined ? { ...changed, updatedMs: nowMs } : task))
  })

  return found
}

/**
 * After a move on item `id` or its end: drops what was typed in its field,
 * kept for a press from a drawing from before, and the reply held there,
 * and leaves its screen once it is closed.
 */
export async function settle($: EngineInterface, id: number) {
  const key = replyKeyOf(id)
  const draft = live.drafts.get(key)

  if (draft !== undefined) {
    live.closed.set(key, draft)
  }

  forget(key)
  live.drafts.delete(key)

  await update($, held, now => (now?.id === id ? null : now))

  if (!(await isOpenNow($, id))) {
    await update($, screen, now => (now.kind === 'item' && now.id === id ? LIST_SCREEN : now))
  }
}

/** Whether task `id` is open now: one closed meanwhile, or gone, takes no answer. */
export async function isOpenNow($: EngineInterface, id: number): Promise<boolean> {
  return (await read($, tasks)).some(task => task.id === id && isActive(task))
}

/** Has every surface draw the field keyed `key` afresh, with its draft. */
export function forget(key: string) {
  for (const drawn of live.drawn.values()) {
    drawn.delete(key)
  }
}

/** The user or Claude is at work in the session: other sessions do not offer its items. */
export async function noteActive($: EngineInterface) {
  const nowMs = await $.clock.now()

  await update($, header, now => ({ ...now, lastActiveMs: nowMs }))
}
