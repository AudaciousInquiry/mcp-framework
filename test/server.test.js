'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const helpers = require('./helpers');
const config = require('../src/config');
const { McpServerBase } = require('../src/server');

const { tempHome, startServer, request, rpc, sleep, freePort } = helpers;
const NAME = 'example-mcp';

function logText() {
  try { return fs.readFileSync(path.join(config.logsDir(NAME), 'server.log'), 'utf8'); } catch { return ''; }
}

function call(port, name, args, id = 1) {
  return rpc(port, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
}

/** A JSON-RPC body of exactly `size` bytes. */
function bodyOfSize(size) {
  const base = '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"pad":""}}}';
  const cut = base.length - 4;
  return base.slice(0, cut) + 'x'.repeat(size - base.length) + base.slice(cut);
}

test('a startup that throws logs the stack, does not bind, writes no process id file, exits non-zero', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const port = await freePort();
  const s = await startServer({ port, env: { EXAMPLE_STARTUP: 'throw' }, waitHealthy: false });
  const { code } = await s.exited;
  assert.notStrictEqual(code, 0);
  assert.match(logText(), /startup failed: Error: startup failed on purpose[\s\S]*at /);
  assert.ok(!fs.existsSync(config.pidFile(NAME)));
  await assert.rejects(request(port, { path: '/health' }), /ECONNREFUSED/);
});

test('a server class without registerTools is refused', async (t) => {
  const h = tempHome(); t.after(h.restore);
  class Bare extends McpServerBase {}
  const exits = [];
  const b = new Bare({ packageDir: helpers.FIXTURE });
  b.exit = (c) => exits.push(c);
  const write = process.stderr.write;
  let out = '';
  process.stderr.write = (m) => { out += m; return true; };
  try { await b.run(); } finally { process.stderr.write = write; }
  assert.deepStrictEqual(exits, [1]);
  assert.match(out, /registerTools is required/);
});

test('routes: health, 404, 405 on GET and DELETE of /', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const s = await startServer(); t.after(() => s.stop());
  assert.strictEqual((await request(s.port, { path: '/health' })).status, 200);
  assert.strictEqual((await request(s.port, { path: '/nope' })).status, 404);
  assert.strictEqual((await request(s.port, { method: 'POST', path: '/nope' })).status, 404);
  const get = await request(s.port, { path: '/' });
  assert.strictEqual(get.status, 405);
  assert.strictEqual((await request(s.port, { method: 'DELETE', path: '/' })).status, 405);
  assert.strictEqual((await request(s.port, { method: 'PUT', path: '/' })).status, 404);
});

test('the server listens on loopback only', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const s = await startServer(); t.after(() => s.stop());
  const external = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
  if (!external) { t.skip('no non-loopback address on this machine'); return; }
  await new Promise((resolve, reject) => {
    const sock = net.connect({ host: external.address, port: s.port });
    sock.on('connect', () => { sock.destroy(); reject(new Error('connected on a non-loopback address')); });
    sock.on('error', (e) => { assert.strictEqual(e.code, 'ECONNREFUSED'); resolve(); });
  });
});

test('stateless: a call needs no handshake, survives a restart, carries no session header', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const port = await freePort();
  let s = await startServer({ port });
  let r = await call(port, 'add', { a: 2, b: 3 });
  assert.strictEqual(r.reply.result.content[0].text, '5');
  assert.strictEqual(r.headers['mcp-session-id'], undefined);
  await s.stop();
  s = await startServer({ port }); t.after(() => s.stop());
  r = await call(port, 'add', { a: 4, b: 5 });
  assert.strictEqual(r.reply.result.content[0].text, '9');
});

test('stateless: concurrent clients do not interfere', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const s = await startServer(); t.after(() => s.stop());
  const results = await Promise.all([1, 2, 3, 4, 5, 6].map((n) =>
    call(s.port, 'add', { a: n, b: n * 10 }, n)));
  results.forEach((r, i) => {
    const n = i + 1;
    assert.strictEqual(r.reply.id, n);
    assert.strictEqual(r.reply.result.content[0].text, String(n + n * 10));
  });
});

test('tool list shows every registered tool', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const s = await startServer(); t.after(() => s.stop());
  const r = await rpc(s.port, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
  const names = r.reply.result.tools.map((x) => x.name).sort();
  assert.deepStrictEqual(names, ['add', 'boom', 'echo', 'fail', 'inspect', 'mixed', 'sleep']);
  assert.strictEqual(r.reply.result.tools.find((x) => x.name === 'add').inputSchema.properties.a.type, 'integer');
});

test('tool errors are results; a throwing handler is an error result with the stack logged', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const s = await startServer(); t.after(() => s.stop());
  const failed = await call(s.port, 'fail', {});
  assert.strictEqual(failed.status, 200);
  assert.strictEqual(failed.reply.result.isError, true);
  const boom = await call(s.port, 'boom', {});
  assert.strictEqual(boom.status, 200);
  assert.strictEqual(boom.reply.result.isError, true);
  assert.match(boom.reply.result.content[0].text, /this tool always throws/);
  await sleep(100);
  assert.match(logText(), /tool boom threw: Error: this tool always throws[\s\S]*at /);
  assert.match(logText(), /tool add end|tool boom end error in \d+ ms/);
});

