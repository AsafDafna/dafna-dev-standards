#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BUILD_LIMIT_MS = 120_000;
const CASE_FILES = ['prompt.md', 'case.yaml'];
const SKIPPED_DIRS = ['results', 'mocks'];
const COMMON_KEYS = ['type', 'weight', 'arm'];
const TYPE_KEYS = {
  regex: ['pattern', 'flags', 'match', 'target'],
  tool_used: ['tool', 'input_match', 'min', 'max'],
  tool_order: ['before', 'after'],
  file_exists: ['path', 'exists'],
  llm: ['criteria', 'focus'],
  baseline: ['baseline_file', 'criteria'],
};
const BLOCK_KEYS = {
  target: ['source', 'path'],
  focus: ['source', 'path'],
  before: ['tool', 'input_match'],
  after: ['tool', 'input_match'],
};
const ESCAPES = {
  0: '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b',
  ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: ' ', P: ' ',
};
const HEX_ESCAPES = { x: 2, u: 4, U: 8 };

const failures = [];
const temps = new Set();
let building = null;

const fail = (line) => failures.push(line);

function cleanup() {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
  temps.clear();
}

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-graders-'));
  temps.add(dir);
  return dir;
}

function killGroup(child) {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {}
}

function quoted(s, where) {
  const q = s[0];
  let out = '';
  for (let i = 1; i < s.length; i++) {
    const c = s[i];
    if (q === "'" && c === "'") {
      if (s[i + 1] !== "'") return [out, s.slice(i + 1)];
      out += "'";
      i++;
    } else if (q === '"' && c === '"') {
      return [out, s.slice(i + 1)];
    } else if (q === '"' && c === '\\') {
      const e = s[++i];
      if (e in ESCAPES) {
        out += ESCAPES[e];
      } else if (e in HEX_ESCAPES) {
        const hex = s.slice(i + 1, i + 1 + HEX_ESCAPES[e]);
        if (!/^[\da-fA-F]+$/.test(hex) || hex.length !== HEX_ESCAPES[e]) throw new Error(`${where}: bad \\${e} escape`);
        out += String.fromCodePoint(parseInt(hex, 16));
        i += hex.length;
      } else {
        throw new Error(`${where}: YAML has no escape \\${e ?? ''}`);
      }
    } else {
      out += c;
    }
  }
  throw new Error(`${where}: unclosed quote`);
}

