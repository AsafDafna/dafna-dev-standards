import { describe, expect, test } from 'claude-code/testing'

import { safeLinksOf } from '../hooks/pane'

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

  test('a link that is not https draws its target as plain text', () => {
    expect(safeLinksOf('[docs](http://a.b)')).toBe('docs (http://a.b)')
    expect(safeLinksOf('[d](HTTP://a.b)')).toBe('d (HTTP://a.b)')
    expect(safeLinksOf('[f](file:///etc/hosts)')).toBe('f (file:///etc/hosts)')
    expect(safeLinksOf('see [a](http://x) and [b](https://y)')).toBe('see a (http://x) and [b](https://y)')
    expect(safeLinksOf('![alt](http://a.b/i.png)')).toBe('!alt (http://a.b/i.png)')
    expect(safeLinksOf('[d](<http://a.b>)')).toBe('d (http://a.b)')
    expect(safeLinksOf('[d](http://a.b "title")')).toBe('d (http://a.b "title")')
    expect(safeLinksOf('[x](http\\://a)')).toBe('x (http\\://a)')
    expect(safeLinksOf('[x](ftp://a)')).toBe('x (ftp://a)')
    expect(safeLinksOf(`[${T}setup.sh${T}](/etc/passwd)`)).toBe(`${T}setup.sh${T} (/etc/passwd)`)
    expect(safeLinksOf('[x](a.ts)')).toBe('x (a.ts)')
  })

  test('after a word or a closing bracket the brackets stay, as code writes them', () => {
    expect(safeLinksOf('handlers[name](event)')).toBe('handlers[name] (event)')
    expect(safeLinksOf('arr[i](x)')).toBe('arr[i] (x)')
    expect(safeLinksOf('f()[k](y)')).toBe('f()[k] (y)')
    expect(safeLinksOf('a[0][1](z)')).toBe('a[0][1] (z)')
    expect(safeLinksOf('x_[d](http://a.b)')).toBe('x_[d] (http://a.b)')
    expect(safeLinksOf('[see the guide](docs/guide.md)')).toBe('see the guide (docs/guide.md)')
    expect(safeLinksOf('(see [docs](a))')).toBe('(see docs (a))')
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
