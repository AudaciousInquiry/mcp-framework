'use strict';

// Dates are read in the local zone; pin it so the expected values are exact.
process.env.TZ = 'America/New_York';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { z } = require('zod');
const { parseTokens, buildArguments, booleanChecker, describeArguments, unquote, splitList } = require('../src/args');
const { convertDate } = require('../src/dates');
const { toJsonSchema } = require('../src/tools');
const { settingsSchema } = require('../src/schema');

const NOW = new Date('2026-11-18T15:00:00Z'); // 10:00 on 18 November in New York (UTC-5)
const CWD = path.resolve('/work');

function schemaOf(shape) {
  return toJsonSchema({ inputSchema: z.object(shape) });
}

/** Run tokens through the same path `call` uses. */
function run(shape, tokens, { base = {}, files = {}, schema = schemaOf(shape) } = {}) {
  const { positional, flags } = parseTokens(tokens, booleanChecker(schema));
  assert.deepStrictEqual(positional, []);
  const readFile = (f) => {
    if (!(f in files)) { const e = new Error('missing'); e.code = 'ENOENT'; throw e; }
    return files[f];
  };
  return buildArguments({ schema, flags, base, label: 'tool "t"', cwd: CWD, now: NOW, readFile });
}

test('parser: both forms, negative values, no-flags, repeats, double dash', () => {
  const isBool = (n) => n === 'verbose';
  assert.deepStrictEqual(parseTokens(['--title', 'Hello', '--title=Hello'], isBool).flags.map((f) => [f.name, f.value]),
    [['title', 'Hello'], ['title', 'Hello']]);
  assert.deepStrictEqual(parseTokens(['--since', '-7d', '--offset', '-5'], isBool).flags.map((f) => f.value), ['-7d', '-5']);
  assert.deepStrictEqual(parseTokens(['--verbose', '--no-verbose', '--verbose=false'], isBool).flags.map((f) => f.value),
    ['true', 'false', 'false']);
  assert.deepStrictEqual(parseTokens(['{"a":1}', '--x', '1'], isBool).positional, ['{"a":1}']);
  assert.deepStrictEqual(parseTokens(['--', '--x'], isBool).positional, ['--x']);
  assert.throws(() => parseTokens(['--count'], isBool), /--count needs a value/);
  assert.throws(() => parseTokens(['--count', '--other'], isBool), /--count needs a value/);
});

test('types come from the schema, never from the look of the value', () => {
  const shape = { code: z.string(), count: z.number().int() };
  assert.deepStrictEqual(run(shape, ['--code', '007', '--count', '7']), { code: '007', count: 7 });
  assert.deepStrictEqual(run({ x: z.any() }, ['--x', '5']), { x: '5' });
});

test('integers, numbers, booleans, enums', () => {
  const shape = { n: z.number(), i: z.number().int(), v: z.boolean(), e: z.enum(['a', 'b']) };
  assert.deepStrictEqual(run(shape, ['--n', '0.25', '--i', '-5', '--v', '--e', 'a']), { n: 0.25, i: -5, v: true, e: 'a' });
  assert.deepStrictEqual(run(shape, ['--no-v']), { v: false });
  assert.deepStrictEqual(run(shape, ['--v=false']), { v: false });
  assert.deepStrictEqual(run({ n: z.number() }, ['--n', '1e3']), { n: 1000 });
  for (const bad of ['abc', '1,000', '0x10', '']) {
    assert.throws(() => run({ n: z.number() }, ['--n', bad]), /--n: ".*" is not a number/);
  }
  assert.throws(() => run({ i: z.number().int() }, ['--i', '2.5']), /--i: "2.5" is not a whole number/);
  assert.throws(() => run({ v: z.boolean() }, ['--v=maybe']), /--v: "maybe" is not true or false/);
  assert.throws(() => run({ e: z.enum(['a', 'b']) }, ['--e', 'c']), /--e: "c" is not one of a, b/);
});

test('quoting rules', () => {
  assert.deepStrictEqual(unquote('"hello world"', 'x'), { value: 'hello world', quoted: true });
  assert.strictEqual(unquote('"say \\"hi\\""', 'x').value, 'say "hi"');
  assert.strictEqual(unquote("'it\\'s'", 'x').value, "it's");
  assert.deepStrictEqual(unquote("don't stop", 'x'), { value: "don't stop", quoted: false });
  assert.strictEqual(unquote('C:\\Users\\me\\notes.md', 'x').value, 'C:\\Users\\me\\notes.md');
  assert.strictEqual(unquote('"C:\\Users\\me"', 'x').value, 'C:\\Users\\me');
  assert.throws(() => unquote('"abc', '--t'), /--t: unterminated quote/);
  assert.throws(() => unquote('"abc"def', '--t'), /unexpected text after the closing quote/);
  assert.deepStrictEqual(run({ t: z.string() }, ['--t', '"hello world"']), { t: 'hello world' });
});

