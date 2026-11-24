"""Draws the Open items pane in a real Claude Code, in tmux, and prints the screen.

The test kit checks the tree the plugin returns, never how a terminal lays it
out. This runs the real engine instead: a throwaway config folder, the store
seeded with the items a session saved, that session started again, `/open-items`,
keys sent with `tmux send-keys`, and `tmux capture-pane` at the width asked for.
No model is called, so a dummy API key does: a reply sent as a prompt ends at
the API's refusal. `Seat` runs the cases that do call the model, on the
person's own sign-in.
"""

import contextlib
import hashlib
import json
import re
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid

from renders import OTHER, SGR, apply, text_of

KEY = 'render-check-not-a-real-key'


def run(*args, check=True, **kw):
    return subprocess.run(args, check=check, capture_output=True, text=True, **kw)


def capture(session, escapes=False):
    """The screen as text; with `escapes`, its colors and styles kept as the terminal's escape codes."""
    return run('tmux', 'capture-pane', '-p', *(['-e'] if escapes else []), '-t', session).stdout


# Set, every screen a test reads is kept there too, for a person to look over.
RENDERS = os.environ.get('RENDERS_DIR')
kept = 0


def keep(styled, name):
    """Saves a screen read with its escapes under RENDERS_DIR, numbered in the order the tests read them."""
    global kept

    if not RENDERS:
        return

    kept += 1
    os.makedirs(RENDERS, exist_ok=True)
    # Only what a file name and the artifact's upload both take.
    safe = re.sub(r'[^A-Za-z0-9._-]+', '_', name)
    with open(os.path.join(RENDERS, f'{kept:03d}-{safe}.ansi'), 'w') as f:
        f.write(styled)


# What `capture-pane -e` adds to the text: colors and styles, and any other CSI or OSC sequence.
ESCAPES = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)')
# A hyperlink's start, its target in the group, or its end, the target empty.
HYPERLINK = re.compile(r'\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]*)(?:\x07|\x1b\\)')


def snapshot(session, name=None):
    """The screen read once, colors and all, and kept as `name` when given: what is kept is what a test reads."""
    styled = capture(session, escapes=True)
    if name is not None:
        keep(styled, name)
    return styled


def plain_of(styled):
    """A screen read with its escapes as the plain capture reads it: that trims the spaces ending a row, styled ones too."""
    return '\n'.join(line.rstrip(' ') for line in ESCAPES.sub('', styled).split('\n'))


def wait_for(session, predicate, timeout=30.0, escapes=False):
    end = time.time() + timeout
    screen = ''
    while time.time() < end:
        screen = capture(session, escapes)
        if predicate(screen):
            return screen
        time.sleep(0.25)
    raise TimeoutError(f'timed out; the screen was:\n{ESCAPES.sub("", screen)}')


