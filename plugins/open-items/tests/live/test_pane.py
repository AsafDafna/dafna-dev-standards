"""The Open items pane as a real Claude Code draws it, at narrow and wide widths.

Run with `python3 tests/live/test_pane.py` from the repository's root, with
`claude` and `tmux` on the PATH. Each case seeds the items a session saved,
starts that session again, opens /open-items in a terminal of the given size,
presses keys there and reads the screen back. The list draws a row per item,
cut to one line, in sections; an item opened with Enter draws a header box
with its kind, number, age and whole title, its ask, its thread, a box for
each option of a decision, the buttons of its kind and its reply field.
Nothing is cut off at the pane's bottom, and the pane asks for no rows it
leaves empty. Below 110 columns the pane is framed above the prompt, 18 rows
at most, and an item taller than that scrolls; from 110 it docks beside the
transcript. The focus ring is read from the inverse video the engine draws it
in. With RENDERS_DIR set, each screen a test reads is kept there, and
`tests/live/renders.py` lays them out; with LIVE_THEME=light, the sessions
draw in the light theme. Two cases read the store back: one after /clear, one
after a session v0.1 saved.
"""

import contextlib
import json
import os
import re
import sys
import time
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from renders import text_of  # noqa: E402
from screen import Claude, body_rows, frame_top, has_pane, hyperlinks_of, pane_body, placement, run, styles_of, wait_for  # noqa: E402

ROOT = os.environ.get('PLUGIN_DIR') or os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
# Framed, then each side of where the pane docks (110), and past where the
# dock stops growing.
WIDTHS = (36, 48, 64, 100, 109, 110, 144, 200)
DOCK_FROM = 110
# Tall enough that the layout spares the pane every row it asks for.
HEIGHT = 90
# Framed at the 18 rows the pane asks for at most, and docked down a short screen.
INLINE = (100, HEIGHT)
DOCKED = (144, 40)
FRAMED_ROWS = 18

KIND_LABELS = {'decision': 'DECISION', 'question': 'QUESTION', 'action': 'ACTION', 'info': 'INFO'}

LABELS = ('DECISIONS', 'QUESTIONS', 'ACTIONS', 'INFO', 'LATER')
HINTS = (
    '↵ open · ↑↓ move · Esc: back to the prompt',
    'Tab: buttons · ↑↓ scroll · Esc: back to the prompt',
    '↑↓ scroll · Esc: back to the prompt',
    'Click, or press ctrl+x tab to use the keys',
)

INSTRUMENTS = 'Open Instruments from Xcode and record with the Activity Monitor template'
XCODE = 'Run xcodebuild test on your Mac and paste every failure you see here please'
GERMAN = 'Datenbankverbindungseinstellungsüberprüfungsprotokoll im Ordner ablegen'
JAPANESE = 'ステージング環境のデータベース移行を承認してください'
# Longer than a title may be when added: an older version's, left in the store.
LONG = 'Rotate the deploy key ' + ' '.join(['and check every runner that holds it'] * 3)
# Emoji the terminal draws two cells wide, below U+1F300 too.
EMOJI = 'Tag issues ✅ done, ❌ failed, ⏳ waiting, ⚡ urgent, ⛔ blocked'

TASKS = [
    {'id': 1, 'title': INSTRUMENTS, 'detail': 'I need a trace of the launch to see where the 4 seconds go.', 'doneWhen': 'The .trace file is in ~/traces.'},
    {'id': 2, 'title': XCODE, 'detail': "I can't run Xcode here.", 'kind': 'question'},
    {'id': 3, 'title': GERMAN, 'detail': 'Die Prüfung braucht es.'},
    {'id': 4, 'title': JAPANESE, 'detail': 'The migration drops a column.', 'kind': 'decision', 'options': ['Approve', 'Wait for the freeze to end']},
]

TITLED = TASKS + [
    {'id': 5, 'title': LONG, 'detail': 'It leaked.'},
    {'id': 7, 'title': EMOJI, 'detail': 'The ⌛ build waits on it.', 'kind': 'question'},
]
# As the list draws them: by section, each oldest first.
TITLED_ORDER = (4, 2, 7, 1, 3, 5)

KINDS = [
    {'id': 1, 'title': 'Ship the feed rewrite this week', 'detail': 'It unblocks the mobile release.', 'kind': 'decision', 'options': ['Yes', 'Not yet'], 'recommended': 'Yes'},
    {'id': 2, 'title': 'Which branch holds the fix?', 'detail': 'Two candidates.', 'kind': 'question'},
    {'id': 3, 'title': 'Add the key to the env file', 'detail': 'The test needs it.', 'doneWhen': 'The test passes.', 'link': 'https://example.com/docs/keys'},
    {'id': 4, 'title': 'The migration ran clean', 'detail': 'The schema is current.', 'kind': 'info'},
]

# The rows the pane draws at 60 columns for the items in tests/register.test.tsx's "rows count the section headers, LATER among them".
ROWS_THREE_KINDS = 8
ROWS_ONE_KIND = 4
# The terminal's columns that give the pane's body those 60.
UNIT_COLUMNS = 64

# A reply longer than its field's row, with a word longer than the row too.
DRAFT = 'Two failures: LoginTests.testExpiredToken and CartTests.testCouponRounding'

# A reply holding the hotkeys of Done, Later, option 1 and Back.
HOTKEY_WORDS = 'done later, 1 of b'

# The most characters a message may have (MAX_DETAIL in hooks/tasks.ts).
MAX_DETAIL = 4000


def long_message(n):
    """A message of the most characters a reply may have, its end saying which it is."""
    end = f' End of message {n}.'
    return (f'Message {n}. ' + 'word ' * 800)[: MAX_DETAIL - len(end)] + end


# More text than the item screen draws of a thread (THREAD_CHARS in hooks/pane.ts): it leaves the oldest messages out.
LONG_THREAD = [
    {
        'id': 1,
        'title': 'Pick the runner for the nightly build',
        'detail': 'The nightly build needs a runner.',
        'kind': 'question',
        'ageMs': 3_600_000,
        'thread': [{'from': 'user' if n % 2 else 'claude', 'text': long_message(n), 'agoMs': (41 - n) * 60_000} for n in range(1, 41)],
    }
]
HIDDEN = re.compile(r'\d+ earlier messages are not shown: the thread is too long for the pane\.')

# A decision as 0.3 adds one: an ask, a note under each option, Markdown in its
# detail, and a recommended option whose label leaves its mark no room beside it.
CARDS = {
    'id': 1,
    'kind': 'decision',
    'title': 'Pick the database for the reporting service',
    'detail': 'The reporting service needs a store.\n\n- It runs **nightly**\n- It reads `events`',
    'askLine': 'Which database should the reporting service use?',
    'options': ['Postgres', 'SQLite on the box', 'ClickHouse cluster that the data team runs for analytics'],
    'optionNotes': ['We know it, and it backs up nightly.', 'No server to run, but one writer at a time.', 'Fast for scans; the data team owns it.'],
    'recommended': 'ClickHouse cluster that the data team runs for analytics',
    'isMarkdown': True,
}
RECOMMENDED_MARK = '  ★ recommended'

# A 0.3 action: a code block, and a link that is not https.
CODE_LINES = ('for f in logs/*.log; do', '  grep -c \'^ERROR\' "$f"; done')
CODE = {
    'id': 1,
    'title': 'Count the errors in the staging logs',
    'detail': 'Run it on staging, then paste the counts.\n\n```sh\n' + '\n'.join(CODE_LINES) + '\n```\n\nThe flags are in the [docs](http://a.b).',
    'isMarkdown': True,
}