test('a registration failure gives 500 and the server keeps running', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const s = await startServer({ env: { EXAMPLE_REGISTER: 'throw' } }); t.after(() => s.stop());
  const r = await call(s.port, 'add', { a: 1, b: 1 });
  assert.strictEqual(r.status, 500);
  assert.match(r.json.error, /registration failed on purpose/);
  assert.strictEqual((await request(s.port, { path: '/health' })).status, 200);
});

test('malformed JSON is rejected and the server keeps running', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const s = await startServer(); t.after(() => s.stop());
  const r = await request(s.port, { method: 'POST', path: '/', headers: helpers.MCP_HEADERS, body: '{ nope' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.json.error.code, -32700);
  assert.strictEqual((await request(s.port, { path: '/health' })).status, 200);
});

test('an Origin header is refused everywhere, including the shutdown route and preflights', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const s = await startServer(); t.after(() => s.stop());
  for (const origin of ['http://localhost:3000', 'https://evil.example']) {
    const r = await request(s.port, { method: 'POST', path: '/', headers: { ...helpers.MCP_HEADERS, Origin: origin }, body: '{}' });
    assert.strictEqual(r.status, 403);
  }
  const shutdown = await request(s.port, { method: 'POST', path: '/shutdown', headers: { Origin: 'http://localhost:3000' } });
  assert.strictEqual(shutdown.status, 403);
  const pre = await request(s.port, {
    method: 'OPTIONS', path: '/',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
  });
  assert.strictEqual(pre.status, 403);
  assert.ok(!Object.keys(pre.headers).some((k) => k.startsWith('access-control-')));
  assert.strictEqual((await request(s.port, { path: '/health' })).status, 200, 'still running');
});

test('a Host other than loopback on the server port is refused', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const s = await startServer(); t.after(() => s.stop());
  for (const host of ['evil.example:7561', `evil.example:${s.port}`, '127.0.0.1:1', '127.0.0.1']) {
    assert.strictEqual((await request(s.port, { path: '/health', headers: { Host: host } })).status, 403, host);
  }
  for (const host of [`127.0.0.1:${s.port}`, `localhost:${s.port}`, `[::1]:${s.port}`]) {
    assert.strictEqual((await request(s.port, { path: '/health', headers: { Host: host } })).status, 200, host);
  }
});

test('request body limit: one byte under and over, default and override', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const s = await startServer(); t.after(() => s.stop());
  const send = (size) => request(s.port, { method: 'POST', path: '/', headers: helpers.MCP_HEADERS, body: bodyOfSize(size) });
  const under = await send(1048576);
  assert.strictEqual(under.status, 200);
  const over = await send(1048577);
  assert.strictEqual(over.status, 413);
  assert.match(over.json.error, /maxBodyBytes/);
  assert.strictEqual((await request(s.port, { path: '/health' })).status, 200);

  const small = await startServer({ defaults: { maxBodyBytes: 1000 } }); t.after(() => small.stop());
  const sendSmall = (size) => request(small.port, { method: 'POST', path: '/', headers: helpers.MCP_HEADERS, body: bodyOfSize(size) });
  assert.strictEqual((await sendSmall(1000)).status, 200);
  assert.strictEqual((await sendSmall(1001)).status, 413);
});

test('health: base fields, plugin fields, base fields win, failing extension still 200', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const s = await startServer(); t.after(() => s.stop());
  const body = (await request(s.port, { path: '/health' })).json;
  assert.strictEqual(body.status, 'ok');
  assert.strictEqual(body.version, '1.0.0');
  assert.strictEqual(body.pid, s.child.pid);
  assert.strictEqual(typeof body.uptime_seconds, 'number');
  assert.ok(Number.isInteger(body.uptime_seconds));
  assert.strictEqual(body.example, true);
  assert.ok(!('name' in body));

  const clash = await startServer({ env: { EXAMPLE_HEALTH: 'clash' } }); t.after(() => clash.stop());
  const cb = (await request(clash.port, { path: '/health' })).json;
  assert.strictEqual(cb.status, 'ok');
  assert.strictEqual(cb.pid, clash.child.pid);
  assert.strictEqual(cb.example, true);

  const bad = await startServer({ env: { EXAMPLE_HEALTH: 'throw' } }); t.after(() => bad.stop());
  const bb = await request(bad.port, { path: '/health' });
  assert.strictEqual(bb.status, 200);
  assert.strictEqual(bb.json.status, 'ok');
  assert.match(bb.json.extension_error, /failed on purpose/);
});