class Claude:
    """One Claude Code in a tmux window of its own, in a folder of its own."""

    def __init__(self, plugin_dir, claude='claude', env=None):
        self.plugin_dir = os.path.abspath(plugin_dir)
        self.extra_env = env or {}
        self.claude = shutil.which(claude) or claude
        self.home = os.path.realpath(tempfile.mkdtemp(prefix='hitl-screen-'))
        self.config = os.path.join(self.home, 'config')
        self.project = os.path.join(self.home, 'project')
        os.makedirs(self.config)
        os.makedirs(self.project)
        with open(os.path.join(self.config, '.claude.json'), 'w') as f:
            json.dump(
                {
                    'hasCompletedOnboarding': True,
                    'theme': os.environ.get('LIVE_THEME', 'dark'),
                    'customApiKeyResponses': {'approved': [KEY[-20:]], 'rejected': []},
                    'projects': {self.project: {'hasTrustDialogAccepted': True}},
                },
                f,
            )
        self.session = f'hitl-{os.getpid()}-{int(time.time() * 1000) % 100000}'
        # The conversation `seed` saves items for, and `pane` starts.
        self.session_id = str(uuid.uuid4())

    def env(self):
        keep = {k: os.environ[k] for k in ('PATH', 'LANG', 'LC_ALL') if k in os.environ}
        return {
            **keep,
            'HOME': self.home,
            'TERM': 'xterm-256color',
            'LANG': os.environ.get('LANG') or 'C.UTF-8',
            'CLAUDE_CONFIG_DIR': self.config,
            'ANTHROPIC_API_KEY': KEY,
            **self.extra_env,
        }

    def launch(self, columns, rows, *args):
        command = ' '.join(
            [
                'exec env -i',
                *[f"{k}='{v}'" for k, v in self.env().items()],
                f"'{self.claude}' --plugin-dir '{self.plugin_dir}'",
                *args,
            ]
        )
        run('tmux', '-u', 'new-session', '-d', '-s', self.session, '-x', str(columns), '-y', str(rows), '-c', self.project, command)

    def start(self, columns, rows, *args):
        self.launch(columns, rows, *args)
        # The prompt draws before it reads keys: type once it echoes them.
        return wait_for(self.session, has_prompt)

    def type(self, text):
        deadline = time.time() + 20
        while time.time() < deadline:
            run('tmux', 'send-keys', '-t', self.session, '-l', text)
            try:
                wait_for(self.session, lambda s: text in s.split('❯')[-1], timeout=2)
                return
            except TimeoutError:
                run('tmux', 'send-keys', '-t', self.session, 'C-u')
        raise TimeoutError(f'the prompt never showed {text!r}:\n{capture(self.session)}')

    def command(self, text):
        self.type(text)
        time.sleep(0.3)
        run('tmux', 'send-keys', '-t', self.session, 'Enter')

    def stop(self):
        pid = run('tmux', 'display-message', '-p', '-t', self.session, '#{pane_pid}', check=False).stdout.strip()
        run('tmux', 'kill-session', '-t', self.session, check=False)
        # Claude Code writes the store as it ends: wait it out before the folder goes.
        deadline = time.time() + 15
        while pid.isdigit() and time.time() < deadline:
            try:
                os.kill(int(pid), 0)
            except ProcessLookupError:
                break
            time.sleep(0.1)

    def store_file(self):
        """The plugin's store, as the engine names it for a plugin loaded with --plugin-dir."""
        digest = hashlib.sha256(b'open-items@inline').hexdigest()[:12]
        return os.path.join(self.config, 'plugins', 'store', f'open-items_inline-{digest}.json')

    def seed(self, items):
        """Leaves `items` in the store as the session saved them, for `pane` to start it again with them.

        Each is an item's fields over an open action's, with `detail` for
        the first message, Claude's or a side question's own, `thread` for the
        messages after it (an `agoMs` in place of `atMs`), `ageMs` for how long
        ago it was added, and in `side` each time as how long ago (`sentAgoMs`
        for `sentMs`).
        """
        now_ms = int(time.time() * 1000)

        def timed(fields):
            return {
                (key[: -len('AgoMs')] + 'Ms' if key.endswith('AgoMs') else key): now_ms - value if key.endswith('AgoMs') else timed(value) if isinstance(value, dict) else value
                for key, value in fields.items()
            }

        tasks = []
        for item in items:
            created = now_ms - item.get('ageMs', 180_000)
            later = [{k: v for k, v in message.items() if k != 'agoMs'} | {'atMs': now_ms - message.get('agoMs', 60_000)} for message in item.get('thread', ())]
            first = 'user' if item.get('kind') == 'side' else 'claude'
            tasks.append(
                {
                    'kind': 'action',
                    'state': 'open',
                    'update': 'none',
                    'isWaitingForClaude': False,
                    'hasNewReply': False,
                    'createdMs': created,
                    'updatedMs': created,
                    'thread': [{'from': first, 'text': item.get('detail', ''), 'atMs': created}, *later],
                    **({'side': timed(item['side'])} if 'side' in item else {}),
                    **{k: v for k, v in item.items() if k not in ('ageMs', 'detail', 'thread', 'side')},
                }
            )
        self.store(
            {
                'version': 2,
                'tasks': tasks,
                'nextId': max(task['id'] for task in tasks) + 1,
                'savedMs': now_ms,
                'lastActiveMs': now_ms,
                'folder': self.project,
                'taken': [],
            }
        )

    def store(self, saved):
        """Leaves `saved` in the store under the session's key, in the shape a version of the plugin wrote."""
        path = self.store_file()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        # No session runs yet to write over it.
        with open(path, 'w') as f:
            json.dump({f'session:{self.session_id}': saved}, f)

    def is_seeded(self):
        """Whether the store holds a key for the session."""
        try:
            with open(self.store_file()) as f:
                return f'session:{self.session_id}' in json.load(f)
        except FileNotFoundError:
            return False

    def saved(self):
        """What the session left under its key in the store, once it has ended."""
        with open(self.store_file()) as f:
            return json.load(f)[f'session:{self.session_id}']

    def open_pane(self, columns, rows):
        """Starts the seeded session again in a terminal `columns` by `rows`, and opens the pane with /open-items."""
        self.start(columns, rows, '--session-id', self.session_id)
        # The session restores the items seeded as it starts; the status line
        # counts them once it has. /open-items typed before that finds none.
        try:
            if self.is_seeded():
                wait_for(self.session, lambda s: re.search('open-items: [☐✓⋯]', s))
        except TimeoutError as error:
            # The engine names the store's file; the seed goes where store_file() says it does.
            raise RuntimeError(
                f'the session restored none of the items seeded in {self.store_file()}: '
                'if the engine names a --plugin-dir store otherwise now, store_file() must follow'
            ) from error
        self.command('/open-items')
        wait_for(self.session, has_pane)
        self.has_keys = False

    def take_keys(self):
        """Has the pane hold the keys, once after it opens."""
        if self.has_keys:
            return
        # The pane takes the keys when the prompt lets it; else ctrl+x tab hands them over.
        try:
            wait_for(self.session, holds_keys, timeout=3, escapes=True)
        except TimeoutError:
            run('tmux', 'send-keys', '-t', self.session, 'C-x', 'Tab')
            wait_for(self.session, holds_keys, timeout=10, escapes=True)
        self.has_keys = True

    def press(self, *keys, pause=0.5):
        """Sends `keys` to the pane, `pause` seconds apart: a key by its tmux name, any other text as typed."""
        self.take_keys()
        for key in keys:
            run('tmux', 'send-keys', '-t', self.session, key)
            time.sleep(pause)

    def read(self, name=None):
        """The screen once the pane is drawn and has settled; kept as `name` when given, and as `styled` with its escapes."""
        # Keys that close the pane and open it again leave it to come back.
        wait_for(self.session, has_pane)
        time.sleep(1.0)
        self.styled = snapshot(self.session, name)
        return plain_of(self.styled)

    def ring(self):
        """The text the focus ring is on in the pane, as the engine draws it inverse: one entry for each run of it."""
        return ring_of(capture(self.session, escapes=True))

    def wait_ring(self, wanted, timeout=5.0):
        """The ring once it is on `wanted`, or where it is when `timeout` seconds pass first."""
        end = time.time() + timeout
        while True:
            found = self.ring()
            if found == wanted or time.time() > end:
                return found
            time.sleep(0.1)

    def pane(self, columns, rows, keys=(), name=None):
        """The screen with the pane opened by /open-items, after `keys`; kept as `name` when given."""
        self.open_pane(columns, rows)
        if keys:
            self.press(*keys)
        return self.read(name)

    def transcript(self, columns, rows, tool_input, name=None):
        """The screen of a session resumed from a transcript where Claude called add_item; kept as `name` when given."""
        session = str(uuid.uuid4())
        folder = os.path.join(self.config, 'projects', re.sub(r'[^A-Za-z0-9]', '-', self.project))
        os.makedirs(folder, exist_ok=True)
        prompt, call, result = (str(uuid.uuid4()) for _ in range(3))
        base = {'isSidechain': False, 'userType': 'external', 'cwd': self.project, 'sessionId': session, 'timestamp': '2026-10-13T12:00:00.000Z'}
        message = {
            'id': 'msg_render_check',
            'type': 'message',
            'role': 'assistant',
            'model': 'claude-opus-5-5',
            'content': [{'type': 'tool_use', 'id': 'toolu_render_check', 'name': 'mcp__open-items__add_item', 'input': tool_input}],
            'stop_reason': 'tool_use',
            'usage': {'input_tokens': 1, 'output_tokens': 1},
        }
        rows_of = [
            {**base, 'parentUuid': None, 'type': 'user', 'uuid': prompt, 'message': {'role': 'user', 'content': 'fix the login bug'}},
            {**base, 'parentUuid': prompt, 'type': 'assistant', 'uuid': call, 'message': message},
            {
                **base,
                'parentUuid': call,
                'type': 'user',
                'uuid': result,
                'message': {'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': 'toolu_render_check', 'content': 'Added item #1'}]},
            },
        ]
        with open(os.path.join(folder, f'{session}.jsonl'), 'w') as f:
            f.write(''.join(json.dumps(row) + '\n' for row in rows_of))
        self.start(columns, rows, '--resume', session)
        wait_for(self.session, lambda s: '☐' in s)
        time.sleep(1.0)
        return plain_of(snapshot(self.session, name))

    def conversation(self):
        """The session's conversation file."""
        return os.path.join(self.config, 'projects', re.sub(r'[^A-Za-z0-9]', '-', self.project), f'{self.session_id}.jsonl')

    def rows(self):
        """The rows of the session's conversation file as they stand now: none before its first."""
        try:
            with open(self.conversation()) as f:
                return [json.loads(line) for line in f if line.strip()]
        except FileNotFoundError:
            return []

    def scratchpads(self):
        """Where Claude Code keeps the scratchpads of the project folder's sessions, outside the folders a close removes."""
        return f'/tmp/claude-{os.getuid()}/{re.sub(r"[^A-Za-z0-9]", "-", self.project)}'

    def close(self):
        self.stop()
        shutil.rmtree(self.home, ignore_errors=True)
        shutil.rmtree(self.scratchpads(), ignore_errors=True)


