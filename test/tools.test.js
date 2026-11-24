'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const log4js = require('log4js');
const { defineTools, toJsonSchema, register } = require('../src/tools');

const schema = z.object({ query: z.string() });

test('defineTools: valid declaration', () => {
  const tools = defineTools([{ name: 'search', description: 'Search', inputSchema: schema }]);
  assert.strictEqual(tools.length, 1);
  assert.strictEqual(tools[0].name, 'search');
  assert.ok(Object.isFrozen(tools));
});

test('defineTools: each invalid declaration names the tool and the problem', () => {
  assert.throws(() => defineTools({}), /expects an array/);
  assert.throws(() => defineTools([{ description: 'd', inputSchema: schema }]), /index 0.*"name"/);
  assert.throws(() => defineTools([{ name: 'bad name', description: 'd', inputSchema: schema }]), /"bad name".*"name"/);
  assert.throws(() => defineTools([{ name: 'a', description: ' ', inputSchema: schema }]), /"a".*"description"/);
  assert.throws(() => defineTools([{ name: 'a', description: 'd', inputSchema: { type: 'object' } }]), /"a".*Zod object/);
  assert.throws(() => defineTools([{ name: 'a', description: 'd', inputSchema: z.string() }]), /"a".*Zod object/);
  assert.throws(() => defineTools([
    { name: 'a', description: 'd', inputSchema: schema },
    { name: 'a', description: 'd', inputSchema: schema },
  ]), /"a".*more than once/);
});

test('schema conversion keeps the x-cli marker', () => {
  const [tool] = defineTools([{
    name: 'write', description: 'Write',
    inputSchema: z.object({ path: z.string().meta({ 'x-cli': 'file' }), n: z.number().int().optional() }),
  }]);
  const json = toJsonSchema(tool);
  assert.strictEqual(json.properties.path['x-cli'], 'file');
  assert.strictEqual(json.properties.n.type, 'integer');
  assert.deepStrictEqual(json.required, ['path']);
});

async function connect(tools, handlers) {
  const server = new McpServer({ name: 't', version: '1.0.0' });
  register(server, tools, handlers);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'c', version: '1.0.0' });
  await client.connect(b);
  return client;
}

test('register: handler result, throwing handler, timing lines, schema violation', async (t) => {
  const lines = [];
  log4js.configure({
    appenders: { rec: { type: 'recording' } },
    categories: { default: { appenders: ['rec'], level: 'info' } },
  });
  t.after(() => log4js.shutdown(() => {}));
  const tools = defineTools([
    { name: 'ok', description: 'ok', inputSchema: schema },
    { name: 'boom', description: 'boom', inputSchema: schema },
  ]);
  let ran = 0;
  const client = await connect(tools, {
    ok: async ({ query }) => { ran++; return `got ${query}`; },
    boom: async () => { throw new Error('exploded'); },
  });

  const ok = await client.callTool({ name: 'ok', arguments: { query: 'x' } });
  assert.strictEqual(ok.content[0].text, 'got x');
  assert.ok(!ok.isError);

  const boom = await client.callTool({ name: 'boom', arguments: { query: 'x' } });
  assert.strictEqual(boom.isError, true);
  assert.match(boom.content[0].text, /boom failed: exploded/);

  const before = ran;
  const bad = await client.callTool({ name: 'ok', arguments: { query: 5 } }).catch((e) => ({ isError: true, thrown: e }));
  assert.strictEqual(bad.isError, true);
  assert.strictEqual(ran, before, 'handler must not run on a schema violation');

  const recorded = log4js.recording().replay().map((e) => e.data.join(' '));
  recorded.forEach((l) => lines.push(l));
  assert.ok(lines.some((l) => /tool ok start/.test(l)));
  assert.ok(lines.some((l) => /tool ok end ok in \d+ ms/.test(l)));
  assert.ok(lines.some((l) => /tool boom threw: Error: exploded[\s\S]*at /.test(l)));
  assert.ok(lines.some((l) => /tool boom end error in \d+ ms/.test(l)));
});

test('register: undeclared handler and missing handler are refused', () => {
  const tools = defineTools([{ name: 'a', description: 'd', inputSchema: schema }]);
  const server = new McpServer({ name: 't', version: '1.0.0' });
  assert.throws(() => register(server, tools, { a: () => 1, extra: () => 2 }), /"extra".*no tool declared/);
  assert.throws(() => register(server, tools, {}), /"a" is declared but has no handler/);
});