# Saved before 0.3: what Markdown would read as emphasis, a tag, a list and a heading, each line drawn as written.
OLDER_LINES = ('Match *.ts files under src_old, not **all** of them.', 'Replace <name> with the user name.', '1. This line is not a list.', '# This line is not a heading.')
OLDER = {'id': 1, 'kind': 'question', 'title': 'Which files does the glob match?', 'detail': '\n'.join(OLDER_LINES)}

# What the link rule (safeLinksOf in hooks/pane.ts) was checked on: the review's cases, the forms the engine
# links, code, and rewrites that join brackets into a new link. Each is seeded unchanged.
LINK_CASES = [
    ('rawctl', '[control](http://rawctl.test)'),
    ('ctlhttps', '[control](https://ctlhttps.test)'),
    ('ctlhttp', '[control](http://ctlhttp.test)'),
    ('ctlfile', '[control](file:///ctlfile/x)'),
    ('c01', '[`setup.sh`](file:///c01/etc/passwd)'),
    ('c02', '[see [docs] here](http://c02.test)'),
    ('c03', '[a\\]b](http://c03.test)'),
    ('c04', '[a](https://ok.test [b](http://c04.test)'),
    ('c05', '\\`[click](http://c05.test)`'),
    ('c06', '[click](http://c06.test/`x`)'),
    ('c07', '[click\nhere](http://c07.test)'),
    ('c08', '[click](\nhttp://c08.test)'),
    ('c09', 'text\n\n    ```\n[click](http://c09.test)'),
    ('c10', '```x`\n[click](http://c10.test)'),
    ('c11', '````\n```\n````\n[click](http://c11.test)\n```'),
    ('c12', '```\n```x\n```\n[click](http://c12.test)\n```'),
    ('c13', '- item\n  ```\n  code\n[click](http://c13.test)'),
    ('c14', '> [id]: http://c14.test\n\n[click][id]'),
    ('c15', '[id]:\nhttp://c15.test\n\n[click][id]'),
    ('c16', '- [id]: http://c16.test\n\n[click][id]'),
    ('c17', '[![badge](https://ok.test/i.png)](http://c17.test)'),
    ('c18', '<a href="http://c18.test">click</a>'),
    ('c19', '[id]: http://c19.test\n\n[click][id]'),
    ('c20', '[click](http://c20.test "title")'),
    ('c21', '<C:\\Users> and \\<http://c21.test>'),
    ('c22', '[note]: some prose here\n\n[^1]: footnote text'),
    ('c23', '````\n```\n[x](http://c23.test)\n```\n````'),
    ('c24', '> ```\n> [x](http://c24.test)\n> ```'),
    ('c25', '~~~\n[x](http://c25.test)\n```\n[x](http://c25b.test)\n~~~'),
    ('c26', '   [id]: http://c26.test "title"\n\n[click][id]'),
    ('c27', '![alt](http://c27.test/i.png)'),
    ('a01', 'y][http://a01q z](http://a01.test)'),
    ('a02', 'x][(http://a02a.test)](http://a02.test)'),
    ('a03', '[[a](http://a03b.test)](http://a03.test)'),
    ('a04', '[a](<http://a04b.test>)](http://a04.test)'),
    ('a05', '](<<http://a05.test>>'),
    ('a06', '<<<http://a06.test>>>'),
    ('a07', '\\\\[x](http://a07.test)'),
    ('a08', '[x\\\\](http://a08.test)'),
    ('a09', '<' * 20 + 'http://a09.test'),
    ('a10', '[x](' * 30 + 'http://a10.test' + ')' * 30),
    ('a11', '[a][a][a][a][a][a][a][a][a][a](http://a11.test)'),
    ('a12', '```\n[x](http://a12.test)\n```'),
    ('a13', 'use `[x](http://a13.test)` here'),
    ('p01', '[x](http\\://p01.test)'),
    ('p02', '[x](&#104;ttp://p02.test)'),
    ('p03', '[x] (http://p03.test)'),
    ('p04', '<a href="http://p04.test">x</a>'),
    ('p05', '[x](ftp://p05.test)'),
    ('p06', '[x](mailto:a@p06.test)'),
    ('p07', '[x](//p07.test)'),
    ('p08', '[x](file\\:///p08/x)'),
    ('p09', '[x](http:\\/\\/p09.test)'),
    ('p10', '[x](&#x68;ttp://p10.test)'),
    ('p11', '[x](http&#58;//p11.test)'),
    ('p12', '[x](< http://p12.test>)'),
    ('p13', '[x](http&colon;//p13.test)'),
    ('p14', '[x](<ht\ttp://p14.test>)'),
    ('p15', '[x](\u200bhttp://p15.test)'),
    ('p16', '[x](%68ttp://p16.test)'),
    ('p17', '[x](/p17/etc/passwd)'),
    ('p18', '[x](./p18/a.ts)'),
    ('p19', '[x](p19/a.ts)'),
    ('p20', 'see www.p20.test now'),
    ('p21', '[x](<http://p21.test>)'),
    ('p22', '[x](HtTp://p22.test)'),
    ('p23', '[x](javascript:alert(23))'),
    ('p24', '[x]: http://p24.test\n\n[x] and [y][x]'),
    ('p25', '<HTTP://p25.test>'),
    ('p26', '<file:///p26/x>'),
    ('p27', '[x](<file:///p27/x>)'),
    ('p28', '[x](\xa0http://p28.test)'),
    ('p29', '[x](file:/p29/x)'),
    ('p30', '[x](http:p30.test)'),
    ('p31', '[x](<http\\://p31.test>)'),
    ('p32', '[x](\\http://p32.test)'),
    ('q01', 'handlers[name](q01event)'),
    ('q02', '`handlers[name](q02event)`'),
    ('q03', '```\nhandlers[name](q03event)\n```'),
    ('q04', '[x](q04.test)'),
    ('q05', '[x](~/q05/x)'),
    ('q06', '[x](#q06)'),
    ('q07', '[x](?q07)'),
    ('q08', '[x](C:\\q08\\x)'),
    ('q09', '[x](\\\\q09\\share)'),
    ('q10', '[x](../q10/a)'),
    ('q11', '<http\\://q11.test>'),
    ('q12', '[x](q12)'),
    ('q13', '[x](/q13)'),
    ('q15', '[`setup.sh`](/q15/etc/passwd)'),
    ('q16', '[x](%2Fq16/x)'),
    ('q17', '[x](\\/q17/x)'),
    ('q18', '[x](h\\ttp://q18.test)'),
    ('q19', '[x](<q19/a b>)'),
    ('q20', '[x](q20.ts)'),
    ('q21', '[x](HTTPS\\://q21.test)'),
    ('k1', '[x](<https://k1.test>)'),
    ('k2', '[x](\nhttps://k2.test)'),
    ('k3', '[x](\xa0https://k3.test)'),
    ('k4', '[x](\u3000https://k4.test)'),
    ('k5', '[x]( <https://k5.test>)'),
    ('k6', '[x](<https://k6.test)'),
    ('k7', '[x](https:/k7/etc/passwd)'),
    ('k8', '[x](https:k8)'),
    ('r01', '[id]: /r01/etc/passwd\n\n[click][id]'),
    ('r02', '[id]: r02rel\n\n[click][id]'),
    ('r03', '[id]: http://r03.test\n\n[click][id]'),
    ('r04', '[id]: /r04/x\n\nsee [id] here'),
    ('r05', '[id]: /r05/x\n\nsee [id][] here'),
    ('r06', '[id]: r06rel\n\nsee [id] and [id][] here'),
    ('r07', '[id]: http://r07.test\n\nsee [id] and [id][] here'),
    ('r08', '> [id]: /r08/x\n\n[click][id]'),
    ('r09', '> [id]: /r09/x\n>\n> [click][id]'),
    ('r10', '- [id]: /r10/x\n\n[click][id]'),
    ('r11', '- [id]: /r11/x\n- [click][id]'),
    ('r12', '> [id]: http://r12.test\n\n[click][id] [id]'),
    ('r13', '[id]: </r13/x>\n\n[click][id]'),
    ('r14', '[click][id]\n\n[id]: /r14/x'),
    ('r15', '[ID]: http://r15.test "t"\n\n[click][id]'),

]
# Reference links to targets that are not https, the definition written plain, under a quote and under a list item.
REFERENCES = [
    (f'{place}-{target_name}-{form_name}', f'{prefix}[id]: {target}\n\n{form}')
    for place, prefix in (('plain', ''), ('quote', '> '), ('list', '- '))
    for target_name, target in (('passwd', '/q/etc/passwd'), ('relative', 'relative'), ('http', 'http://x'))
    for form_name, form in (('full', '[click][id]'), ('shortcut', '[id]'), ('collapsed', '[id][]'))
]
# Docked, wide and tall enough that an item of LINK_BATCH cases shows whole.
LINK_SCREEN = (200, 250)
LINK_BATCH = 30


