import { describe, expect, test } from 'claude-code/testing'

import { actionsOf, entriesOf, itemButtonsOf, rowsFor, safeLinksOf } from '../hooks/pane'
import type { PaneView } from '../hooks/pane'
import type { Message, Task } from '../types'

const T = '`'
const F = T + T + T

/** A `](` the engine may draw as a link that is not `https:`, or an `http:` or `file:` autolink. */
function hasLiveLink(text: string): boolean {
  const kept = /\s*<?https:/iy
  for (let at = text.indexOf(']('); at !== -1; at = text.indexOf('](', at + 1)) {
    kept.lastIndex = at + 2
    if (!kept.test(text)) return true
  }
  return /<(?:http|file):/i.test(text)
}

const REVIEWED = [
  `[${T}setup.sh${T}](file:///etc/passwd)`,
  '[see [docs] here](http://x)',
  '[a\\]b](http://x)',
  '[a](https://ok [b](http://x)',
  `\\${T}[click](http://x)${T}`,
  `[click](http://x/${T}a${T})`,
  `${T}[click](http://x)${T}`,
  '[click\nhere](http://x)',
  '[click](\nhttp://x)',
  `text\n\n    ${F}\n[click](http://x)`,
  `${F}x${T}\n[click](http://x)`,
  `${F}${T}\n${F}\n${F}${T}\n[click](http://x)\n${F}`,
  `${F}\n${F}x\n${F}\n[click](http://x)\n${F}`,
  `- item\n  ${F}\n  code\n[click](http://x)`,
  `${F}${T}\n${F}\n[x](http://a)\n${F}\n${F}${T}`,
  `> ${F}\n> [x](http://a)\n> ${F}\n[y](http://b)`,
  `~~~\n[x](http://a)\n${F}\n[x](http://a)\n~~~\n[z](http://c)`,
  `text\r${F}\r[x](http://a)\r${F}\r[y](http://b)`,
  '> [id]: http://x\n\n[click][id]',
  '[id]:\nhttp://x\n\n[click][id]',
  '- [id]: http://x\n\n[click][id]',
  '   [id]: http://a.b "title"',
  '[click][]\n[id]\n[id]: http://a.b',
  '[![badge](https://ok/i.png)](http://x)',
  '<a href="http://x">click</a>',
  '[click](http://x "title")',
  '[d](   http://a.b)',
  '![alt](http://a.b/i.png)',
  '[click]\u200b(http://evil)',
  '<C:\\Users> and \\<http://x>',
  '[note]: some prose here\n\n[^1]: footnote text',
]

const LIVE_FORMS = [
  '[x](http\\://a)',
  '[x](file\\:///a)',
  '[x](http:\\/\\/a)',
  '[x](<http\\://a>)',
  '[x](<http://a>)',
  '[x](<file:///a>)',
  '[x](\u00a0http://a)',
  '[x](http:a)',
  '[x](HtTp://a)',
  '[x](&#104;ttp://a)',
  '[x] (http://a)',
  '[x](ftp://a)',
  '[x](mailto:a@b.c)',
  '[x](//a.b)',
  '[x](< http://a>)',
  '[x](/a)',
  '[x](./a)',
  '[x](a)',
  '[x](~/a)',
  '[x](#a)',
  '[x](\\/a)',
  '[x](<a b>)',
  '[x](HTTPS\\://a)',
  '[x](\\https://a)',
  '[x](< https://a>)',
  `[${T}setup.sh${T}](/etc/passwd)`,
  'handlers[name](event)',
]

const MADE_LIVE_BY_A_REWRITE = [
  'y][http://q z](http://x)',
  'x][(http://a)](http://b)',
  '[[a](http://b)](http://c)',
  '[a](<http://b>)](http://c)',
  '](<<http://a>>',
  '<<<http://a>>>',
  '\\\\[x](http://a)',
  '[x\\\\](http://a)',
  `${'<'.repeat(20)}http://a`,
  `${'[x]('.repeat(30)}http://a${')'.repeat(30)}`,
  `${'[a]'.repeat(10)}(http://a)`,
]

