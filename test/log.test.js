'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { tempHome } = require('./helpers');
const config = require('../src/config');
const log = require('../src/log');

const CHILD = path.join(__dirname, 'fixtures', 'log-child.js');

function runChild(options, home) {
  return spawnSync(process.execPath, [CHILD, JSON.stringify(options)], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
  });
}

function logText(name) {
  return fs.readFileSync(path.join(config.logsDir(name), 'server.log'), 'utf8');
}

test('level variable is derived from the name', () => {
  assert.strictEqual(log.levelVariable('my-mcp'), 'MY_MCP_LOG_LEVEL');
});

test('level precedence: option, environment, setting, default', () => {
  assert.strictEqual(log.resolveLevel({}), 'info');
  assert.strictEqual(log.resolveLevel({ setting: 'debug' }), 'debug');
  assert.strictEqual(log.resolveLevel({ env: 'error', setting: 'debug' }), 'error');
  assert.strictEqual(log.resolveLevel({ option: 'trace', env: 'error', setting: 'debug' }), 'trace');
  assert.strictEqual(log.resolveLevel({ option: 'WARN' }), 'warn');
});

test('invalid level names the source and the allowed values', () => {
  assert.throws(() => log.resolveLevel({ setting: 'loud' }),
    /setting "log_level" is "loud".*trace, debug, info, warn, error/);
  assert.throws(() => log.resolveLevel({ env: 'loud', variable: 'MY_MCP_LOG_LEVEL' }), /MY_MCP_LOG_LEVEL is "loud"/);
  assert.throws(() => log.resolveLevel({ option: 'loud' }), /--log-level is "loud"/);
});

test('line format and default level', (t) => {
  const h = tempHome(); t.after(h.restore);
  const r = runChild({ name: 'fmt', category: 'indexer' }, h.home);
  assert.strictEqual(r.status, 0, r.stderr);
  const text = logText('fmt');
  assert.match(text, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}(?:[+-]\d\d:\d\d|Z) INFO indexer hello\r?$/m);
  assert.doesNotMatch(text, /a debug line/);
});

test('configured level lets debug lines through', (t) => {
  const h = tempHome(); t.after(h.restore);
  runChild({ name: 'lvl', level: 'debug' }, h.home);
  assert.match(logText('lvl'), /DEBUG child a debug line/);
});

test('size roll-over with a lowered limit', (t) => {
  const h = tempHome(); t.after(h.restore);
  const r = runChild({ name: 'roll', mode: 'many', count: 100, maxLogSize: 4096 }, h.home);
  assert.strictEqual(r.status, 0, r.stderr);
  const files = fs.readdirSync(config.logsDir('roll')).filter((f) => f.startsWith('server'));
  assert.ok(files.length > 1, `expected several files, found ${files}`);
  assert.ok(files.length <= 8, 'at most the current file and 7 backups');
});

test('unwritable log folder: lines go to standard error and the process keeps running', (t) => {
  const h = tempHome(); t.after(h.restore);
  fs.mkdirSync(config.dataDir('bad'), { recursive: true });
  fs.writeFileSync(config.logsDir('bad'), 'a file where the folder should be');
  const r = runChild({ name: 'bad' }, h.home);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stderr, /INFO child hello/);
});

test('worker thread logs to the same file at the same level', (t) => {
  const h = tempHome(); t.after(h.restore);
  const r = runChild({ name: 'wk', level: 'debug', mode: 'worker' }, h.home);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(logText('wk'), /DEBUG worker hello from the worker/);
});

test('exception in a timer: trace written, exit non-zero', (t) => {
  const h = tempHome(); t.after(h.restore);
  const r = runChild({ name: 'fatal', mode: 'timer-throw' }, h.home);
  assert.notStrictEqual(r.status, 0);
  const text = logText('fatal');
  assert.match(text, /FATAL server uncaught exception: Error: boom in timer/);
  assert.match(text, /at /);
  assert.match(r.stderr, /boom in timer/);
});

test('unhandled rejection: reason and stack written, exit non-zero', (t) => {
  const h = tempHome(); t.after(h.restore);
  const r = runChild({ name: 'rej', mode: 'rejection' }, h.home);
  assert.notStrictEqual(r.status, 0);
  assert.match(logText('rej'), /unhandled rejection: Error: boom rejected/);
});

test('debug mirror: lines reach a connected standard error', (t) => {
  const h = tempHome(); t.after(h.restore);
  const r = runChild({ name: 'mir', debug: true }, h.home);
  assert.match(r.stderr, /INFO child hello/);
  assert.match(logText('mir'), /INFO child hello/);
});

test('debug mirror: closing standard error mid-run does not stop the server or its log', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const child = spawn(process.execPath, [CHILD, JSON.stringify({ name: 'closed', debug: true, mode: 'steady' })], {
    env: { ...process.env, HOME: h.home, USERPROFILE: h.home },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await new Promise((resolve) => child.stderr.once('data', resolve));
  child.stderr.destroy();
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.strictEqual(code, 0);
  assert.match(logText('closed'), /finished/);
});

test('timing helper costs nothing at info and reports at debug', () => {
  const lines = [];
  const quiet = { isDebugEnabled: () => false, debug: (m) => lines.push(m) };
  assert.strictEqual(log.timed(quiet, 'job', () => 42), 42);
  assert.deepStrictEqual(lines, []);
  const loud = { isDebugEnabled: () => true, debug: (m) => lines.push(m) };
  log.timed(loud, 'slow job', () => { const end = Date.now() + 30; while (Date.now() < end); }, 10);
  assert.match(lines[0], /slow job held the main thread for/);
});
