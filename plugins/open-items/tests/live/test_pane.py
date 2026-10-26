"""The Open items pane as a real Claude Code draws it, at narrow and wide widths.

Run with `python3 tests/live/test_pane.py` from the repository's root, with
`claude` and `tmux` on the PATH. Each case seeds the items a session saved,
starts that session again, opens /open-items in a terminal of the given size,
presses keys there and reads the screen back. The list draws a row per item,
cut to one line, in sections; an item opened with Enter draws its title
whole, its thread, the buttons of its kind and its reply field. Nothing is
cut off at the pane's bottom, and the pane asks for no rows it leaves empty.
Below 110 columns the pane is framed above the prompt, 18 rows at most; from
110 it docks beside the transcript. The focus ring is read from the inverse
video the engine draws it in. With RENDERS_DIR set, each screen a test reads
is kept there, and `tests/live/renders.py` lays them out. Two cases read the
store back: one after /clear, one after a session v0.1 saved.
"""

import contextlib
import json
import os
import re
import sys
import time
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from screen import Claude, pane_body, placement, run, wait_for  # noqa: E402

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


def flat(text):
    """Text as one line: the pane's wrapping and the frame's padding gone."""
    return re.sub(r'\s+', ' ', text).strip()


def joined(body):
    """The pane's body read as prose: its rows joined, the glyphs and indents gone."""
    return flat(' '.join(re.sub(r'^[☐✓✗]\s', '', row.strip()) for row in body))


def unspaced(text):
    """Text with no spaces: a word longer than a row, or a CJK title, breaks anywhere."""
    return re.sub(r'\s+', '', text)


def list_row(n):
    """Row `n` of a 40-item list, its number as wide as #40."""
    return f'{f"#{n}":<3} Action number {n}'


class Live(unittest.TestCase):
    @contextlib.contextmanager
    def opened(self, tasks, columns, rows=HEIGHT):
        """A session started again with `tasks` saved, in a terminal `columns` by `rows`, with its pane open."""
        claude = Claude(ROOT)
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
        # a field out of the keys squeezes its label onto; framed, nothing
        # follows it either: no row asked for and left empty.
        rows = [row.strip() for row in body]
        last = max(i for i, row in enumerate(rows) if row)
        foot = max(i for i, row in enumerate(rows) if 'Hide' in row)
        hint = flat(' '.join(rows[foot : last + 1]).replace('b: Back', '').replace('Hide', ''))
        gaps = [i for i, row in enumerate(rows[:last]) if row == '' and not (i > 0 and rows[i - 1].startswith('Reply:') and '⏎ send' not in rows[i - 1])]

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

    def assert_title(self, body, title, age, context):
        """The item screen's first rows hold `title` whole and `age` after it, each row after the first at the title's indent."""
        head = next(i for i, row in enumerate(body) if row.strip().startswith('Claude · '))
        rows = body[:head]
        # A title that fills its last row leaves the age a row of its own, its space before it kept.
        words = rows[1:-1] if rows[-1].strip() == age else rows[1:]

        self.assertTrue(rows[0].startswith('☐ '), context)
        for row in words:
            self.assertTrue(row.startswith('  ') and not row.startswith('   '), 'a title row out of line\n' + context)
        self.assertIn(unspaced(f'{title} {age}'), unspaced(joined(rows)), context)

    def reply_rows(self, body):
        """The rows the reply field's label starts: `Reply: `, or `Reply:` where the field squeezes it."""
        return [row for row in body if row.startswith('Reply:')]

    def without_field(self, body):
        """The rows of `body` but the reply field's, whose hint shows who has the keys, and the empty ones."""
        return [row for row in body if row.strip() and not row.startswith('Reply:')]


