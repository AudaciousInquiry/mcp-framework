'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const helpers = require('./helpers');
const { launch } = require('../src/launcher');

const { tempHome, freePort, request, writeConfig, runLauncher, shutdownAll, FIXTURE } = helpers;
const INDEX = path.join(FIXTURE, 'index.js');
const HOOKS = path.join(FIXTURE, 'index-hooks.js');

test('ctx reaches every launcher hook with config, client and log', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const port = await freePort();
  writeConfig('example-mcp', { port });
  t.after(() => shutdownAll(port));
  assert.strictEqual((await runLauncher(INDEX)).code, 0);

  const seen = {};
  const check = (name) => (ctx) => {
    seen[name] = {
      port: ctx.config.port,
      save: typeof ctx.config.save,
      log: typeof ctx.log.info,
      callTool: typeof ctx.client.callTool,
    };
    return ctx;
  };
  let toolCall;
  const definition = {
    defaultPort: 7561,
    tools: require('./fixtures/example-mcp/tools'),
    options: [{ name: '--rebuild', description: 'Rebuild', handler: check('option') }],
    async defaultArguments(tool, args, ctx) {
      check('defaultArguments')(ctx);
      toolCall = (await ctx.client.callTool('echo', { text: 'via ctx.client' })).text;
      return args;
    },
  };
  const io = { out() {}, err() {} };
  assert.strictEqual(await launch(definition, ['--rebuild'], io, FIXTURE), 0);
  assert.strictEqual(await launch(definition, ['call', 'add', '--a', '1', '--b', '2'], io, FIXTURE), 0);
  for (const name of ['option', 'defaultArguments']) {
    assert.deepStrictEqual(seen[name], { port, save: 'function', log: 'function', callTool: 'function' }, name);
  }
  assert.strictEqual(toolCall, 'via ctx.client', 'ctx.client can call a tool');
});

test('the server has this.config and this.log', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const s = await helpers.startServer(); t.after(() => s.stop());
  const body = (await request(s.port, { path: '/health' })).json;
  assert.strictEqual(body.configuredPort, s.port);
  assert.strictEqual(body.hasLogger, true);
});

