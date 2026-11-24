/**
 * What Claude needs from the user: one of a few options (`decision`), an
 * answer in their own words (`question`), something done (`action`), or
 * nothing but a look (`info`). A `side` item is the user's question to the
 * session, which a helper answers.
 */
export type TaskKind = 'decision' | 'question' | 'action' | 'info' | 'side'

/**
 * `handing-off`: marked for a successor session, not taken yet. `moved`:
 * taken by another session, which owns it now.
 */
export type ItemState = 'open' | 'later' | 'resolved' | 'withdrawn' | 'handing-off' | 'moved'

/** A one-line entry in a thread for a press, an in-place change or a notice, in place of words. */
export type ThreadEvent = 'chose' | 'done' | 'seen' | 'later' | 'changed' | 'took' | 'notice'

/**
 * `text` is the option for `chose`, the line for `notice`, and empty for the
 * other events. `author: 'helper'` marks a message from Claude that a helper
 * wrote; without it, the main session wrote it.
 */
export type Message = { from: 'claude' | 'user'; text: string; atMs: number; event?: ThreadEvent; author?: 'helper' }

/** A helper's note or question that waits for the main session: `sentMs` is set once it went there; `askedMs` is the `atMs` of the user message it answers. */
export type ToMain = { kind: 'note' | 'question'; text: string; atMs: number; sentMs?: number; askedMs?: number }

/**
 * A side item's record. `transcripts`: the main conversation files it was
 * asked in, oldest first. `helperId`: the helper it was last handed to,
 * which a follow-up resumes; none after a timeout or a move. `sentMs`: the
 * `atMs` of the user's newest message a helper was given. `endedMs`: the
 * `sentMs` whose helper run ended, with an answer or a notice. `seenUuid`:
 * the newest main-conversation row the helper has seen.
 */
export type Side = { transcripts: readonly string[]; helperId?: string; sentMs?: number; endedMs?: number; seenUuid?: string; toMain?: ToMain }

/**
 * Whether Claude has heard of the user's latest move on the item: nothing
 * to tell (`none`), told nothing yet (`pending`), or told (`delivered`).
 */
export type TaskUpdate = 'none' | 'pending' | 'delivered'

export type Task = {
  /** Counts up per session: #1, #2, … */
  id: number
  kind: TaskKind
  title: string
  /** The `ask` argument: the one line the user answers, does or must know. */
  askLine?: string
  /** `thread[0]` is the detail, from Claude, or a side item's question, from the user. A closed item saved past its delivery keeps none. */
  thread: readonly Message[]
  doneWhen?: string
  options?: readonly string[]
  /** One note for each of `options`, in the same order: what the option means for the user. */
  optionNotes?: readonly string[]
  /** One of `options`, the one Claude suggests. */
  recommended?: string
  link?: string
  /** Made by `add_item` from 0.3 on, so Claude's messages are Markdown; an item saved before has none and shows as plain text. */
  isMarkdown?: true
  state: ItemState
  /** The user replied; Claude has not replied or closed it since. */
  isWaitingForClaude: boolean
  /** Claude replied; the user has not opened the item since. */
  hasNewReply: boolean
  update: TaskUpdate
  /** The `atMs` of the user's latest move Claude was told of: the moves after it are what Claude has not heard. */
  heardMs?: number
  /** Claude's note on closing it, "recorded in …", or "was #5 in the previous session". */
  note?: string
  side?: Side
  createdMs: number
  updatedMs: number
}

/**
 * Items a session took or dismissed from another session's key: `code` is
 * the hand-off code it took them by, '' for leftovers. Items keep their
 * number `was` where `now` is free.
 */
export type Taken = { code: string; fromKey: string; ids: readonly { was: number; now: number }[] }

/**
 * What a session keeps in the store under its own key, as one JSON file of
 * 4 MiB holds every session's key.
 */
export type Saved = {
  version: 2
  tasks: readonly Task[]
  nextId: number
  savedMs: number
  lastActiveMs: number
  endedMs?: number
  /** The folder the session started in, read once then. */
  folder: string
  /** The code its `handing-off` items wait under, and when `handoff_items` set them so. */
  handoff?: { code: string; atMs: number }
  taken: readonly Taken[]
}

/** What a session's key holds beside its items and its count. */
export type Header = Pick<Saved, 'lastActiveMs' | 'endedMs' | 'handoff' | 'taken'>

/**
 * Items the pane offers to take, by the key that holds them: those another
 * session left, or this session's own hand-off that no session took.
 */
export type Offer = readonly { key: string; ids: readonly number[] }[]

/** A reply to item `id`, or a new side question (`'new'`), the pane holds back, as it looks like a secret. */
export type Held = { id: number | 'new'; text: string }

/** What the Open items pane shows: the list of items, or one item. */
export type Screen = { kind: 'list' } | { kind: 'item'; id: number }

declare module 'claude-code' {
  interface PluginState {
    'open-items': {
      tasks: readonly Task[]
      nextId: number
      screen: Screen
      held: Held | null
      /** The session whose saved key the state was read from: a reload of the code finds it read. */
      restoredFor: string | null
      /** The folder the session started in, or its saved key names: a reload of the code, or a later cd, keeps it. */
      folder: string | null
      /** The remote clients attached, by surface: two phones are two clients on one. */
      clients: Readonly<Partial<Record<RenderSurface, readonly string[]>>>
      /** What the session's key holds beside its items: the end writes it with no read. */
      header: Header
      offer: Offer
      /** The session's last store write failed: the pane and the status line say so until one succeeds. */
      isSaveFailing: boolean
      /** The items `take_items` just brought here, which the list names until the user opens one, goes Back or hides the pane. */
      arrived: readonly number[]
    }
  }
}