function dummy(port, handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

test('port in use by the same MCP: exit 0 quietly', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const port = await freePort();
  const srv = await dummy(port, (req, res) => {
    res.end(JSON.stringify({ status: 'ok', version: '0.0.1', pid: 1, uptime_seconds: 3 }));
  });
  t.after(() => srv.close());
  const s = await startServer({ port, waitHealthy: false });
  const { code } = await s.exited;
  assert.strictEqual(code, 0);
  assert.match(logText(), /already served by this MCP/);
});

test('port in use by another program: reported, exit non-zero', async (t) => {
  const h = tempHome(); t.after(h.restore);
  for (const handler of [
    (req, res) => { res.statusCode = 404; res.end('nothing here'); },
    (req, res) => { res.end('<html>not json</html>'); },
    (req, res) => { res.end(JSON.stringify({ status: 'ok' })); },
  ]) {
    const port = await freePort();
    const srv = await dummy(port, handler);
    const s = await startServer({ port, waitHealthy: false });
    const { code } = await s.exited;
    srv.close();
    assert.notStrictEqual(code, 0);
  }
  assert.match(logText(), /in use by another program, which answered \/health with status 404: nothing here/);
});

test('a bind error other than port-in-use exits non-zero', async () => {
  const b = new McpServerBase();
  const exits = [];
  b.exit = (c) => exits.push(c);
  b.config = { port: 1 };
  b.log = { fatal() {}, error() {}, info() {} };
  await b.bindFailed(Object.assign(new Error('permission denied'), { code: 'EACCES' }));
  assert.deepStrictEqual(exits, [1]);
});

test('process id file: written after the bind, replaces a stale one, removed at shutdown', async (t) => {
  const h = tempHome(); t.after(h.restore);
  config.ensureDataDir(NAME);
  fs.writeFileSync(config.pidFile(NAME), '2147483646');
  const s = await startServer();
  assert.strictEqual(fs.readFileSync(config.pidFile(NAME), 'utf8'), String(s.child.pid));
  await s.stop();
  assert.ok(!fs.existsSync(config.pidFile(NAME)));
});

test('shutdown: an in-flight request finishes, the hook completes, exit is zero', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const marker = path.join(h.home, 'marker.txt');
  const s = await startServer({ env: { EXAMPLE_MARKER: marker } });
  const slow = call(s.port, 'sleep', { ms: 700 });
  await sleep(150);
  const stop = await request(s.port, { method: 'POST', path: '/shutdown' });
  assert.strictEqual(stop.status, 200);
  const done = await slow;
  assert.strictEqual(done.reply.result.content[0].text, 'slept 700');
  const { code } = await s.exited;
  assert.strictEqual(code, 0);
  assert.strictEqual(fs.readFileSync(marker, 'utf8'), 'shutdown ran', 'the hook finished before the process exited');
  assert.ok(!fs.existsSync(config.pidFile(NAME)));
});

test('shutdown: a request that outlasts the drain is cut off and the server still exits', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const s = await startServer({ defaults: { drainMs: 300 } });
  const slow = call(s.port, 'sleep', { ms: 20000 }).then(() => 'answered', () => 'cut');
  await sleep(150);
  const started = Date.now();
  await request(s.port, { method: 'POST', path: '/shutdown' });
  const { code } = await s.exited;
  assert.strictEqual(code, 0);
  assert.ok(Date.now() - started < 8000, 'did not wait for the 20 s request');
  assert.strictEqual(await slow, 'cut');
});

test('shutdown: a repeated trigger is ignored', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const marker = path.join(h.home, 'marker.txt');
  const s = await startServer({ env: { EXAMPLE_MARKER: marker } });
  const a = request(s.port, { method: 'POST', path: '/shutdown' });
  const b = request(s.port, { method: 'POST', path: '/shutdown' }).catch(() => ({ status: 'closed' }));
  await Promise.all([a, b]);
  const { code } = await s.exited;
  assert.strictEqual(code, 0);
  assert.match(logText(), /shutting down/);
  assert.strictEqual((logText().match(/shutting down/g) || []).length, 1);
});

test('shutdown on SIGTERM (not delivered on Windows)', async (t) => {
  if (process.platform === 'win32') { t.skip('Windows delivers no handler-run signals to another process'); return; }
  const h = tempHome(); t.after(h.restore);
  const s = await startServer();
  s.child.kill('SIGTERM');
  assert.strictEqual((await s.exited).code, 0);
});

test('a failure in afterListening is logged and the server shuts down non-zero', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const s = await startServer({ env: { EXAMPLE_AFTER: 'throw' }, waitHealthy: false });
  const { code } = await s.exited;
  assert.strictEqual(code, 1);
  assert.match(logText(), /afterListening failed: Error: afterListening failed on purpose[\s\S]*at /);
  assert.ok(!fs.existsSync(config.pidFile(NAME)));
});

test('slow setup after listening does not block health', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const s = await startServer({ env: { EXAMPLE_AFTER: 'slow' } }); t.after(() => s.stop());
  assert.strictEqual((await request(s.port, { path: '/health' })).status, 200);
  assert.strictEqual((await call(s.port, 'add', { a: 1, b: 2 })).reply.result.content[0].text, '3');
});