def flat(text):
    """Text as one line: the pane's wrapping and the frame's padding gone."""
    return re.sub(r'\s+', ' ', text).strip()


def joined(body):
    """The pane's body read as prose: its rows joined, the glyphs and indents gone."""
    return flat(' '.join(re.sub(r'^[☐✓✗]\s', '', row.strip()) for row in body))


def prose(body):
    """The pane's body read as prose, the borders of its boxes gone too."""
    return joined(re.sub('[╭╮╰╯│─]', '', row) for row in body)


def marked(name, text):
    """`text` as one message of its own, between markers that say which case drew what."""
    return f'BEGIN-{name}\n\n{text}\n\nEND-{name}'


def link_kind(target, text):
    """What a hyperlink shows of where it goes: `https`, its target as its text, or `HIDDEN`."""
    if target.lower().startswith('https:'):
        return 'https'
    if text == target:
        return 'shown'
    # A bare `www.` address, linked with the scheme the text leaves out.
    if target == f'http://{text}':
        return 'shown-noscheme'
    return 'HIDDEN'


def box_backgrounds(styled):
    """Each box whole in the pane's body, in order: the text of each row inside it, and the backgrounds its inner cells are drawn on."""
    lines = styled.split('\n')
    plain = [text_of(line) for line in lines]
    is_framed = frame_top(plain) is not None
    found, inside = [], None
    for i, start in body_rows(plain):
        # Framed, past the frame's border and padding.
        start, end = (plain[i].index('│') + 2, plain[i].rindex('│') - 1) if is_framed else (start, len(plain[i]))
        row = plain[i][start:end]
        edge = row.strip()[:1]
        if edge == '╭':
            inside = ([], set())
        elif edge == '╰' and inside is not None:
            found.append(inside)
            inside = None
        elif edge == '│' and inside is not None:
            left, right = start + row.index('│'), start + row.rindex('│')
            inside[0].append(plain[i][left + 1 : right].strip())
            inside[1].update(style.get('bg') for style in styles_of(lines[i])[left + 1 : right])
    return found


def boxes(body):
    """Each box whose top and bottom border are both in `body`, in order: the text of each row inside, stripped."""
    found, inside = [], None
    for row in (row.strip() for row in body):
        if row.startswith('╭'):
            inside = []
        elif row.startswith('╰') and inside is not None:
            found.append(inside)
            inside = None
        elif inside is not None:
            inside.append(row[1:-1].strip())
    return found


def unspaced(text):
    """Text with no spaces: a word longer than a row, or a CJK title, breaks anywhere."""
    return re.sub(r'\s+', '', text)


def list_row(n):
    """Row `n` of a 40-item list, its number as wide as #40."""
    return f'{f"#{n}":<3} Action number {n}'


class Live(unittest.TestCase):
    @contextlib.contextmanager
    def opened(self, tasks, columns, rows=HEIGHT, env=None):
        """A session started again with `tasks` saved, in a terminal `columns` by `rows`, with its pane open."""
        claude = Claude(ROOT, env=env)
        self.reads = 0
        try:
            claude.seed(tasks)
            claude.open_pane(columns, rows)
            yield claude
        finally:
            claude.close()

    def look(self, claude, columns, *keys, pause=0.5):
        """The pane's body after `keys`, and what a failure shows of it; the whole screen is kept as `self.last`."""
        if keys:
            claude.press(*keys, pause=pause)
        self.reads += 1
        # Text typed goes by `typed` in the name, a key by its own.
        step = ('typed' if ' ' in keys[-1] else keys[-1]) if keys else 'opened'
        self.last = claude.read(f'{self._testMethodName}-{columns}-{self.reads:02d}-{step}')
        body = pane_body(self.last)
        context = f'at {columns} columns the pane drew {placement(self.last)}:\n' + '\n'.join(body)
        self.assertEqual(placement(self.last), 'dock' if columns >= DOCK_FROM else 'inline', context)
        return body, context

    def draw(self, tasks, columns, keys=()):
        with self.opened(tasks, columns) as claude:
            return self.look(claude, columns, *keys)

    def assert_fits(self, body, context, columns):
        # The foot ends what is drawn, Hide in its first row and the hint
        # whole: none cut off below it. No row above it is empty but the one
        # a field out of the keys squeezes its label onto and, on an item
        # screen, one between two of its parts; framed, nothing follows it
        # either: no row asked for and left empty.
        rows = [row.strip() for row in body]
        last = max(i for i, row in enumerate(rows) if row)
        foot = max(i for i, row in enumerate(rows) if 'Hide' in row)
        hint = flat(' '.join(rows[foot : last + 1]).replace('b: Back', '').replace('Hide', ''))
        is_item = 'b: Back' in ' '.join(rows[foot : last + 1])
        gaps = [
            i
            for i, row in enumerate(rows[:last])
            if row == ''
            and not (i > 0 and rows[i - 1].startswith('Reply:') and '⏎ send' not in rows[i - 1])
            and not (is_item and i > 0 and rows[i - 1] and rows[i + 1])
        ]

        self.assertIn(hint, HINTS, 'the pane is cut off\n' + context)
        self.assertEqual(gaps, [], 'a row asked for and left empty\n' + context)
        if columns < DOCK_FROM:
            self.assertEqual(last, len(rows) - 1, 'a row asked for and left empty\n' + context)

    def assert_rows(self, body, rows, context):
        """`rows`, each a number and its title, are the list's rows in order, each on one line, the title cut short with `…` where it does not fit."""
        lines = [row.strip() for row in body]
        first = next(i for i, row in enumerate(lines) if row in LABELS)
        foot = max(i for i, row in enumerate(lines) if 'Hide' in row)
        drawn = [row for row in lines[first:foot] if row not in LABELS]

        self.assertEqual([row.split(' ')[0] for row in drawn], [f'#{n}' for n, _ in rows], 'a row takes more than one line\n' + context)
        for row, (_, title) in zip(drawn, rows):
            text = row.split(' ', 1)[1].strip()
            shown = text[:-1].rstrip() if text.endswith('…') else text
            self.assertTrue(title.startswith(shown) and (shown == title or text.endswith('…')), f'{row!r} is not the start of {title!r}\n' + context)

    def assert_title(self, body, task, age, context):
        """The item screen starts with its header box: `task`'s kind, number and `age` on its first line, then its title whole, each row at the box's padding."""
        rows = [row.strip() for row in body]
        self.assertTrue(rows[0].startswith('╭'), 'no header box at the top\n' + context)
        bottom = next(i for i, row in enumerate(rows) if row.startswith('╰'))
        first, *title = [row[1:-1] for row in rows[1:bottom]]

        self.assertEqual(flat(first), f"{KIND_LABELS[task.get('kind', 'action')]} #{task['id']} {age}", context)
        for row in title:
            self.assertTrue(row.startswith(' ') and not row.startswith('  '), 'a title row out of line\n' + context)
        self.assertEqual(unspaced(''.join(title)), unspaced(task['title']), context)

    def whole(self, claude, columns, body, context):
        """
        All of the item screen `body` shows: `body` itself when docked, or
        framed in fewer than 18 rows. A full framed pane may hold an item
        taller than it: its rows from Home and from End put together, the ring
        moved off the field, and End's context.
        """
        if columns >= DOCK_FROM or len(body) < FRAMED_ROWS:
            return body, context
        top, _ = self.look(claude, columns, 'Tab', 'Home')
        end, context = self.look(claude, columns, 'End')
        windows = '\n'.join(top) + '\n---\n' + '\n'.join(end)
        shift = next((n for n in range(len(top)) if top[n:] == end[: len(top) - n]), None)

        self.assertEqual((len(top), len(end)), (FRAMED_ROWS, FRAMED_ROWS), windows)
        self.assertIsNotNone(shift, 'Home and End share no row: the item is taller than two windows\n' + windows)
        return top + end[len(top) - shift :], context

    def assert_whole_rows(self, body, context):
        """Each row of a box ends on its right border: none is cut at the pane's side, or drawn past the border."""
        for row in (row.strip() for row in body):
            if row[:1] in ('╭', '│', '╰'):
                self.assertEqual(row[-1], {'╭': '╮', '│': '│', '╰': '╯'}[row[0]], f'{row!r} does not end on its border\n' + context)

    def reply_rows(self, body):
        """The rows the reply field's label starts: `Reply: `, or `Reply:` where the field squeezes it."""
        return [row for row in body if row.startswith('Reply:')]

    def without_field(self, body):
        """The rows of `body` but the reply field's, whose hint shows who has the keys, and the empty ones."""
        return [row for row in body if row.strip() and not row.startswith('Reply:')]


