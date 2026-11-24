'use strict';

/*
 * Command-line arguments to typed JSON, driven by a JSON Schema. The same code
 * serves `call` (a tool's schema) and `init` (the settings schema).
 */

const fs = require('node:fs');
const path = require('node:path');
const { UserError } = require('./errors');
const { classify, resolvePath } = require('./schema');
const { convertDate, ACCEPTED } = require('./dates');

const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const INTEGER_RE = /^[+-]?\d+(?:[eE]\+?\d+)?$/;

function fail(message) {
  return new UserError(message);
}

/**
 * Split raw tokens into flags and positional words. A flag needs a value unless
 * its field is boolean; a value may start with a single dash (`-5`, `-7d`).
 * @param {string[]} tokens
 * @param {(name: string) => boolean} isBoolean whether the named field is a boolean
 * @returns {{positional: string[], flags: Array<{name: string, value: string, raw: string}>}}
 */
function parseTokens(tokens, isBoolean = () => false) {
  const positional = [];
  const flags = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === '--') {
      positional.push(...tokens.slice(i + 1));
      break;
    }
    if (!tok.startsWith('--') || tok.length === 2) {
      positional.push(tok);
      continue;
    }
    const body = tok.slice(2);
    const eq = body.indexOf('=');
    if (eq === 0) throw fail(`${tok}: the name is missing before "="`);
    if (eq > 0) {
      flags.push({ name: body.slice(0, eq), value: body.slice(eq + 1), raw: tok });
      continue;
    }
    if (body.startsWith('no-') && body.length > 3 && isBoolean(body.slice(3))) {
      flags.push({ name: body.slice(3), value: 'false', raw: tok });
      continue;
    }
    if (isBoolean(body)) {
      flags.push({ name: body, value: 'true', raw: tok });
      continue;
    }
    const next = tokens[i + 1];
    if (next === undefined || next.startsWith('--')) {
      throw fail(`--${body} needs a value`);
    }
    flags.push({ name: body, value: next, raw: `${tok} ${next}` });
    i++;
  }
  return { positional, flags };
}

/**
 * Read one quoted or unquoted string. A quote opens a quoted string only at
 * the start; inside it `\"` and `\'` become the plain character and any other
 * backslash is literal.
 * @param {string} text
 * @param {string} label for messages
 * @returns {{value: string, quoted: boolean}}
 */
function unquote(text, label) {
  const q = text[0];
  if (q !== '"' && q !== "'") return { value: text, quoted: false };
  let out = '';
  for (let i = 1; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && (text[i + 1] === '"' || text[i + 1] === "'")) {
      out += text[i + 1];
      i++;
    } else if (c === q) {
      if (i !== text.length - 1) throw fail(`${label}: unexpected text after the closing quote in ${text}`);
      return { value: out, quoted: true };
    } else {
      out += c;
    }
  }
  throw fail(`${label}: unterminated quote in ${text}`);
}

/**
 * Split a comma-separated list; a comma inside a quoted element does not split.
 * @param {string} text
 * @param {string} label
 * @returns {Array<{value: string, quoted: boolean}>}
 */
function splitList(text, label) {
  if (text === '') return [];
  const out = [];
  let i = 0;
  while (i <= text.length) {
    let element;
    const q = text[i];
    if (q === '"' || q === "'") {
      let j = i + 1;
      let closed = false;
      while (j < text.length) {
        if (text[j] === '\\' && (text[j + 1] === '"' || text[j + 1] === "'")) { j += 2; continue; }
        if (text[j] === q) { closed = true; break; }
        j++;
      }
      if (!closed) throw fail(`${label}: unterminated quote in ${text}`);
      if (j + 1 < text.length && text[j + 1] !== ',') {
        throw fail(`${label}: unexpected text after the closing quote in ${text}`);
      }
      element = unquote(text.slice(i, j + 1), label);
      i = j + 2;
    } else {
      const next = text.indexOf(',', i);
      const end = next === -1 ? text.length : next;
      element = { value: text.slice(i, end), quoted: false };
      i = end + 1;
    }
    out.push(element);
    if (i > text.length) break;
  }
  return out;
}

function readFileValue(rawPath, ctx, label) {
  const file = path.resolve(ctx.cwd, rawPath);
  try {
    return (ctx.readFile || ((f) => fs.readFileSync(f, 'utf8')))(file);
  } catch (err) {
    throw fail(`${label}: cannot read the file ${file} (${err.code || err.message})`);
  }
}