class Seat(Claude):
    """
    A Claude on the person's own seat, for the cases that call the model: the
    config folder CLAUDE_CONFIG_DIR names and its sign-in, no API key. The
    plugin's installed copy is off for these sessions only, so the one in
    `plugin_dir` is the only open-items. A Seat's sessions share one project
    folder; `close` purges it and drops its keys from the store.
    """

    def __init__(self, plugin_dir, claude='claude'):
        self.plugin_dir = os.path.abspath(plugin_dir)
        self.claude = shutil.which(claude) or claude
        # Only the person's own seat: unset, Claude Code reads a sign-in slot that may hold another account.
        config, own = os.environ.get('CLAUDE_CONFIG_DIR', ''), os.path.expanduser('~/.claude')
        if not config or os.path.realpath(config) != os.path.realpath(own):
            raise RuntimeError(f'the model cases run only on the seat whose config is {own}; CLAUDE_CONFIG_DIR is {config or "unset"}')
        self.config = config
        self.project = os.path.realpath(tempfile.mkdtemp(prefix='hitl-model-'))
        self.session = f'hitl-model-{os.getpid()}-{int(time.time() * 1000) % 100000}'
        self.session_id = str(uuid.uuid4())

    def env(self):
        keep = ('PATH', 'LANG', 'LC_ALL', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'CLAUDE_CONFIG_DIR')
        return {**{k: os.environ[k] for k in keep if k in os.environ}, 'TERM': 'xterm-256color', 'LANG': os.environ.get('LANG') or 'C.UTF-8'}

    def start(self, columns, rows, *args):
        with open(os.path.join(self.config, 'settings.json')) as f:
            installed = [name for name in json.load(f).get('enabledPlugins', {}) if name.startswith('open-items@')]
        off = json.dumps({'enabledPlugins': {name: False for name in installed}})
        self.launch(columns, rows, '--settings', f"'{off}'", *args)
        screen = wait_for(self.session, lambda s: TRUST in s or has_prompt(s))
        # A new project folder asks for trust once, "No, exit" first; its entry goes with the purge.
        if TRUST in screen:
            # The dialog, like the prompt, draws before it reads keys, and ↓ goes round its two answers.
            for _ in range(10):
                if f'❯ {TRUST}' in capture(self.session):
                    break
                run('tmux', 'send-keys', '-t', self.session, 'Down')
                time.sleep(1.5)
            run('tmux', 'send-keys', '-t', self.session, 'Enter')
            screen = wait_for(self.session, lambda s: TRUST not in s and has_prompt(s))
        return screen

    def store(self, saved):
        """Adds `saved` to the store under the session's key, beside the keys already there."""
        path = self.store_file()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        try:
            with open(path) as f:
                kept = json.load(f)
        except FileNotFoundError:
            kept = {}
        with open(path, 'w') as f:
            json.dump({**kept, f'session:{self.session_id}': saved}, f)

    def close(self):
        self.stop()
        run(self.claude, 'purge', self.project, '-y', check=False)
        path = self.store_file()
        try:
            with open(path) as f:
                kept = {key: saved for key, saved in json.load(f).items() if saved.get('folder') != self.project}
        except FileNotFoundError:
            kept = None
        if kept == {}:
            os.remove(path)
        elif kept is not None:
            with open(path, 'w') as f:
                json.dump(kept, f)
        shutil.rmtree(self.scratchpads(), ignore_errors=True)
        shutil.rmtree(self.project, ignore_errors=True)