class List(Live):
    def test_rows_take_one_line_each_and_an_opened_item_shows_its_title_whole_with_its_age_after_it(self):
        tasks = {task['id']: task for task in TITLED}
        titles = {n: task['title'] for n, task in tasks.items()}
        for columns in WIDTHS:
            with self.subTest(columns=columns), self.opened(TITLED, columns) as claude:
                body, context = self.look(claude, columns)

                self.assert_fits(body, context, columns)
                self.assert_rows(body, [(n, titles[n]) for n in TITLED_ORDER], context)

                # Either side of the dock, the list alone.
                if columns in (48, 109, 144):
                    continue

                # ↓ from the ring on nothing, or on the row just left, reaches the next row.
                for n in TITLED_ORDER:
                    body, context = self.whole(claude, columns, *self.look(claude, columns, 'Down', 'Enter', pause=0.3))

                    self.assert_fits(body, context, columns)
                    self.assert_title(body, tasks[n], '3m', context)
                    claude.press('Tab', 'b', pause=0.3)

    def test_sections_group_the_four_kinds_then_later_and_rows_carry_their_marks(self):
        items = [
            {'id': 1, 'title': 'Note one', 'detail': 'Nothing to do.', 'kind': 'info'},
            {'id': 2, 'title': 'Which branch holds the fix?', 'detail': 'Two candidates.', 'kind': 'question', 'hasNewReply': True, 'thread': [{'from': 'claude', 'text': 'Maybe the second.'}]},
            {'id': 3, 'title': 'Add the key to the env file', 'detail': 'The test needs it.', 'isWaitingForClaude': True, 'thread': [{'from': 'user', 'text': 'Which env file?'}]},
            {'id': 4, 'title': 'Ship the rewrite', 'detail': 'It unblocks the release.', 'kind': 'decision', 'options': ['Go', 'No']},
            {'id': 5, 'title': 'Rotate the deploy key', 'detail': 'It leaked.', 'state': 'later'},
        ]
        # An item waiting for Claude is not counted.
        head = '1 decision · 1 question · 1 info · ● 1 reply · 1 later'
        for columns in (48, 100, 120):
            with self.subTest(columns=columns), self.opened(items, columns) as claude:
                body, context = self.look(claude, columns)
                text = joined(body)
                rows = [row.strip() for row in body]

                self.assert_fits(body, context, columns)
                self.assertTrue(text.startswith(head), context)
                positions = [text.index(word) for word in ('DECISIONS', '#4', 'QUESTIONS', '#2', 'ACTIONS', '#3', 'INFO', '#1', 'LATER', '#5')]
                self.assertEqual(positions, sorted(positions), context)
                self.assertIn('#2 Which branch holds the fix?  ●', rows, context)
                # The mark stays whole; the title gives way.
                self.assertTrue(any(row.startswith('#3 Add the') and row.endswith('  ⋯ waiting for Claude') for row in rows), context)
                if columns == 100:
                    self.assertIn(f'open-items: ☐ {head} · /open-items', self.last, self.last)

                # Opened, Claude's reply is read: its mark and count go.
                body, context = self.look(claude, columns, 'Down', 'Down', 'Enter')

                self.assertIn('Maybe the second.', joined(body), context)
                body, context = self.look(claude, columns, 'Tab', 'b')

                self.assertIn('#2 Which branch holds the fix?', [row.strip() for row in body], context)
                self.assertTrue(joined(body).startswith('1 decision · 1 question · 1 info · 1 later'), context)

    def test_items_moving_to_a_new_session_are_drawn_read_only_under_their_own_label(self):
        items = [
            {'id': 1, 'title': 'Add the key to the env file', 'detail': 'The test needs it.'},
            {'id': 2, 'title': 'Which branch holds the fix?', 'detail': 'Two candidates.', 'kind': 'question', 'state': 'handing-off'},
            {'id': 3, 'title': LONG, 'detail': 'It leaked.', 'state': 'handing-off'},
        ]
        for columns in (64, 144):
            with self.subTest(columns=columns), self.opened(items, columns) as claude:
                body, context = self.look(claude, columns)
                rows = [row.strip() for row in body]
                text = joined(body)

                self.assert_fits(body, context, columns)
                positions = [text.index(word) for word in ('ACTIONS', '#1', 'Moving to a new session', '#2', '#3')]
                self.assertEqual(positions, sorted(positions), context)
                self.assertIn('#2 Which branch holds the fix?', rows, context)
                # One line each, a long title cut short.
                self.assertTrue(any(row.startswith('#3 Rotate the deploy key') and row.endswith('…') for row in rows), context)

                # No press there could reach the Claude they go to: the ring passes them by.
                claude.press('Down', 'Down', 'Down')
                self.assertFalse(any('#2' in run or '#3' in run for run in claude.ring()), context)

    def test_the_rows_the_unit_test_counts_for_three_kinds_are_the_rows_drawn(self):
        three = [{'id': n, 'title': f'Item number {n}', 'detail': 'A reason.', 'kind': kind} for n, kind in ((1, 'info'), (2, 'question'), (3, 'decision'))]
        three[2]['options'] = ['Ship it', 'Hold']
        later = {**three[1], 'state': 'later'}
        for items, rows in ((three, ROWS_THREE_KINDS), (three[1:2], ROWS_ONE_KIND), ([three[0], later], ROWS_ONE_KIND + 2)):
            with self.subTest(items=len(items), rows=rows):
                body, context = self.draw(items, UNIT_COLUMNS)

                self.assert_fits(body, context, UNIT_COLUMNS)
                self.assertEqual(len(body), rows, context)


