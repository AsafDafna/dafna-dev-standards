import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { NOW, PANE, REPLY, earlierItems, savedItem, seat, start, step, textOf } from './world'

type Drawn = { type: string; props: Record<string, unknown>; children: unknown[] }

describe('thread heads', () => {
  test("each speaker's name is bold in its own color, its age dim, with a blank row before each message", async ($, on) => {
    seat(
      on,
      earlierItems([
        savedItem(1, {
          kind: 'question',
          thread: [
            { from: 'claude', text: "I can't run Xcode here.", atMs: NOW - 240_000 },
            { from: 'user', text: 'ok', atMs: NOW - 120_000 },
            { from: 'claude', text: 'Then paste the failures here.', atMs: NOW - 60_000 },
          ],
        }),
      ]),
    )
    await start($)

    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    const textIn = async (key: string) => (await ui.find({ key }))?.children[0] as Drawn | undefined
    const [you, youAge] = ((await textIn('head-1'))?.children ?? []) as Drawn[]
    const [claude] = ((await textIn('head-2'))?.children ?? []) as Drawn[]

    expect(you).toMatchObject({ type: 'Text', props: { bold: true, color: 'ide' }, children: ['You'] })
    expect(youAge).toMatchObject({ type: 'Text', props: { dimColor: true }, children: [' · 2m'] })
    expect(claude).toMatchObject({ type: 'Text', props: { bold: true, color: 'claude' }, children: ['Claude'] })
    expect(await textIn('msg-1')).toMatchObject({ type: 'Text', children: ['ok'] })
    expect((await textIn('msg-1'))?.props.dimColor).toBeFalsy()
    expect((await ui.find({ key: 'head-1' }))?.props.marginTop).toBe(1)
  })
})

describe('the sent line', () => {
  const opened = async ($: Engine, on: On) => {
    const { world, clock } = seat(on, earlierItems([savedItem(1, { kind: 'question', thread: [{ from: 'claude', text: "I can't run Xcode here.", atMs: NOW - 240_000 }] })]))
    await start($)
    const ui = await $.ui.mount(PANE)
    await ui.press({ key: 'row-1' })
    const reply = async (text: string) => {
      await ui.input({ key: 'reply-1', text })
      await clock.advance(1000)
      await clock.settle()
    }

    return { world, ui, reply }
  }

  test('a reply sent while Claude is idle shows that Claude has it', async ($, on) => {
    const { ui, reply } = await opened($, on)

    await reply('Two failures')

    expect(await textOf(ui, 'sent')).toBe('✓ Claude has it')
  })

  test('a reply that joins a running turn shows it was sent, then that Claude has it after the next step', async ($, on) => {
    const { ui, reply } = await opened($, on)

    await $.turn.start({ text: 'go', turnId: 't1' })
    await reply('Two failures')

    expect(await textOf(ui, 'sent')).toBe('Sent · Claude reads it at its next step')

    await step($, 't1')

    expect(await textOf(ui, 'sent')).toBe('✓ Claude has it')
  })

  test('a reply whose prompt a hook beneath drops waits to send', async ($, on) => {
    const { world, ui, reply } = await opened($, on)

    world.refusing = 'Another plugin held the prompt.'
    await reply('Two failures')

    expect(await textOf(ui, 'sent')).toBe('Waiting to send')
  })

  test("Claude's answer in the thread takes the line away", async ($, on) => {
    const { ui, reply } = await opened($, on)

    await reply('Two failures')

    expect(await textOf(ui, 'sent')).toBe('✓ Claude has it')

    await $.tool.call({ tool: REPLY, id: 1, text: 'Which scheme do you build?' })

    expect(await ui.find({ key: 'sent' })).toBeUndefined()
  })
})
