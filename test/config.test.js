'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { tempHome } = require('./helpers');
const config = require('../src/config');

test('data directory is created on demand and never shared', (t) => {
  const h = tempHome(); t.after(h.restore);
  config.ensureDataDir('one');
  config.ensureDataDir('two');
  assert.ok(fs.statSync(path.join(h.home, '.mcp', 'one', 'logs')).isDirectory());
  assert.notStrictEqual(config.dataDir('one'), config.dataDir('two'));
  assert.ok(config.dataDir('one').startsWith(h.home));
});

test('declared default port, user override, refusal without a port', (t) => {
  const h = tempHome(); t.after(h.restore);
  assert.strictEqual(config.loadConfig({ name: 'a', defaults: { port: 7561 } }).port, 7561);
  fs.writeFileSync(config.configFile('a'), '{"port": 7777}');
  assert.strictEqual(config.loadConfig({ name: 'a', defaults: { port: 7561 } }).port, 7777);
  assert.throws(() => config.loadConfig({ name: 'b', defaults: {} }), /default port is required/);
});

test('stored values over defaults; nested merge; unknown keys kept', (t) => {
  const h = tempHome(); t.after(h.restore);
  config.ensureDataDir('a');
  fs.writeFileSync(config.configFile('a'), '{"nested":{"a":1},"extra":true}');
  const c = config.loadConfig({ name: 'a', defaults: { port: 1000, nested: { a: 0, b: 2 }, added: 'x' } });
  assert.deepStrictEqual({ ...c }, { port: 1000, nested: { a: 1, b: 2 }, added: 'x', extra: true });
});

test('invalid JSON and bad ports are reported and the file is untouched', (t) => {
  const h = tempHome(); t.after(h.restore);
  config.ensureDataDir('a');
  const file = config.configFile('a');
  fs.writeFileSync(file, '{ not json');
  assert.throws(() => config.loadConfig({ name: 'a', defaults: { port: 1 }, writeDefaults: true }),
    (e) => e.message.includes(file) && /not valid JSON/.test(e.message));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{ not json');
  for (const bad of ['0', '70000', '"abc"', '1.5']) {
    fs.writeFileSync(file, `{"port": ${bad}}`);
    assert.throws(() => config.loadConfig({ name: 'a', defaults: { port: 1 } }), /"port".*1 to 65535/);
  }
});

test('first run writes defaults on the launcher side; the server writes nothing', (t) => {
  const h = tempHome(); t.after(h.restore);
  const c = config.loadConfig({ name: 'srv', defaults: { port: 5 } });
  assert.strictEqual(c.port, 5);
  assert.ok(!fs.existsSync(config.configFile('srv')));
  config.loadConfig({ name: 'cli', defaults: { port: 6, k: 'v' }, writeDefaults: true });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(config.configFile('cli'), 'utf8')), { port: 6, k: 'v' });
});

test('two simultaneous creators: the loser reads what the winner wrote', (t) => {
  const h = tempHome(); t.after(h.restore);
  config.ensureDataDir('race');
  let first = true;
  const racing = Object.assign(Object.create(fs), {
    readFileSync(f, enc) {
      if (first) {
        first = false;
        fs.writeFileSync(f, '{"port": 9000}');
        const e = new Error('missing'); e.code = 'ENOENT'; throw e;
      }
      return fs.readFileSync(f, enc);
    },
  });
  const c = config.loadConfig({ name: 'race', defaults: { port: 1 }, writeDefaults: true, fs: racing });
  assert.strictEqual(c.port, 9000);
});

test('save: no argument stores in-place changes', (t) => {
  const h = tempHome(); t.after(h.restore);
  const c = config.loadConfig({ name: 'a', defaults: { port: 1, n: 5 }, writeDefaults: true });
  c.n = 6;
  const out = c.save();
  assert.deepStrictEqual(out, { port: 1, n: 6 });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(config.configFile('a'), 'utf8')), { port: 1, n: 6 });
});

