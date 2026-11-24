'use strict';

// Runs every example in the README's "Argument examples" table against the
// fixture's real server, splitting each command line the way the named shell does.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const helpers = require('./helpers');
const { launch } = require('../src/launcher');

const { tempHome, freePort, request, sleep, writeConfig, startServer, FIXTURE } = helpers;
const README = path.join(__dirname, '..', 'README.md');

/** Split a command line the way a POSIX shell does (the cases the README uses). */
function splitPosix(line) {
  const out = [];
  let cur = '';
  let have = false;
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      cur += line.slice(i + 1, end);
      have = true;
      i = end + 1;
    } else if (c === '"') {
      i++;
      have = true;
      while (line[i] !== '"') {
        if (line[i] === '\\' && '"\\$`'.includes(line[i + 1])) i++;
        cur += line[i++];
      }
      i++;
    } else if (c === '\\') {
      cur += line[i + 1];
      have = true;
      i += 2;
    } else if (c === ' ') {
      if (have) out.push(cur);
      cur = ''; have = false; i++;
    } else {
      cur += c; have = true; i++;
    }
  }
  if (have) out.push(cur);
  return out;
}

/** Split a command line by the Windows rules (CommandLineToArgvW), which cmd.exe programs get. */
function splitCmd(line) {
  const out = [];
  let cur = '';
  let have = false;
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '\\') {
      let n = 0;
      while (line[i] === '\\') { n++; i++; }
      if (line[i] === '"') {
        cur += '\\'.repeat(Math.floor(n / 2));
        if (n % 2 === 1) { cur += '"'; i++; }
      } else {
        cur += '\\'.repeat(n);
      }
      have = true;
    } else if (c === '"') {
      inQuotes = !inQuotes; have = true; i++;
    } else if (c === ' ' && !inQuotes) {
      if (have) out.push(cur);
      cur = ''; have = false; i++;
    } else {
      cur += c; have = true; i++;
    }
  }
  if (have) out.push(cur);
  return out;
}

function exampleRows() {
  const text = fs.readFileSync(README, 'utf8');
  const start = text.indexOf('#### Argument examples');
  assert.ok(start >= 0, 'README has an "Argument examples" section');
  const rows = [];
  for (const line of text.slice(start).split(/\r?\n/).slice(1)) {
    if (/^#{1,4} /.test(line)) break;
    if (!line.startsWith('|') || /^\|[-| ]+\|$/.test(line) || /POSIX shell/.test(line)) continue;
    const cells = line.slice(1, line.lastIndexOf('|')).split(' | ').map((c) => c.trim().replace(/^`|`$/g, ''));
    assert.strictEqual(cells.length, 3, `three cells in: ${line}`);
    rows.push({ posix: cells[0], cmd: cells[1] === 'same' ? cells[0] : cells[1], expected: cells[2] });
  }
  return rows;
}

function expand(value, cwd) {
  if (typeof value === 'string') {
    if (value.startsWith('<cwd>/')) return path.resolve(cwd, value.slice(6));
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => expand(v, cwd));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v, cwd)]));
  return value;
}

test('every README argument example runs and produces what the table says', async (t) => {
  const h = tempHome();
  const port = await freePort();
  writeConfig('example-mcp', { port });
  const server = await startServer({ port });
  t.after(async () => { await server.stop(); h.restore(); });

  const cwd = fs.mkdtempSync(path.join(h.home, 'work-'));
  fs.writeFileSync(path.join(cwd, 'notes.md'), 'hello from notes');
  fs.writeFileSync(path.join(cwd, 'prov.json'), '{"session_id":"s1"}');
  fs.writeFileSync(path.join(cwd, 'base.json'), '{"title":"from file"}');

  const rows = exampleRows();
  assert.ok(rows.length >= 30, `found ${rows.length} examples`);
  for (const row of rows) {
    for (const [shell, line, split] of [['POSIX', row.posix, splitPosix], ['cmd.exe', row.cmd, splitCmd]]) {
      const out = []; const err = [];
      const code = await launch(
        { defaultPort: 7561, tools: require('./fixtures/example-mcp/tools') },
        ['call', 'inspect', ...split(line)],
        { out: (m) => out.push(m), err: (m) => err.push(m) },
        FIXTURE, 'index.js', cwd
      );
      assert.strictEqual(code, 0, `${shell}: ${line}\n${err.join('\n')}`);
      const got = JSON.parse(out.join('\n'));
      const want = JSON.parse(row.expected);
      const placeholder = (v) => (typeof v === 'string' && /^<date(-time)?>$/.test(v)) ? v : null;
      const check = (g, w, where) => {
        if (placeholder(w) === '<date>') return assert.match(g, /^\d{4}-\d\d-\d\d$/, where);
        if (placeholder(w) === '<date-time>') return assert.match(g, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, where);
        if (w && typeof w === 'object' && !Array.isArray(w)) {
          assert.deepStrictEqual(Object.keys(g).sort(), Object.keys(w).sort(), where);
          for (const k of Object.keys(w)) check(g[k], w[k], where);
          return undefined;
        }
        return assert.deepStrictEqual(g, expand(w, cwd), where);
      };
      check(got, want, `${shell}: ${line}`);
    }
  }
  await sleep(10);
});

test('the splitters behave as the shells do', () => {
  assert.deepStrictEqual(splitPosix(`--tags '"a,b",c'`), ['--tags', '"a,b",c']);
  assert.deepStrictEqual(splitPosix(`--content "'@alice'"`), ['--content', "'@alice'"]);
  assert.deepStrictEqual(splitPosix(`--tags ''`), ['--tags', '']);
  assert.deepStrictEqual(splitCmd(`--tags "\\"a,b\\",c"`), ['--tags', '"a,b",c']);
  assert.deepStrictEqual(splitCmd(`--title C:\\Users\\me\\notes.md`), ['--title', 'C:\\Users\\me\\notes.md']);
  assert.deepStrictEqual(splitCmd(`--tags ""`), ['--tags', '']);
});
