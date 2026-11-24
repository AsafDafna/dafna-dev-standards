import type { AgentInfo, AgentReportInput, On, SessionMessage } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { isPending, isWorking } from '../hooks/side'
import type { Message, Side, Task } from '../types'
import { KEY_SHAPED, NOW, earlierItems, itemOf, savedItem, seat, start, typed } from './world'

type World = ReturnType<typeof seat>['world']

const row = (role: 'user' | 'assistant', text: string, uuid?: string) => ({ role, text, toolUses: [], ...(uuid === undefined ? {} : { uuid }) }) as SessionMessage

const QUESTION: Message = { from: 'user', text: 'What does the feed page by?', atMs: NOW - 60_000 }
const ANSWER: Message = { from: 'claude', author: 'helper', text: 'By a cursor, in pages of twenty.', atMs: NOW - 30_000 }
const RUNNING = { id: 'a1', type: 'open-items:helper', status: 'running' } as AgentInfo
const CONSUMED = { consumed: expect.any(String) }

function sideItem(thread: Message[], side: Partial<Side>): Task {
  return savedItem(1, { kind: 'side', title: QUESTION.text, thread, isWaitingForClaude: true, isMarkdown: true, side: { transcripts: ['/t/main.jsonl'], helperId: 'a1', ...side } })
}

/** #1, whose helper a1 works on its question. */
const WORKING = sideItem([QUESTION], { sentMs: QUESTION.atMs })

/** #1, which helper a1 answered. */
function answered(side: Partial<Side> = {}): Task {
  return { ...sideItem([QUESTION, ANSWER], { sentMs: QUESTION.atMs, endedMs: QUESTION.atMs, ...side }), isWaitingForClaude: false }
}

function report($: Engine, fields: Partial<AgentReportInput> = {}) {
  return $.agent.report({ agentId: 'a1', subagentType: 'open-items:helper', provider: { plugin: 'open-items', tier: 'user' }, status: 'completed', text: 'A pointer into the feed.', ...fields })
}