function plain(text, where) {
  if (/^[[\]{}|>&*!%@`#,]/.test(text) || /^[-?:](\s|$)/.test(text)) {
    throw new Error(`${where}: quote the value ${text}, or use a block mapping, not a flow mapping or block scalar`);
  }
  if (/:(\s|$)/.test(text) || /\s#/.test(text)) throw new Error(`${where}: quote the value ${text}; YAML reads ": " and " #" in it differently`);
  if (/^(y|n|yes|no|on|off)$/i.test(text)) throw new Error(`${where}: quote the value ${text}; some YAML parsers read it as a boolean`);
  if (/^(true|True|TRUE)$/.test(text)) return true;
  if (/^(false|False|FALSE)$/.test(text)) return false;
  if (/^(null|Null|NULL|~)$/.test(text)) return null;
  if (/^[-+]?\d+$/.test(text) || /^0x[\da-fA-F]+$/.test(text)) return Number(text);
  if (/^0o[0-7]+$/.test(text)) return parseInt(text.slice(2), 8);
  if (/^[-+]?(\.\d+|\d+(\.\d*)?)([eE][-+]?\d+)?$/.test(text)) return Number(text);
  return text;
}

function scalar(s, where, inList) {
  if (s[0] === "'" || s[0] === '"') return quoted(s, where);
  const end = inList ? s.search(/[,\]]/) : -1;
  const text = (end < 0 ? s : s.slice(0, end)).trimEnd();
  if (text === '') throw new Error(`${where}: empty item`);
  return [plain(text, where), end < 0 ? '' : s.slice(end)];
}

function flowList(s, where) {
  const items = [];
  let rest = s.slice(1).trimStart();
  while (!rest.startsWith(']')) {
    if (/^[[{]/.test(rest)) throw new Error(`${where}: only flat flow lists`);
    const [item, after] = scalar(rest, where, true);
    items.push(item);
    rest = after.trimStart();
    if (rest.startsWith(',')) rest = rest.slice(1).trimStart();
    else if (!rest.startsWith(']')) throw new Error(`${where}: unclosed flow list`);
  }
  return [items, rest.slice(1)];
}

function value(raw, where) {
  const [v, rest] = raw.startsWith('[') ? flowList(raw, where) : scalar(raw, where, false);
  if (rest.trim() !== '') throw new Error(`${where}: unexpected text after the value: ${rest.trim()}`);
  return v;
}

function setKey(obj, key, v, where) {
  if (Object.hasOwn(obj, key)) throw new Error(`${where}: duplicate key ${key}`);
  obj[key] = v;
}

// Only the subset that every YAML parser reads the same way: scalars, flat flow lists, and one
// level of block mapping under blockKeys. Anything else is refused, so the checker never tests
// a different pattern than the harness loads.
function parseSubset(text, blockKeys) {
  const out = {};
  let block = null;
  const closeBlock = () => {
    if (block && block.indent === undefined) throw new Error(`${block.key} is an empty block mapping`);
    block = null;
  };
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    const where = `line ${i + 1}`;
    if (/^\s*(#.*)?$/.test(line)) return;
    if (/^ *\t/.test(line)) throw new Error(`${where}: tab indent`);
    const indent = line.match(/^ */)[0].length;
    const m = line.slice(indent).match(/^([A-Za-z_][\w-]*):(?:\s+(.*))?$/);
    if (!m) throw new Error(`${where}: not a "key: value" line`);
    const key = m[1];
    const val = (m[2] ?? '').trimEnd();
    if (indent > 0) {
      if (!block) throw new Error(`${where}: indented line outside a block mapping`);
      block.indent ??= indent;
      if (indent !== block.indent || val === '') throw new Error(`${where}: only one level of block mapping`);
      setKey(block.obj, key, value(val, where), where);
      return;
    }
    closeBlock();
    if (val !== '') {
      setKey(out, key, value(val, where), where);
    } else if (blockKeys.includes(key)) {
      block = { key, obj: {} };
      setKey(out, key, block.obj, where);
    } else {
      throw new Error(`${where}: ${key} has no value`);
    }
  });
  closeBlock();
  return out;
}

function frontmatter(text) {
  const lines = text.split('\n');
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---');
  if (lines[0].trimEnd() !== '---' || end < 0) throw new Error('no --- frontmatter');
  return lines.slice(1, end).join('\n');
}

function regexPattern(key, source, flags, count) {
  if (typeof source !== 'string') throw new Error(`${key}: the pattern must be a string`);
  if (typeof flags !== 'string') throw new Error(`${key}: flags must be a string`);
  const re = new RegExp(source, flags.includes('g') ? flags : `${flags}g`);
  return { key, count, hits: (text) => [...text.matchAll(re)].length };
}

function countOf(match) {
  if (match === undefined || match === 'not_contains') return null;
  const m = typeof match === 'string' && match.match(/^count:(\d+)$/);
  if (!m) throw new Error(`unknown match ${JSON.stringify(match)}`);
  return Number(m[1]);
}

function patternsOf(name, g) {
  const keys = TYPE_KEYS[g.type];
  if (!keys) throw new Error(`unknown type ${JSON.stringify(g.type)}`);
  for (const [key, v] of Object.entries(g)) {
    if (!COMMON_KEYS.includes(key) && !keys.includes(key)) throw new Error(`unknown key ${key} for type ${g.type}`);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const sub of Object.keys(v)) {
        if (!BLOCK_KEYS[key]?.includes(sub)) throw new Error(`unknown key ${key}.${sub}`);
      }
    }
  }
  const need = (key) => {
    if (g[key] === undefined) throw new Error(`${g.type} needs ${key}`);
  };
  switch (g.type) {
    case 'regex':
      need('pattern');
      return [regexPattern(name, g.pattern, g.flags ?? '', countOf(g.match))];
    case 'tool_used':
      need('tool');
      return g.input_match === undefined ? [] : [regexPattern(name, g.input_match, '', null)];
    case 'tool_order':
      need('before');
      need('after');
      return ['before', 'after'].flatMap((side) => {
        const s = g[side];
        if (typeof s === 'string') return [];
        if (typeof s?.tool !== 'string') throw new Error(`${side} needs a tool`);
        return s.input_match === undefined ? [] : [regexPattern(`${name}.${side}`, s.input_match, '', null)];
      });
    case 'file_exists':
      need('path');
      if (typeof g.path !== 'string') throw new Error('path must be a string');
      return [{ key: name, count: null, hits: (text) => (path.matchesGlob(text, g.path) ? 1 : 0) }];
    default:
      return [];
  }
}

function build(dir, script) {
  const where = `${dir}: ${script}`;
  const file = path.resolve(dir, script);
  if (!fs.existsSync(file)) {
    fail(`${where}: not found`);
    return Promise.resolve(null);
  }
  const workspace = tempDir();
  // The harness's run has a temp home with no git identity. useConfigOnly stops git from
  // guessing one from the host name, so a scaffold must set a repo-local user.
  const env = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: tempDir(),
    TERM: 'dumb',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'user.useConfigOnly',
    GIT_CONFIG_VALUE_0: 'true',
  };
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  return new Promise((resolve) => {
    let stderr = '';
    let timedOut = false;
    let done = false;
    const finish = (problem) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      building = null;
      if (problem) fail(`${where}: ${problem}`);
      resolve(problem ? null : workspace);
    };
    // Its own process group, so a timeout also stops the scaffold's children.
    const child = spawn('bash', [file], { cwd: workspace, env, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
    building = child;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child);
    }, BUILD_LIMIT_MS);
    child.stderr.on('data', (d) => {
      stderr = (stderr + d).slice(-2000);
    });
    child.on('error', (e) => finish(`could not start: ${e.message}`));
    child.on('close', (code, signal) => {
      const last = stderr.trim().split('\n').pop();
      if (timedOut) finish(`took more than ${BUILD_LIMIT_MS / 1000} s`);
      else if (code !== 0) finish(`exited ${code ?? signal}${last ? `: ${last}` : ''}`);
      else finish(null);
    });
  });
}

function sampleText(sample, workspace) {
  if (typeof sample === 'string') return sample;
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) throw new Error('a sample is a string or an object');
  const keys = Object.keys(sample);
  if (keys.length !== 1 || keys[0] !== 'fixture' || typeof sample.fixture !== 'string') return JSON.stringify(sample);
  if (workspace === undefined) throw new Error('a fixture sample, but the case has no scaffold_script');
  if (workspace === null) return null;
  const file = path.resolve(workspace, sample.fixture);
  if (!file.startsWith(workspace + path.sep)) throw new Error(`fixture ${sample.fixture} is outside the workspace`);
  if (!fs.existsSync(file)) throw new Error(`fixture ${sample.fixture} is not in the built fixture`);
  return fs.readFileSync(file, 'utf8');
}

function checkSamples(dir, patterns, checks, workspace) {
  for (const p of patterns) {
    for (const kind of ['match', 'miss']) {
      const samples = checks[p.key]?.[kind];
      if (!Array.isArray(samples) || samples.length === 0) {
        fail(`${dir}: ${p.key}: no ${kind} sample in checks.json`);
        continue;
      }
      samples.forEach((sample, i) => {
        const where = `${dir}: ${p.key}: ${kind} sample ${i + 1}`;
        let text;
        try {
          text = sampleText(sample, workspace);
        } catch (e) {
          fail(`${where}: ${e.message}`);
          return;
        }
        if (text === null) return;
        const n = p.hits(text);
        const hit = p.count === null ? n > 0 : n === p.count;
        if (hit !== (kind === 'match')) {
          const want = p.count === null ? (kind === 'match' ? 'at least 1' : '0') : `${kind === 'match' ? '' : 'not '}${p.count}`;
          fail(`${where}: ${n} hits, want ${want}`);
        }
      });
    }
  }
}

function readChecks(dir) {
  const file = path.join(dir, 'checks.json');
  if (!fs.existsSync(file)) throw new Error('checks.json is missing');
  let checks;
  try {
    checks = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`checks.json: ${e.message}`);
  }
  if (!checks || typeof checks !== 'object' || Array.isArray(checks)) throw new Error('checks.json must hold an object');
  return checks;
}

async function checkCase(dir) {
  let scaffold;
  let workspace;
  if (fs.existsSync(path.join(dir, 'case.yaml'))) {
    try {
      scaffold = parseSubset(fs.readFileSync(path.join(dir, 'case.yaml'), 'utf8'), ['context']).context?.scaffold_script;
    } catch (e) {
      fail(`${dir}: case.yaml: ${e.message}`);
      workspace = null;
    }
  }
  if (typeof scaffold === 'string') workspace = await build(dir, scaffold);
  else if (scaffold !== undefined) fail(`${dir}: case.yaml: context.scaffold_script must be a file name`);

  const graderDir = path.join(dir, 'graders');
  const files = fs.existsSync(graderDir) ? fs.readdirSync(graderDir).filter((f) => f.endsWith('.md')).sort() : [];
  if (files.length === 0) fail(`${dir}: no graders`);
  const patterns = [];
  for (const f of files) {
    const name = f.slice(0, -3);
    try {
      const g = parseSubset(frontmatter(fs.readFileSync(path.join(graderDir, f), 'utf8')), Object.keys(BLOCK_KEYS));
      patterns.push(...patternsOf(name, g));
    } catch (e) {
      fail(`${dir}: ${name}: ${e.message}`);
    }
  }
  if (patterns.length > 0) {
    try {
      checkSamples(dir, patterns, readChecks(dir), workspace);
    } catch (e) {
      fail(`${dir}: ${e.message}`);
    }
  }
  cleanup();
}

function findCases(dir) {
  if (CASE_FILES.some((f) => fs.existsSync(path.join(dir, f)))) return [dir];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIPPED_DIRS.includes(e.name))
    .map((e) => e.name)
    .sort()
    .flatMap((name) => findCases(path.join(dir, name)));
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: node scripts/check-graders.mjs <case dir or evals dir>...');
  process.exit(2);
}
process.on('exit', cleanup);
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.on(signal, () => {
    if (building) killGroup(building);
    process.exit(code);
  });
}
for (const arg of args) {
  const cases = fs.existsSync(arg) && fs.statSync(arg).isDirectory() ? findCases(arg) : null;
  if (!cases) fail(`${arg}: not a folder`);
  else if (cases.length === 0) fail(`${arg}: no cases`);
  else for (const dir of cases) await checkCase(dir);
}
console.log(failures.length ? failures.join('\n') : 'OK');
process.exitCode = failures.length ? 1 : 0;
