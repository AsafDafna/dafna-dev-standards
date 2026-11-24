import { describe, expect, test } from 'claude-code/testing'

import { NOW, PANE, earlierItems, savedItem, seat, start } from './world'

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
