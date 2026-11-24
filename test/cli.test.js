'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const helpers = require('./helpers');
const config = require('../src/config');
const { launch } = require('../src/launcher');

const { tempHome, freePort, request, sleep, writeConfig, runLauncher, startServer, FIXTURE } = helpers;
const NAME = 'example-mcp';
const INDEX = path.join(FIXTURE, 'index.js');

async function setup(t) {
  const h = tempHome();
  const port = await freePort();
  writeConfig(NAME, { port });
  t.after(async () => {
    try { await Promise.race([request(port, { method: 'POST', path: '/shutdown' }), sleep(1500)]); } catch { /* not running */ }
    await sleep(300);
    h.restore();
  });
  return { h, port };
}

/** Run the launcher in-process (fast) with captured output. */
async function cli(args, definition = {}, cwd) {
  const out = [];
  const err = [];
  const base = { defaultPort: 7561, tools: require('./fixtures/example-mcp/tools'), ...definition };
  const code = await launch(base, args, { out: (m) => out.push(m), err: (m) => err.push(m) }, FIXTURE, 'index.js', cwd);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

function serverFor(t, port) {
  return startServer({ port }).then((s) => { t.after(() => s.stop()); return s; });
}

test('health and call refuse when the server is not running, and start nothing', async (t) => {
  const { port } = await setup(t);
  for (const args of [['health'], ['call', 'echo', '--text', 'x']]) {
    const r = await cli(args);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.err, new RegExp(`example-mcp: .*not reachable on port ${port}.*start it with the launcher`));
  }
  await assert.rejects(request(port, { path: '/health' }), /ECONNREFUSED/, 'no server was started');
});

test('an unreachable server is given up on quickly', async (t) => {
  await setup(t);
  const started = Date.now();
  await cli(['health']);
  assert.ok(Date.now() - started < 5000);
});

test('health: indented JSON, exit zero; an unhealthy answer is reported with a non-zero exit', async (t) => {
  const { port } = await setup(t);
  const s = await serverFor(t, port);
  const r = await cli(['health']);
  assert.strictEqual(r.code, 0);
  const body = JSON.parse(r.out);
  assert.strictEqual(body.pid, s.child.pid);
  assert.match(r.out, /\n  "status": "ok"/, 'indented');

  const http = require('node:http');
  const port2 = await freePort();
  writeConfig(NAME, { port: port2 });
  const sick = http.createServer((q, res) => { res.statusCode = 503; res.end('overloaded'); });
  await new Promise((resolve) => sick.listen(port2, '127.0.0.1', resolve));
  t.after(() => sick.close());
  const bad = await cli(['health']);
  assert.notStrictEqual(bad.code, 0);
  assert.match(bad.err, /unhealthy: \/health answered status 503: overloaded/);
});

test('list works with no server: names, descriptions, parameters, types, required marks', async (t) => {
  await setup(t);
  const r = await cli(['list']);
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /^echo: Return the text it is given\.$/m);
  assert.match(r.out, /^  text  string  required  Text to echo$/m);
  assert.match(r.out, /^  count  integer  optional  A whole number$/m);
  assert.match(r.out, /^  level  enum\(low\|high\)  optional$/m);
  assert.match(r.out, /^  tags  string\[\]  optional  A list of strings$/m);
  assert.match(r.out, /^  provenance  object  optional$/m);
  assert.doesNotMatch(r.out, /session_id/, 'nested fields are not expanded');
  assert.match(r.out, /^fail: Return an error result\.$/m);
  assert.doesNotMatch(r.out, /^fail: .*\n  /m, 'a tool without parameters has no parameter lines');
});

test('call: text result to standard output, exit zero', async (t) => {
  const { port } = await setup(t);
  await serverFor(t, port);
  const r = await cli(['call', 'echo', '--text', 'hello there']);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(r.out, 'hello there');
  const inline = await cli(['call', 'add', '{"a":2,"b":3}']);
  assert.strictEqual(inline.out, '5');
  const flags = await cli(['call', 'add', '--a', '4', '--b=5']);
  assert.strictEqual(flags.out, '9');
});

test('call: JSON from a file, flags on top of it', async (t) => {
  const { port, h } = await setup(t);
  await serverFor(t, port);
  const file = path.join(h.home, 'args.json');
  fs.writeFileSync(file, '{"a":10,"b":20}');
  assert.strictEqual((await cli(['call', 'add', `@${file}`])).out, '30');
  assert.strictEqual((await cli(['call', 'add', `@${file}`, '--b', '1'])).out, '11');
});

test('call: an error result goes to standard error with a non-zero exit', async (t) => {
  const { port } = await setup(t);
  await serverFor(t, port);
  const r = await cli(['call', 'fail']);
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.err, 'this tool always fails');
  const boom = await cli(['call', 'boom']);
  assert.strictEqual(boom.code, 1);
  assert.match(boom.err, /this tool always throws/);
});

