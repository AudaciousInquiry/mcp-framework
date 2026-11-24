'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { z } = require('zod');
const { UserError } = require('./errors');
const { configFile } = require('./config');
const { resolvePath, settingsSchema, classify } = require('./schema');
const { parseTokens, booleanChecker, buildArguments, convertValue, describeArguments, closest } = require('./args');
const { FRAMEWORK_SETTINGS, FRAMEWORK_PROMPTABLE, FRAMEWORK_DEFAULTS } = require('./settings');

function getAt(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

function buildSchema(def) {
  const declared = def.settings ? z.toJSONSchema(def.settings, { io: 'input', unrepresentable: 'any' }) : null;
  return settingsSchema(declared, def.defaults, FRAMEWORK_SETTINGS);
}

function readJson(text, cwd) {
  let source = text;
  if (text.startsWith('@')) {
    const file = path.resolve(cwd, text.slice(1));
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch (err) {
      throw new UserError(`cannot read the file ${file} (${err.code || err.message})`);
    }
  }
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (err) {
    throw new UserError(`the settings must be valid JSON or @file (${err.message})`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UserError('the settings must be a JSON object');
  }
  return parsed;
}

function checkKnown(schema, base) {
  const known = Object.keys(schema.properties);
  for (const key of Object.keys(base)) {
    const r = resolvePath(schema, [key]);
    if (r.error) {
      const near = closest(key, known);
      throw new UserError(`${key} is not a setting${near ? `; did you mean ${near}?` : `; the settings are ${known.join(', ')}`}`);
    }
  }
}

function initHelp(c, schema) {
  const rows = describeArguments(schema);
  const lines = [`init: show or change the settings in ${configFile(c.identity.name)}`, '', 'Settings:'];
  for (const r of rows) {
    const dflt = getAt(c.def.defaults, r.name);
    const framework = FRAMEWORK_DEFAULTS[r.name];
    const shown = dflt !== undefined ? dflt : framework;
    lines.push(`  --${r.name} <${r.type}>${shown !== undefined && shown !== null ? `  default ${JSON.stringify(shown)}` : ''}${r.description ? `  ${r.description}` : ''}`);
    for (const n of r.notes) lines.push(`      ${n}`);
  }
  lines.push('', 'Give settings as JSON or @file, as --name value flags, or both (flags win).',
    'With no settings, init asks about each promptable setting; press Enter to keep the current value.');
  return lines.join('\n');
}

function nextSteps(c) {
  const { name } = c.identity;
  const script = path.join(c.launcherDir, c.script || 'index.js');
  const port = c.config.port;
  return [
    '',
    'Start the server:',
    `  node ${script}`,
    '',
    'Register it with a client over stdio:',
    `  claude mcp add ${name} -- node ${script} --stdio`,
    `  or in a client's JSON configuration: { "mcpServers": { "${name}": { "command": "node", "args": [${JSON.stringify(script)}, "--stdio"] } } }`,
    '',
    'Register it over HTTP (the server must be running):',
    `  claude mcp add --transport http ${name} http://127.0.0.1:${port}/`,
    `  or: { "mcpServers": { "${name}": { "type": "http", "url": "http://127.0.0.1:${port}/" } } }`,
  ].join('\n');
}

async function prompt(c, schema) {
  const names = [...FRAMEWORK_PROMPTABLE, ...(c.def.promptable || [])];
  const rl = readline.createInterface({ input: c.io.stdin || process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const update = {};
  const write = c.io.prompt || ((m) => process.stdout.write(m));
  try {
    for (const name of names) {
      const r = resolvePath(schema, name.split('.'));
      if (r.error) throw new UserError(`${name} is declared promptable but is not a setting`);
      const current = getAt(c.config, name);
      write(`${name} [${current === undefined || current === null ? '' : JSON.stringify(current).replace(/^"|"$/g, '')}]: `);
      const { value, done } = await lines.next();
      const answer = done ? '' : String(value).trim();
      if (answer === '') continue;
      const converted = convertValue(r.info, answer, name, { cwd: c.cwd || process.cwd(), now: c.now });
      // Build nested updates for dotted names.
      const segs = name.split('.');
      let node = update;
      for (let i = 0; i < segs.length - 1; i++) node = node[segs[i]] = node[segs[i]] || {};
      node[segs[segs.length - 1]] = converted;
    }
  } finally {
    rl.close();
  }
  return update;
}

/**
 * The `init` command.
 * @param {object} c context from the launcher
 * @returns {Promise<number>} exit code
 */
async function runInit(c) {
  const schema = buildSchema(c.def);
  const rest = c.args.rest;
  if (rest.includes('--help') || rest.includes('-h')) {
    c.io.out(initHelp(c, schema));
    return 0;
  }
  const cwd = c.cwd || process.cwd();
  const { positional, flags } = parseTokens(rest, booleanChecker(schema));
  if (positional.length > 1) throw new UserError(`unexpected argument "${positional[1]}"; only one JSON object or @file may be given`);

  let update;
  if (positional.length === 0 && flags.length === 0) {
    update = await prompt(c, schema);
  } else {
    const base = positional.length ? readJson(positional[0], cwd) : {};
    checkKnown(schema, base);
    update = buildArguments({ schema, flags, base, label: 'the settings', unknownAs: 'a setting', cwd, now: c.now });
  }
  const saved = Object.keys(update).length ? c.config.save(update) : { ...c.config };
  c.io.out(`${Object.keys(update).length ? 'Saved' : 'Current'} configuration in ${configFile(c.identity.name)}:`);
  c.io.out(JSON.stringify(saved, null, 2));
  c.io.out(nextSteps(c));
  return 0;
}

module.exports = { runInit, initHelp, buildSchema, classify };