TRUST = 'Yes, I trust this folder'


def has_prompt(screen):
    """Whether the prompt box is drawn: a row starts with its mark."""
    return any(line.startswith('❯') for line in screen.split('\n'))


@contextlib.contextmanager
def silent_api():
    """The environment of an API address that takes each connection and never answers: a helper started there stays at work."""
    server = socket.create_server(('127.0.0.1', 0))
    held = []

    def hold():
        with contextlib.suppress(OSError):
            while True:
                held.append(server.accept()[0])

    threading.Thread(target=hold, daemon=True).start()
    try:
        yield {'ANTHROPIC_BASE_URL': f'http://127.0.0.1:{server.getsockname()[1]}'}
    finally:
        server.close()
        for one in held:
            one.close()


def has_pane(screen):
    """Whether the pane is drawn, a row of it in view: framed above the prompt, or docked beside the transcript."""
    try:
        return any(row.strip() for row in pane_body(screen))
    except StopIteration:
        return False


def holds_keys(styled):
    """Whether the pane has the keys: the engine draws its frame, or a docked pane's rule, dim while the prompt has them."""
    lines = styled.split('\n')
    plain = [text_of(line) for line in lines]
    top = frame_top(plain)
    if top is not None:
        row, column = top, plain[top].index('╭')
    else:
        column = rule_of(plain)
        if column is None:
            return False
        row = next(i for i, line in enumerate(plain) if len(line) > column and line[column] == '│')
    return not styles_of(lines[row])[column].get('dim')