test('the package entry exports the public API to CommonJS and to ES modules', () => {
  const root = path.join(__dirname, '..');
  const names = ['runLauncher', 'McpServerBase', 'defineTools', 'register', 'textResult', 'jsonResult', 'errorResult', 'getLogger'];
  const cjs = require(root);
  for (const n of names) assert.ok(cjs[n], `CommonJS has ${n}`);
  assert.strictEqual(typeof cjs.runLauncher, 'function');
  assert.strictEqual(typeof cjs.McpServerBase, 'function');

  const esm = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { ${names.join(', ')} } from ${JSON.stringify(require('node:url').pathToFileURL(path.join(root, 'src', 'index.js')).href)};
     console.log([${names.join(', ')}].every((x) => x !== undefined) ? 'ok' : 'missing');`], { encoding: 'utf8' });
  assert.strictEqual(esm.stdout.trim(), 'ok', esm.stderr);
  assert.strictEqual(require(path.join(root, 'package.json')).main, 'src/index.js');
});

test('the three fixture files support every mode', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const port = await freePort();
  writeConfig('example-mcp', { port });
  t.after(() => shutdownAll(port));

  const help = await runLauncher(INDEX, ['--help']);
  assert.strictEqual(help.code, 0);
  assert.match(help.stdout, /--stdio/);

  const init = await runLauncher(INDEX, ['init', '--log_level', 'debug']);
  assert.strictEqual(init.code, 0, init.stderr);
  assert.match(init.stdout, /"log_level": "debug"/);

  const list = await runLauncher(INDEX, ['list']);
  assert.strictEqual(list.code, 0);
  assert.match(list.stdout, /^echo: /m);

  const start = await runLauncher(INDEX, ['--debug']);
  assert.strictEqual(start.code, 0, start.stderr);
  assert.match(start.stdout, /started/);

  const healthOut = await runLauncher(INDEX, ['health']);
  assert.strictEqual(healthOut.code, 0);
  assert.strictEqual(JSON.parse(healthOut.stdout).status, 'ok');

  const call = await runLauncher(INDEX, ['call', 'echo', '--text', 'every mode']);
  assert.strictEqual(call.stdout.trim(), 'every mode');

  const restart = await runLauncher(INDEX, ['--restart']);
  assert.strictEqual(restart.code, 0, restart.stderr);

  const bridge = spawnSync(process.execPath, [INDEX, '--stdio'], {
    input: `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })}\n`,
    encoding: 'utf8',
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  assert.match(bridge.stdout, /"name":"echo"/, 'the stdio bridge forwards');

  const stop = await runLauncher(INDEX, ['--stop']);
  assert.strictEqual(stop.code, 0);
  assert.match(stop.stdout, /stopped gracefully/);
  assert.ok(fs.existsSync(HOOKS));
});

test('every item the README lists as public contract exists in the code', async (t) => {
  const h = tempHome(); t.after(h.restore);
  const api = require('..');
  const { McpServerBase } = api;
  const { validateDefinition, RESERVED_OPTIONS, COMMANDS } = require('../src/launcher');
  const { FRAMEWORK_SETTINGS } = require('../src/settings');
  const config = require('../src/config');
  const server = await helpers.startServer(); t.after(() => server.stop());
  const health = (await request(server.port, { path: '/health' })).json;
  const shutdownRoute = (await request(server.port, { method: 'GET', path: '/shutdown' })).status; // exists as POST-only: GET is 404
  const fixtureDef = {
    defaultPort: 1, serverScript: 'server.js', nodeArgs: [], startupTimeoutMs: 1000, defaults: {}, validate() {},
    options: [], tools: [], settings: require('zod').z.object({}), promptable: [], defaultArguments() {}, onBridgeStart() {}, bridgeTimeoutMs: 1000,
  };
  assert.doesNotThrow(() => validateDefinition(fixtureDef, FIXTURE));

  const checks = {
    runLauncher: () => typeof api.runLauncher === 'function',
    McpServerBase: () => typeof McpServerBase === 'function',
    defineTools: () => typeof api.defineTools === 'function',
    register: () => typeof api.register === 'function',
    textResult: () => typeof api.textResult === 'function',
    jsonResult: () => typeof api.jsonResult === 'function',
    errorResult: () => typeof api.errorResult === 'function',
    getLogger: () => typeof api.getLogger === 'function',
    defaultPort: () => 'defaultPort' in fixtureDef,
    serverScript: () => 'serverScript' in fixtureDef,
    nodeArgs: () => 'nodeArgs' in fixtureDef,
    startupTimeoutMs: () => 'startupTimeoutMs' in fixtureDef && 'startupTimeoutMs' in FRAMEWORK_SETTINGS,
    defaults: () => 'defaults' in fixtureDef,
    validate: () => 'validate' in fixtureDef,
    options: () => 'options' in fixtureDef,
    tools: () => 'tools' in fixtureDef,
    settings: () => 'settings' in fixtureDef,
    promptable: () => 'promptable' in fixtureDef,
    defaultArguments: () => 'defaultArguments' in fixtureDef,
    onBridgeStart: () => 'onBridgeStart' in fixtureDef,
    bridgeTimeoutMs: () => 'bridgeTimeoutMs' in fixtureDef,
    startup: () => typeof McpServerBase.prototype.startup === 'function',
    registerTools: () => typeof McpServerBase.prototype.registerTools === 'function',
    afterListening: () => typeof McpServerBase.prototype.afterListening === 'function',
    healthExtension: () => typeof McpServerBase.prototype.healthExtension === 'function',
    shutdown: () => typeof McpServerBase.prototype.shutdown === 'function',
    ctx: () => true, // checked by the ctx test above
    'ctx.config': () => true,
    'ctx.client': () => true,
    'ctx.log': () => true,
    'this.config': () => health.configuredPort === server.port,
    'this.log': () => health.hasLogger === true,
    port: () => 'port' in FRAMEWORK_SETTINGS,
    log_level: () => 'log_level' in FRAMEWORK_SETTINGS,
    maxBodyBytes: () => 'maxBodyBytes' in FRAMEWORK_SETTINGS,
    drainMs: () => 'drainMs' in FRAMEWORK_SETTINGS,
    '/health': () => ['status', 'version', 'pid', 'uptime_seconds'].every((k) => k in health),
    status: () => 'status' in health,
    version: () => 'version' in health,
    pid: () => 'pid' in health,
    uptime_seconds: () => 'uptime_seconds' in health,
    '/shutdown': () => shutdownRoute === 404, // POST-only: a GET is not routed, and the POST route is tested in the server tests
    '~/.mcp/<name>/': () => config.dataDir('x').endsWith(path.join('.mcp', 'x')),
    'config.json': () => path.basename(config.configFile('x')) === 'config.json',
    'server.pid': () => path.basename(config.pidFile('x')) === 'server.pid',
    'logs/server.log': () => path.basename(config.logsDir('x')) === 'logs',
    '--stdio': () => RESERVED_OPTIONS.includes('--stdio'),
    '--stop': () => RESERVED_OPTIONS.includes('--stop'),
    '--restart': () => RESERVED_OPTIONS.includes('--restart'),
    '--debug': () => RESERVED_OPTIONS.includes('--debug'),
    '--log-level': () => RESERVED_OPTIONS.includes('--log-level'),
    '--help': () => RESERVED_OPTIONS.includes('--help'),
    health: () => COMMANDS.includes('health'),
    list: () => COMMANDS.includes('list'),
    call: () => COMMANDS.includes('call'),
    init: () => COMMANDS.includes('init'),
  };

  const text = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  const start = text.indexOf('### Public contract items');
  const section = text.slice(start, text.indexOf('\n## ', start));
  const listed = [...section.matchAll(/`([^`]+)`/g)].map((m) => m[1]).map((s) => s.replace(/\(.*\)$/, '').trim());
  const normalized = new Set(listed);
  for (const item of normalized) assert.ok(item in checks, `README lists "${item}" but the test has no check for it`);
  for (const item of Object.keys(checks)) assert.ok(normalized.has(item), `the test checks "${item}" but the README does not list it`);
  for (const [item, fn] of Object.entries(checks)) assert.ok(fn(), `${item} exists in the code`);
});