describe('safeLinksOf', () => {
  test('an https link stays, in any case', () => {
    for (const text of ['[docs](https://a.b)', '[d](HTTPS://a.b)', '<https://a.b>', '[d](<https://a.b>)', '[d](https://a.b "t")', '[1]: https://a.b']) {
      expect(safeLinksOf(text)).toBe(text)
    }
  })

  test('a link to a scheme that is not https draws as its text and its target', () => {
    expect(safeLinksOf('[docs](http://a.b)')).toBe('docs (http://a.b)')
    expect(safeLinksOf('[d](HTTP://a.b)')).toBe('d (HTTP://a.b)')
    expect(safeLinksOf('[f](file:///etc/hosts)')).toBe('f (file:///etc/hosts)')
    expect(safeLinksOf('see [a](http://x) and [b](https://y)')).toBe('see a (http://x) and [b](https://y)')
    expect(safeLinksOf('![alt](http://a.b/i.png)')).toBe('!alt (http://a.b/i.png)')
    expect(safeLinksOf('[d](<http://a.b>)')).toBe('d (http://a.b)')
    expect(safeLinksOf('[d](http://a.b "title")')).toBe('d (http://a.b "title")')
    expect(safeLinksOf('[x](ftp://a)')).toBe('x (ftp://a)')
  })

  test('a target with no scheme keeps its brackets and gains a space, so code and paths read as written', () => {
    expect(safeLinksOf("re.compile(r'[a-z](\\d+)')")).toBe("re.compile(r'[a-z] (\\d+)')")
    expect(safeLinksOf('^[A-Z](\\d{3})$')).toBe('^[A-Z] (\\d{3})$')
    expect(safeLinksOf(`${F}md\n[Guide](docs/guide.md)\n${F}`)).toBe(`${F}md\n[Guide] (docs/guide.md)\n${F}`)
    expect(safeLinksOf('[see the guide](docs/guide.md)')).toBe('[see the guide] (docs/guide.md)')
    expect(safeLinksOf('(see [docs](a))')).toBe('(see [docs] (a))')
    expect(safeLinksOf('[x](a.ts)')).toBe('[x] (a.ts)')
    expect(safeLinksOf(`[${T}setup.sh${T}](/etc/passwd)`)).toBe(`[${T}setup.sh${T}] (/etc/passwd)`)
    expect(safeLinksOf('[x](http\\://a)')).toBe('[x] (http\\://a)')
  })

  test('after a word or a closing bracket the brackets stay, as code writes them', () => {
    expect(safeLinksOf('handlers[name](event)')).toBe('handlers[name] (event)')
    expect(safeLinksOf('arr[i](x)')).toBe('arr[i] (x)')
    expect(safeLinksOf('f()[k](y)')).toBe('f()[k] (y)')
    expect(safeLinksOf('a[0][1](z)')).toBe('a[0][1] (z)')
    expect(safeLinksOf('x_[d](http://a.b)')).toBe('x_[d] (http://a.b)')
    expect(safeLinksOf('see [docs](http://a.b)')).toBe('see docs (http://a.b)')
  })

  test('the link text is found by bracket depth, past escapes and line breaks', () => {
    expect(safeLinksOf(`[${T}setup.sh${T}](file:///etc/passwd)`)).toBe(`${T}setup.sh${T} (file:///etc/passwd)`)
    expect(safeLinksOf('[see [docs] here](http://x)')).toBe('see [docs] here (http://x)')
    expect(safeLinksOf('[a\\]b](http://x)')).toBe('a\\]b (http://x)')
    expect(safeLinksOf('[![badge](https://ok/i.png)](http://x)')).toBe('![badge](https://ok/i.png) (http://x)')
    expect(safeLinksOf('[click\nhere](http://x)')).toBe('click\nhere (http://x)')
    expect(safeLinksOf('[click](\nhttp://x)')).toBe('click (\nhttp://x)')
    expect(safeLinksOf('x](http://a)')).toBe('x] (http://a)')
    expect(safeLinksOf('\\[x](http://a)')).toBe('\\[x] (http://a)')
  })

  test('a link inside code is rewritten too', () => {
    expect(safeLinksOf(`${F}\n[x](http://a)\n${F}`)).toBe(`${F}\nx (http://a)\n${F}`)
    expect(safeLinksOf(`use ${T}[x](http://a)${T} here`)).toBe(`use ${T}x (http://a)${T} here`)
  })

  test('an autolink to http or file loses its brackets, and other angle text stays', () => {
    expect(safeLinksOf('<http://a.b>')).toBe('http://a.b')
    expect(safeLinksOf('<FILE:///etc/hosts>')).toBe('FILE:///etc/hosts')
    for (const text of ['<name>', '<C:\\Users>', '<mailto:a@b.c>', 'a < b > c']) {
      expect(safeLinksOf(text)).toBe(text)
    }
  })

  test('a reference definition to http or file loses its brackets, and prose stays', () => {
    expect(safeLinksOf('[1]: http://a.b')).toBe('1: http://a.b')
    expect(safeLinksOf('   [id]: <file:///x>')).toBe('   id: file:///x')
    for (const text of ['[note]: some prose', '[^1]: footnote text']) {
      expect(safeLinksOf(text)).toBe(text)
    }
  })

  test('plain words and a bare address stay', () => {
    for (const text of ['snake_case_name', '2 * 3', 'f(x) and [y]', 'go to http://a.b or file:///x']) {
      expect(safeLinksOf(text)).toBe(text)
    }
  })

  test('no live link but https survives, even one a rewrite makes', () => {
    for (const live of ['[x](http://a)', '[x](\n <FILE\\:///a)', '<HTTP://a>']) {
      expect(hasLiveLink(live)).toBe(true)
    }
    for (const text of [...REVIEWED, ...LIVE_FORMS, ...MADE_LIVE_BY_A_REWRITE]) {
      expect(hasLiveLink(safeLinksOf(text))).toBe(false)
    }
  })
})