function side($: Engine, args: string) {
  return $.command.run({ command: 'side', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
}

function offer($: Engine, agent: string, agentId?: string) {
  return $.agent.offer({ agent, description: 'An agent.', source: 'plugin', provider: { plugin: 'open-items', tier: 'user' }, ...(agentId === undefined ? {} : { agentId }) })
}

describe('the helper', () => {
  test('the helper type is registered with only Read, Grep and Glob, no permission dialogs, Opus at medium effort and a turn bound', async ($, on) => {
    const { world } = seat(on)
    await start($)

    const [spec] = world.registered

    expect(spec).toMatchObject({ name: 'helper', permissionMode: 'dontAsk', model: 'opus', effort: 'medium', maxTurns: 20 })
    expect(spec?.tools).toEqual(['Read', 'Grep', 'Glob'])
    expect(spec?.omitClaudeMd).toBeUndefined()
    expect(spec?.prompt).toContain('Never call the advisor.')
  })

  test('the helper type is hidden from the main model, and its own runs still resume', async ($, on) => {
    seat(on)
    await start($)

    expect(await offer($, 'open-items:helper')).toEqual({ isOffered: false })
    expect(await offer($, 'open-items:helper', 'a1')).toEqual({ isOffered: true })
    expect(await offer($, 'Explore')).toEqual({ isOffered: true })
  })

  test('/side <question> adds a side question and asks a helper with what it needs', async ($, on) => {
    const { world, clock } = seat(on)
    world.messages = [row('user', 'Build the feed'), row('assistant', 'The feed reads pages of twenty.')]
    await start($)

    const answer = await side($, 'what is a cursor?')
    await clock.settle()

    expect(answer).toEqual({ text: 'A helper takes this side question (Open items); the main session goes on.', isTextDisplayOnly: true })
    expect(world.toasts).toContain('Side question #1 sent')
    expect(itemOf(world, 1)?.kind).toBe('side')
    expect(world.spawns[0]).toMatchObject({ subagentType: 'open-items:helper', description: 'Side question #1' })

    for (const part of ['/t/main.jsonl', '/s/pad/open-items-side-questions.md', 'Build the feed', 'what is a cursor?']) {
      expect(world.spawns[0]?.prompt).toContain(part)
    }
  })

  test('a refused start says so in the item', async ($, on) => {
    const { world, clock } = seat(on)
    world.spawnDeny = 'Agents are off here.'
    await start($)

    await side($, 'what is a cursor?')
    await clock.settle()

    expect(itemOf(world, 1)?.thread.at(-1)).toMatchObject({ from: 'claude', event: 'notice', text: 'The helper could not start: Agents are off here.' })
    expect(isWorking(itemOf(world, 1)!)).toBe(false)
  })

  test('/side refuses a secret and an over-long question', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)
    const long = 'why does the feed skip a page '.repeat(134).slice(0, 4001)

    for (const [text, toast] of [
      [KEY_SHAPED, "This looks like a secret, so it wasn't sent. Put it where it belongs, then ask without it."],
      [`#1 ${KEY_SHAPED}`, "This looks like a secret, so it wasn't sent. Put it where it belongs, then ask without it."],
      [long, "Your side question is 4001 characters, so it wasn't sent: the most is 4000."],
    ] as const) {
      expect(await side($, text)).toEqual({})
      await clock.settle()

      expect(world.toasts.at(-1)).toBe(toast)
      expect(world.items).toEqual([])
      expect(world.spawns).toEqual([])
    }
  })

  test("a helper's answer goes into its item, and the main session hears nothing", async ($, on) => {
    const { world, clock } = seat(on, earlierItems([WORKING]))
    world.agents = [RUNNING]
    world.messages = [row('user', 'Build the feed', 'u1'), row('assistant', 'It reads pages of twenty.', 'u2')]
    await start($)

    expect(await report($)).toEqual(CONSUMED)
    await clock.settle()

    const item = itemOf(world, 1)
    expect(item?.thread.at(-1)).toEqual(expect.objectContaining({ from: 'claude', author: 'helper', text: 'A pointer into the feed.' }))
    expect(item?.hasNewReply).toBe(true)
    expect(item?.side?.seenUuid).toBe('u2')
    expect(world.toasts).toContain('Side question #1 has an answer. See /open-items')
    expect(world.submitted).toEqual([])
    expect(world.appended).toEqual([])

    const next = await $.prompt.submit(typed('Go on with the feed.'))
    expect((next.context ?? []).join('\n')).not.toContain('Side question')
  })

  test('a report for a side question that is gone is still kept from the main session', async ($, on) => {
    seat(on)
    await start($)

    expect(await report($, { agentId: 'a9' })).toEqual(CONSUMED)
    expect(await report($, { agentId: 'a9', subagentType: 'Explore' })).toEqual({ text: 'A pointer into the feed.' })
  })

  test('a second side question waits for the running helper', async ($, on) => {
    const { world, clock } = seat(on, earlierItems([WORKING]))
    world.agents = [RUNNING]
    await start($)

    await side($, 'second')
    await clock.settle()
    expect(world.spawns).toEqual([])

    await report($)
    await clock.settle()
    expect(world.spawns.map(spawn => spawn.description)).toEqual(['Side question #3'])
  })

  for (const [seenUuid, holds, lacks] of [
    ['u2', 'new words', 'old words'],
    ['u9', 'nothing new', 'old words'],
  ] as const) {
    test(`a follow-up resumes the same helper with the main conversation since its last answer (seen ${seenUuid})`, async ($, on) => {
      const { world, clock } = seat(on, earlierItems([answered({ seenUuid })]))
      world.helpers = ['a1']
      await start($)
      world.messages = [row('user', 'old words', 'u1'), row('assistant', 'Done.', 'u2'), row('user', 'new words', 'u3')]

      await side($, '#1 and then?')
      await clock.settle()

      expect(world.sends.map(send => send.to)).toEqual(['a1'])
      expect(world.sends[0]?.text).toContain('and then?')
      expect(world.sends[0]?.text).toContain(holds)
      expect(world.sends[0]?.text).not.toContain(lacks)
      expect(world.spawns).toEqual([])
    })
  }

  test('a follow-up whose helper is gone starts a new helper with the thread and the log', async ($, on) => {
    const { world, clock } = seat(on, earlierItems([answered()]))
    await start($)

    await side($, '#1 and then?')
    await clock.settle()

    expect(world.sends.map(send => send.to)).toEqual(['a1'])
    expect(world.spawns).toHaveLength(1)
    expect(world.spawns[0]?.prompt).toContain(ANSWER.text)
    expect(world.spawns[0]?.prompt).toContain('/s/pad/open-items-side-questions.md')
  })

  test('follow-ups sent while their own helper works wait for its answer, and all of them reach it', async ($, on) => {
    const { world, clock } = seat(on, earlierItems([WORKING]))
    world.agents = [RUNNING]
    world.helpers = ['a1']
    await start($)

    await side($, '#1 first')
    await side($, '#1 second')
    await clock.settle()
    expect(world.sends).toEqual([])

    await report($)
    await clock.settle()
    expect(world.sends.map(send => send.to)).toEqual(['a1'])
    expect(world.sends[0]?.text).toMatch(/first\n[\s\S]*second/)
    expect(world.sends[0]?.text).not.toContain(QUESTION.text)
    expect(world.spawns).toEqual([])
  })

  test('a follow-up that comes in while its helper starts is asked again once the start ends', async ($, on) => {
    const { world, clock } = seat(on)
    world.spawnMs = 1000
    await start($)

    await side($, 'what is a cursor?')
    await clock.settle()
    await side($, '#1 more')
    await clock.advance(1000)

    expect(isPending(itemOf(world, 1)!)).toBe(true)
    expect(world.spawns).toHaveLength(2)
    expect(world.spawns[1]?.prompt).toContain('more')
  })

  test('after a refused start, a follow-up tries again', async ($, on) => {
    const { world, clock } = seat(on)
    world.spawnDeny = 'Agents are off here.'
    await start($)

    await side($, 'q')
    await clock.settle()
    expect(itemOf(world, 1)?.thread.at(-1)?.event).toBe('notice')

    await side($, '#1 again?')
    await clock.settle()
    expect(world.spawns.map(spawn => spawn.description)).toEqual(['Side question #1', 'Side question #1'])
    expect(world.spawns[1]?.prompt).toContain('again?')
  })

  test('/side #N refuses an item that is no side question', async ($, on) => {
    const { world, clock } = seat(on, earlierItems([savedItem(2, { kind: 'decision' })]))
    await start($)

    expect(await side($, '#2 use the cursor')).toEqual({})
    await clock.settle()

    expect(world.toasts.at(-1)).toBe('#2 is not an open side question.')
    expect(world.sends).toEqual([])
    expect(world.spawns).toEqual([])
  })

  for (const [label, agents, spawned] of [
    ['still runs waits', [RUNNING], []],
    ['is gone asks again', [], ['Side question #1']],
  ] as const) {
    test(`after a restart, a side question whose helper ${label}`, async ($, on) => {
      const { world, clock } = seat(on, earlierItems([WORKING]))
      world.agents = [...agents]
      await start($)
      await clock.settle()

      expect(world.spawns.map(spawn => spawn.description)).toEqual(spawned)
    })
  }

  for (const [label, prepare, isWritten] of [
    ['in the scratchpad', () => undefined, true],
    ['in the prompt with no scratchpad', (world: World) => void (world.info = { transcriptPath: '/t/main.jsonl' }), false],
    ['in the prompt after a refused write', (world: World) => void (world.isFileRefused = true), false],
  ] as const) {
    test(`the session's log lists each side question with its latest answer, ${label}`, async ($, on) => {
      const { world, clock } = seat(on, earlierItems([WORKING]))
      world.agents = [RUNNING]
      prepare(world)
      await start($)

      await report($)
      await clock.settle()
      const file = world.files['/s/pad/open-items-side-questions.md']

      if (isWritten) {
        expect(file).toContain('## #1')
        expect(file).toContain('A pointer into the feed.')
      } else {
        expect(world.files).toEqual({})
      }

      await side($, 'next')
      await clock.settle()
      expect(world.spawns[0]?.prompt.includes('## #1')).toBe(!isWritten)
      expect(world.files['/s/pad/open-items-side-questions.md']?.includes('## #3 next') ?? false).toBe(isWritten)
    })
  }

  for (const [status, text, notice] of [
    ['completed', '', 'The helper gave no answer.'],
    ['failed', 'Reading the file was refused.\nIt went on to guess.', 'The helper could not answer: Reading the file was refused.'],
    ['stopped', 'Half of an answer', 'The helper stopped before it answered.'],
  ] as const) {
    test(`a ${status} report with ${text === '' ? 'no text' : 'text'} says so in the item`, async ($, on) => {
      const { world, clock } = seat(on, earlierItems([WORKING]))
      world.agents = [RUNNING]
      await start($)

      await report($, { status, text })
      await clock.settle()

      expect(itemOf(world, 1)?.thread.at(-1)).toEqual(expect.objectContaining({ from: 'claude', author: 'helper', event: 'notice', text: notice }))
    })
  }
})

