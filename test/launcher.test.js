'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const helpers = require('./helpers');
const config = require('../src/config');
const daemon = require('../src/daemon');
const { probeHealth } = require('../src/probe');
const { validateDefinition, parseLauncherArgs } = require('../src/launcher');

const { tempHome, freePort, request, sleep, writeConfig, fixtureVersion, runLauncher, startDummy, FIXTURE, shutdownAll } = helpers;
const NAME = 'example-mcp';
const INDEX = path.join(FIXTURE, 'index.js');

async function setup(t, settings = {}) {
  const h = tempHome();
  const port = await freePort();
  writeConfig(NAME, { port, ...settings });
  t.after(async () => {
    // Make sure nothing is left running, then remove the temporary home.
    await shutdownAll(port);
    h.restore();
  });
  return { h, port };
}

test('definition validation: each message names the field', () => {
  const dir = FIXTURE;
  assert.throws(() => validateDefinition({}, dir), /"defaultPort" is required/);
  assert.throws(() => validateDefinition({ defaultPort: 'x' }, dir), /"defaultPort".*1 to 65535/);
  assert.throws(() => validateDefinition({ defaultPort: 70000 }, dir), /"defaultPort".*1 to 65535/);
  assert.throws(() => validateDefinition({ defaultPort: 1, serverScript: 'missing.js' }, dir),
    (e) => e.message.includes(path.join(dir, 'missing.js')) && /does not exist/.test(e.message));
  assert.throws(() => validateDefinition({ defaultPort: 1, nodeArgs: 'x' }, dir), /"nodeArgs"/);
  assert.throws(() => validateDefinition({ defaultPort: 1, startupTimeoutMs: 0 }, dir), /"startupTimeoutMs"/);
  assert.throws(() => validateDefinition({ defaultPort: 1, onBridgeStart: 3 }, dir), /"onBridgeStart".*function/);
  const ok = validateDefinition({ defaultPort: 7561 }, dir);
  assert.strictEqual(ok.serverScript, 'server.js');
  assert.deepStrictEqual(ok.nodeArgs, []);
  assert.strictEqual(ok.startupTimeoutMs, 30000);
  assert.strictEqual(ok.defaults.port, 7561);
});

test('extra options: an added option is parsed, a reserved name is refused', () => {
  const handler = () => {};
  const def = validateDefinition({ defaultPort: 1, options: [{ name: '--rebuild', description: 'Rebuild', handler }] }, FIXTURE);
  assert.strictEqual(parseLauncherArgs(['--rebuild'], def).extra.name, '--rebuild');
  assert.throws(() => parseLauncherArgs(['--nope'], def), /unknown option --nope/);
  assert.throws(() => validateDefinition({ defaultPort: 1, options: [{ name: '--stop', description: 'x', handler }] }, FIXTURE),
    /"--stop" collides/);
  assert.throws(() => validateDefinition({ defaultPort: 1, options: [{ name: '--call', description: 'x', handler }] }, FIXTURE),
    /"--call" collides/);
});

test('health probe: up, refused, silent, other', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const port = await freePort();
  assert.strictEqual((await probeHealth(port, 1000)).state, 'refused');
  const silent = await startDummy('silent', port);
  t.after(silent.stop);
  const started = Date.now();
  assert.strictEqual((await probeHealth(port, 400)).state, 'silent');
  assert.ok(Date.now() - started < 3000);
  silent.stop();
  await sleep(300);
  const stubborn = await startDummy('stubborn', port, '3.2.1');
  t.after(stubborn.stop);
  const up = await probeHealth(port, 2000);
  assert.strictEqual(up.state, 'responded');
  assert.strictEqual(up.json.version, '3.2.1');
});

