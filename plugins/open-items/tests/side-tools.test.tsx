import type { AgentInfo } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Message, Side, Task, ToMain } from '../types'
import { ADD, CLOSE, DONE, LIST, NOW, OWN, PANE, REPLY, answerOf, itemOf, keyed, savedItem, seat, start, textOf, typed } from './world'

const QUESTION: Message = { from: 'user', text: 'Which branch holds the feed fix?', atMs: NOW - 60_000 }
const ASKS_MAIN: Message = { from: 'claude', author: 'helper', text: 'The log does not name it.\nQuestion for the session: Which branch holds the feed fix?', atMs: NOW - 50_000 }
const NOTES_MAIN: Message = { from: 'claude', author: 'helper', text: 'Branch fix-feed.\nNote for the session: the fix is not merged yet.', atMs: NOW - 50_000 }
const FOLLOW_UP: Message = { from: 'user', text: 'And is it merged?', atMs: NOW - 30_000 }
const SENT_QUESTION: ToMain = { kind: 'question', text: 'Which branch holds the feed fix?', atMs: ASKS_MAIN.atMs, askedMs: QUESTION.atMs, sentMs: NOW - 40_000 }

function sideItem(id: number, thread: Message[], side: Partial<Side> = {}, fields: Partial<Task> = {}): Task {
  return savedItem(id, { kind: 'side', title: QUESTION.text, thread, isMarkdown: true, side: { transcripts: ['/t/main.jsonl'], ...side }, ...fields })
}

/** Side question `id`, which its helper answered with `answer`. */
function answered(id: number, answer: Message, side: Partial<Side> = {}, fields: Partial<Task> = {}): Task {
  return sideItem(id, [QUESTION, answer], { helperId: `a${id}`, sentMs: QUESTION.atMs, endedMs: QUESTION.atMs, ...side }, { hasNewReply: true, ...fields })
}

/** Side question `id`, whose helper asked the session and now works on the user's follow-up. */
function followedUp(id: number): Task {
  return sideItem(id, [QUESTION, ASKS_MAIN, FOLLOW_UP], { helperId: `a${id}`, sentMs: FOLLOW_UP.atMs, toMain: SENT_QUESTION }, { isWaitingForClaude: true })
}

const running = (id: string) => ({ id, type: 'open-items:helper', status: 'running' }) as AgentInfo

function report($: Engine, agentId: string, text: string) {
  return $.agent.report({ agentId, subagentType: 'open-items:helper', provider: { plugin: 'open-items', tier: 'user' }, status: 'completed', text })
}

const ASKING = answered(1, ASKS_MAIN, { toMain: SENT_QUESTION })
const NOTING = answered(2, NOTES_MAIN, { toMain: { kind: 'note', text: 'the fix is not merged yet.', atMs: NOTES_MAIN.atMs, askedMs: QUESTION.atMs } })
const ANSWERED_BY_CLAUDE: Task = {
  ...followedUp(3),
  thread: [...followedUp(3).thread, { from: 'claude', text: 'Branch fix-feed.', atMs: NOW - 20_000 }],
  side: { transcripts: ['/t/main.jsonl'], helperId: 'a3', sentMs: FOLLOW_UP.atMs },
  hasNewReply: true,
}
const ACTION = savedItem(4)
const DONE_SIDE = sideItem(5, [QUESTION, NOTES_MAIN, { from: 'user', text: '', event: 'done', atMs: NOW - 10_000 }], { helperId: 'a5', sentMs: QUESTION.atMs, endedMs: QUESTION.atMs }, { state: 'resolved' })