test('arrays are comma-separated, with quoting and typed elements', () => {
  assert.deepStrictEqual(run({ tags: z.array(z.string()) }, ['--tags', 'a,b,c']), { tags: ['a', 'b', 'c'] });
  assert.deepStrictEqual(run({ tags: z.array(z.string()) }, ['--tags', '"a,b",c']), { tags: ['a,b', 'c'] });
  assert.deepStrictEqual(run({ ids: z.array(z.number().int()) }, ['--ids', '1,2,3']), { ids: [1, 2, 3] });
  assert.deepStrictEqual(run({ tags: z.array(z.string()) }, ['--tags', '']), { tags: [] });
  assert.throws(() => run({ ids: z.array(z.number().int()) }, ['--ids', '1,x,3']), /--ids element 2: "x" is not a whole number/);
  assert.deepStrictEqual(splitList("a,'b,c',d", 'x').map((e) => e.value), ['a', 'b,c', 'd']);
});

test('a field that is a string or a list', () => {
  const shape = { tags: z.union([z.string(), z.array(z.string())]) };
  assert.deepStrictEqual(run(shape, ['--tags', 'solo']), { tags: 'solo' });
  assert.deepStrictEqual(run(shape, ['--tags', 'a,b']), { tags: ['a', 'b'] });
  assert.deepStrictEqual(run(shape, ['--tags', '"a,b"']), { tags: 'a,b' });
});

test('dotted names: nested, merge with JSON, several, typed, array element, whole object', () => {
  const shape = {
    p: z.object({ a: z.string().optional(), b: z.string().optional(), count: z.number().int().optional(),
      agent: z.object({ name: z.string() }).optional() }).optional(),
    items: z.array(z.object({ name: z.string() })).optional(),
  };
  assert.deepStrictEqual(run(shape, ['--p.agent.name', 'claude']), { p: { agent: { name: 'claude' } } });
  assert.deepStrictEqual(run(shape, ['--p.a', 'y'], { base: { p: { a: 'x', b: 'keep' } } }), { p: { a: 'y', b: 'keep' } });
  assert.deepStrictEqual(run(shape, ['--p.a', '1', '--p.b', '2']), { p: { a: '1', b: '2' } });
  assert.deepStrictEqual(run(shape, ['--p.count', '4']), { p: { count: 4 } });
  assert.deepStrictEqual(run(shape, ['--items.1.name', 'second'], { base: { items: [{ name: 'first' }] } }),
    { items: [{ name: 'first' }, { name: 'second' }] });
  assert.deepStrictEqual(run(shape, ['--p', '{"agent":{"name":"claude"}}']), { p: { agent: { name: 'claude' } } });
  assert.deepStrictEqual(run(shape, ['--p.a', 'z', '--p', '{"b":"w"}']), { p: { b: 'w', a: 'z' } }, 'object first, dotted on top');
});

test('JSON first, flags on top', () => {
  assert.deepStrictEqual(run({ title: z.string(), count: z.number().int() }, ['--title', 'B'], { base: { title: 'A', count: 1 } }),
    { title: 'B', count: 1 });
});

test('dates: absolute forms', () => {
  const o = { now: NOW, field: '--d' };
  assert.strictEqual(convertDate('2026-11-18', 'date', o), '2026-11-18');
  assert.strictEqual(convertDate('2026-11-18', 'date-time', o), '2026-11-18T05:00:00.000Z');
  assert.strictEqual(convertDate('2026-11-18T09:30:00-05:00', 'date-time', o), '2026-11-18T14:30:00.000Z');
  assert.strictEqual(convertDate('2026-11-18T09:30', 'date-time', o), '2026-11-18T14:30:00.000Z');
  assert.strictEqual(convertDate('2026-11-18T14:30:00Z', 'date-time', o), '2026-11-18T14:30:00.000Z');
  assert.strictEqual(convertDate('2026-11-18T23:30:00-05:00', 'date', o), '2026-11-18');
  assert.throws(() => convertDate('2026-02-30', 'date', o), /--d: "2026-02-30" is not a valid date/);
  assert.throws(() => convertDate('2026-13-01', 'date', o), /not a valid date/);
});

test('dates: relative forms', () => {
  const o = { now: NOW, field: '--d' };
  assert.strictEqual(convertDate('-7d', 'date', o), '2026-11-11');
  assert.strictEqual(convertDate('+2w', 'date', o), '2026-12-02');
  assert.strictEqual(convertDate('yesterday', 'date', o), '2026-11-17');
  assert.strictEqual(convertDate('today', 'date', o), '2026-11-18');
  assert.strictEqual(convertDate('tomorrow', 'date', o), '2026-11-19');
  assert.strictEqual(convertDate('today', 'date-time', o), '2026-11-18T05:00:00.000Z');
  assert.strictEqual(convertDate('yesterday', 'date-time', o), '2026-11-17T05:00:00.000Z');
  assert.strictEqual(convertDate('now', 'date-time', o), '2026-11-18T15:00:00.000Z');
  assert.strictEqual(convertDate('-3h', 'date-time', o), '2026-11-18T12:00:00.000Z');
  assert.strictEqual(convertDate('+30m', 'date-time', o), '2026-11-18T15:30:00.000Z');
  assert.throws(() => convertDate('last tuesday', 'date', o), /accepted forms:.*yesterday.*-7d/);
  assert.throws(() => convertDate('7d', 'date', o), /accepted forms/, 'an offset needs a sign');
  assert.deepStrictEqual(run({ since: z.iso.date() }, ['--since', '-7d']), { since: '2026-11-11' });
});