class Arrows(Live):
    def walk(self, claude, start, end):
        """↓ from row `start` to row `end`, one press at a time: the ring is on each row in turn, and in view."""
        for n in range(start + 1, end + 1):
            claude.press('Down', pause=0.1)
            self.assertEqual(claude.wait_ring([list_row(n)]), [list_row(n)], f'↓ to row {n}')

    def test_down_walks_the_ring_through_a_long_list_row_by_row_and_the_window_follows_it(self):
        forty = [{'id': n, 'title': f'Action number {n}', 'detail': 'A reason.'} for n in range(1, 41)]
        # Rows past what the window shows at first.
        for (columns, rows), last in ((INLINE, 20), (DOCKED, 34)):
            with self.subTest(columns=columns), self.opened(forty, columns, rows) as claude:
                body, context = self.look(claude, columns)

                if columns < DOCK_FROM:
                    self.assertEqual(len(body), 18, context)
                self.assertEqual(claude.ring(), [], context)
                claude.take_keys()
                self.walk(claude, 0, last)

                # A held ↓: the terminal repeats the key 30 times a second.
                for _ in range(5):
                    run('tmux', 'send-keys', '-t', claude.session, 'Down')
                    time.sleep(0.03)
                self.assertEqual(claude.wait_ring([list_row(last + 5)]), [list_row(last + 5)], 'a held ↓')

                # ↓ then ↑ as fast as they come, and ↓ ↓ ↑.
                run('tmux', 'send-keys', '-t', claude.session, 'Down')
                run('tmux', 'send-keys', '-t', claude.session, 'Up')
                self.assertEqual(claude.wait_ring([list_row(last + 5)]), [list_row(last + 5)], 'a fast ↓ ↑')
                for key in ('Down', 'Down', 'Up'):
                    run('tmux', 'send-keys', '-t', claude.session, key)
                self.assertEqual(claude.wait_ring([list_row(last + 6)]), [list_row(last + 6)], 'a fast ↓ ↓ ↑')

                body, context = self.look(claude, columns)
                if columns < DOCK_FROM:
                    self.assertEqual(len(body), 18, context)
                self.assertIn(list_row(last + 6), [row.strip() for row in body], context)

    def test_a_closed_item_leaves_the_ring_on_the_row_after_it_and_later_on_its_own_row(self):
        forty = [{'id': n, 'title': f'Action number {n}', 'detail': 'A reason.'} for n in range(1, 41)]
        for columns, rows in (INLINE, DOCKED):
            with self.subTest(columns=columns), self.opened(forty, columns, rows) as claude:
                claude.take_keys()
                self.walk(claude, 0, 3)
                # Done from Back, the field behind it.
                body, context = self.look(claude, columns, 'Enter', 'Tab', 'd')

                self.assertNotIn(list_row(3), [row.strip() for row in body], context)
                self.assertEqual(claude.wait_ring([list_row(4)]), [list_row(4)], context)
                claude.press('Down')

                self.assertEqual(claude.wait_ring([list_row(5)]), [list_row(5)])
                body, context = self.look(claude, columns, 'Enter', 'Tab', 'l')

                # Under LATER, the list's last row now, in view.
                self.assertEqual([row.strip() for row in body if row.strip()][-2:], ['LATER', list_row(5)], context)
                self.assertEqual(claude.wait_ring([list_row(5)]), [list_row(5)], context)
                claude.press('Up')

                self.assertEqual(claude.wait_ring([list_row(40)]), [list_row(40)])
                body, context = self.look(claude, columns, 'Down', 'Enter', 'Tab', 'd')

                # Done on the last row: the ring goes to the row before it.
                self.assertNotIn('LATER', [row.strip() for row in body], context)
                self.assertEqual(claude.wait_ring([list_row(40)]), [list_row(40)], context)

    # The engine sums the arrows that come while the pane's scroll hook still
    # answers one into a single move of `by` rows.
    def test_arrows_that_reach_the_engine_at_once_move_the_ring_a_row_for_each(self):
        forty = [{'id': n, 'title': f'Action number {n}', 'detail': 'A reason.'} for n in range(1, 41)]
        with self.opened(forty, *INLINE) as claude:
            claude.press('Down')
            self.assertEqual(claude.wait_ring([list_row(1)]), [list_row(1)])
            run('tmux', 'send-keys', '-t', claude.session, *['Down'] * 5)

            self.assertEqual(claude.wait_ring([list_row(6)]), [list_row(6)])


