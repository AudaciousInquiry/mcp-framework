'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const helpers = require('./helpers');

const { tempHome, freePort, request, sleep, writeConfig, runLauncher, startServer, FIXTURE, shutdownAll } = helpers;
const HOOKS = path.join(FIXTURE, 'index-hooks.js');
const INDEX = path.join(FIXTURE, 'index.js');

async function setup(t, settings = {}) {
  const h = tempHome();
  const port = await freePort();
  writeConfig('example-mcp', { port, ...settings });
  t.after(async () => {
    await shutdownAll(port);
    h.restore();
  });
  return { h, port };
}

async function health(port) {
  return (await request(port, { path: '/health' })).json;
}

async function waitHealthy(port, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await request(port, { path: '/health' }); if (r.status === 200) return r.json; } catch { /* not yet */ }
    await sleep(100);
  }
  throw new Error('server did not become healthy');
}

/** A real SDK client talking to the bridge over stdio. */
async function connectBridge(env = {}, args = ['--stdio']) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [HOOKS, ...args],
    env: { ...process.env, ...env },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr.on('data', (d) => { stderr += d; });
  const client = new Client({ name: 'bridge-test', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport, stderr: () => stderr };
}

/** The bridge as a bare process, for checking exactly what it writes. */
function rawBridge(env = {}) {
  const child = spawn(process.execPath, [HOOKS, '--stdio'], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return {
    child, exited,
    stdout: () => out,
    stderr: () => err,
    send: (obj) => child.stdin.write(`${JSON.stringify(obj)}\n`),
    async waitForLine(ms = 15000) {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (out.includes('\n')) return; await sleep(25); }
      throw new Error(`no output from the bridge; stderr: ${err}`);
    },
  };
}

const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } };

/** SIGKILL the server and wait until its port stops answering, so the next call finds it gone. */
async function killServer(port) {
  const pid = (await health(port)).pid;
  process.kill(pid, 'SIGKILL');
  const end = Date.now() + 5000;
  for (;;) {
    try { await request(port, { path: '/health' }); } catch { return pid; }
    assert.ok(Date.now() < end, `the server (pid ${pid}) still answers 5 s after SIGKILL`);
    await sleep(50);
  }
}

async function callRetrying(client, name, args, tries = 40) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await client.callTool({ name, arguments: args }); } catch (e) { last = e; await sleep(250); }
  }
  throw last;
}

test('bridge starts the server, forwards, and writes only protocol messages to standard output', async (t) => {
  const { port } = await setup(t);
  const b = rawBridge();
  t.after(() => b.child.kill('SIGKILL'));
  b.send(INIT);
  await b.waitForLine();
  const lines = b.stdout().split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const msg = JSON.parse(line);
    assert.strictEqual(msg.jsonrpc, '2.0');
  }
  assert.strictEqual(JSON.parse(lines[0]).id, 1);
  assert.ok(JSON.parse(lines[0]).result.serverInfo);
  assert.match(b.stderr(), /started \(pid \d+\)/, 'the started notice is on standard error');
  assert.strictEqual((await health(port)).status, 'ok');
});

test('bridge uses a server that is already running and starts no other', async (t) => {
  const { port } = await setup(t);
  assert.strictEqual((await runLauncher(INDEX)).code, 0);
  const before = (await health(port)).pid;
  const { client } = await connectBridge();
  t.after(() => client.close());
  const r = await client.callTool({ name: 'add', arguments: { a: 1, b: 2 } });
  assert.strictEqual(r.content[0].text, '3');
  assert.strictEqual((await health(port)).pid, before);
});

test('a start that fails: reason on standard error, non-zero exit, nothing on standard output', async (t) => {
  await setup(t);
  const b = rawBridge({ EXAMPLE_STARTUP: 'throw' });
  t.after(() => b.child.kill('SIGKILL'));
  const code = await b.exited;
  assert.notStrictEqual(code, 0);
  assert.strictEqual(b.stdout(), '');
  assert.match(b.stderr(), /exited prematurely/);
});

