import type { AgentInfo, SessionRateLimit } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import type { Message, Side, Task } from '../types'
import { ADD, CLOSE, DONE, HOUR_MS, KEY_SHAPED, NOW, OWN, PANE, itemOf, keyed, runTasks, savedItem, seat, start, textOf } from './world'

const QUESTION: Message = { from: 'user', text: 'What does the feed page by?', atMs: NOW - 60_000 }
const RUNNING = { id: 'a1', type: 'open-items:helper', status: 'running' } as AgentInfo

function sideItem(id: number, thread: Message[], side: Partial<Side> = {}, fields: Partial<Task> = {}): Task {
  return savedItem(id, { kind: 'side', title: QUESTION.text, thread, isWaitingForClaude: true, isMarkdown: true, side: { transcripts: ['/t/main.jsonl'], ...side }, ...fields })
}

/** Side question `id`, which helper a1 answered with `text`. */
function answered(id: number, text: string, side: Partial<Side> = {}, fields: Partial<Task> = {}): Task {
  const answer: Message = { from: 'claude', author: 'helper', text, atMs: NOW - 30_000 }

  return sideItem(id, [QUESTION, answer], { helperId: 'a1', sentMs: QUESTION.atMs, endedMs: QUESTION.atMs, ...side }, { isWaitingForClaude: false, ...fields })
}

const fiveHour = (percentUsed: number, resetsInMs?: number): SessionRateLimit => ({
  kind: 'five_hour',
  percentUsed,
  ...(resetsInMs === undefined ? {} : { resetsAt: new Date(NOW + resetsInMs).toISOString() }),
})