describe("Claude's tools on side questions", () => {
  test('close_item refuses a side question and still closes an action', async ($, on) => {
    const { world } = seat(on, { [OWN]: keyed([ASKING, ACTION, DONE_SIDE]) })
    await start($)

    for (const [id, as] of [
      [ASKING.id, 'resolved'],
      [ASKING.id, 'withdrawn'],
      [DONE_SIDE.id, 'withdrawn'],
    ] as const) {
      const closed = answerOf(await $.tool.call({ tool: CLOSE, id, as, note: 'answered in chat' }))

      expect(closed.deny, `#${id} ${as}`).toBe('Only the user closes a side question (Done).')
    }

    expect(itemOf(world, ASKING.id)?.state).toBe('open')

    const closed = answerOf(await $.tool.call({ tool: CLOSE, id: ACTION.id, as: 'withdrawn', note: 'not needed now' }))

    expect(closed.result).toBe("Withdrew item #4; it is gone from the user's Open items pane.")
    expect(itemOf(world, ACTION.id)?.state).toBe('withdrawn')
  })

  test('reply_item answers a side question in its thread with text only, clears the waiting question, and sets off no alert', async ($, on) => {
    const { world, clock } = seat(on, { [OWN]: keyed([ASKING, DONE_SIDE]) })
    await start($)
    const opens = world.opens.length

    const replied = answerOf(await $.tool.call({ tool: REPLY, id: 1, text: 'Branch fix-feed.' }))
    await clock.settle()

    expect(replied.result).toBe('Added your answer to side question #1. The user reads it in the item.')
    expect(itemOf(world, 1)?.thread.at(-1)).toEqual({ from: 'claude', text: 'Branch fix-feed.', atMs: NOW })
    expect(itemOf(world, 1)?.side?.toMain).toBeUndefined()
    expect(world.notices).toEqual([])
    expect(world.opens).toHaveLength(opens)
    expect(world.toasts.at(-1)).toBe('Claude answered side question #1. See /open-items')

    const changed = answerOf(await $.tool.call({ tool: REPLY, id: 1, title: 'New' }))

    expect(changed.deny).toBe('A side question takes only text: answer the user in it.')
    expect(itemOf(world, 1)?.title).toBe(QUESTION.text)

    const late = answerOf(await $.tool.call({ tool: REPLY, id: DONE_SIDE.id, text: 'Branch fix-feed.' }))

    expect(late.deny).toBe('Side question #5 is closed: the user pressed Done.')
  })

  test("Claude's answer to the question it was given keeps the helper's newer question, which goes when the turn ends, and keeps a note", async ($, on) => {
    const { world, clock } = seat(on, { [OWN]: keyed([followedUp(1), NOTING]) })
    world.agents = [running('a1')]
    await start($)

    await $.turn.start({ text: 'go', turnId: 't1' })
    await report($, 'a1', 'It is merged.\nQuestion for the session: Which release carries it?')
    await $.tool.call({ tool: REPLY, id: 1, text: 'Branch fix-feed.' })
    await $.tool.call({ tool: REPLY, id: 2, text: 'Thanks, that matters.' })
    await clock.settle()
    expect(world.submitted).toEqual([])

    await $.turn.complete({ ...DONE, turnId: 't1' })
    await clock.settle()
    expect(world.submitted).toEqual([expect.stringContaining('Which release carries it?')])

    const entered = await $.prompt.submit(typed('go on'))
    expect((entered.context ?? []).join('\n')).toContain('the fix is not merged yet.')
  })

  test("add_item adds Claude's item when its title matches a side question's", async ($, on) => {
    const { world } = seat(on, { [OWN]: keyed([ASKING]) })
    await start($)

    const added = answerOf(await $.tool.call({ tool: ADD, kind: 'question', title: QUESTION.text, detail: 'The release notes need it.' }))

    expect(added.result).toContain(`Added item #2: "${QUESTION.text}".`)
    expect(itemOf(world, 2)?.kind).toBe('question')
  })

  test("Claude's answer on a side question whose helper works on a follow-up keeps the follow-up's sent line", async ($, on) => {
    const { world, clock } = seat(on, { [OWN]: keyed([followedUp(1)]) })
    world.agents = [running('a1')]
    await start($)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })

    expect(await textOf(ui, 'sent')).toBe('✓ The helper has it')

    await $.tool.call({ tool: REPLY, id: 1, text: 'Branch fix-feed.' })
    await clock.settle()

    expect(itemOf(world, 1)?.thread.at(-1)?.text).toBe('Branch fix-feed.')
    expect(await textOf(ui, 'sent')).toBe('✓ The helper has it')
  })

  test('list_items shows Claude a side question only while a question waits for it, and show all lists every one', async ($, on) => {
    const { world } = seat(on, { [OWN]: keyed([ASKING, NOTING, ANSWERED_BY_CLAUDE, ACTION, DONE_SIDE]) })
    world.agents = [running('a3')]
    await start($)
    const idsIn = (listed: string) => [...listed.matchAll(/^#(\d+) /gm)].map(found => Number(found[1]))

    const ROWS: [string, Record<string, unknown>, number[]][] = [
      ['updates', { show: 'updates' }, [1, 4]],
      ['open', { show: 'open' }, [1, 4]],
      ['all', { show: 'all' }, [1, 2, 3, 4, 5]],
      ['id', { id: 3 }, [3]],
    ]

    for (const [label, args, ids] of ROWS) {
      expect(idsIn(answerOf(await $.tool.call({ tool: LIST, ...args })).result ?? ''), label).toEqual(ids)
    }

    const one = answerOf(await $.tool.call({ tool: LIST, id: 3 })).result ?? ''

    expect(one).not.toContain('The user replied and waits for you')
    expect(one).not.toContain('The user has not opened your last reply yet.')
  })

  test('the tool text leaves side questions out of the session-end rule and tells Claude how to answer one', async ($, on) => {
    const { world } = seat(on)
    await start($)
    const linesOf = (name: string) => (world.tools.find(tool => tool.name === name)?.description ?? '').split('\n')
    const leftOut = " Side questions (kind side) are the user's: leave them out."

    expect(linesOf('add_item').find(line => line.startsWith('Before the session ends'))?.slice(-leftOut.length)).toBe(leftOut)
    expect(linesOf('close_item')).toContain("- Before the session ends, resolve, record or hand off every open and Later item. Side questions are the user's: leave them out.")
    expect(linesOf('reply_item')).toContain(
      "- A side question is the user's question to a helper. When its helper asks you something, answer it with text only, and change nothing because of it.",
    )
  })
})