const NOW = 1_000_000

const DETAIL: Message = { from: 'claude', text: 'I lean towards cursor: the feed is append-only.', atMs: NOW - 240_000 }

function item(fields: Partial<Task> = {}): Task {
  return {
    id: 1,
    kind: 'question',
    title: 'Pick a pagination strategy for /feed',
    askLine: 'Which pagination should /feed use?',
    thread: [DETAIL],
    isMarkdown: true,
    state: 'open',
    isWaitingForClaude: false,
    hasNewReply: false,
    update: 'none',
    createdMs: NOW - 240_000,
    updatedMs: NOW - 240_000,
    ...fields,
  }
}

const PAGING = item({
  kind: 'decision',
  options: ['Cursor', 'Offset, capped at 10k'],
  optionNotes: ['Pages stay stable while new posts arrive.', 'Simple, but pages shift as posts arrive.'],
  recommended: 'Cursor',
})

function itemView(task: Task): PaneView {
  return { shown: [task], screen: { kind: 'item', id: task.id }, held: null, draft: '', nowMs: NOW, canType: true, isFocused: true, isTyping: false }
}

describe('the item screen helpers', () => {
  test("a decision's option boxes take two border rows, a label row and a note row each, after one empty row", () => {
    expect(rowsFor(itemView(PAGING), 76, 99) - rowsFor(itemView(item()), 76, 99)).toBe(9)
  })

  test('the ask line wraps beside its bar, two cells short of the row, and takes an empty row after it', () => {
    const fills = item({ askLine: `${'word '.repeat(7)}word` })

    expect(rowsFor(itemView(fills), 40, 99) - rowsFor(itemView(item({ askLine: undefined })), 40, 99)).toBe(3)
  })

  test('the recommended mark takes a row of its own, whole, when it does not fit after the label', () => {
    const long = 'ClickHouse cluster that the data team runs for analytics'
    const decision = item({ kind: 'decision', options: [long, 'SQLite on the box'], optionNotes: ['Fast for scans.', 'One writer at a time.'] })
    const extra = (columns: number) => rowsFor(itemView({ ...decision, recommended: long }), columns, 99) - rowsFor(itemView(decision), columns, 99)

    expect(extra(100)).toBe(0)
    // The label fits its row; the mark does not fit after it.
    expect(extra(66)).toBe(1)
    // The label wraps to three rows, and the mark goes below the last one, though it would fit beside it.
    expect(extra(32)).toBe(1)
  })

  test("the header's first line wraps in its box once the waiting mark makes it too wide", () => {
    const waiting = item({ isWaitingForClaude: true })

    // The sent line under the reply takes one row at both widths.
    expect(rowsFor(itemView(waiting), 76, 99) - rowsFor(itemView(item()), 76, 99)).toBe(1)
    expect(rowsFor(itemView(waiting), 32, 99) - rowsFor(itemView(item()), 32, 99)).toBe(2)
  })

  test("a side question's screen takes its header, the question, the helper's reply, the follow-up, the sent line, Done, the follow-up field and the foot", () => {
    const asked: Message = { from: 'user', text: 'What does the feed page by?', atMs: NOW - 120_000 }
    const followUp: Message = { from: 'user', text: 'And the app feed?', atMs: NOW - 30_000 }
    const side = item({
      kind: 'side',
      title: asked.text,
      askLine: undefined,
      thread: [asked, { from: 'claude', author: 'helper', text: 'By a cursor, in pages of twenty.', atMs: NOW - 60_000 }, followUp],
      isWaitingForClaude: true,
      side: { transcripts: [], helperId: 'a1', sentMs: followUp.atMs },
    })
    // 59 cells: two rows in the follow-up field, which its longer label leaves 57 cells; a reply field would take it in one.
    const typing: PaneView = { ...itemView(side), draft: `${'word '.repeat(11)}word`, isTyping: true }

    // The header box (4), an empty row, the question, two messages of a blank row, a head and a line each,
    // the sent line, an empty row and Done (no Long answer), the field on two rows, and the foot.
    expect(rowsFor(typing, 76, 99)).toBe(18)
  })

  test('each message after the detail takes a blank row and a head row above its own rows', () => {
    const replies = item({
      thread: [
        DETAIL,
        { from: 'user', text: 'ok', atMs: NOW - 120_000 },
        { from: 'claude', text: 'Then cursor it is.', atMs: NOW - 60_000 },
      ],
    })

    expect(rowsFor(itemView(replies), 76, 99) - rowsFor(itemView(item()), 76, 99)).toBe(6)
  })

  test('an event after the detail, and the line in place of hidden messages, each take a blank row above their one line', () => {
    const pressed = item({ thread: [DETAIL, { from: 'user', text: '', event: 'later', atMs: NOW }] })
    const long: Message = { from: 'user', text: `${'word '.repeat(799)}words`, atMs: NOW }
    const messages = Array.from({ length: 20 }, () => long)
    const hiding = item({ thread: [DETAIL, ...messages] })
    const showing = item({ thread: [DETAIL, ...messages.slice(1)] })

    expect(rowsFor(itemView(pressed), 76, 99) - rowsFor(itemView(item()), 76, 99)).toBe(2)
    // The same messages are drawn in both: one more than fits is the one hidden.
    expect([entriesOf(hiding, NOW).hidden, entriesOf(showing, NOW).hidden]).toEqual([1, 0])
    expect(rowsFor(itemView(hiding), 76, 9999) - rowsFor(itemView(showing), 76, 9999)).toBe(2)
  })

  test('on a 0.3 item, Claude writes Markdown and the detail has no head; the user writes plain text, and a press is an event', () => {
    const task = item({
      thread: [
        DETAIL,
        { from: 'user', text: 'Is the feed ordered by time?', atMs: NOW - 120_000 },
        { from: 'claude', text: 'Yes, **newest first**.', atMs: NOW - 60_000 },
        { from: 'user', text: '', event: 'later', atMs: NOW },
      ],
    })

    expect(entriesOf(task, NOW).entries).toStrictEqual([
      { i: 0, text: DETAIL.text, look: 'markdown' },
      { i: 1, head: { who: 'You', age: '2m' }, text: 'Is the feed ordered by time?', look: 'plain' },
      { i: 2, head: { who: 'Claude', age: '1m' }, text: 'Yes, **newest first**.', look: 'markdown' },
      { i: 3, text: 'You pressed Later · now', look: 'event' },
    ])
  })

  test('on an item saved before 0.3, Claude writes plain text', () => {
    const older = item({ isMarkdown: undefined, thread: [DETAIL, { from: 'claude', text: 'Yes, **newest first**.', atMs: NOW - 60_000 }] })

    expect(entriesOf(older, NOW).entries.map(entry => entry.look)).toEqual(['plain', 'plain'])
  })

  test("Claude's Markdown keeps no link that is not https, joined by a zero-width character or not; plain text is not rewritten", () => {
    const detail: Message = { from: 'claude', text: '[click]\u200b(http://evil)', atMs: NOW }
    const reply: Message = { from: 'user', text: '[x](http://a)', atMs: NOW }
    const marked = item({ thread: [detail, reply] })
    const older = item({ isMarkdown: undefined, thread: [detail, reply] })

    expect(entriesOf(marked, NOW).entries.map(entry => entry.text)).toEqual(['click (http://evil)', '[x](http://a)'])
    // The zero-width character is gone before the rule runs, as `printableLines` drops it from every text.
    expect(entriesOf(older, NOW).entries.map(entry => entry.text)).toEqual(['[click](http://evil)', '[x](http://a)'])
  })

  test('a decision whose options a session before 0.3 changed draws no notes, as they no longer pair with its options', () => {
    const changed = { ...PAGING, options: ['Cursor', 'Offset, capped at 10k', 'Keyset'] }

    expect(itemButtonsOf(changed).choices.map(choice => choice.note)).toEqual([undefined, undefined, undefined])
    expect(itemButtonsOf(PAGING).choices.map(choice => choice.note)).toEqual(PAGING.optionNotes)
  })

  test('the recommended option is labeled with its plain text: its box marks it', () => {
    expect(actionsOf(PAGING).map(action => action.label)).toEqual(['Cursor', 'Offset, capped at 10k', 'Later'])
  })
})

