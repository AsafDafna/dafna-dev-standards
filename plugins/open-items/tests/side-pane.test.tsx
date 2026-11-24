import type { AgentInfo, SessionRateLimit } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Mounted } from 'claude-code/testing'

import type { Message, Side, Task } from '../types'
import { ADD, CLOSE, DONE, HOUR_MS, KEY_SHAPED, NOW, OWN, PANE, answerOf, itemOf, keyed, report, runTasks, savedItem, seat, side, start, textOf, typed } from './world'

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

describe('the side question screen', () => {
  const FOLLOW_UP = 'And the app feed?'
  const SECOND: Message = { from: 'user', text: 'What sorts the feed?', atMs: NOW - 20_000 }
  /** #1, whose helper a1 works on its question. */
  const WORKING = sideItem(1, [QUESTION], { helperId: 'a1', sentMs: QUESTION.atMs })

  test("a side question's screen shows its kind, the question as plain text, the helper's head, Done and the follow-up field, and no Later", async ($, on) => {
    seat(on, { [OWN]: keyed([answered(1, 'By a cursor, in pages of twenty.')]) })
    await start($)
    const ui = await $.ui.mount(PANE)

    await ui.press({ key: 'row-1' })

    expect(await textOf(ui, 'header')).toContain('SIDE QUESTION')
    expect(await textOf(ui, 'header')).toContain('#1')
    expect((await ui.find({ key: 'msg-0' }))?.children[0]).toMatchObject({ type: 'Text', children: [QUESTION.text] })
    expect((await ui.find({ key: 'head-1' }))?.children[0]).toMatchObject({ children: [{ type: 'Text', props: { bold: true, color: 'planMode' }, children: ['Helper'] }, expect.anything()] })
    expect((await ui.findAll({ type: 'Button' })).map(button => button.key)).toEqual(['done', 'back', 'hide'])
    expect((await ui.find({ type: 'Input' }))?.props.label).toBe('Follow up')
    expect(await ui.find({ key: 'sent' })).toBeUndefined()
  })

  test('a follow-up from the item reaches its helper and Done closes it, and neither reaches the main session by any path', async ($, on) => {
    const { world, clock } = seat(on, { [OWN]: keyed([answered(1, 'By a cursor, in pages of twenty.')]) })
    world.helpers = ['a1']
    await start($)
    // A running turn would take a batch's row; an idle one, its prompt.
    await $.turn.start({ text: 'go', turnId: 't1' })
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })

    await ui.input({ key: 'reply-1', text: FOLLOW_UP })
    await clock.advance(1000)
    expect(world.sends).toEqual([{ to: 'a1', text: expect.stringContaining(FOLLOW_UP) }])
    expect(itemOf(world, 1)?.update).toBe('none')

    await ui.press({ key: 'done' })
    await clock.advance(1000)
    expect(itemOf(world, 1)?.state).toBe('resolved')
    expect(itemOf(world, 1)?.update).toBe('none')

    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()
    const entered = await $.prompt.submit(typed('go on'))

    expect(world.submitted).toEqual([])
    expect(world.appended).toEqual([])
    expect((entered.context ?? []).filter(block => block.includes('#1'))).toEqual([])
    expect(itemOf(world, 1)?.update).toBe('none')
  })

  test('Done on a side question whose helper works stops it, and the next one starts', async ($, on) => {
    const { world, clock } = seat(on, { [OWN]: keyed([WORKING, sideItem(2, [SECOND], {}, { title: SECOND.text })]) })
    world.agents = [RUNNING]
    await start($)
    await clock.settle()
    expect(world.spawns).toEqual([])
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })

    await ui.press({ key: 'done' })
    await clock.settle()

    expect(world.stops).toEqual(['a1'])
    expect(world.spawns.map(spawn => spawn.description)).toEqual(['Side question #2'])
  })

  test('Done while a follow-up is on its way to the helper stops that helper', async ($, on) => {
    const { world, clock } = seat(on, { [OWN]: keyed([answered(1, 'By a cursor.')]) })
    world.helpers = ['a1']
    world.sendMs = 1000
    await start($)
    await side($, '#1 more?')
    await clock.settle()
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })

    const pressing = ui.press({ key: 'done' })
    await clock.advance(1000)
    await pressing

    expect(world.stops).toEqual(['a1'])
    expect(itemOf(world, 1)?.state).toBe('resolved')
  })

  test('the stopped report after Done does not cancel the 10-minute stop of a later run of the same helper', async ($, on) => {
    const { world, clock } = seat(on, { [OWN]: keyed([answered(1, 'By a cursor.'), answered(2, 'By date.')]) })
    world.helpers = ['a1']
    await start($)
    // #1's run arms its timer; #2 waits behind it.
    await side($, '#1 more?')
    await side($, '#2 more?')
    await clock.settle()
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })

    await ui.press({ key: 'done' })
    await clock.settle()
    expect(world.sends.map(send => send.to)).toEqual(['a1', 'a1'])
    await report($, { status: 'stopped', text: 'Running the 14 searches.' })
    await clock.advance(600_000)

    expect(world.stops).toEqual(['a1', 'a1'])
    expect(itemOf(world, 2)?.thread.at(-1)).toMatchObject({ event: 'notice', text: 'The helper did not answer in 10 minutes.' })
  })

  test('the sent line on a side question names the helper', async ($, on) => {
    const { world, clock } = seat(on, { [OWN]: keyed([WORKING, answered(2, 'By a cursor, in pages of twenty.', { helperId: 'a2' })]) })
    world.agents = [RUNNING]
    world.helpers = ['a2']
    await start($)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-2' })

    await ui.input({ key: 'reply-2', text: FOLLOW_UP })
    await clock.settle()
    expect(await textOf(ui, 'sent')).toBe('Waiting to send')

    await report($)
    await clock.settle()
    expect(world.sends.map(send => send.to)).toEqual(['a2'])
    expect(await textOf(ui, 'sent')).toBe('✓ The helper has it')
    expect(await textOf(ui, 'header')).not.toContain('waiting for Claude')
  })

  for (const [label, limit, line] of [
    ['with a reset time', fiveHour(86.5, HOUR_MS), /^Waiting to send · usage at 86%, resumes at \d\d:\d\d$/],
    ['with no reset time', fiveHour(86.5), /^Waiting to send · usage at 86%$/],
  ] as const) {
    test(`the sent line on a side question held by the quota gives the usage, ${label}`, async ($, on) => {
      const { world, clock } = seat(on, { [OWN]: keyed([sideItem(1, [QUESTION])]) })
      world.rateLimits = [limit]
      await start($)
      await clock.settle()
      const ui = await $.ui.mount(PANE)

      await ui.press({ key: 'row-1' })

      expect(await textOf(ui, 'sent')).toMatch(line)
    })
  }

  for (const [label, seeded, act] of [
    ['a new side question', [], async (ui: Mounted<'terminal', 'Pane'>) => ui.input({ key: 'side-new', text: 'what is a cursor?' })],
    [
      'a new side question held back, then Send anyway',
      [],
      async (ui: Mounted<'terminal', 'Pane'>) => {
        await ui.input({ key: 'side-new', text: KEY_SHAPED })
        await ui.press({ key: 'send-anyway' })
      },
    ],
    [
      'a look, a follow-up and Done on a side question',
      [answered(1, 'By a cursor, in pages of twenty.')],
      async (ui: Mounted<'terminal', 'Pane'>) => {
        await ui.press({ key: 'row-1' })
        await ui.input({ key: 'reply-1', text: FOLLOW_UP })
        await ui.press({ key: 'done' })
      },
    ],
  ] as const) {
    test(`a side question from the pane does not count as a press for the live-chat gate: ${label}`, async ($, on) => {
      const { world, clock } = seat(on, { [OWN]: keyed([...seeded]) })
      world.helpers = ['a1']
      await start($)
      await runTasks($)
      const ui = await $.ui.mount(PANE)
      await $.prompt.submit(typed("Let's brainstorm a name for the CLI"))
      await $.prompt.submit(typed('I like the short ones'))

      await act(ui)
      await clock.settle()

      expect(answerOf(await $.tool.call({ tool: ADD, title: 'Rotate the deploy key', detail: 'Needed before the release.', kind: 'action' })).deny).toBe('live chat: ask in the chat')
    })
  }
})