class Item(Live):
    def test_an_item_screen_draws_the_buttons_of_its_kind_and_fits_them(self):
        for columns in (36, 100):
            with self.subTest(columns=columns), self.opened(KINDS, columns) as claude:
                body, context = self.whole(claude, columns, *self.look(claude, columns, 'Down', 'Enter'))
                text = joined(body)

                self.assert_fits(body, context, columns)
                self.assertTrue(any(row.strip().startswith('│ 1: Yes  ★ recommended') for row in body), context)
                self.assertIn('2: Not yet', text, context)
                self.assertIn('l: Later', text, context)
                self.assertIn('Long answer…', text, context)
                self.assertNotIn('d: Done', text, context)
                self.assertTrue(self.reply_rows(body), context)
                body, context = self.look(claude, columns, 'Tab', 'b', 'Down', 'Enter')
                text = joined(body)

                # A question asks for words only.
                self.assert_fits(body, context, columns)
                self.assertIn('l: Later', text, context)
                self.assertIn('Long answer…', text, context)
                self.assertNotRegex(text, r'\b(\d|d): ', context)
                self.assertTrue(self.reply_rows(body), context)
                body, context = self.look(claude, columns, 'Tab', 'b', 'Down', 'Enter')
                text = joined(body)

                self.assert_fits(body, context, columns)
                self.assertIn('d: Done', text, context)
                self.assertIn('l: Later', text, context)
                self.assertIn('Done when: The test passes.', text, context)
                # Wrapped where the row ends, the link whole.
                self.assertIn('Details:https://example.com/docs/keys', unspaced(text), context)
                self.assertTrue(self.reply_rows(body), context)
                body, context = self.look(claude, columns, 'Tab', 'b', 'Down', 'Enter')
                text = joined(body)

                # An info item asks nothing: Seen alone, no field, and the ring on Back.
                self.assert_fits(body, context, columns)
                self.assertIn('d: Seen', text, context)
                self.assertNotIn('l: Later', text, context)
                self.assertNotIn('Long answer…', text, context)
                self.assertFalse(self.reply_rows(body), context)
                self.assertEqual(claude.ring(), ['b: Back'], context)

    def test_a_thread_draws_each_message_under_its_head_and_each_line_on_a_row_of_its_own(self):
        later = [
            {
                'id': 1,
                'title': 'Which runner failed?',
                'detail': 'One of three runners failed.',
                'kind': 'question',
                'state': 'later',
                'hasNewReply': True,
                'link': 'https://example.com/builds/nightly',
                'thread': [
                    {'from': 'user', 'text': 'Which runners ran it?', 'agoMs': 120_000},
                    {'from': 'claude', 'text': 'Runner A\nRunner B\nRunner C', 'agoMs': 60_000},
                    {'from': 'claude', 'text': '', 'event': 'changed', 'agoMs': 60_000},
                    {'from': 'user', 'text': '', 'event': 'later', 'agoMs': 60_000},
                ],
            }
        ]
        # From 48 columns: narrower, the item takes more than the 18 rows a framed pane shows.
        for columns in (48, 100, 144):
            with self.subTest(columns=columns), self.opened(later, columns) as claude:
                body, context = self.look(claude, columns)

                self.assert_fits(body, context, columns)
                self.assertTrue(joined(body).startswith('● 1 reply · 1 later LATER #1 Which runner failed? ●'), context)
                body, context = self.whole(claude, columns, *self.look(claude, columns, 'Down', 'Enter'))
                rows = [row.strip() for row in body]
                text = joined(body)

                self.assert_fits(body, context, columns)
                self.assert_title(body, later[0], '3m', context)
                self.assertEqual(rows[rows.index('Runner A') : rows.index('Runner A') + 3], ['Runner A', 'Runner B', 'Runner C'], context)
                order = ['One of three runners failed.', 'You · 2m', 'Which runners ran it?', 'Claude · 1m', 'Runner A', 'Claude changed the item · 1m', 'You pressed Later · 1m', 'Details:', 'Long answer…']
                positions = [text.index(words) for words in order]
                self.assertEqual(positions, sorted(positions), context)
                # Later already: the item offers no Later.
                self.assertNotIn('l: Later', text, context)
                body, context = self.look(claude, columns, 'Tab', 'b')

                self.assertTrue(joined(body).startswith('1 later LATER #1 Which runner failed? ↵'), context)

    def test_a_long_thread_scrolls_framed_at_18_rows_and_docked_and_back_stays_its_b(self):
        for columns, rows in (INLINE, DOCKED):
            with self.subTest(columns=columns), self.opened(LONG_THREAD, columns, rows) as claude:
                body, context = self.look(claude, columns, 'Down', 'Enter')
                text = joined(body)

                # The window follows the ring to the field: the newest message, the buttons and the field are in view.
                if columns < DOCK_FROM:
                    self.assertEqual(len(body), 18, context)
                self.assertIn('End of message 40.', text, context)
                self.assertIn('l: Later Long answer…', text, context)
                self.assertTrue(any('⏎ send' in row for row in self.reply_rows(body)), context)
                newest = body
                body, context = self.look(claude, columns, 'Up')

                # The field hands the ring to the button above it, and the window stays.
                self.assertEqual(claude.ring(), ['Long answer…'], context)
                self.assertEqual(self.without_field(body), self.without_field(newest), context)
                body, context = self.look(claude, columns, 'Up', 'Up')

                # From a button, ↑ scrolls the body.
                self.assertFalse(self.reply_rows(body), context)
                self.assertIn('End of message 40.', joined(body), context)
                body, context = self.look(claude, columns, 'Home')
                text = joined(body)

                # Drawn whole: the header, the detail, and the line for the messages left out.
                self.assert_title(body, LONG_THREAD[0], '1h', context)
                self.assertTrue(prose(body).startswith('QUESTION #1 1h Pick the runner for the nightly build The nightly build needs a runner.'), context)
                self.assertRegex(text, HIDDEN, context)
                body, context = self.look(claude, columns, 'End')

                self.assertIn('End of message 40.', joined(body), context)
                self.assertIn('b: Back', joined(body), context)
                self.assertTrue(body[-1].strip().endswith('Hide') if columns < DOCK_FROM else 'Hide' in joined(body), context)
                if columns < DOCK_FROM:
                    self.assertEqual(len(body), 18, context)
                body, context = self.look(claude, columns, 'b')

                self.assertEqual(claude.ring(), ['#1 Pick the runner for the nightly build'], context)


