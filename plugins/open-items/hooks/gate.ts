import type { AgentStatus, EngineInterface } from 'claude-code'

import { HELPER_TYPE } from './side'
import { live } from './state'
import type { UserInput } from './state'

/** The states of an agent whose work has not ended: `pending` has not started, and `waiting` waits on background work of its own. */
export const AT_WORK: readonly AgentStatus[] = ['pending', 'running', 'waiting']

/** How recent the user's last typed prompt is in a live chat. */
export const LIVE_CHAT_MS = 300_000

export const LIVE_CHAT = 'live chat: ask in the chat'

/** Ends `add_item`'s result when the live-chat gate cannot tell whether background work runs. */
export const LIVE_CHAT_NOTE = 'This looks like a live chat: if no background work runs and the user is here and replying, withdraw it with close_item and ask in the chat.'

export function noteInput(kind: UserInput['kind'], atMs: number) {
  live.inputs = [...live.inputs, { kind, atMs }].slice(-2)
}

/**
 * Whether the user chats live with Claude, so `add_item` refuses and a
 * helper's question starts no turn: their last two inputs were prompts typed
 * in the chat, the last one under LIVE_CHAT_MS ago, no agent is at work
 * (AT_WORK) but the mod's own helpers, and no background shell command or
 * monitor runs. 'unknown' when the rest holds but what runs cannot be told.
 */
export async function isLiveChat($: EngineInterface, nowMs: number): Promise<boolean | 'unknown'> {
  const [before, last] = live.inputs

  if (before?.kind !== 'typed' || last?.kind !== 'typed' || nowMs - last.atMs >= LIVE_CHAT_MS) {
    return false
  }

  const agents = await $.agent.list().catch(() => undefined)

  if (agents?.some(agent => agent.type !== HELPER_TYPE && AT_WORK.includes(agent.status))) {
    return false
  }

  return agents === undefined || live.background === null ? 'unknown' : live.background.size === 0
}

/**
 * Notes a background start that a Bash or Monitor result reports, in the
 * words of Claude Code 2.1.331. A start whose id cannot be read leaves what
 * runs unknown.
 */
export function noteStart(tool: string, text: string | undefined) {
  if (text === undefined || live.background === null) {
    return
  }

  if (tool !== 'Monitor' && !(tool === 'Bash' && /^Command\b[^\n]*\bbackground/i.test(text))) {
    return
  }

  const id = (tool === 'Monitor' ? /^Monitor started \(task ([\w-]+)/ : /(?:with ID: |\(ID: )([\w-]+)/).exec(text)?.[1]
  live.background = id === undefined ? null : live.background.add(id)
}

/** Drops the tasks a notification reports ended: an end carries a status, a monitor's event none. */
export function noteEnds(text: string) {
  for (const [, block = ''] of text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
    const id = /<task-id>([^<]+)<\/task-id>/.exec(block)?.[1]

    if (id !== undefined && block.includes('<status>')) {
      live.background?.delete(id)
    }
  }
}

/** The text of a tool's result row, unless the tool failed. */
export function resultTextOf(content: readonly Record<string, unknown>[]): string | undefined {
  const block = content.find(one => one['type'] === 'tool_result')
  const inner = block?.['content']

  if (block === undefined || block['is_error'] === true) {
    return undefined
  }

  if (typeof inner === 'string') {
    return inner
  }

  return Array.isArray(inner) ? inner.map(part => (typeof part?.text === 'string' ? part.text : '')).join('\n') : undefined
}