function side($: Engine, args: string) {
  return $.command.run({ command: 'side', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
}

async function fieldValueIn(ui: Pick<Mounted<'terminal', 'Pane'>, 'find'>): Promise<unknown> {
  return (await ui.find({ type: 'Input', key: 'side-new' }))?.props.value
}

describe('side questions in the list', () => {
  test('SIDE QUESTIONS is the last section, and a pane with only side questions draws no head', async ($, on) => {
    const decision = savedItem(1, { kind: 'decision', title: 'Ship the feed rewrite this week', options: ['Yes', 'Not yet'] })
    const later = savedItem(2, { state: 'later' })
    const asked = answered(3, 'By a cursor, in pages of twenty.')
    seat(on, { [OWN]: keyed([decision, later, asked]) })
    await start($)
    const ui = await $.ui.mount(PANE)

    const sections = (await ui.findAll({ type: 'Box' })).flatMap(box => (box.key?.startsWith('section-') ? [box.key.slice('section-'.length)] : []))
    expect(sections).toEqual(['DECISIONS', 'LATER', 'SIDE QUESTIONS'])
    expect(await ui.find({ key: 'head' })).toBeDefined()

    for (const id of [1, 2]) {
      await $.tool.call({ tool: CLOSE, id, as: 'withdrawn', note: 'not needed now' })
    }

    expect(await ui.find({ key: 'row-3' })).toBeDefined()
    expect(await ui.find({ key: 'head' })).toBeUndefined()
  })

  const DIM = { dimColor: true }
  const YELLOW = { color: 'yellow' }
  const MARKS: [string, Task, readonly SessionRateLimit[], string, object][] = [
    ['held, with a reset time', sideItem(1, [QUESTION]), [fiveHour(86, HOUR_MS)], '  ⏸ held', DIM],
    ['held, with no reset time', sideItem(1, [QUESTION]), [fiveHour(86)], '  ⏸ held', DIM],
    ['working', sideItem(1, [QUESTION], { helperId: 'a1', sentMs: QUESTION.atMs }), [], '  ⋯ helper working', DIM],
    ['asking the user back', answered(1, 'Which feed?\nQuestion for you: the web feed or the app feed?', {}, { hasNewReply: true }), [], '  ? helper asks you', YELLOW],
    [
      'waiting for the session',
      answered(1, 'Unclear.\nQuestion for the session: Which branch?', { toMain: { kind: 'question', text: 'Which branch?', atMs: NOW - 30_000 } }),
      [],
      '  ⋯ waiting for the session',
      DIM,
    ],
    ['answered, not yet opened', answered(1, 'By a cursor, in pages of twenty.', {}, { hasNewReply: true }), [], '  ● answered', YELLOW],
    [
      'waiting for the session, over an answer not yet opened',
      answered(1, 'Unclear.\nQuestion for the session: Which branch?', { toMain: { kind: 'question', text: 'Which branch?', atMs: NOW - 30_000 } }, { hasNewReply: true }),
      [],
      '  ⋯ waiting for the session',
      DIM,
    ],
  ]

  for (const [state, task, limits, mark, look] of MARKS) {
    test(`each side question row shows one mark: ${state}`, async ($, on) => {
      const { world, clock } = seat(on, { [OWN]: keyed([task]) })
      world.agents = [RUNNING]
      world.rateLimits = [...limits]
      await start($)
      await clock.settle()
      const ui = await $.ui.mount(PANE)

      expect(await textOf(ui, 'row-1')).toBe(`#1 ${QUESTION.text}${mark}`)
      expect((await ui.find({ type: 'Text', text: mark }))?.props).toEqual(look)
    })
  }

  test('a follow-up made while its helper works shows held, not working, under a hold', async ($, on) => {
    const followUp: Message = { from: 'user', text: 'And the app feed?', atMs: NOW - 10_000 }
    const working = sideItem(1, [QUESTION, followUp], { helperId: 'a1', sentMs: QUESTION.atMs })
    // A question for the session that waits: the turn's end reads the window, and the hold starts.
    const asking = answered(2, 'Unclear.\nQuestion for the session: Which branch?', { helperId: 'a2', toMain: { kind: 'question', text: 'Which branch?', atMs: NOW - 30_000 } })
    const { world, clock } = seat(on, { [OWN]: keyed([working, asking]) })
    world.agents = [RUNNING]
    world.rateLimits = [fiveHour(86, HOUR_MS)]
    await start($)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()
    const ui = await $.ui.mount(PANE)

    expect(world.submitted).toEqual([])
    expect(await textOf(ui, 'row-1')).toBe(`#1 ${QUESTION.text}  ⏸ held`)
  })
})

describe('opening the pane and the new-question field', () => {
  test('/open-items opens the pane with the new-question field also when nothing is in it, and it stays open until Hide', async ($, on) => {
    const { world } = seat(on)
    await start($)

    await runTasks($)
    const ui = await $.ui.mount(PANE)

    expect(world.opens.at(-1)?.focus).toBe(true)
    expect(await ui.find({ type: 'Text', text: 'No items for you right now.' })).toBeDefined()
    expect(await ui.find({ type: 'Input', key: 'side-new' })).toBeDefined()

    await $.tool.call({ tool: ADD, title: 'Rotate the deploy key', detail: 'Needed before the release.', kind: 'action' })
    await $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn', note: 'answered in chat' })
    expect(world.isPaneOpen).toBe(true)

    await ui.press({ key: 'hide' })
    expect(world.isPaneOpen).toBe(false)
  })

  test('Enter in the field adds a side question, says so, and asks a helper', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)
    await runTasks($)
    const typing = await $.ui.mount(PANE)
    await typing.input({ key: 'side-new', text: 'what is a cursor?', kind: 'change' })
    await clock.settle()
    // Hidden and opened again, the field draws its draft.
    await typing.press({ key: 'hide' })
    await typing.unmount()
    await runTasks($)
    const ui = await $.ui.mount(PANE)
    expect(await fieldValueIn(ui)).toBe('what is a cursor?')

    await ui.input({ key: 'side-new', text: 'what is a cursor?' })
    await clock.settle()

    expect(world.toasts).toContain('Side question #1 sent')
    expect(world.spawns.map(spawn => spawn.description)).toEqual(['Side question #1'])
    expect(await fieldValueIn(ui)).toBe('')
  })

  test("a draft in the field is there again after a look at an item's screen", async ($, on) => {
    const { clock } = seat(on, { [OWN]: keyed([savedItem(1)]) })
    await start($)
    const ui = await $.ui.mount(PANE)
    await ui.input({ key: 'side-new', text: 'what is a cursor?', kind: 'change' })
    await clock.settle()

    await ui.press({ key: 'row-1' })
    await ui.press({ key: 'back' })

    expect(await fieldValueIn(ui)).toBe('what is a cursor?')
  })

  test("a side question held back is still held after a look at an item's screen", async ($, on) => {
    seat(on, { [OWN]: keyed([savedItem(1)]) })
    await start($)
    const ui = await $.ui.mount(PANE)
    await ui.input({ key: 'side-new', text: KEY_SHAPED })

    await ui.press({ key: 'row-1' })
    await ui.press({ key: 'back' })

    expect(await textOf(ui, 'held')).toContain('This looks like a secret.')
    expect(await ui.find({ type: 'Button', key: 'edit' })).toBeDefined()
  })

  test("Send anyway refused while the session's items load keeps the side question held", async ($, on) => {
    const { world, clock } = seat(on)
    await start($)
    await runTasks($)
    const ui = await $.ui.mount(PANE)
    await ui.input({ key: 'side-new', text: KEY_SHAPED })
    // The process goes on as another session, whose key the store is slow to give.
    world.sessionId = 'session-2'
    world.isStuck = true
    const started = start($)
    await clock.advance(5000)
    await started

    await ui.press({ key: 'send-anyway' })

    expect(world.toasts.at(-1)).toBe("Open items is still loading this session's items. Try again in a moment.")
    expect(world.items).toEqual([])
    expect(await textOf(ui, 'held')).toContain('This looks like a secret.')
  })

  test("the field holds a secret back with Edit and Send anyway, as v0.2's reply field does", async ($, on) => {
    const { world, clock } = seat(on)
    await start($)
    await runTasks($)
    const ui = await $.ui.mount(PANE)

    await ui.input({ key: 'side-new', text: KEY_SHAPED })
    await clock.settle()
    expect(world.items).toEqual([])
    expect(await textOf(ui, 'held')).toContain(
      'This looks like a secret. Claude and the transcript on disk would see it. Put it where it belongs and ask without it instead.',
    )

    await ui.press({ key: 'edit' })
    expect(await fieldValueIn(ui)).toBe(KEY_SHAPED)
    expect(await ui.find({ key: 'held' })).toBeUndefined()

    await ui.input({ key: 'side-new', text: KEY_SHAPED })
    await ui.press({ key: 'send-anyway' })
    await clock.settle()
    expect([itemOf(world, 1)?.kind, itemOf(world, 1)?.thread[0]?.text]).toEqual(['side', KEY_SHAPED])
    expect(world.spawns).toHaveLength(1)
  })

  test("/side with nothing after it opens the pane on the field, also from an item's screen, and it stays open once nothing is in it", async ($, on) => {
    const { world } = seat(on, { [OWN]: keyed([savedItem(1)]) })
    await start($)
    const ui = await $.ui.mount(PANE)
    const onTheField = async () => [world.isPaneOpen, world.opens.at(-1)?.focus, world.screen, (await ui.find({ type: 'Input', key: 'side-new' })) !== undefined]

    // The ring's move onto the field is the live harness's to check: on 2.1.331 the kit answers no `$.ui.focus` the mod makes.
    await side($, '')
    expect(await onTheField()).toEqual([true, true, { kind: 'list' }, true])

    await ui.press({ key: 'row-1' })
    expect(world.screen).toEqual({ kind: 'item', id: 1 })
    await side($, '')
    expect(await onTheField()).toEqual([true, true, { kind: 'list' }, true])

    await $.tool.call({ tool: CLOSE, id: 1, as: 'withdrawn', note: 'not needed now' })
    expect(world.isPaneOpen).toBe(true)
  })

  test('/open-items and /side run at once, also while Claude works', async ($, on) => {
    const { world } = seat(on)
    await start($)

    // Retention: the engine's mid-turn run is a platform contract the kit cannot exercise (probe 0.4 proved the engine side).
    expect(world.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'open-items', immediate: true }),
        expect.objectContaining({ name: 'side', immediate: true, argumentHint: '[#N] <question>' }),
      ]),
    )
  })
})