class Cards(Live):
    def options(self, body):
        """The option boxes whole in `body`, by number: the text of each row inside."""
        return {int(box[0][0]): box for box in boxes(body) if re.match(r'\d: ', box[0])}

    def tab_to(self, claude, wanted):
        """Tab until the ring is on the button `wanted`: some stops past Hide draw no ring."""
        for _ in range(8):
            claude.press('Tab', pause=0.2)
            if claude.wait_ring([wanted], timeout=2) == [wanted]:
                return
        self.fail(f'Tab never reached {wanted!r}: the ring is on {claude.ring()}')

    def assert_lit(self, styled, n, context):
        """Option `n`'s box is drawn on a background of its own, which no other option box whole on screen has."""
        found = {texts[0][0]: backgrounds for texts, backgrounds in box_backgrounds(styled) if re.match(r'\d: ', texts[0])}
        lit = found[str(n)]

        self.assertEqual(len(lit), 1, f'option {n} is drawn on {lit}\n' + context)
        self.assertNotIn(None, lit, f'option {n} is drawn on no background\n' + context)
        for other, backgrounds in found.items():
            if other != str(n):
                self.assertNotEqual(backgrounds, lit, f'option {other} is lit too\n' + context)

    def test_a_decision_docked_shows_whole_its_ask_first_and_a_box_for_each_option_with_its_note(self):
        columns = 150
        with self.opened([CARDS], columns) as claude:
            body, context = self.look(claude, columns, 'Down', 'Enter')
            rows = [row.strip() for row in body]
            ask = next(i for i, row in enumerate(rows) if row.startswith('▌ '))
            options = self.options(body)

            # One window, the header box first and the foot last.
            self.assert_fits(body, context, columns)
            self.assert_title(body, CARDS, '3m', context)
            self.assert_whole_rows(body, context)
            self.assertEqual(flat(' '.join(rows[ask : rows.index('', ask)])), f'▌ {CARDS["askLine"]}', context)
            self.assertEqual(sorted(options), [1, 2, 3], context)
            self.assertEqual([options[1][0], options[2][0]], [f'1: {CARDS["options"][0]}', f'2: {CARDS["options"][1]}'], context)
            self.assertEqual([options[n][-1] for n in (1, 2, 3)], CARDS['optionNotes'], context)
            self.tab_to(claude, '2: SQLite on the box')
            body, context = self.look(claude, columns)

            # The ring lights its option's box; the kind label, drawn on a color of its own, is not read as the ring.
            self.assertEqual(claude.ring(), ['2: SQLite on the box'], context)
            self.assert_lit(claude.styled, 2, context)

    def test_a_decision_taller_than_the_framed_pane_scrolls_from_its_header_to_its_last_option_box(self):
        columns = 100
        with self.opened([CARDS], columns) as claude:
            self.look(claude, columns, 'Down', 'Enter')
            # Off the field, which keeps Home and End for its text.
            top, context = self.look(claude, columns, 'Tab', 'Home')

            self.assertEqual(len(top), FRAMED_ROWS, context)
            self.assert_title(top, CARDS, '3m', context)
            self.assertIn(f'▌ {CARDS["askLine"]}', [row.strip() for row in top], context)
            self.assert_whole_rows(top, context)
            end, context = self.look(claude, columns, 'End')

            self.assertEqual(len(end), FRAMED_ROWS, context)
            self.assert_fits(end, context, columns)
            self.assertEqual(boxes(end)[-1], [f'3: {CARDS["options"][2]}{RECOMMENDED_MARK}', CARDS['optionNotes'][2]], context)
            self.assert_whole_rows(end, context)
            self.tab_to(claude, '2: SQLite on the box')
            _, context = self.look(claude, columns)

            self.assert_lit(claude.styled, 2, context)

    def test_the_recommended_mark_follows_a_long_label_whole_inside_its_box(self):
        label = f'3: {CARDS["options"][2]}'
        for columns in (24, 32, 100, 150):
            with self.subTest(columns=columns), self.opened([CARDS], columns) as claude:
                # The window follows the field, the last option box just above it.
                body, context = self.look(claude, columns, 'Down', 'Enter')
                box = next(box for box in boxes(body) if box[0].startswith(label[:6]))

                self.assert_whole_rows(body, context)
                self.assertIn(flat(label + RECOMMENDED_MARK), flat(' '.join(box[:-1])), context)

    def test_a_markdown_detail_draws_its_code_as_written_and_a_link_that_is_not_https_as_its_text_and_target(self):
        for columns in (100, 150):
            with self.subTest(columns=columns), self.opened([CODE], columns) as claude:
                body, context = self.look(claude, columns, 'Down', 'Enter')
                rows = [row.rstrip() for row in body]
                first = next(i for i, row in enumerate(rows) if row.endswith(CODE_LINES[0]))
                indent = len(rows[first]) - len(CODE_LINES[0])

                self.assert_fits(body, context, columns)
                self.assertEqual([row[indent:] for row in rows[first : first + len(CODE_LINES)]], list(CODE_LINES), context)
                self.assertIn('The flags are in the docs (http://a.b).', [row.strip() for row in rows], context)

    def test_an_item_saved_before_0_3_draws_each_line_of_its_detail_as_written(self):
        for columns in (100, 150):
            with self.subTest(columns=columns), self.opened([OLDER], columns) as claude:
                body, context = self.look(claude, columns, 'Down', 'Enter')
                rows = [row.strip() for row in body]
                start = rows.index(OLDER_LINES[0])

                self.assert_fits(body, context, columns)
                self.assert_title(body, OLDER, '3m', context)
                self.assertEqual(rows[start : start + len(OLDER_LINES)], list(OLDER_LINES), context)
                # No ask line: the item has none.
                self.assertFalse(any(row.startswith('▌') for row in rows), context)

    def test_no_link_in_claude_s_markdown_hides_a_target_that_is_not_https(self):
        cases = LINK_CASES + REFERENCES
        batches = [cases[k : k + LINK_BATCH] for k in range(0, len(cases), LINK_BATCH)]
        # A case to a message, as one case's open fence or definition would change the next ones.
        items = [
            {
                'id': n,
                'title': f'Links, part {n}',
                'isMarkdown': True,
                'detail': marked(*batch[0]),
                'thread': [{'from': 'claude', 'text': marked(*case)} for case in [*batch[1:], (f'control{n}', f'[control](https://control{n}.test)')]],
            }
            for n, batch in enumerate(batches, 1)
        ]
        columns, rows = LINK_SCREEN
        with self.opened(items, columns, rows, env={'FORCE_HYPERLINK': '1'}) as claude:
            for n, batch in enumerate(batches, 1):
                body, context = self.look(claude, columns, 'Down', 'Enter')
                links = [(target, text.strip()) for target, text, _ in hyperlinks_of(claude.styled)]
                missing = [name for name, _ in batch for mark in ('BEGIN', 'END') if not re.search(rf'{mark}-{re.escape(name)}(?![\w-])', self.last)]

                # The control shows the links are read: a link under text that is not its target.
                self.assertIn((f'https://control{n}.test', 'control'), links, context)
                self.assertEqual(missing, [], context)
                self.assertEqual([link for link in links if link_kind(*link) == 'HIDDEN'], [], context)
                claude.press('Tab', 'b')


class Keys(Live):
    def test_enter_opens_an_item_with_its_field_holding_the_keys_and_back_returns_to_its_row(self):
        items = [
            {'id': 1, 'title': 'Add the key to the env file', 'detail': 'The test needs it.'},
            {'id': 2, 'title': 'Which branch holds the fix?', 'detail': 'Two candidates.', 'kind': 'question'},
            {'id': 3, 'title': 'The migration ran clean', 'detail': 'The schema is current.', 'kind': 'info'},
        ]
        for columns, rows in (INLINE, DOCKED):
            with self.subTest(columns=columns), self.opened(items, columns, rows) as claude:
                claude.press('Down', 'Down')

                self.assertEqual(claude.wait_ring(['#1 Add the key to the env file']), ['#1 Add the key to the env file'])
                body, context = self.look(claude, columns, 'Enter')

                # The field takes the keys, so a hotkey typed there stays text.
                self.assert_title(body, items[0], '3m', context)
                self.assertTrue(any('⏎ send' in row for row in self.reply_rows(body)), context)
                self.assertEqual(claude.ring(), [], context)
                body, context = self.look(claude, columns, 'Tab')

                # Tab from the field reaches Back.
                self.assertEqual(claude.ring(), ['b: Back'], context)
                self.assertFalse(any('⏎ send' in row for row in self.reply_rows(body)), context)
                body, context = self.look(claude, columns, 'BTab')

                self.assertTrue(any('⏎ send' in row for row in self.reply_rows(body)), context)
                self.assertEqual(claude.ring(), [], context)
                body, context = self.look(claude, columns, 'Tab', 'b')

                # Back on the item's own row, and ↓ goes on from there.
                self.assertIn('QUESTIONS', [row.strip() for row in body], context)
                self.assertEqual(claude.ring(), ['#1 Add the key to the env file'], context)
                claude.press('Down')

                self.assertEqual(claude.wait_ring(['#3 The migration ran clean']), ['#3 The migration ran clean'])
                body, context = self.look(claude, columns, 'Enter')

                # No field to type in: the ring on Back, and Enter there goes back.
                self.assert_title(body, items[2], '3m', context)
                self.assertEqual(claude.ring(), ['b: Back'], context)
                body, context = self.look(claude, columns, 'Enter')

                self.assertIn('INFO', [row.strip() for row in body], context)
                self.assertEqual(claude.ring(), ['#3 The migration ran clean'], context)

    def test_a_reply_holding_the_hotkeys_goes_to_claude_and_presses_no_button(self):
        items = [
            {'id': 1, 'title': 'Add the key to the env file', 'detail': 'The test needs it.'},
            {'id': 2, 'title': 'Ship the rewrite', 'detail': 'It unblocks the release.', 'kind': 'decision', 'options': ['Go', 'Wait']},
        ]
        for columns, rows in (INLINE, DOCKED):
            with self.subTest(columns=columns), self.opened(items, columns, rows) as claude:
                # The decision first, then the action: each kind's own hotkeys.
                for keys, task in ((('Down', 'Enter'), items[1]), (('Tab', 'b', 'Down', 'Enter'), items[0])):
                    body, context = self.look(claude, columns, *keys, HOTKEY_WORDS)

                    self.assertTrue(any(HOTKEY_WORDS in row for row in self.reply_rows(body)), context)
                    claude.press('Enter')
                    wait_for(claude.session, lambda s: 'You · now' in s)
                    body, context = self.look(claude, columns)

                    # Sent as a reply: the field empty for the next, the item still open, and the reply in its thread.
                    self.assertTrue(any('Enter sends it to Claude' in row and '⏎ send' in row for row in self.reply_rows(body)), context)
                    body, context = self.whole(claude, columns, body, context)
                    text = joined(body)

                    self.assert_title(body, task, '3m · waiting for Claude', context)
                    self.assertIn(f'You · now {HOTKEY_WORDS}', text, context)
                    self.assertNotIn(' chose ', text, context)
                    self.assertNotIn(' pressed ', text, context)

                body, context = self.look(claude, columns, 'Tab', 'b')
                listed = [row.strip() for row in body]

                self.assertEqual(listed[:5], ['⋯ 2 waiting for Claude', 'DECISIONS', '#2 Ship the rewrite  ⋯ waiting for Claude', 'ACTIONS', '#1 Add the key to the env file  ⋯ waiting for Claude'], context)