test('file path fields and the @ prefix', () => {
  const shape = {
    path: z.string().meta({ 'x-cli': 'file' }),
    note: z.string(),
    content: z.string(),
    prov: z.object({ a: z.string() }),
  };
  assert.deepStrictEqual(run(shape, ['--path', 'notes/a.md']), { path: path.join(CWD, 'notes', 'a.md') });
  assert.deepStrictEqual(run(shape, ['--path', path.resolve('/abs/x.md')]), { path: path.resolve('/abs/x.md') });
  assert.deepStrictEqual(run(shape, ['--note', 'notes/a.md']), { note: 'notes/a.md' }, 'unmarked field is not resolved');
  const files = { [path.join(CWD, 'notes.md')]: 'file text\nline 2', [path.join(CWD, 'prov.json')]: '{"a":"x"}', [path.join(CWD, 'bad.json')]: '{nope' };
  assert.deepStrictEqual(run(shape, ['--content', '@notes.md'], { files }), { content: 'file text\nline 2' });
  assert.deepStrictEqual(run(shape, ['--prov', '@prov.json'], { files }), { prov: { a: 'x' } });
  assert.deepStrictEqual(run(shape, ['--note', "'@alice'"]), { note: '@alice' });
  assert.throws(() => run(shape, ['--content', '@missing.md'], { files }), /--content: cannot read the file .*missing\.md/);
  assert.throws(() => run(shape, ['--prov', '@bad.json'], { files }), /--prov: the file .*bad\.json is not valid JSON/);
});

test('fail fast: unknown, repeated, scalar then child, extra properties', () => {
  const shape = { title: z.string(), p: z.object({ a: z.string() }).optional() };
  assert.throws(() => run(shape, ['--titel', 'Hello']), /--titel is not an argument of tool "t"; did you mean --title\?/);
  assert.throws(() => run(shape, ['--zzzzzzzz', 'x']), /Valid names here: --title, --p\./);
  assert.throws(() => run(shape, ['--title', 'A', '--title', 'B']), /--title was given twice/);
  assert.throws(() => run(shape, ['--title.sub', 'x']), /--title\.sub: title is not an object/);
  assert.throws(() => run(shape, ['--p.b', 'x']), /--p\.b is not an argument.*--p\.a/);
  const loose = toJsonSchema({ inputSchema: z.looseObject({ title: z.string() }) });
  assert.deepStrictEqual(run({}, ['--whatever', '5'], { schema: loose }), { whatever: '5' });
});

test('argument help lists names, types, required marks and notes', () => {
  const rows = describeArguments(schemaOf({
    title: z.string().describe('The title'),
    since: z.iso.date().optional(),
    path: z.string().meta({ 'x-cli': 'file' }).optional(),
    tags: z.array(z.string()).optional(),
    prov: z.object({ agent: z.object({ name: z.string() }) }).optional(),
    verbose: z.boolean().optional(),
  }));
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.strictEqual(byName.title.required, true);
  assert.strictEqual(byName.title.description, 'The title');
  assert.match(byName.since.notes[0], /date; written YYYY-MM-DD/);
  assert.match(byName.path.notes[0], /file path/);
  assert.match(byName.tags.notes[0], /comma-separated/);
  assert.ok(byName['prov.agent.name'], 'nested fields by dotted name');
  assert.match(byName.verbose.notes[0], /--no-verbose/);
});

test('settings schema: types from declared schema, then from defaults; null default is untyped', () => {
  const schema = settingsSchema(null, { flag: true, n: 3, s: 'x', list: [1, 2], nested: { a: false }, nothing: null }, {});
  assert.deepStrictEqual(run({}, ['--no-flag', '--n', '4', '--list', '5,6', '--nested.a', '--nothing', 'v'], { schema }),
    { flag: false, n: 4, list: [5, 6], nested: { a: true }, nothing: 'v' });
  assert.strictEqual(describeArguments(schema).find((r) => r.name === 'nothing').type, 'untyped (sent as a string)');
});

test('a scalar from the JSON is not turned into an object by a dotted argument', () => {
  const shape = { p: z.object({ agent: z.string().optional() }).optional() };
  assert.throws(() => run(shape, ['--p.agent', 'x'], { base: { p: 'a string' } }), /--p.agent: p is not an object/);
});

test('fractional seconds are truncated to milliseconds, never rolled over', () => {
  const o = { now: NOW, field: '--d' };
  assert.strictEqual(convertDate('2026-01-01T10:00:00.9996Z', 'date-time', o), '2026-01-01T10:00:00.999Z');
  assert.strictEqual(convertDate('2026-01-01T10:00:00.5Z', 'date-time', o), '2026-01-01T10:00:00.500Z');
});