test('a real client lists tools, calls them, gets progress notifications, and several clients share one server', async (t) => {
  const { port } = await setup(t);
  const a = await connectBridge();
  t.after(() => a.client.close());
  const b = await connectBridge();
  t.after(() => b.client.close());
  const tools = await a.client.listTools();
  assert.ok(tools.tools.some((x) => x.name === 'echo'));
  const [r1, r2] = await Promise.all([
    a.client.callTool({ name: 'echo', arguments: { text: 'from a' } }),
    b.client.callTool({ name: 'echo', arguments: { text: 'from b' } }),
  ]);
  assert.strictEqual(r1.content[0].text, 'from a');
  assert.strictEqual(r2.content[0].text, 'from b');
  const seen = [];
  const p = await a.client.callTool({ name: 'progress', arguments: {} }, undefined, { onprogress: (x) => seen.push(x.progress) });
  assert.strictEqual(p.content[0].text, 'progress done');
  assert.deepStrictEqual(seen, [1, 2], 'messages that are not responses reach the client');
  assert.strictEqual((await health(port)).status, 'ok');
});

test('a stray console.log in the start-up hook goes to standard error', async (t) => {
  await setup(t);
  const b = rawBridge({ EXAMPLE_HOOK: 'log' });
  t.after(() => b.child.kill('SIGKILL'));
  b.send(INIT);
  await b.waitForLine();
  assert.match(b.stderr(), /stray print from the hook/);
  assert.doesNotMatch(b.stdout(), /stray print/);
  for (const line of b.stdout().split(/\r?\n/).filter(Boolean)) JSON.parse(line);
});

test('closing standard input ends the bridge with status zero and leaves the server running', async (t) => {
  const { port } = await setup(t);
  const b = rawBridge();
  t.after(() => b.child.kill('SIGKILL'));
  b.send(INIT);
  await b.waitForLine();
  const pid = (await health(port)).pid;
  b.child.stdin.end();
  assert.strictEqual(await b.exited, 0);
  assert.strictEqual((await health(port)).pid, pid);
});

test('hook: runs before forwarding, can call tools, failure is logged and the bridge starts anyway', async (t) => {
  const { h } = await setup(t);
  const hookLog = path.join(h.home, 'hook.log');
  const calls = path.join(h.home, 'hook-calls.log');
  const ok = await connectBridge({ EXAMPLE_HOOK_LOG: hookLog, EXAMPLE_HOOK_CALL: calls });
  t.after(() => ok.client.close());
  assert.strictEqual(fs.readFileSync(hookLog, 'utf8'), 'hook ran\n', 'ran once, before the first message could be sent');
  assert.strictEqual(fs.readFileSync(calls, 'utf8').trim(), 'from the hook', 'ctx.client can call a tool');
  await ok.client.close();

  const bad = await connectBridge({ EXAMPLE_HOOK: 'throw' });
  t.after(() => bad.client.close());
  assert.match(bad.stderr(), /hook failed on purpose[\s\S]*at /);
  assert.strictEqual((await bad.client.callTool({ name: 'add', arguments: { a: 2, b: 2 } })).content[0].text, '4');
});

test('recovery: the server dies while idle: the first call errors with its id, the next succeeds, the hook runs again', async (t) => {
  const { h, port } = await setup(t);
  const hookLog = path.join(h.home, 'hook.log');
  const { client, stderr } = await connectBridge({ EXAMPLE_HOOK_LOG: hookLog });
  t.after(() => client.close());
  const dead = await killServer(port);
  await assert.rejects(client.callTool({ name: 'add', arguments: { a: 1, b: 1 } }), (e) => e.code === -32000);
  const r = await callRetrying(client, 'add', { a: 20, b: 22 });
  assert.strictEqual(r.content[0].text, '42');
  const now = await waitHealthy(port);
  assert.notStrictEqual(now.pid, dead);
  assert.match(stderr(), /restarting it/);
  assert.strictEqual(fs.readFileSync(hookLog, 'utf8'), 'hook ran\nhook ran\n', 'the hook ran again before forwarding resumed');
});

