import type { SessionMessage, SessionRateLimit } from 'claude-code'

import type { Message, Task, ToMain } from '../types'
import { MAX_TITLE } from './tasks'
import { clip, oneLine } from './text'

export const HELPER_TYPE = 'open-items:helper'
export const MAX_SUMMARY_FIRST = 2000
export const MAX_SUMMARY = 8000
export const MAX_ROW = 2000
export const LOG_NAME = 'open-items-side-questions.md'
export const HELPER_LIMIT_MS = 600_000
export const ALERT_AT = 70
export const HOLD_AT = 85

const MAX_ANSWER = 2000

export const HELPER_PROMPT = `You answer a side question the user left for this session. The main session goes on without you. You write for the user: follow the user's reply rules in CLAUDE.md.
- Search the main conversation file before you answer a question about the session's work. Look for every term that may hold the answer. Say what you could not find.
- If you are not sure whether the question is about the main session's work, ask the user one short question and stop.
- Look and report only. You have no shell. Never edit files, commit, push or send messages. Never call the advisor.
- Put the answer first. Keep it short.
- When your answer matters to the main session's work, add a one-line note for the main session: what it should know, and why. When only the main session can answer, add a one-line question for it instead.
Start each of these lines with its label, at the start of a line: "Question for you:" when you ask the user back, "Note for the session:" for a note, "Question for the session:" for a question.`

const ASKS_USER = /^question for you:/im
const NOTE = /^note for the session:[ \t]*(.*)$/im
const QUESTION = /^question for the session:[ \t]*(.*)$/im
const MARKER_LINE = /^(question for you:|note for the session:|question for the session:).*$/gim

export function newSideOf(id: number, text: string, atMs: number, transcript: string): Task {
  return {
    id,
    kind: 'side',
    title: clip(oneLine(text), MAX_TITLE),
    thread: [{ from: 'user', text, atMs }],
    state: 'open',
    isWaitingForClaude: true,
    hasNewReply: false,
    update: 'none',
    isMarkdown: true,
    side: { transcripts: transcript === '' ? [] : [transcript] },
    createdMs: atMs,
    updatedMs: atMs,
  }
}

export function newestUserOf(task: Task): Message | undefined {
  return task.thread.findLast(message => message.from === 'user' && !message.event)
}

export function isPending(task: Task): boolean {
  const newest = newestUserOf(task)

  return task.kind === 'side' && task.state === 'open' && newest !== undefined && (task.side?.sentMs === undefined || newest.atMs > task.side.sentMs)
}

const isHelperEntry = (message: Message) => message.from === 'claude' && message.author === 'helper' && (!message.event || message.event === 'notice')

export function isWorking(task: Task): boolean {
  const sentMs = task.side?.sentMs

  if (task.kind !== 'side' || task.state !== 'open' || sentMs === undefined) {
    return false
  }

  const sent = task.thread.findLastIndex(message => message.from === 'user' && !message.event && message.atMs <= sentMs)

  return sent >= 0 && !task.thread.slice(sent + 1).some(isHelperEntry)
}

export function reportOf(text: string): { asksUser: boolean; toMain?: { kind: 'note' | 'question'; text: string } } {
  const question = QUESTION.exec(text)
  const note = NOTE.exec(text)
  const found = question ? { kind: 'question' as const, text: (question[1] ?? '').trim() } : note ? { kind: 'note' as const, text: (note[1] ?? '').trim() } : undefined

  return { asksUser: ASKS_USER.test(text), ...(found && { toMain: found }) }
}

function withReply(task: Task, entry: Message, side: Task['side']): Task {
  const next = { ...task, thread: [...task.thread, entry], hasNewReply: true, side }

  return { ...next, isWaitingForClaude: isPending(next) }
}

export function answeredOf(task: Task, text: string, atMs: number, seenUuid?: string): Task {
  const side = task.side ?? { transcripts: [] }
  const report = reportOf(text).toMain

  return withReply(task, { from: 'claude', author: 'helper', text, atMs }, {
    ...side,
    ...(report && { toMain: { ...report, atMs } }),
    ...(seenUuid !== undefined && { seenUuid }),
  })
}

export function noticedOf(task: Task, line: string, atMs: number): Task {
  return withReply(task, { from: 'claude', author: 'helper', event: 'notice', text: line, atMs }, task.side)
}

export function sentOf(task: Task, helperId: string | undefined): Task {
  const sentMs = newestUserOf(task)?.atMs

  return { ...task, side: { transcripts: [], ...task.side, ...(sentMs !== undefined && { sentMs }), ...(helperId !== undefined && { helperId }) } }
}