def styles_of(line):
    """The style each character of a captured row is drawn in, in the order of its characters."""
    styles, style, at = [], {}, 0
    for match in [*SGR.finditer(line), None]:
        styles += [dict(style)] * len(text_of(line[at : len(line) if match is None else match.start()]))
        if match is not None:
            apply(style, match.group(1))
            at = match.end()
    return styles


def body_rows(plain):
    """Where the pane's body is in a screen's rows: each row's index and the column the body starts at."""
    top = frame_top(plain)
    if top is None:
        column = rule_of(plain)
        return [] if column is None else [(i, column + 1) for i, line in enumerate(plain) if len(line) > column and line[column] == '│']
    bottom = next((i for i, line in enumerate(plain) if i > top and line.lstrip().startswith('╰')), len(plain))
    return [(i, 0) for i in range(top + 1, bottom)]


def ring_of(styled):
    """The runs of text drawn inverse in the pane's body, each stripped: where the engine draws the focus ring."""
    lines = styled.split('\n')
    plain = [text_of(line) for line in lines]
    runs = []
    for i, start in body_rows(plain):
        inverse = ''
        for character, style in list(zip(plain[i], styles_of(lines[i])))[start:] + [('', {})]:
            if style.get('inverse'):
                inverse += character
            elif inverse:
                runs.append(inverse.strip())
                inverse = ''
    return [one for one in runs if one]


