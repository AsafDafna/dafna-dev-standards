import { describe, expect, test } from 'claude-code/testing'

import { leftoversIn, savedIn, takenCodes, trimmed } from '../hooks/saved'
import { isOpenAsk, parseAsk, parseReply } from '../hooks/tasks'
import type { Message, Saved, Task } from '../types'

const DAY_MS = 24 * 60 * 60_000
const NOW = 100 * DAY_MS

const STEPS = '1. Open settings\n2. Click New'

/** An item v0.1 saved: the same as register.test.tsx's. */
const ROTATE = {
  id: 7,
  title: 'Rotate the leaked token in Vault',
  why: 'It was in a public gist.',
  kind: 'action',
  state: 'open',
  update: 'none',
  createdMs: 0,
  updatedMs: 0,
} as const

const DETAIL: Message = { from: 'claude', text: "I can't run Xcode here.", atMs: NOW }

function item(fields: Partial<Task> = {}): Task {
  return {
    id: 1,
    kind: 'question',
    title: 'Paste the failing test names',
    thread: [DETAIL],
    state: 'open',
    isWaitingForClaude: false,
    hasNewReply: false,
    update: 'none',
    createdMs: NOW,
    updatedMs: NOW,
    ...fields,
  }
}

function saved(tasks: readonly Task[]): Saved {
  return { version: 2, tasks, nextId: 9, savedMs: NOW, lastActiveMs: NOW, folder: '/repo', taken: [] }
}

const errorOf = (parsed: unknown) => (parsed as { error?: string }).error