function convertScalarText(info, text, label, ctx) {
  switch (info.kind) {
    case 'integer':
      if (!INTEGER_RE.test(text.trim())) {
        throw fail(`${label}: "${text}" is not a whole number`);
      }
      return Number(text.trim());
    case 'number':
      if (!NUMBER_RE.test(text.trim())) throw fail(`${label}: "${text}" is not a number`);
      return Number(text.trim());
    case 'boolean':
      if (text === 'true') return true;
      if (text === 'false') return false;
      throw fail(`${label}: "${text}" is not true or false`);
    case 'enum': {
      const hit = info.values.find((v) => String(v) === text);
      if (hit === undefined) throw fail(`${label}: "${text}" is not one of ${info.values.join(', ')}`);
      return hit;
    }
    case 'date':
    case 'date-time':
      try {
        return convertDate(text, info.kind, { field: label, now: ctx.now });
      } catch (err) {
        throw fail(err.message);
      }
    default:
      return text;
  }
}

/**
 * Convert one raw argument value to the type the schema declares.
 * @param {object} info classified schema node (see schema.classify)
 * @param {string} raw the text after the shell
 * @param {string} label argument name for messages, such as `--count`
 * @param {{cwd: string, now?: Date, readFile?: Function}} ctx
 * @returns {*}
 */
function convertValue(info, raw, label, ctx) {
  // The @ prefix: the value is the contents of a file.
  if (raw.startsWith('@') && info.kind !== 'boolean') {
    const text = readFileValue(raw.slice(1), ctx, label);
    if (info.kind === 'object' || info.kind === 'array') {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw fail(`${label}: the file ${path.resolve(ctx.cwd, raw.slice(1))} is not valid JSON (${err.message})`);
      }
      if (info.kind === 'object' && (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))) {
        throw fail(`${label}: the file must hold a JSON object`);
      }
      if (info.kind === 'array' && !Array.isArray(parsed)) throw fail(`${label}: the file must hold a JSON array`);
      return parsed;
    }
    if (info.kind === 'string' || info.kind === 'string-or-list' || info.kind === 'untyped') return text;
    return convertScalarText(info, text.trim(), label, ctx);
  }

  switch (info.kind) {
    case 'object': {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw fail(`${label}: an object is given as JSON or by dotted names such as ${label}.field (${err.message})`);
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw fail(`${label}: expected a JSON object`);
      return parsed;
    }
    case 'array': {
      const itemInfo = classify(info.items);
      return splitList(raw, label).map((el, index) => {
        const where = `${label} element ${index + 1}`;
        return convertElementText(itemInfo, el.value, where, ctx);
      });
    }
    case 'string-or-list': {
      const elements = splitList(raw, label);
      if (elements.length > 1) return elements.map((e) => e.value);
      if (elements.length === 1) return finishString(info, elements[0].value, ctx);
      return finishString(info, '', ctx);
    }
    case 'string': {
      const { value } = unquote(raw, label);
      return finishString(info, value, ctx);
    }
    case 'untyped': {
      return unquote(raw, label).value;
    }
    default: {
      const { value } = unquote(raw, label);
      return convertScalarText(info, value, label, ctx);
    }
  }
}

function convertElementText(info, text, label, ctx) {
  if (info.kind === 'string') return finishString(info, text, ctx);
  return convertScalarText(info, text, label, ctx);
}

function finishString(info, text, ctx) {
  return info.file ? path.resolve(ctx.cwd, text) : text;
}

function distance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/** The candidate closest to `name`, when one is close enough to be a typo. */
function closest(name, candidates) {
  let best;
  let bestDistance = Infinity;
  for (const c of candidates) {
    const dist = distance(name.toLowerCase(), c.toLowerCase());
    if (dist < bestDistance) { best = c; bestDistance = dist; }
  }
  return bestDistance <= Math.max(2, Math.floor(name.length / 3)) ? best : undefined;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);

function setAtPath(root, segments, value, flagLabel) {
  const bad = segments.find((seg) => UNSAFE.has(seg));
  if (bad) throw fail(`${flagLabel}: "${bad}" is not allowed in an argument name`);
  let node = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const nextIsIndex = /^\d+$/.test(segments[i + 1]);
    let child = Object.prototype.hasOwnProperty.call(node, seg) ? node[seg] : undefined;
    if (child === undefined || child === null) {
      child = nextIsIndex ? [] : {};
      node[seg] = child;
    } else if (nextIsIndex ? !Array.isArray(child) : !isPlainObject(child)) {
      const walked = segments.slice(0, i + 1).join('.');
      throw fail(`${flagLabel}: ${walked} is not ${nextIsIndex ? 'a list' : 'an object'}`);
    }
    node = child;
  }
  const last = segments[segments.length - 1];
  if (Array.isArray(node)) node[Number(last)] = value;
  else if (isPlainObject(value) && isPlainObject(node[last])) node[last] = { ...node[last], ...value };
  else node[last] = value;
}

