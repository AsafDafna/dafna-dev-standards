import type { SessionMessage } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { answeredOf, clockOf, fiveHourOf, isPending, isWorking, newSideOf, noteForMain, noticedOf, refusedOf, questionForMain, reportOf, ridingOf, summaryOf } from '../hooks/side'
import { tookBy } from '../hooks/tasks'
import type { Message, Task } from '../types'

const ASKED: Message = { from: 'user', text: 'Why did the build fail?', atMs: 1000 }
const ANSWER: Message = { from: 'claude', author: 'helper', text: 'A missing env var.', atMs: 2000 }

function side(thread: Message[], fields: Partial<Task> = {}): Task {
  return { ...newSideOf(4, 'x', 1000, '/t/main.jsonl'), thread, ...fields }
}

const sent = (sentMs: number, fields: Partial<Task> = {}, endedMs?: number) => ({ side: { transcripts: [], sentMs, ...(endedMs !== undefined && { endedMs }) }, ...fields })

const row = (role: 'user' | 'assistant', text: string) => ({ role, text, toolUses: [] }) as SessionMessage

describe('side questions', () => {
  test('a long question gives an 80-character title, and a missing transcript gives none', () => {
    const task = newSideOf(3, 'q'.repeat(90), 5, '/t/main.jsonl')

    expect(task.title).toHaveLength(80)
    expect(task.title.endsWith('…')).toBe(true)
    expect(task).toMatchObject({ kind: 'side', thread: [{ from: 'user' }], side: { transcripts: ['/t/main.jsonl'] } })
    expect(newSideOf(3, 'q', 5, '').side?.transcripts).toEqual([])
  })

  const REPORTS: [string, object][] = [
    ['A.\nQuestion for you: which one?', { asksUser: true }],
    ['A.\nnote for the session: The test is flaky.', { asksUser: false, toMain: { kind: 'note', text: 'The test is flaky.' } }],
    ['Note for the session: a\nQuestion for the session: b?', { asksUser: false, toMain: { kind: 'question', text: 'b?' } }],
    ['See the Note for the session: x', { asksUser: false }],
    ['A.\n**Note for the session:** CI lacks it.', { asksUser: false, toMain: { kind: 'note', text: 'CI lacks it.' } }],
    ['A.\n**Question for the session**: which?', { asksUser: false, toMain: { kind: 'question', text: 'which?' } }],
    ['A.\n- Note for the session: CI lacks it.', { asksUser: false, toMain: { kind: 'note', text: 'CI lacks it.' } }],
    ['A.\n> Note for the session: CI lacks it.', { asksUser: false, toMain: { kind: 'note', text: 'CI lacks it.' } }],
    ['A.\n**Question for you:** which one?', { asksUser: true }],
    ['A.\nNote for the session:\n\nCI lacks it.', { asksUser: false, toMain: { kind: 'note', text: 'CI lacks it.' } }],
    ['A.\nSee **Note for the session:** x', { asksUser: false }],
    ['Note for the session:\nQuestion for you: x\nCI lacks it.', { asksUser: true, toMain: { kind: 'note', text: 'CI lacks it.' } }],
    ['A.\n    Note for the session: x', { asksUser: false }],
  ]

  for (const [text, want] of REPORTS) {
    test(`reportOf reads the markers at a line start: ${JSON.stringify(text)}`, () => {
      expect(reportOf(text)).toEqual(want)
    })
  }

  const STATES: [string, Task, boolean, boolean][] = [
    ['asked, not sent', side([ASKED]), true, false],
    ['sent, no answer', side([ASKED], sent(1000)), false, true],
    ['sent and answered', side([ASKED, ANSWER], sent(1000, {}, 1000)), false, false],
    ['answered, then a follow-up', side([ASKED, ANSWER, { from: 'user', text: 'and then?', atMs: 3000 }], sent(1000, {}, 1000)), true, false],
    ['an older answer after the follow-up that is now sent', side([ASKED, { from: 'user', text: 'and then?', atMs: 1500 }, ANSWER], sent(1500, {}, 1000)), false, true],
    ['sent, no answer, handing off', side([ASKED], sent(1000, { state: 'handing-off' })), false, false],
    ['answered, then taken', tookBy(side([ASKED, ANSWER], sent(1000, {}, 1000)), 'user', 3000), false, false],
  ]

  for (const [name, task, pending, working] of STATES) {
    test(`${name}: pending ${pending}, working ${working}`, () => {
      expect([isPending(task), isWorking(task)]).toEqual([pending, working])
    })
  }

  test('an answer with a note sets the note, the reply flag and the waiting flag', () => {
    const task = answeredOf(side([ASKED], sent(1000)), 'A missing env var.\nNote for the session: CI lacks it.', 2000, 'u9')

    expect(task).toMatchObject({ hasNewReply: true, isWaitingForClaude: false, side: { seenUuid: 'u9', toMain: { kind: 'note', text: 'CI lacks it.', atMs: 2000 } } })
  })

  test('an answer with no marker keeps an earlier unsent note, and a new marker replaces it', () => {
    const noted = answeredOf(side([ASKED], sent(1000)), 'One.\nNote for the session: first.', 2000)
    const plain = answeredOf(noted, 'Two.', 3000)
    const replaced = answeredOf(noted, 'Three.\nQuestion for the session: which?', 4000)

    expect(plain.side?.toMain).toEqual({ kind: 'note', text: 'first.', atMs: 2000, askedMs: 1000 })
    expect(replaced.side?.toMain).toEqual({ kind: 'question', text: 'which?', atMs: 4000, askedMs: 1000 })
  })

  test('answeredOf and noticedOf end the run of the message sent', () => {
    const working = side([ASKED], sent(1000))

    expect(answeredOf(working, 'Done.', 2000).side?.endedMs).toBe(1000)
    expect(noticedOf(working, 'The helper could not start: x', 2000).side?.endedMs).toBe(1000)
  })

  test('refusedOf leaves an asked item and a refused follow-up neither pending nor working, with the notice newest', () => {
    const NOTICE = 'The helper could not start: x'
    const followed = { ...side([ASKED, ANSWER, { from: 'user', text: 'and then?', atMs: 3000 }], sent(1000, {}, 1000)) }

    for (const task of [side([ASKED]), followed]) {
      const refused = refusedOf(task, NOTICE, 4000)

      expect([isPending(refused), isWorking(refused), refused.thread.at(-1)]).toEqual([false, false, expect.objectContaining({ event: 'notice', text: NOTICE })])
    }
  })

  test('noteForMain names the question the helper was given, not a follow-up that waited', () => {
    const task = answeredOf(side([ASKED, { from: 'user', text: 'and then?', atMs: 1500 }], sent(1000)), 'A.\nNote for the session: CI lacks it.', 2000)

    expect(noteForMain(task)).toContain('(Open items): Why did the build fail?. The helper')
  })

  test('noteForMain keeps the noted answer and its question after a notice, a follow-up and a later plain answer', () => {
    const FOLLOW: Message = { from: 'user', text: 'and then?', atMs: 3000 }
    const base = answeredOf(side([ASKED], sent(1000)), '**Note for the session:** CI lacks it.\nA missing env var.', 2000)
    const later = noticedOf(base, 'The helper could not start: x', 2500)
    const followed = answeredOf({ ...later, thread: [...later.thread, FOLLOW] }, 'Plain reply.', 4000)

    expect(noteForMain(followed)).toBe(
      'Side question #4 (Open items): Why did the build fail?. The helper answered: A missing env var.. Why it may matter: CI lacks it.. If it changes your work, ask the user before you act: add a decision with `add_item`, or in a live chat ask in the chat.',
    )
  })

  test('summaryOf skips empty rows, cuts the first prompt, and labels rows', () => {
    const summary = summaryOf([row('user', 'a'.repeat(2500)), row('user', ''), row('assistant', 'Sure.'), row('user', 'Next?')])

    expect(summary).toContain(`First prompt: ${'a'.repeat(1999)}…\n`)
    expect(summary).toContain('Latest messages:\nClaude: Sure.\nUser: Next?')
  })

  test('summaryOf keeps only the newest rows within 8,000 characters', () => {
    const rows = Array.from({ length: 20 }, (_, i) => row('assistant', `${String(i).padStart(2, '0')}${'z'.repeat(998)}`))
    const latest = summaryOf([row('user', 'go'), ...rows]).split('Latest messages:\n')[1] ?? ''

    expect(latest.length).toBeLessThanOrEqual(8000)
    expect(latest).toContain('19zzz')
    expect(latest).not.toContain('Claude: 00')
  })

  test('fiveHourOf reads the five_hour window without a reset time', () => {
    expect(fiveHourOf([{ kind: 'seven_day', percentUsed: 5 }, { kind: 'five_hour', percentUsed: 72 }], 0)).toEqual({ percent: 72 })
  })

  test('clockOf pads to HH:MM', () => {
    expect([clockOf(new Date(2026, 10, 24, 20, 49).getTime()), clockOf(new Date(2026, 10, 24, 9, 5).getTime())]).toEqual(['20:49', '09:05'])
  })

  const noted = answeredOf(side([ASKED], sent(1000)), 'A missing env var.\nNote for the session: CI lacks it.', 2000)
  const asking = answeredOf(side([ASKED], sent(1000)), 'Unclear.\nQuestion for the session: Which branch?', 2000)

  test('the note and the question for the main session read exactly', () => {
    expect(noteForMain(noted)).toBe(
      'Side question #4 (Open items): Why did the build fail?. The helper answered: A missing env var.. Why it may matter: CI lacks it.. If it changes your work, ask the user before you act: add a decision with `add_item`, or in a live chat ask in the chat.',
    )
    expect(questionForMain(asking)).toBe(
      'Side question #4 (Open items): the helper needs you: Which branch?. Answer in the item with `reply_item`. Look and report only: change nothing because of this question.',
    )
  })

  test('ridingOf covers only the items whose note or question is not sent yet', () => {
    const done = { ...asking, id: 5, side: { ...asking.side!, toMain: { ...asking.side!.toMain!, sentMs: 3000 } } }

    expect(ridingOf([noted, done])).toMatchObject({ ids: [4], context: noteForMain(noted) })
    expect(ridingOf([done])).toBeUndefined()
  })
})