describe('the item model', () => {
  test('parseAsk keeps line breaks in detail and done_when', () => {
    const ask = parseAsk({ kind: 'action', title: 'Create the dev tokens', detail: STEPS, done_when: STEPS })

    expect(ask).toEqual({ kind: 'action', title: 'Create the dev tokens', detail: STEPS, doneWhen: STEPS })
  })

  test('parseAsk refuses a detail or done_when over 4000 characters', () => {
    const long = 'x'.repeat(4001)

    expect(errorOf(parseAsk({ kind: 'action', title: 'Create the dev tokens', detail: long }))).toContain('4000')
    expect(errorOf(parseAsk({ kind: 'action', title: 'Create the dev tokens', detail: 'Two tokens.', done_when: long }))).toContain('4000')

    const full = parseAsk({ kind: 'action', title: 'Create the dev tokens', detail: 'x'.repeat(4000) })
    expect((full as { detail?: string }).detail).toHaveLength(4000)
  })

  test('parseAsk keeps the 80-character title error', () => {
    const title = 'x'.repeat(81)

    expect(errorOf(parseAsk({ kind: 'action', title, detail: 'Two tokens.' }))).toBe(
      'title is 81 characters; keep it under 80 and put the rest in detail.',
    )
  })

  test('parseReply needs text or a change', () => {
    expect(errorOf(parseReply({ id: 3 }))).toContain('text or a change')
    expect(parseReply({ id: 3, text: STEPS })).toEqual({ id: 3, text: STEPS })
    expect(parseReply({ id: 3, title: 'Paste the failing test names' })).toEqual({ id: 3, change: { title: 'Paste the failing test names' } })
    expect(errorOf(parseReply({ id: 3, text: 'x'.repeat(4001) }))).toContain('4000')
  })

  test('isOpenAsk counts later items, not info', () => {
    expect(isOpenAsk(item())).toBe(true)
    expect(isOpenAsk(item({ state: 'later' }))).toBe(true)
    expect(isOpenAsk(item({ kind: 'info' }))).toBe(false)
    expect(isOpenAsk(item({ state: 'resolved' }))).toBe(false)
  })

  test('savedIn converts a v0.1 key', () => {
    const done = { ...ROTATE, id: 6, state: 'done', update: 'delivered', answer: 'Rotated it.' }
    const converted = savedIn({ tasks: [ROTATE, done], nextId: 8, savedMs: 0 })

    expect(converted?.tasks.map(task => task.id)).toEqual([7])
    expect(converted?.tasks[0]?.thread[0]?.text).toBe('It was in a public gist.')
    expect(converted?.folder).toBe('')
    expect(converted).toEqual({
      version: 2,
      tasks: [
        {
          id: 7,
          kind: 'action',
          title: 'Rotate the leaked token in Vault',
          thread: [{ from: 'claude', text: 'It was in a public gist.', atMs: 0 }],
          state: 'open',
          isWaitingForClaude: false,
          hasNewReply: false,
          update: 'none',
          createdMs: 0,
          updatedMs: 0,
        },
      ],
      nextId: 8,
      savedMs: 0,
      lastActiveMs: 0,
      folder: '',
      taken: [],
    })
  })

  test('savedIn keeps the answers a v0.1 key had not sent yet, resolved, each move in its thread', () => {
    const answered = { ...ROTATE, update: 'pending', updatedMs: 5 }
    const v1 = [
      { ...answered, id: 1, state: 'done' },
      { ...answered, id: 2, kind: 'decision', options: ['Cursor', 'Offset'], state: 'done', answer: 'Cursor' },
      { ...answered, id: 3, kind: 'question', state: 'done', answer: 'Two failures' },
      { ...answered, id: 4, kind: 'info', state: 'seen' },
      { ...answered, id: 5, state: 'done', update: 'delivered' },
      { ...answered, id: 6, state: 'rejected', reason: 'Not now' },
    ]
    const tasks = savedIn({ tasks: v1, nextId: 8, savedMs: 0 })?.tasks ?? []
    const why: Message = { from: 'claude', text: 'It was in a public gist.', atMs: 0 }

    expect(tasks.map(task => [task.id, task.state, task.update])).toEqual([
      [1, 'resolved', 'pending'],
      [2, 'resolved', 'pending'],
      [3, 'resolved', 'pending'],
      [4, 'resolved', 'pending'],
    ])
    expect(tasks.map(task => task.thread)).toEqual([
      [why, { from: 'user', text: '', event: 'done', atMs: 5 }],
      [why, { from: 'user', text: 'Cursor', event: 'chose', atMs: 5 }],
      [why, { from: 'user', text: 'Two failures', atMs: 5 }],
      [why, { from: 'user', text: '', event: 'seen', atMs: 5 }],
    ])
  })

  test('savedIn keeps a key whose taken list holds a malformed entry, without it, and drops only a malformed hand-off', () => {
    const good = { code: 'k3x9q2', fromKey: 'session:a', ids: [{ was: 1, now: 2 }] }
    const raw = { ...saved([item()]), handoff: { code: 7 }, taken: [good, { code: 'x' }, { ...good, ids: [{ was: 'one' }] }] }

    expect(savedIn(raw)).toEqual({ ...saved([item()]), taken: [good] })
  })

  test('leftoversIn offers the items of an ended or stale session in the folder, and a hand-off nobody took in 30 minutes, never an item another key took', () => {
    const MINUTE = 60_000
    const at = (fields: Partial<Saved>, tasks: readonly Task[] = [item({ id: 1 })]): Saved => ({ ...saved(tasks), ...fields })
    const handingOff = (id: number) => item({ id, state: 'handing-off' })
    const all: Record<string, unknown> = {
      'session:ended': at({ endedMs: NOW - MINUTE }, [item({ id: 1 }), item({ id: 2, state: 'later' }), item({ id: 3, state: 'resolved' }), item({ id: 4 })]),
      'session:live': at({ lastActiveMs: NOW - 5 * MINUTE }),
      'session:stale': at({ lastActiveMs: NOW - 13 * 60 * MINUTE }),
      'session:elsewhere': at({ folder: '/other', endedMs: NOW - MINUTE }),
      'session:v01': { tasks: [], nextId: 1, savedMs: NOW },
      'session:handed': at({ handoff: { code: 'aaaaaa', atMs: NOW - 31 * MINUTE } }, [handingOff(1), item({ id: 2 })]),
      'session:fresh': at({ handoff: { code: 'bbbbbb', atMs: NOW - 5 * MINUTE }, endedMs: NOW - MINUTE }, [handingOff(1)]),
      'session:claimed': at({ handoff: { code: 'cccccc', atMs: NOW - 120 * MINUTE }, endedMs: NOW - MINUTE }, [handingOff(1), handingOff(2)]),
      'session:taker': at({
        taken: [
          { code: 'cccccc', fromKey: 'session:claimed', ids: [{ was: 1, now: 1 }] },
          { code: '', fromKey: 'session:ended', ids: [{ was: 4, now: 2 }] },
        ],
      }),
      'session:mine': at({ endedMs: NOW - MINUTE }),
    }

    expect(leftoversIn(all, '/repo', 'session:mine', NOW).map(({ key, saved: one }) => [key, one.tasks.map(task => task.id)])).toEqual([
      ['session:ended', [1, 2]],
      ['session:stale', [1]],
      ['session:handed', [1]],
      // Its code was taken with #1 only: #2 is an ordinary leftover of a session that ended.
      ['session:claimed', [2]],
    ])
    expect(takenCodes(all)).toEqual(new Set(['cccccc']))
  })

  test('trimmed keeps a resolved item\'s thread while its update is pending, strips it once delivered, drops it after 7 days, and keeps an open one of any age', () => {
    const old = { createdMs: NOW - 30 * DAY_MS, updatedMs: NOW - 30 * DAY_MS }
    const open = item({ id: 1, ...old })
    const later = item({ id: 2, state: 'later', ...old })
    const chosen: Message = { from: 'user', text: 'Cursor', event: 'chose', atMs: NOW }
    const resolved = item({ id: 3, kind: 'decision', options: ['Cursor', 'Offset'], state: 'resolved', update: 'pending', thread: [DETAIL, chosen] })

    expect(trimmed(saved([open, later, resolved]), NOW).tasks).toEqual([open, later, resolved])

    const delivered = { ...resolved, update: 'delivered' as const }
    const withdrawn = item({ id: 4, state: 'withdrawn', update: 'delivered', note: 'answered in chat' })

    expect(trimmed(saved([open, delivered, withdrawn]), NOW).tasks).toEqual([open, { ...delivered, thread: [] }, { ...withdrawn, thread: [] }])
    expect(trimmed(saved([open, later, delivered, withdrawn]), NOW + 7 * DAY_MS + 1).tasks).toEqual([open, later])
  })

  test('a 40-message thread of 4000-character messages saves under 1 MiB', () => {
    // Three bytes a character in UTF-8: the most a 4000-character message can take.
    const thread = Array.from({ length: 40 }, (_, i): Message => ({ from: i % 2 === 0 ? 'claude' : 'user', text: '一'.repeat(4000), atMs: NOW + i }))
    const value = trimmed(saved([item({ thread })]), NOW)
    const json = JSON.stringify(value)

    expect(new TextEncoder().encode(json).length).toBeLessThan(1024 * 1024)
    expect(savedIn(JSON.parse(json))?.tasks[0]?.thread).toHaveLength(40)
  })
})