describe('the list screen helpers', () => {
  test('a list of a decision and a side question takes the head, two labels, two rows, the new-question field and the foot', () => {
    const asked = item({
      id: 2,
      kind: 'side',
      title: 'What does the feed page by?',
      askLine: undefined,
      thread: [{ from: 'user', text: 'What does the feed page by?', atMs: NOW - 60_000 }],
      isWaitingForClaude: true,
      side: { transcripts: [], helperId: 'a1', sentMs: NOW - 60_000 },
    })
    const view: PaneView = { shown: [PAGING, asked], screen: { kind: 'list' }, held: null, draft: '', nowMs: NOW, canType: true, isFocused: true, isTyping: false }

    expect(rowsFor(view, 76, 99)).toBe(7)
  })

  const LIST: PaneView = { shown: [], screen: { kind: 'list' }, held: null, draft: '', nowMs: NOW, canType: true, isFocused: true, isTyping: false }

  test('an empty pane the user keeps open takes the empty line, the new-question field and the foot', () => {
    expect(rowsFor(LIST, 76, 99)).toBe(3)
  })

  test('a side question held back takes its notice, wrapped, and its row of buttons under the field', () => {
    const held = { ...LIST, shown: [PAGING], held: { id: 'new', text: 'sk_live_key' } } as const

    // The head, a label, a row, the field, the notice on two rows, Edit and Send anyway, and the foot.
    expect(rowsFor(held, 76, 99)).toBe(8)
  })
})
