import type { SessionMessage } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { KEY_SHAPED, itemOf, seat, start } from './world'

const row = (role: 'user' | 'assistant', text: string) => ({ role, text, toolUses: [] }) as SessionMessage

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
  })

  test('/side refuses a secret and an over-long question', async ($, on) => {
    const { world, clock } = seat(on)
    await start($)
    const long = 'why does the feed skip a page '.repeat(134).slice(0, 4001)

    for (const [text, toast] of [
      [KEY_SHAPED, "This looks like a secret, so it wasn't sent. Put it where it belongs, then ask without it."],
      [long, "Your side question is 4001 characters, so it wasn't sent: the most is 4000."],
    ] as const) {
      expect(await side($, text)).toEqual({})
      await clock.settle()

      expect(world.toasts.at(-1)).toBe(toast)
      expect(world.items).toEqual([])
      expect(world.spawns).toEqual([])
    }
  })
})