def links_of(line):
    """The hyperlink target each character of a captured row is drawn under, None where none, in the order of its characters."""
    targets, target, at = [], None, 0
    for match in [*OTHER.finditer(line), None]:
        targets += [target] * len(line[at : len(line) if match is None else match.start()])
        if match is not None:
            link = HYPERLINK.fullmatch(match.group(0))
            if link is not None:
                target = link.group(1) or None
            at = match.end()
    return targets


def hyperlinks_of(styled):
    """
    The hyperlinks drawn in the pane's body, in order: each one's target, its
    text, and the screen row it starts on. A link the pane wraps goes on at the
    next row's start, past the spaces and borders between, and is joined.
    """
    lines = styled.split('\n')
    plain = [text_of(line) for line in lines]
    found, link, between = [], None, ''
    for i, start in body_rows(plain):
        for character, target in [*list(zip(plain[i], links_of(lines[i])))[start:], ('\n', None)]:
            if target is not None and link is not None and target == link[0] and (between == '' or '\n' in between):
                link[1] += character
                between = ''
            elif target is not None:
                if link is not None:
                    found.append(tuple(link))
                link, between = [target, character, i], ''
            elif link is not None:
                between += character
                if between.strip(' \n│'):
                    found.append(tuple(link))
                    link, between = None, ''
    return found + ([] if link is None else [tuple(link)])


def placement(screen):
    """Where the pane is drawn: `inline`, framed above the prompt, or `dock`, beside the transcript."""
    return 'inline' if frame_top(screen.split('\n')) is not None else 'dock'


def frame_top(lines):
    """The row a framed pane starts on: its frame's top, with the close mark. A toast's frame has none."""
    return next((i for i, line in enumerate(lines) if line.lstrip().startswith('╭') and '✕' in line), None)


def pane_body(screen):
    """The pane's rows in order, its frame and padding stripped."""
    lines = screen.split('\n')
    top = frame_top(lines)
    if top is None:
        return dock_body(lines)
    bottom = next(i for i, line in enumerate(lines) if i > top and line.lstrip().startswith('╰'))
    return [line.strip()[1:-1].rstrip()[1:] if line.strip().startswith('│') else line for line in lines[top + 1 : bottom]]


def rule_of(lines):
    """The column of the rule a docked pane draws down the screen's height, or None."""
    columns = [{i for i, c in enumerate(line) if c == '│'} for line in lines]
    rule = max(set().union(*columns), key=lambda i: sum(i in found for found in columns), default=None)
    return None if rule is None or sum(rule in found for found in columns) < len(lines) // 2 else rule


def dock_body(lines):
    """The rows right of the rule a docked pane draws down the screen's height, its close mark's row gone."""
    rule = rule_of(lines)
    if rule is None:
        raise StopIteration
    return [line[rule + 1 :].rstrip() for line in lines if len(line) > rule and line[rule] == '│'][1:]


if __name__ == '__main__':
    tasks = json.load(open(sys.argv[2]))
    columns = int(sys.argv[3]) if len(sys.argv) > 3 else 60
    claude = Claude(sys.argv[1])
    try:
        claude.seed(tasks)
        print(claude.pane(columns, int(sys.argv[4]) if len(sys.argv) > 4 else 50))
    finally:
        claude.close()