/**
 * Build the argument object: the JSON first, then the flags set on top.
 * @param {object} options
 * @param {object} options.schema object JSON Schema
 * @param {Array<{name: string, value: string}>} options.flags from parseTokens
 * @param {object} [options.base] JSON object applied first
 * @param {string} [options.label] what the schema describes, for messages (for example `tool "echo"`)
 * @param {string} [options.unknownAs] replaces "an argument of <label>" in the unknown-name message
 * @param {string} [options.cwd]
 * @param {Date} [options.now]
 * @param {Function} [options.readFile]
 * @returns {object}
 */
function buildArguments({ schema, flags, base = {}, label = 'the arguments', unknownAs, cwd = process.cwd(), now, readFile }) {
  const result = JSON.parse(JSON.stringify(base));
  const ctx = { cwd, now, readFile };
  const seen = new Set();
  // Shallower names first, so a whole object is set before dotted fields on it.
  const ordered = flags
    .map((f, index) => ({ ...f, index, segments: f.name.split('.') }))
    .sort((a, b) => a.segments.length - b.segments.length || a.index - b.index);
  for (const f of ordered) {
    if (seen.has(f.name)) throw fail(`--${f.name} was given twice`);
    seen.add(f.name);
    const resolved = resolvePath(schema, f.segments);
    if (resolved.error) {
      const flagLabel = `--${f.name}`;
      if (resolved.error === 'unknown') {
        const near = closest(resolved.segment, resolved.valid);
        const prefix = resolved.at ? `${resolved.at}.` : '';
        const hint = near ? `; did you mean --${prefix}${near}?` : '';
        const valid = resolved.valid.length ? ` Valid names here: ${resolved.valid.map((v) => `--${prefix}${v}`).join(', ')}.` : '';
        throw fail(`${flagLabel} is not ${unknownAs || `an argument of ${label}`}${hint}${near ? '' : valid}`);
      }
      if (resolved.error === 'index') throw fail(`${flagLabel}: "${resolved.segment}" is not a list position`);
      throw fail(`${flagLabel}: ${resolved.at || f.segments[0]} is not an object`);
    }
    const value = convertValue(resolved.info, f.value, `--${f.name}`, ctx);
    setAtPath(result, f.segments, value, `--${f.name}`);
  }
  return result;
}

/**
 * A function telling parseTokens whether a (dotted) name is a boolean field.
 * @param {object} schema object JSON Schema
 * @returns {(name: string) => boolean}
 */
function booleanChecker(schema) {
  return (name) => {
    const r = resolvePath(schema, name.split('.'));
    return Boolean(r.info && r.info.kind === 'boolean');
  };
}

/**
 * Flatten a schema into rows describing each argument as it is written on the
 * command line, with nested fields by dotted name.
 * @param {object} schema object JSON Schema
 * @returns {Array<{name: string, type: string, required: boolean, description: string, notes: string[], default?: *}>}
 */
function describeArguments(schema) {
  const rows = [];
  const walk = (node, prefix, requiredList) => {
    const info = classify(node);
    const props = info.properties || {};
    for (const [key, sub] of Object.entries(props)) {
      const subInfo = classify(sub);
      const name = prefix + key;
      const required = (requiredList || []).includes(key);
      if (subInfo.kind === 'object' && Object.keys(subInfo.properties || {}).length) {
        rows.push({ name, type: 'object', required, description: subInfo.description || '', notes: ['JSON, or set the fields by dotted name:'] });
        walk(sub, `${name}.`, subInfo.required);
        continue;
      }
      rows.push(describeRow(name, subInfo, required, sub));
    }
  };
  walk(schema, '', classify(schema).required);
  return rows;
}

function describeRow(name, info, required, raw) {
  const notes = [];
  let type = info.kind;
  if (info.kind === 'enum') type = `one of ${info.values.join(' | ')}`;
  if (info.kind === 'array') type = `list of ${classify(info.items).kind}`;
  if (info.kind === 'string-or-list') type = 'string or list';
  if (info.kind === 'untyped') type = raw && raw['x-untyped'] ? 'untyped (sent as a string)' : 'string';
  if (info.kind === 'date') notes.push(`date; written YYYY-MM-DD or one of: ${ACCEPTED.split(', ').slice(2).join(', ')}`);
  if (info.kind === 'date-time') notes.push(`date-time; sent as UTC; accepted forms: ${ACCEPTED}`);
  if (info.file) notes.push('file path; a relative path is resolved against the current directory');
  if (info.kind === 'array' || info.kind === 'string-or-list') notes.push('comma-separated list; quote an element that contains a comma');
  if (info.kind === 'boolean') notes.push(`--${name}, --no-${name} or --${name}=false`);
  const row = { name, type, required, description: info.description || '', notes };
  if (raw && raw.default !== undefined) row.default = raw.default;
  return row;
}

module.exports = { booleanChecker, parseTokens, unquote, splitList, convertValue, buildArguments, describeArguments, closest };
