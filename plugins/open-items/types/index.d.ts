/**
 * What Claude needs from the user: one of a few options (`decision`), an
 * answer in their own words (`question`), something done (`action`), or
 * nothing but a look (`info`).
 */
export type TaskKind = 'decision' | 'question' | 'action' | 'info'

/**
 * Where an item stands: waiting for the user (`open`), fulfilled (`done`),
 * turned down (`rejected`), taken back by Claude (`withdrawn`), or looked at
 * (`seen`, an `info` item only).
 */
export type TaskState = 'open' | 'done' | 'rejected' | 'withdrawn' | 'seen'

/**
 * Whether Claude has heard of the user's latest move on the item: nothing
 * to tell (`none`), told nothing yet (`pending`), or told (`delivered`).
 */
export type TaskUpdate = 'none' | 'pending' | 'delivered'

/** An item Claude gave the user. */
export type Task = {
  /** Counts up per session: #1, #2, … */
  id: number
  title: string
  why: string
  doneWhen?: string
  kind: TaskKind
  options?: readonly string[]
  /** One of `options`, the one Claude suggests. */
  recommended?: string
  state: TaskState
  /** The user's answer, or the option they chose. */
  answer?: string
  /** Why the user rejected it, or why Claude withdrew it. */
  reason?: string
  update: TaskUpdate
  createdMs: number
  updatedMs: number
}

/**
 * The selected item's field, when the pane shows one in place of its
 * buttons: an answer, or a reason for rejecting. `held` is an answer held
 * back because it looks like a secret.
 */
export type Editing = {
  id: number
  field: 'answer' | 'reason'
  held?: string
}

declare module 'claude-code' {
  interface PluginState {
    'open-items': {
      tasks: readonly Task[]
      nextId: number
      selectedId: number | null
      editing: Editing | null
      /** The session whose saved key the state was read from: a reload of the code finds it read. */
      restoredFor: string | null
      isWorking: boolean
      /** The remote clients attached, by surface: two phones are two clients on one. */
      clients: Readonly<Partial<Record<RenderSurface, readonly string[]>>>
    }
  }
}