class Field(Live):
    def test_the_reply_field_fits_empty_typed_in_and_out_of_the_keys(self):
        for columns in (36, 64, 110, 200):
            with self.subTest(columns=columns), self.opened(TASKS[1:2], columns) as claude:
                body, context = self.look(claude, columns, 'Down', 'Enter')

                # Across the body's whole width, which the terminal sizes a field by.
                self.assert_fits(body, context, columns)
                self.assertTrue(self.reply_rows(body), context)
                body, context = self.look(claude, columns, DRAFT)

                # Whole, wrapped beside the label, the hint after its first row. A full
                # framed pane holds an item taller than it: the window keeps the field,
                # and the foot is below.
                if columns >= DOCK_FROM or len(body) < FRAMED_ROWS:
                    self.assert_fits(body, context, columns)
                self.assertIn(unspaced(DRAFT), unspaced(joined(body).replace('⏎ send', '')), context)
                body, context = self.look(claude, columns, 'Tab')

                # Out of the keys, the field draws one row of its text, the label squeezed onto a second.
                self.assert_fits(body, context, columns)
                self.assertEqual(claude.ring(), ['b: Back'], context)

    def test_closed_and_opened_again_the_field_holds_what_was_typed_in_it(self):
        with self.opened(TASKS[1:2], 64) as claude:
            # ctrl+x x closes the pane as the person's close key does, and the
            # terminal forgets the field's text; /open-items opens it again.
            body, context = self.look(claude, 64, 'Down', 'Enter', DRAFT, 'C-x', 'x', '/open-items', 'Enter')

            # The ring starts on nothing: the field draws its text's start.
            self.assert_title(body, TASKS[1], '3m', context)
            self.assertEqual(claude.ring(), [], context)
            self.assertTrue(any(row.startswith('Reply:Two failures: LoginTests') and row.endswith('…') for row in self.reply_rows(body)), context)
            # Shift+Tab goes round to it from the foot.
            for _ in range(4):
                body, context = self.look(claude, 64, 'BTab')
                if any('⏎ send' in row for row in self.reply_rows(body)):
                    break

            self.assertTrue(any('⏎ send' in row for row in self.reply_rows(body)), context)
            self.assertIn(unspaced(DRAFT), unspaced(joined(body).replace('⏎ send', '')), context)


class Store(unittest.TestCase):
    def test_clear_starts_a_session_with_no_items_and_offers_the_ones_it_left(self):
        claude = Claude(ROOT)
        try:
            claude.seed(TASKS[:1])
            claude.start(100, 40, '--session-id', claude.session_id)
            wait_for(claude.session, lambda s: 'open-items: ☐' in s)
            claude.command('/clear')
            wait_for(claude.session, lambda s: 'open-items:' not in s)
            claude.command('/open-items')
            wait_for(claude.session, has_pane)
            screen = claude.read('test_clear_starts_a_session_with_no_items_and_offers_the_ones_it_left')
            body = joined(pane_body(screen))
            with open(claude.store_file()) as f:
                store = json.load(f)
        finally:
            claude.close()
        key = f'session:{claude.session_id}'

        # The session /clear started holds nothing, so it saved nothing; the one it ended is offered, not moved.
        self.assertEqual(list(store), [key], screen)
        self.assertEqual([task['id'] for task in store[key]['tasks']], [1], screen)
        self.assertIn('endedMs', store[key], screen)
        self.assertTrue(body.startswith('1 item left by an earlier session Take Dismiss'), body)

    def test_a_session_v01_saved_comes_back_with_its_open_items_and_keeps_its_unsent_answer(self):
        claude = Claude(ROOT)
        now_ms = int(time.time() * 1000)
        made = {'createdMs': now_ms - 180_000, 'updatedMs': now_ms - 120_000, 'sessionId': claude.session_id}
        # As v0.1 saved them: a reason in place of a thread, and an answer on a task it closed.
        claude.store(
            {
                'tasks': [
                    {**made, 'id': 1, 'kind': 'decision', 'title': 'Ship the rewrite', 'why': 'It unblocks the release.', 'options': ['Go', 'Wait'], 'state': 'open', 'update': 'none'},
                    {**made, 'id': 2, 'kind': 'question', 'title': 'Which runner failed?', 'why': 'The log is gone.', 'state': 'done', 'answer': 'Runner B', 'update': 'pending'},
                    {**made, 'id': 3, 'kind': 'action', 'title': 'Rotate the key', 'why': 'It leaked.', 'state': 'done', 'update': 'delivered'},
                ],
                'nextId': 4,
                'savedMs': now_ms,
            }
        )
        try:
            claude.open_pane(100, HEIGHT)
            listed = flat(' '.join(pane_body(claude.read())))
            claude.press('Down', 'Enter')
            opened = prose(pane_body(claude.read()))
            claude.stop()
            saved = claude.saved()
        finally:
            claude.close()
        items = {task['id']: task for task in saved['tasks']}

        self.assertTrue(listed.startswith('☐ 1 decision DECISIONS #1 Ship the rewrite ↵'), listed)
        self.assertTrue(opened.startswith('DECISION #1 3m Ship the rewrite It unblocks the release. 1: Go 2: Wait'), opened)
        self.assertEqual(saved['version'], 2, saved)
        self.assertEqual(sorted(items), [1, 2], saved)
        self.assertEqual((items[1]['state'], [message['text'] for message in items[1]['thread']]), ('open', ['It unblocks the release.']), saved)
        # Not sent yet: closed, its answer in its thread, still to go to Claude.
        self.assertEqual((items[2]['state'], items[2]['update']), ('resolved', 'pending'), saved)
        self.assertEqual([(message['from'], message['text']) for message in items[2]['thread']], [('claude', 'The log is gone.'), ('user', 'Runner B')], saved)


class TranscriptRow(unittest.TestCase):
    def test_the_label_stays_whole_and_the_title_wraps_after_it(self):
        for columns in (40, 64):
            with self.subTest(columns=columns):
                claude = Claude(ROOT)
                try:
                    tool_input = {'title': XCODE, 'detail': "I can't run Xcode here.", 'kind': 'question'}
                    screen = claude.transcript(columns, 40, tool_input, name=f'{self._testMethodName}-{columns}')
                finally:
                    claude.close()
                lines = screen.split('\n')
                start = next(i for i, line in enumerate(lines) if '☐' in line)
                row = flat(' '.join(lines[start : start + 4]).split('───')[0])

                self.assertIn('☐ Added an item for you: ', lines[start], screen)
                self.assertIn(f'☐ Added an item for you: {XCODE}', row, screen)


if __name__ == '__main__':
    unittest.main(verbosity=2)
