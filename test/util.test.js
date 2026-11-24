'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { compareVersions } = require('../src/util/version');
const { deepMerge } = require('../src/util/merge');
const { validateIdentity } = require('../src/util/identity');
const { nodeVersionProblem } = require('../src/util/nodeversion');

test('version compare', () => {
  assert.strictEqual(compareVersions('1.2.3', '1.2.3'), 0);
  assert.ok(compareVersions('1.2.3', '1.2.4') < 0);
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
  assert.ok(compareVersions('2.0.0', '1.99.99') > 0);
  assert.strictEqual(compareVersions('1.2.3-beta.1+build5', '1.2.3'), 0);
  assert.throws(() => compareVersions('x', '1.0.0'), /not semver/);
});

test('merge: nested objects merge key by key', () => {
  assert.deepStrictEqual(deepMerge({ a: { b: 1, c: 2 } }, { a: { b: 9 } }), { a: { b: 9, c: 2 } });
});

test('merge: arrays are replaced', () => {
  assert.deepStrictEqual(deepMerge({ a: [1, 2, 3] }, { a: [4] }), { a: [4] });
});

test('merge: 0, false and null are kept', () => {
  assert.deepStrictEqual(deepMerge({ a: 5, b: true, c: 'x' }, { a: 0, b: false, c: null }), {
    a: 0, b: false, c: null,
  });
});

test('merge: unknown keys are kept and inputs are not modified', () => {
  const base = { a: { x: 1 } };
  const out = deepMerge(base, { z: 1 });
  assert.deepStrictEqual(out, { a: { x: 1 }, z: 1 });
  out.a.x = 2;
  assert.strictEqual(base.a.x, 1);
});

test('identity: valid', () => {
  assert.deepStrictEqual(validateIdentity({ name: 'my-mcp', version: '1.0.0' }), {
    name: 'my-mcp', version: '1.0.0', logLevelVariable: 'MY_MCP_LOG_LEVEL',
  });
});

test('identity: invalid cases name the field', () => {
  assert.throws(() => validateIdentity({ version: '1.0.0' }), /"name" is missing/);
  assert.throws(() => validateIdentity({ name: '@scope/x', version: '1.0.0' }), /"name".*directory name/);
  assert.throws(() => validateIdentity({ name: 'a b', version: '1.0.0' }), /"name"/);
  assert.throws(() => validateIdentity({ name: 'x' }), /"version"/);
  assert.throws(() => validateIdentity({ name: 'x', version: 'one' }), /"version".*semver/);
});

test('node version check', () => {
  assert.match(nodeVersionProblem('20.11.0'), /22.*20\.11\.0/);
  assert.strictEqual(nodeVersionProblem('22.0.0'), null);
});
