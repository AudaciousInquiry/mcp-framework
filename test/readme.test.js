'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').replace(/\r\n/g, '\n');

test('every README example block equals the fixture file it names', () => {
  const markers = [...README.matchAll(/<!-- example: (\S+) -->\n```js\n([\s\S]*?)```/g)];
  assert.ok(markers.length >= 3, `found ${markers.length} example blocks`);
  for (const [, file, block] of markers) {
    const source = fs.readFileSync(path.join(__dirname, 'fixtures', file), 'utf8')
      .replace(/\r\n/g, '\n')
      .replace(/require\('\.\.\/\.\.\/\.\.\/src'\)/g, "require('@audaciousinquiry/mcp-framework')");
    assert.strictEqual(block, source, `${file} differs from its README block`);
  }
});

test('the README has the sections of the integration guide, in order', () => {
  const headings = [...README.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  const wanted = [
    'What it is',
    'Five-minute example',
    'The launcher definition and the `ctx` object',
    'Writing tools',
    'The server class',
    'The command line',
    'Registering with a client',
    'Configuration',
    'Logging',
    'The public contract',
    'Things worth knowing',
  ];
  assert.deepStrictEqual(headings, wanted);
});

test('the README covers the surprising behaviors and troubleshooting', () => {
  for (const phrase of [
    'read through a pipe', 'does not reach an existing', 'only graceful stop on Windows',
    '`maxBodyBytes`', 'Port in use', 'A server that will not start', 'A stale process id file',
  ]) {
    assert.ok(README.includes(phrase), `README mentions "${phrase}"`);
  }
});

test('documentation entry point links resolve', () => {
  const index = path.join(ROOT, 'doc', 'index.md');
  assert.ok(fs.existsSync(index), 'doc/index.md exists');
  const text = fs.readFileSync(index, 'utf8');
  const links = [...text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)].map((m) => m[1]).filter((l) => !/^https?:/.test(l));
  assert.ok(links.length >= 2, 'links to the README and the design');
  for (const link of links) {
    assert.ok(fs.existsSync(path.join(path.dirname(index), link)), `${link} resolves`);
  }
});
