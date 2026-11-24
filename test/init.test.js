'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { z } = require('zod');
const helpers = require('./helpers');
const config = require('../src/config');
const { launch } = require('../src/launcher');

const { tempHome, freePort, request, FIXTURE } = helpers;
const NAME = 'example-mcp';

const DEFINITION = {
  defaultPort: 7561,
  defaults: { feature: true, interval: 5, label: 'x', reindex_defaults: { agent: { name: 'x', version: '1' }, limit: 3 }, nothing: null },
  settings: z.object({ label: z.string().describe('A label') }),
  promptable: ['interval'],
};

async function init(args, { definition = DEFINITION, stdin } = {}) {
  const out = [];
  const err = [];
  const io = { out: (m) => out.push(m), err: (m) => err.push(m), prompt: (m) => out.push(`PROMPT ${m}`) };
  if (stdin !== undefined) io.stdin = Readable.from([stdin]);
  const code = await launch(definition, ['init', ...args], io, FIXTURE, 'index.js', FIXTURE);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

function saved() {
  return JSON.parse(fs.readFileSync(config.configFile(NAME), 'utf8'));
}

test('JSON settings are saved and the full configuration is printed', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const r = await init(['{"port":7600}']);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(saved().port, 7600);
  assert.match(r.out, /Saved configuration in .*config\.json/);
  assert.match(r.out, /"port": 7600/);
  assert.match(r.out, /"interval": 5/);
});

test('arguments are typed from the schema: number, string, boolean, nested', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const r = await init(['--port', '7601', '--log_level', 'debug', '--no-feature', '--interval', '9',
    '--reindex_defaults.agent.name', 'claude', '--label', '007']);
  assert.strictEqual(r.code, 0, r.err);
  const s = saved();
  assert.strictEqual(s.port, 7601);
  assert.strictEqual(s.log_level, 'debug');
  assert.strictEqual(s.feature, false);
  assert.strictEqual(s.interval, 9);
  assert.strictEqual(s.label, '007', 'a declared string stays a string');
  assert.deepStrictEqual(s.reindex_defaults, { agent: { name: 'claude', version: '1' }, limit: 3 }, 'other nested fields kept');
});

test('JSON and arguments together: the arguments win', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const file = path.join(h.home, 'base.json');
  fs.writeFileSync(file, '{"port":7602,"interval":2}');
  const r = await init([`@${file}`, '--port', '7603']);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(saved().port, 7603);
  assert.strictEqual(saved().interval, 2);
});

test('a setting with no declared type is typed from its default', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const r = await init(['--no-feature', '--nothing', 'v']);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(saved().feature, false);
  assert.strictEqual(saved().nothing, 'v', 'a null default is untyped, so a string');
});

test('unknown and wrong-type settings fail and save nothing', async (t) => {
  const h = tempHome(); t.after(h.restore);
  await init(['--port', '7604']);
  const before = fs.readFileSync(config.configFile(NAME), 'utf8');
  const unknown = await init(['--prot', '7605']);
  assert.notStrictEqual(unknown.code, 0);
  assert.match(unknown.err, /^example-mcp: --prot is not a setting; did you mean --port\?$/);
  const wrong = await init(['--port', 'abc']);
  assert.match(wrong.err, /--port: "abc" is not a whole number/);
  const outOfRange = await init(['--port', '70000']);
  assert.notStrictEqual(outOfRange.code, 0);
  assert.match(outOfRange.err, /"port".*1 to 65535/);
  const jsonUnknown = await init(['{"prot":1}']);
  assert.match(jsonUnknown.err, /prot is not a setting; did you mean port\?/);
  assert.strictEqual(fs.readFileSync(config.configFile(NAME), 'utf8'), before);
});

test('init needs no server and starts none', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const port = await freePort();
  const r = await init(['--port', String(port)]);
  assert.strictEqual(r.code, 0, r.err);
  await assert.rejects(request(port, { path: '/health' }), /ECONNREFUSED/);
});

test('prompts: Enter keeps a value, an answer changes it', async (t) => {
  const h = tempHome(); t.after(h.restore);
  await init(['--log_level', 'warn']);
  const r = await init([], { stdin: '7650\n\n8\n' });
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /PROMPT port \[7561\]: /);
  assert.match(r.out, /PROMPT log_level \[warn\]: /);
  assert.match(r.out, /PROMPT interval \[5\]: /);
  const s = saved();
  assert.strictEqual(s.port, 7650);
  assert.strictEqual(s.log_level, 'warn');
  assert.strictEqual(s.interval, 8);
});

test('prompts: an invalid answer is reported and nothing is saved', async (t) => {
  const h = tempHome(); t.after(h.restore);
  await init(['--port', '7660']);
  const before = fs.readFileSync(config.configFile(NAME), 'utf8');
  const r = await init([], { stdin: '7661\nloud\n\n' });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /log_level: "loud" is not one of trace, debug, info, warn, error/);
  assert.strictEqual(fs.readFileSync(config.configFile(NAME), 'utf8'), before);
  const bad = await init([], { stdin: '70000\n\n\n' });
  assert.notStrictEqual(bad.code, 0);
  assert.strictEqual(fs.readFileSync(config.configFile(NAME), 'utf8'), before);
});

test('prompts: the end of input keeps the remaining values', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const r = await init([], { stdin: '7670\n' });
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(saved().port, 7670);
});

test('output: how to start the server and register it over stdio and HTTP', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const r = await init(['--port', '7680']);
  assert.match(r.out, /Start the server:\n  node .*index\.js/);
  assert.match(r.out, /claude mcp add example-mcp -- node .*index\.js --stdio/);
  assert.match(r.out, /"command": "node"/);
  assert.match(r.out, /claude mcp add --transport http example-mcp http:\/\/127\.0\.0\.1:7680\//);
});

test('init --help lists every setting with type, default and description, and saves nothing', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const r = await init(['--help']);
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /--port <integer>  default 7561  Port the server listens on/);
  assert.match(r.out, /--log_level <one of trace \| debug \| info \| warn \| error>  default "info"/);
  assert.match(r.out, /--feature <boolean>  default true/);
  assert.match(r.out, /--label <string>  default "x"  A label/);
  assert.match(r.out, /--reindex_defaults\.agent\.name <string>  default "x"/);
  assert.match(r.out, /--nothing <untyped \(sent as a string\)>/);
  assert.match(r.out, /--no-feature/);
  assert.ok(!fs.existsSync(config.configFile(NAME)), 'help saves nothing');
});

test('definition checks: settings, promptable', async () => {
  const { validateDefinition } = require('../src/launcher');
  assert.throws(() => validateDefinition({ defaultPort: 1, settings: { a: 1 } }, FIXTURE), /"settings".*Zod object/);
  assert.throws(() => validateDefinition({ defaultPort: 1, promptable: 'x' }, FIXTURE), /"promptable"/);
});

test('JSON settings are checked too: a bad framework setting saves nothing', async (t) => {
  const h = tempHome(); t.after(h.restore);
  await init(['--port', '7604']);
  const before = fs.readFileSync(config.configFile(NAME), 'utf8');
  const r = await init(['{"startupTimeoutMs":0}']);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /^example-mcp: .*"startupTimeoutMs" must be a whole number of at least 1/);
  assert.strictEqual(fs.readFileSync(config.configFile(NAME), 'utf8'), before);
});