test('start: a normal start prints the pid, the server stays up, a second start reports it', async (t) => {
  const { port } = await setup(t);
  const r = await runLauncher(INDEX);
  assert.strictEqual(r.code, 0, r.stderr);
  const health = (await request(port, { path: '/health' })).json;
  assert.match(r.stdout, new RegExp(`started \\(pid ${health.pid}\\)`));
  const again = await runLauncher(INDEX);
  assert.strictEqual(again.code, 0);
  assert.match(again.stdout, /already running \(version 1\.0\.0/);
  assert.strictEqual((await request(port, { path: '/health' })).json.pid, health.pid);
});

test('start: a premature exit is reported with the exit code', async (t) => {
  await setup(t);
  const r = await runLauncher(INDEX, [], { env: { EXAMPLE_STARTUP: 'throw' } });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.stderr, /exited prematurely \(exit code 1\)/);
});

test('start: a timeout reports the pid and log file and leaves the server running', async (t) => {
  const { port } = await setup(t, { startupTimeoutMs: 400 });
  const r = await runLauncher(INDEX, [], { env: { EXAMPLE_STARTUP: 'slow' } });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.stderr, /not healthy after \d+ s; it may still be starting/);
  assert.match(r.stderr, /pid \d+/);
  assert.ok(r.stderr.includes('server.log'));
  const end = Date.now() + 15000;
  let health = null;
  while (Date.now() < end && !health) {
    try { health = (await request(port, { path: '/health' })).json; } catch { await sleep(200); }
  }
  assert.ok(health && health.status === 'ok', 'the server it started kept running and became healthy');
});

test('versions: same is reported, older is replaced, newer is refused with and without restart', async (t) => {
  const { port } = await setup(t);
  const v1 = fixtureVersion('1.0.0');
  const v11 = fixtureVersion('1.1.0');
  const v2 = fixtureVersion('2.0.0');
  t.after(() => [v1, v11, v2].forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  assert.strictEqual((await runLauncher(path.join(v1, 'index.js'))).code, 0);
  const first = (await request(port, { path: '/health' })).json;
  const same = await runLauncher(path.join(v1, 'index.js'));
  assert.match(same.stdout, /already running/);

  const up = await runLauncher(path.join(v11, 'index.js'));
  assert.strictEqual(up.code, 0, up.stderr);
  assert.match(up.stdout, /replacing it with 1\.1\.0/);
  const second = (await request(port, { path: '/health' })).json;
  assert.strictEqual(second.version, '1.1.0');
  assert.notStrictEqual(second.pid, first.pid);

  assert.strictEqual((await runLauncher(path.join(v2, 'index.js'), ['--restart'])).code, 0);
  assert.strictEqual((await request(port, { path: '/health' })).json.version, '2.0.0');

  for (const args of [[], ['--restart']]) {
    const newer = await runLauncher(path.join(v1, 'index.js'), args);
    assert.notStrictEqual(newer.code, 0);
    assert.match(newer.stderr, /newer version.*2\.0\.0.*--stop/);
    assert.strictEqual((await request(port, { path: '/health' })).json.version, '2.0.0');
  }
});

test('stop: graceful, and the port is free afterwards so an immediate start works', async (t) => {
  const { port } = await setup(t);
  await runLauncher(INDEX);
  const before = (await request(port, { path: '/health' })).json;
  const r = await runLauncher(INDEX, ['--stop']);
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, new RegExp(`pid ${before.pid}, version 1\\.0\\.0\\) stopped gracefully`));
  assert.ok(!fs.existsSync(config.pidFile(NAME)));
  await assert.rejects(request(port, { path: '/health' }), /ECONNREFUSED/);
  const again = await runLauncher(INDEX);
  assert.strictEqual(again.code, 0, again.stderr);
});

test('stop: a server that ignores /shutdown is killed', async (t) => {
  const { port } = await setup(t);
  const stubborn = await startDummy('stubborn', port);
  t.after(stubborn.stop);
  const r = await runLauncher(INDEX, ['--stop']);
  assert.strictEqual(r.code, 0, r.stderr);
  assert.match(r.stdout, /did not shut down on request and was killed/);
  await assert.rejects(request(port, { path: '/health' }), /ECONNREFUSED/);
});