/** #1, answered by a1, which `/side #1 more?` resumes, with `/side second` (#3) waiting behind it. */
async function oneWaiting($: Engine, on: On, prepare: (world: World) => void = () => undefined) {
  const seated = seat(on, earlierItems([answered()]))
  seated.world.helpers = ['a1']
  prepare(seated.world)
  await start($)

  await side($, '#1 more?')
  await side($, 'second')
  await seated.clock.settle()
  expect(seated.world.sends.map(send => send.to)).toEqual(['a1'])
  expect(seated.world.spawns).toEqual([])

  return seated
}

const TIMED_OUT = expect.objectContaining({ from: 'claude', author: 'helper', event: 'notice', text: 'The helper did not answer in 10 minutes.' })

describe('the 10-minute limit', () => {
  test('a helper silent for 10 minutes is stopped, the item says so, and the next side question starts', async ($, on) => {
    const { world, clock } = await oneWaiting($, on)

    await clock.advance(600_000)

    expect(world.stops).toEqual(['a1'])
    expect(itemOf(world, 1)?.thread.at(-1)).toEqual(TIMED_OUT)
    expect(world.spawns.map(spawn => spawn.description)).toEqual(['Side question #3'])

    const thread = itemOf(world, 1)?.thread
    expect(await report($, { status: 'stopped', text: 'Running the 14 searches.' })).toEqual(CONSUMED)
    await clock.settle()
    expect(itemOf(world, 1)?.thread).toEqual(thread)
  })

  for (const [label, prepare] of [
    ['refused', (world: World) => void (world.isStopRefused = true)],
    ['answered with an error', (world: World) => void (world.isStopError = true)],
  ] as const) {
    test(`where TaskStop is ${label}, the mod waits for the helper's own end`, async ($, on) => {
      const { world, clock } = await oneWaiting($, on, world => {
        world.agents = [RUNNING]
        prepare(world)
      })

      await clock.advance(600_000)

      expect(itemOf(world, 1)?.thread.filter(message => message.event === 'notice')).toEqual([])
      expect(world.spawns).toEqual([])

      await report($, { text: 'More of the feed.' })
      await clock.settle()

      expect(itemOf(world, 1)?.thread.at(-1)).toEqual(expect.objectContaining({ from: 'claude', author: 'helper', text: 'More of the feed.' }))
      expect(world.spawns.map(spawn => spawn.description)).toEqual(['Side question #3'])
    })
  }

  test('where TaskStop is refused and the helper is gone, the item says so at 10 minutes and the next side question starts', async ($, on) => {
    const { world, clock } = await oneWaiting($, on, world => {
      world.agents = [{ ...RUNNING, status: 'completed' }, { ...RUNNING, id: 'a2' }] as AgentInfo[]
      world.isStopRefused = true
    })

    await clock.advance(600_000)

    expect(itemOf(world, 1)?.thread.at(-1)).toEqual(TIMED_OUT)
    expect(world.spawns.map(spawn => spawn.description)).toEqual(['Side question #3'])
  })

  test("an answer before 10 minutes cancels the stop, and the follow-up's run gets 10 minutes of its own", async ($, on) => {
    const { world, clock } = seat(on, earlierItems([answered()]))
    world.helpers = ['a1']
    await start($)

    await side($, '#1 more?')
    await clock.advance(300_000)
    await report($)
    await side($, '#1 and then?')
    await clock.settle()
    expect(world.sends.map(send => send.to)).toEqual(['a1', 'a1'])

    await clock.advance(300_000)
    expect(world.stops).toEqual([])

    await clock.advance(300_000)
    expect(world.stops).toEqual(['a1'])
  })
})