export function rowsTextOf(messages: readonly SessionMessage[], max: number): string {
  const rows = messages
    .filter(message => message.text !== '')
    .map(message => `${message.role === 'user' ? 'User' : 'Claude'}: ${clip(message.text, MAX_ROW)}`)
  const kept: string[] = []
  let size = 0

  for (const row of rows.reverse()) {
    size += row.length + (kept.length > 0 ? 1 : 0)

    if (size > max) {
      break
    }

    kept.unshift(row)
  }

  return kept.join('\n')
}

export function summaryOf(messages: readonly SessionMessage[]): string {
  const first = messages.findIndex(message => message.role === 'user' && message.text !== '')
  const prompt = clip(messages[first]?.text ?? '', MAX_SUMMARY_FIRST)

  return `First prompt: ${prompt}\nLatest messages:\n${rowsTextOf(messages.slice(first + 1), MAX_SUMMARY)}`
}

function speakerOf(message: Message): string {
  return message.from === 'user' ? 'User' : message.author === 'helper' ? 'Helper' : 'Claude'
}

export function helperPromptOf(args: { task: Task; summary: string; current: string; log: { path?: string; text: string } }): string {
  const { task, summary, current, log } = args
  const earlier = (task.side?.transcripts ?? []).filter(path => path !== current)
  const thread = task.thread
    .filter(message => !message.event || message.event === 'notice')
    .map(message => (message.event === 'notice' ? message.text : `${speakerOf(message)}: ${message.text}`))

  return [
    `Side question #${task.id} from the user (Open items).`,
    current === '' ? 'This session keeps no conversation file.' : `The main conversation file: ${current}`,
    ...(earlier.length > 0 ? ['Earlier conversation files:', ...earlier] : []),
    log.path ? `The log of side questions: ${log.path}` : `The log of side questions:\n${log.text}`,
    `Summary of the main conversation:\n${summary}`,
    `The side question's thread:\n${thread.join('\n')}`,
  ].join('\n\n')
}

export function followUpOf(task: Task, since: string): string {
  return `Follow-up on side question #${task.id}: ${newestUserOf(task)?.text ?? ''}\n\nThe main conversation since your last answer:\n${since === '' ? 'nothing new' : since}`
}

export function logOf(tasks: readonly Task[]): string {
  const entries = tasks
    .filter(task => task.kind === 'side')
    .map(task => {
      const answer = task.thread.findLast(message => message.from === 'claude' && !message.event)?.text ?? 'none yet'

      return `## #${task.id} ${task.title}\nQuestion: ${task.thread[0]?.text ?? ''}\nLatest answer: ${answer}`
    })

  return ['# Side questions of this session', ...entries].join('\n\n')
}

export function fiveHourOf(limits: readonly SessionRateLimit[], nowMs: number): { percent: number; resetsAtMs?: number } | undefined {
  const limit = limits.find(entry => entry.kind === 'five_hour')

  if (!limit) {
    return undefined
  }

  const resetsAtMs = limit.resetsAt === undefined ? undefined : Date.parse(limit.resetsAt)

  if (resetsAtMs !== undefined && resetsAtMs <= nowMs) {
    return undefined
  }

  return { percent: limit.percentUsed, ...(resetsAtMs !== undefined && !Number.isNaN(resetsAtMs) && { resetsAtMs }) }
}

export function clockOf(ms: number): string {
  const date = new Date(ms)

  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function noteForMain(task: Task): string {
  const helper = task.thread.findLast(isHelperEntry)
  const answer = (helper?.event ? '' : (helper?.text ?? '')).replace(MARKER_LINE, '').trim()
  const shown = answer.length > MAX_ANSWER ? `${answer.slice(0, MAX_ANSWER)} (cut: list_items with id ${task.id} gives it whole)` : answer

  return `Side question #${task.id} (Open items): ${newestUserOf(task)?.text ?? ''}. The helper answered: ${shown}. Why it may matter: ${task.side?.toMain?.text ?? ''}. If it changes your work, ask the user before you act: add a decision with \`add_item\`, or in a live chat ask in the chat.`
}

export function questionForMain(task: Task): string {
  return `Side question #${task.id} (Open items): the helper needs you: ${task.side?.toMain?.text ?? ''}. Answer in the item with \`reply_item\`. Look and report only: change nothing because of this question.`
}

export function ridingOf(tasks: readonly Task[]): { context: string; ids: number[] } | undefined {
  const riding = tasks.filter((task): task is Task & { side: { toMain: ToMain } } => task.kind === 'side' && task.state === 'open' && task.side?.toMain !== undefined && task.side.toMain.sentMs === undefined)

  if (riding.length === 0) {
    return undefined
  }

  return {
    context: riding.map(task => (task.side.toMain.kind === 'note' ? noteForMain(task) : questionForMain(task))).join('\n\n'),
    ids: riding.map(task => task.id),
  }
}