test('call: missing tool name, unknown tool, invalid JSON, missing file', async (t) => {
  const { port } = await setup(t);
  await serverFor(t, port);
  const none = await cli(['call']);
  assert.notStrictEqual(none.code, 0);
  assert.match(none.err, /usage: call <tool>/);
  const unknown = await cli(['call', 'nope']);
  assert.match(unknown.err, /unknown tool "nope"; run list/);
  const bad = await cli(['call', 'echo', '{nope']);
  assert.match(bad.err, /the arguments must be valid JSON or @file/);
  const missing = await cli(['call', 'echo', '@/no/such/file.json']);
  assert.match(missing.err, /cannot read the file .*file\.json/);
});

test('call: a tool registered at run time takes JSON only', async (t) => {
  const { port } = await setup(t);
  await serverFor(t, port);
  const flags = await cli(['call', 'runtime_tool', '--x', '1']);
  assert.match(flags.err, /"runtime_tool" has no declared schema, so flag-style arguments cannot be used/);
  const json = await cli(['call', 'runtime_tool', '{"x":1}']);
  assert.notStrictEqual(json.code, 0, 'the server does not know it, but the JSON was sent');
  assert.doesNotMatch(json.err, /no declared schema/);
});

test('call: non-text content prints only the text items, joined by newlines', async (t) => {
  const { port } = await setup(t);
  await serverFor(t, port);
  const r = await cli(['call', 'mixed']);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(r.out, 'first\nsecond');
});

test('argument errors are one line and nothing reaches a server', async (t) => {
  const { port } = await setup(t);
  const unknown = await cli(['call', 'echo', '--txt', 'x']);
  assert.strictEqual(unknown.code, 1);
  assert.match(unknown.err, /^example-mcp: --txt is not an argument of tool "echo"; did you mean --text\?$/);
  const wrong = await cli(['call', 'add', '--a', 'abc']);
  assert.match(wrong.err, /^example-mcp: --a: "abc" is not a whole number$/);
  await assert.rejects(request(port, { path: '/health' }), /ECONNREFUSED/);
});

test('an unexpected failure includes the stack', async (t) => {
  await setup(t);
  const r = await cli(['call', 'echo', '--text', 'x'], { defaultArguments: () => { throw new Error('hook blew up'); } });
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /example-mcp: unexpected failure: Error: hook blew up\n\s+at /);
});

test('default arguments: the MCP fills a missing field and the user\'s value wins', async (t) => {
  const { port } = await setup(t);
  await serverFor(t, port);
  const seen = [];
  const definition = {
    defaultArguments: (tool, args) => { seen.push(tool); return { ...args, title: 'from-hook', code: 'hook-code' }; },
  };
  const filled = JSON.parse((await cli(['call', 'inspect'], definition)).out);
  assert.deepStrictEqual(filled, { title: 'from-hook', code: 'hook-code' });
  const mine = JSON.parse((await cli(['call', 'inspect', '--title', 'mine'], definition)).out);
  assert.deepStrictEqual(mine, { title: 'mine', code: 'hook-code' });
  const plain = JSON.parse((await cli(['call', 'inspect', '--title', 'x'])).out);
  assert.deepStrictEqual(plain, { title: 'x' });
  assert.deepStrictEqual(seen, ['inspect', 'inspect']);
});

test('call <tool> --help lists the arguments from the tools file with nothing listening', async (t) => {
  await setup(t);
  const r = await cli(['call', 'inspect', '--help']);
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /^call inspect$/m);
  assert.match(r.out, /--count <integer>  optional  A whole number/);
  assert.match(r.out, /--provenance\.agent\.name <string>/);
  assert.match(r.out, /file path; a relative path is resolved against the current directory/);
  assert.match(r.out, /--no-verbose/);
  const unknown = await cli(['call', 'nope', '--help']);
  assert.match(unknown.err, /unknown tool "nope"/);
});

test('--help and -h print every option and command, the configuration location and the default port', async (t) => {
  await setup(t);
  const handler = () => {};
  for (const flag of ['--help', '-h']) {
    const r = await cli([flag], { options: [{ name: '--rebuild', description: 'Rebuild the index', handler }] });
    assert.strictEqual(r.code, 0);
    for (const item of ['--stop', '--restart', '--stdio', '--debug', '--log-level', 'health', 'list', 'call <tool>', 'init', '--rebuild  ', 'Rebuild the index']) {
      assert.ok(r.out.includes(item), `help mentions ${item}`);
    }
    assert.ok(r.out.includes(config.configFile(NAME)));
    assert.match(r.out, /Default port: 7561/);
    assert.match(r.out, /^example-mcp 1\.0\.0$/m);
  }
});

test('the real launcher process: list needs no server, call reaches a started server', async (t) => {
  const { port } = await setup(t);
  const list = await runLauncher(INDEX, ['list']);
  assert.strictEqual(list.code, 0, list.stderr);
  assert.match(list.stdout, /^echo: /m);
  await assert.rejects(request(port, { path: '/health' }), /ECONNREFUSED/);
  assert.strictEqual((await runLauncher(INDEX)).code, 0);
  const call = await runLauncher(INDEX, ['call', 'echo', '--text', 'over the wire']);
  assert.strictEqual(call.code, 0, call.stderr);
  assert.strictEqual(call.stdout.trim(), 'over the wire');
});