test('save: partial update, zero as a value, nothing but settings written', (t) => {
  const h = tempHome(); t.after(h.restore);
  const c = config.loadConfig({ name: 'a', defaults: { port: 1, n: 5, o: { x: 1, y: 2 } }, writeDefaults: true });
  const out = c.save({ n: 0, o: { x: 9 } });
  assert.deepStrictEqual(out, { port: 1, n: 0, o: { x: 9, y: 2 } });
  assert.strictEqual(c.n, 0);
  assert.ok(!('save' in JSON.parse(fs.readFileSync(config.configFile('a'), 'utf8'))));
});

test('save: the MCP normalizes', (t) => {
  const h = tempHome(); t.after(h.restore);
  const c = config.loadConfig({
    name: 'a', defaults: { port: 1, n: 5 }, writeDefaults: true,
    validate: (cand) => ({ ...cand, n: Math.max(cand.n, 10) }),
  });
  assert.strictEqual(c.save({ n: 2 }).n, 10);
  assert.strictEqual(JSON.parse(fs.readFileSync(config.configFile('a'), 'utf8')).n, 10);
});

test('save: rejection changes nothing in memory or on disk', (t) => {
  const h = tempHome(); t.after(h.restore);
  const c = config.loadConfig({
    name: 'a', defaults: { port: 1, n: 5 }, writeDefaults: true,
    validate: (cand) => { if (cand.n < 0) throw new Error('n must not be negative'); },
  });
  const before = fs.readFileSync(config.configFile('a'), 'utf8');
  assert.throws(() => c.save({ n: -1 }), /must not be negative/);
  assert.throws(() => c.save({ port: 0 }), /"port"/);
  assert.strictEqual(c.n, 5);
  assert.strictEqual(fs.readFileSync(config.configFile('a'), 'utf8'), before);
});

test('save: a failed write leaves the old file complete', (t) => {
  const h = tempHome(); t.after(h.restore);
  const failing = Object.assign(Object.create(fs), {
    renameSync() { throw new Error('disk full'); },
  });
  const c = config.loadConfig({ name: 'a', defaults: { port: 1, n: 5 }, writeDefaults: true, fs: failing });
  const before = fs.readFileSync(config.configFile('a'), 'utf8');
  assert.throws(() => c.save({ n: 7 }), /disk full/);
  assert.strictEqual(fs.readFileSync(config.configFile('a'), 'utf8'), before);
  assert.strictEqual(c.n, 5);
  assert.deepStrictEqual(fs.readdirSync(config.dataDir('a')).filter((f) => f.endsWith('.tmp')), []);
});

test('an unknown key in the file is kept when the configuration is saved', (t) => {
  const h = tempHome(); t.after(h.restore);
  config.ensureDataDir('a');
  fs.writeFileSync(config.configFile('a'), '{"port": 5, "extra": {"keep": true}}');
  const c = config.loadConfig({ name: 'a', defaults: { port: 5 } });
  c.save({ port: 6 });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(config.configFile('a'), 'utf8')), { port: 6, extra: { keep: true } });
});

test('framework settings are type-checked on load and on save', (t) => {
  const h = tempHome(); t.after(h.restore);
  config.ensureDataDir('a');
  fs.writeFileSync(config.configFile('a'), '{"drainMs": "x"}');
  assert.throws(() => config.loadConfig({ name: 'a', defaults: { port: 5 } }), /"drainMs" must be a whole number of at least 0/);
  fs.writeFileSync(config.configFile('a'), '{"log_level": "loud"}');
  assert.throws(() => config.loadConfig({ name: 'a', defaults: { port: 5 } }), /"log_level" must be one of trace, debug, info, warn, error/);
  fs.writeFileSync(config.configFile('a'), '{}');
  const c = config.loadConfig({ name: 'a', defaults: { port: 5 } });
  const before = fs.readFileSync(config.configFile('a'), 'utf8');
  for (const bad of [{ startupTimeoutMs: 0 }, { maxBodyBytes: 'x' }, { drainMs: -1 }]) {
    assert.throws(() => c.save(bad), /must be a whole number/);
  }
  assert.strictEqual(fs.readFileSync(config.configFile('a'), 'utf8'), before);
});