class List(Live):
    def test_rows_take_one_line_each_and_an_opened_item_shows_its_title_whole_with_its_age_after_it(self):
        titles = {task['id']: task['title'] for task in TITLED}
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
                    body, context = self.look(claude, columns, 'Down', 'Enter', pause=0.3)

                    self.assert_fits(body, context, columns)
                    self.assert_title(body, f'#{n} {titles[n]}', '3m', context)
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
    # answers one into a single move of `by` rows, which the hook passes on as
    # a scroll of the body: the ring moves one row for the five.
    @unittest.expectedFailure
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
                body, context = self.look(claude, columns, 'Down', 'Enter')
                text = joined(body)

                self.assert_fits(body, context, columns)
                self.assertIn('1: Yes (recommended)', text, context)
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
                body, context = self.look(claude, columns, 'Down', 'Enter')
                rows = [row.strip() for row in body]
                text = joined(body)

                self.assert_fits(body, context, columns)
                self.assertEqual(rows[rows.index('Runner A') : rows.index('Runner A') + 3], ['Runner A', 'Runner B', 'Runner C'], context)
                order = ['Claude · 3m', 'One of three runners failed.', 'You · 2m', 'Which runners ran it?', 'Claude · 1m', 'Runner A', 'Claude changed the item · 1m', 'You pressed Later · 1m', 'Details:', 'Long answer…']
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

                # Drawn whole: the head, the detail, and the line for the messages left out.
                self.assertTrue(text.startswith('#1 Pick the runner for the nightly build 1h Claude · 1h The nightly build needs a runner.'), context)
                self.assertRegex(text, HIDDEN, context)
                body, context = self.look(claude, columns, 'End')

                self.assertIn('End of message 40.', joined(body), context)
                self.assertIn('b: Back', joined(body), context)
                self.assertTrue(body[-1].strip().endswith('Hide') if columns < DOCK_FROM else 'Hide' in joined(body), context)
                if columns < DOCK_FROM:
                    self.assertEqual(len(body), 18, context)
                body, context = self.look(claude, columns, 'b')

                self.assertEqual(claude.ring(), ['#1 Pick the runner for the nightly build'], context)


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
                self.assertTrue(body[0].startswith('☐ #1 Add the key to the env file'), context)
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
                self.assertTrue(body[0].startswith('☐ #3 The migration ran clean'), context)
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
                for keys, title in ((('Down', 'Enter'), '#2 Ship the rewrite'), (('Tab', 'b', 'Down', 'Enter'), '#1 Add the key to the env file')):
                    body, context = self.look(claude, columns, *keys, HOTKEY_WORDS)

                    self.assertTrue(any(HOTKEY_WORDS in row for row in self.reply_rows(body)), context)
                    claude.press('Enter')
                    wait_for(claude.session, lambda s: 'You · now' in s)
                    body, context = self.look(claude, columns)
                    text = joined(body)

                    # Sent as a reply: still open, in its thread, and the field empty for the next.
                    self.assertTrue(text.startswith(f'{title} 3m · waiting for Claude'), context)
                    self.assertIn(f'You · now {HOTKEY_WORDS}', text, context)
                    self.assertNotIn(' chose ', text, context)
                    self.assertNotIn(' pressed ', text, context)
                    self.assertTrue(any('Enter sends it to Claude' in row and '⏎ send' in row for row in self.reply_rows(body)), context)

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

                # Whole, wrapped beside the label, the hint after its first row.
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
            self.assertTrue(body[0].startswith(f'☐ #2 {XCODE[:20]}'), context)
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
    def test_clear_starts_a_session_with_no_items_and_the_old_one_stays_saved(self):
        claude = Claude(ROOT)
        try:
            claude.seed(TASKS[:1])
            claude.start(100, 40, '--session-id', claude.session_id)
            wait_for(claude.session, lambda s: 'open-items: ☐' in s)
            claude.command('/clear')
            screen = wait_for(claude.session, lambda s: 'open-items:' not in s)
            with open(claude.store_file()) as f:
                store = json.load(f)
        finally:
            claude.close()
        key = f'session:{claude.session_id}'

        # The session /clear started holds nothing, so it saved nothing.
        self.assertEqual(list(store), [key], screen)
        self.assertEqual([task['id'] for task in store[key]['tasks']], [1], screen)

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
            opened = flat(' '.join(pane_body(claude.read())))
            claude.stop()
            saved = claude.saved()
        finally:
            claude.close()
        items = {task['id']: task for task in saved['tasks']}

        self.assertTrue(listed.startswith('☐ 1 decision DECISIONS #1 Ship the rewrite ↵'), listed)
        self.assertIn('Claude · 3m It unblocks the release.', opened, opened)
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
