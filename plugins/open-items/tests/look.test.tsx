import { describe, expect, test } from 'claude-code/testing'

import { safeLinksOf } from '../hooks/pane'

describe('safeLinksOf', () => {
  test('an https link stays, in any case', () => {
    expect(safeLinksOf('[docs](https://a.b)')).toBe('[docs](https://a.b)')
    expect(safeLinksOf('[d](HTTPS://a.b)')).toBe('[d](HTTPS://a.b)')
    expect(safeLinksOf('<https://a.b>')).toBe('<https://a.b>')
  })

  test('a link to any other scheme draws its target as plain text', () => {
    expect(safeLinksOf('[docs](http://a.b)')).toBe('docs (http://a.b)')
    expect(safeLinksOf('[d](HTTP://a.b)')).toBe('d (HTTP://a.b)')
    expect(safeLinksOf('[f](file:///etc/hosts)')).toBe('f (file:///etc/hosts)')
    expect(safeLinksOf('[x](javascript:alert(1))')).toBe('x (javascript:alert(1))')
    expect(safeLinksOf('see [a](http://x) and [b](https://y)')).toBe('see a (http://x) and [b](https://y)')
  })

  test('an image, a <target> and a title are judged by their URL', () => {
    expect(safeLinksOf('![alt](http://a.b/i.png)')).toBe('!alt (http://a.b/i.png)')
    expect(safeLinksOf('[d](<http://a.b>)')).toBe('d (http://a.b)')
    expect(safeLinksOf('[d](http://a.b "title")')).toBe('d (http://a.b "title")')
    expect(safeLinksOf('[d](<https://a.b>)')).toBe('[d](<https://a.b>)')
    expect(safeLinksOf('[d](https://a.b "title")')).toBe('[d](https://a.b "title")')
  })

  test('an autolink to any scheme but https loses its brackets', () => {
    expect(safeLinksOf('<http://a.b>')).toBe('http://a.b')
    expect(safeLinksOf('<file:///etc/hosts>')).toBe('file:///etc/hosts')
    expect(safeLinksOf('<mailto:a@b.c>')).toBe('mailto:a@b.c')
    expect(safeLinksOf('<name>')).toBe('<name>')
  })

  test('a reference definition to a non-https target loses its link', () => {
    expect(safeLinksOf('[1]: http://a.b')).toBe('1: http://a.b')
    expect(safeLinksOf('[1]: https://a.b')).toBe('[1]: https://a.b')
  })

  test('a fenced block and an inline code span stay as written', () => {
    const fenced = 'a\n```\n[x](http://a)\n<http://a>\n```\n[y](http://b)'
    expect(safeLinksOf(fenced)).toBe('a\n```\n[x](http://a)\n<http://a>\n```\ny (http://b)')
    expect(safeLinksOf('~~~\n[x](http://a)\n```\n[x](http://a)\n~~~\n[z](http://c)')).toBe(
      '~~~\n[x](http://a)\n```\n[x](http://a)\n~~~\nz (http://c)',
    )
    expect(safeLinksOf('use `[x](http://a)` then [y](http://b)')).toBe('use `[x](http://a)` then y (http://b)')
    expect(safeLinksOf('``a ` [x](http://a)`` [y](http://b)')).toBe('``a ` [x](http://a)`` y (http://b)')
    expect(safeLinksOf('a ` [x](http://a)')).toBe('a ` x (http://a)')
  })

  test('plain text stays, and a bare address stays', () => {
    for (const text of ['snake_case_name', '2 * 3', 'go to http://a.b or file:///x', 'a < b > c']) {
      expect(safeLinksOf(text)).toBe(text)
    }
  })
})