test('recovery: the server dies during a call: that request gets an error and later ones succeed', async (t) => {
  const { port } = await setup(t);
  const { client } = await connectBridge();
  t.after(() => client.close());
  const pid = (await health(port)).pid;
  const slow = client.callTool({ name: 'sleep', arguments: { ms: 20000 } }).then(() => 'answered', (e) => e);
  await sleep(500);
  const killedAt = Date.now();
  process.kill(pid, 'SIGKILL');
  const outcome = await slow;
  assert.strictEqual(outcome.code, -32000);
  assert.ok(Date.now() - killedAt < 10000, 'failed fast, not at the client timeout');
  const r = await callRetrying(client, 'add', { a: 3, b: 4 });
  assert.strictEqual(r.content[0].text, '7');
});

test('a request during the restart gets an immediate error', async (t) => {
  const { port } = await setup(t);
  const { client } = await connectBridge();
  t.after(() => client.close());
  await killServer(port);
  await assert.rejects(client.callTool({ name: 'add', arguments: { a: 1, b: 1 } }), (e) => e.code === -32000);
  // The restart is under way; this request must be answered at once and not queued.
  const started = Date.now();
  const second = await client.callTool({ name: 'add', arguments: { a: 1, b: 1 } }).then(() => 'ok', (e) => e);
  if (second !== 'ok') {
    assert.strictEqual(second.code, -32000);
    assert.ok(Date.now() - started < 2000, 'answered right away');
  }
  assert.strictEqual((await callRetrying(client, 'add', { a: 5, b: 5 })).content[0].text, '10');
});

test('a busy server (timeout) gets an error and is not restarted', async (t) => {
  const { port } = await setup(t);
  const { client } = await connectBridge({ EXAMPLE_BRIDGE_TIMEOUT: '600' });
  t.after(() => client.close());
  const pid = (await health(port)).pid;
  await assert.rejects(client.callTool({ name: 'sleep', arguments: { ms: 4000 } }), (e) => e.code === -32000);
  await sleep(500);
  assert.strictEqual((await health(port)).pid, pid, 'the server was left running');
});

test('an HTTP error status gets an error and the server is not restarted', async (t) => {
  const { port } = await setup(t, { maxBodyBytes: 3000 });
  const { client } = await connectBridge();
  t.after(() => client.close());
  const pid = (await health(port)).pid;
  await assert.rejects(client.callTool({ name: 'echo', arguments: { text: 'x'.repeat(5000) } }),
    (e) => e.code === -32000 && /413|maxBodyBytes/.test(e.message));
  assert.strictEqual((await health(port)).pid, pid, 'the server was left running');
  assert.strictEqual((await client.callTool({ name: 'echo', arguments: { text: 'small' } })).content[0].text, 'small', 'and later calls work');
});

test('several bridges recover together and end with one server', async (t) => {
  const { port } = await setup(t);
  const a = await connectBridge();
  t.after(() => a.client.close());
  const b = await connectBridge();
  t.after(() => b.client.close());
  const dead = await killServer(port);
  await Promise.all([
    a.client.callTool({ name: 'add', arguments: { a: 1, b: 1 } }).catch(() => {}),
    b.client.callTool({ name: 'add', arguments: { a: 1, b: 1 } }).catch(() => {}),
  ]);
  const [ra, rb] = await Promise.all([callRetrying(a.client, 'echo', { text: 'a' }), callRetrying(b.client, 'echo', { text: 'b' })]);
  assert.strictEqual(ra.content[0].text, 'a');
  assert.strictEqual(rb.content[0].text, 'b');
  const now = await health(port);
  assert.notStrictEqual(now.pid, dead);
});

test('a failed recovery closes the bridge with a non-zero status', async (t) => {
  const { port } = await setup(t);
  assert.strictEqual((await runLauncher(INDEX)).code, 0);
  const b = rawBridge({ EXAMPLE_STARTUP: 'throw' });
  t.after(() => b.child.kill('SIGKILL'));
  b.send(INIT);
  await b.waitForLine();
  process.kill((await health(port)).pid, 'SIGKILL');
  await sleep(300);
  b.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const code = await b.exited;
  assert.notStrictEqual(code, 0);
  assert.match(b.stderr(), /could not restart the server/);
});
