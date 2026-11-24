'use strict';

// Packs the package, installs the tarball in an empty folder, builds the README's
// example MCP there from the README's own code blocks, and uses it end to end.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const helpers = require('./helpers');

const { tempHome, freePort, writeConfig, runLauncher, shutdownAll } = helpers;
const ROOT = path.join(__dirname, '..');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function npm(args, cwd, timeout = 300000) {
  const r = spawnSync(NPM, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32', timeout });
  assert.strictEqual(r.status, 0, `npm ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

test('npm pack ships only src, the README, the LICENSE and package.json', () => {
  const out = npm(['pack', '--dry-run', '--json'], ROOT);
  const files = JSON.parse(out)[0].files.map((f) => f.path.replace(/\\/g, '/'));
  assert.ok(files.length > 10);
  for (const f of files) {
    assert.ok(f.startsWith('src/') || ['README.md', 'LICENSE', 'package.json'].includes(f), `unexpected file in the package: ${f}`);
  }
  for (const needed of ['src/index.js', 'README.md', 'LICENSE', 'package.json']) {
    assert.ok(files.includes(needed), `${needed} is in the package`);
  }
});

test('an MCP built from the README and an installed tarball works over HTTP, over stdio and from the command line', async (t) => {
  const h = tempHome();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpfw-pack-'));
  const port = await freePort();
  writeConfig('my-mcp', { port });
  t.after(async () => {
    await shutdownAll(port);
    h.restore();
    fs.rmSync(work, { recursive: true, force: true });
  });

  // 1. Pack and install in an empty folder.
  const packDir = path.join(work, 'pack');
  fs.mkdirSync(packDir);
  const tarball = path.join(packDir, npm(['pack', '--pack-destination', packDir], ROOT).trim().split(/\r?\n/).pop());
  assert.ok(fs.existsSync(tarball), 'tarball was created');
  const project = path.join(work, 'my-mcp');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'my-mcp', version: '1.0.0' }));
  npm(['install', tarball, 'zod', '--no-audit', '--no-fund'], project);

  // 2. Write the three files exactly as the README shows them.
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
  const blocks = [...readme.matchAll(/<!-- example: readme-mcp\/(\S+) -->\n```js\n([\s\S]*?)```/g)];
  assert.deepStrictEqual(blocks.map((b) => b[1]).sort(), ['index.js', 'server.js', 'tools.js']);
  for (const [, file, code] of blocks) fs.writeFileSync(path.join(project, file), code);
  const index = path.join(project, 'index.js');

  // 3. Start it, as the README says.
  const start = await runLauncher(index);
  assert.strictEqual(start.code, 0, start.stderr);
  assert.match(start.stdout, /my-mcp 1\.0\.0 started \(pid \d+\)/);

  // 4. The command line.
  assert.match((await runLauncher(index, ['list'])).stdout, /^echo: Return the text it is given\.$/m);
  assert.strictEqual((await runLauncher(index, ['call', 'echo', '--text', 'hello'])).stdout.trim(), 'hello');
  assert.strictEqual((await runLauncher(index, ['call', 'add', '--a', '2', '--b', '3'])).stdout.trim(), '5');

  // 5. A real SDK client over HTTP.
  const http = new Client({ name: 'integration', version: '1.0.0' });
  await http.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/`)));
  assert.strictEqual((await http.callTool({ name: 'add', arguments: { a: 20, b: 22 } })).content[0].text, '42');
  await http.close();

  // 6. A real SDK client over the stdio bridge.
  const stdio = new Client({ name: 'integration', version: '1.0.0' });
  await stdio.connect(new StdioClientTransport({
    command: process.execPath, args: [index, '--stdio'], env: { ...process.env }, stderr: 'pipe',
  }));
  assert.strictEqual((await stdio.callTool({ name: 'echo', arguments: { text: 'over stdio' } })).content[0].text, 'over stdio');
  await stdio.close();

  // 7. Stop it.
  const stop = await runLauncher(index, ['--stop']);
  assert.strictEqual(stop.code, 0);
  assert.match(stop.stdout, /stopped gracefully/);
});