test('stop and restart when nothing runs', async (t) => {
  const { port } = await setup(t);
  config.ensureDataDir(NAME);
  fs.writeFileSync(config.pidFile(NAME), '2147483646');
  const stop = await runLauncher(INDEX, ['--stop']);
  assert.strictEqual(stop.code, 0);
  assert.match(stop.stdout, /is not running/);
  assert.ok(!fs.existsSync(config.pidFile(NAME)), 'a stale process id file is removed');
  const restart = await runLauncher(INDEX, ['--restart']);
  assert.strictEqual(restart.code, 0, restart.stderr);
  assert.match(restart.stdout, /was not running/);
  assert.match(restart.stdout, /started/);
  assert.strictEqual((await request(port, { path: '/health' })).status, 200);
});

test('a restart replaces a running server', async (t) => {
  const { port } = await setup(t);
  await runLauncher(INDEX);
  const before = (await request(port, { path: '/health' })).json.pid;
  const r = await runLauncher(INDEX, ['--restart']);
  assert.strictEqual(r.code, 0, r.stderr);
  assert.notStrictEqual((await request(port, { path: '/health' })).json.pid, before);
});

test('a server that accepts but never answers is reported and left alone', async (t) => {
  const { port } = await setup(t, {});
  const silent = await startDummy('silent', port);
  t.after(silent.stop);
  const r = await runLauncher(INDEX, [], { env: {} });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.stderr, /not answering on port \d+; it may be busy/);
  assert.match(r.stderr, /--stop/);
  assert.strictEqual(silent.child.exitCode, null, 'the dummy was not killed');
});

test('port held by another program is reported', async (t) => {
  const { port } = await setup(t);
  const http = require('node:http');
  const srv = http.createServer((q, s) => { s.statusCode = 404; s.end('not ours'); });
  await new Promise((r) => srv.listen(port, '127.0.0.1', r));
  t.after(() => srv.close());
  const r = await runLauncher(INDEX);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.stderr, /in use by another program.*status 404: not ours/);
});

test('--log-level reaches the server it starts; a running server keeps its level and is told so', async (t) => {
  const { port } = await setup(t);
  const r = await runLauncher(INDEX, ['--log-level', 'debug']);
  assert.strictEqual(r.code, 0, r.stderr);
  await request(port, { method: 'POST', path: '/', headers: helpers.MCP_HEADERS, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
  const again = await runLauncher(INDEX, ['--log-level', 'error']);
  assert.match(again.stdout, /--log-level not applied, a restart is needed/);
  const bad = await runLauncher(INDEX, ['--log-level', 'loud']);
  assert.notStrictEqual(bad.code, 0);
  assert.match(bad.stderr, /--log-level is "loud".*trace, debug, info, warn, error/);
});

test('--debug starts the server with the log mirrored to the launcher\'s standard error', async (t) => {
  const { port } = await setup(t);
  const r = await runLauncher(INDEX, ['--debug']);
  assert.strictEqual(r.code, 0, r.stderr);
  const end = Date.now() + 3000;
  while (Date.now() < end && !/listening on/.test(r.stderr)) await sleep(50);
  void port;
  assert.match(r.stderr, /listening on 127\.0\.0\.1/);
});

test('respawn: several callers at once end with one healthy server', async (t) => {
  const { port } = await setup(t);
  const d = {
    name: NAME, version: '1.0.0', port, serverPath: path.join(FIXTURE, 'server.js'), nodeArgs: [],
    startupTimeoutMs: 20000, serverDefaults: { port }, say() {},
  };
  const results = await Promise.all([1, 2, 3, 4].map(() => daemon.respawn(d)));
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  const health = (await request(port, { path: '/health' })).json;
  assert.strictEqual(health.status, 'ok');
  const again = await daemon.respawn(d);
  assert.ok(again.ok);
  assert.strictEqual((await request(port, { path: '/health' })).json.pid, health.pid);
});
