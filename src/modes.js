'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { UserError } = require('./errors');
const { toJsonSchema } = require('./tools');
const { classify } = require('./schema');
const { parseTokens, booleanChecker, buildArguments, describeArguments } = require('./args');
const { createClient } = require('./client');
const { configFile } = require('./config');
const { deepMerge } = require('./util/merge');
const { getLogger, configureLogging, resolveLevel, levelVariable } = require('./log');

/** Display a parameter's type for `list`. */
function typeDisplay(node) {
  const info = classify(node);
  switch (info.kind) {
    case 'enum': return `enum(${info.values.join('|')})`;
    case 'array': return `${typeDisplay(info.items)}[]`;
    case 'string-or-list': return 'string|string[]';
    case 'date': return 'date';
    case 'date-time': return 'date-time';
    case 'untyped': return 'any';
    default: return info.kind;
  }
}

function requireTools(c) {
  if (!c.def.tools) {
    throw new UserError('this MCP did not give its tools file to the launcher: add `tools: require(\'./tools\')` to the launcher definition');
  }
  return c.def.tools;
}

/**
 * The `ctx` object every launcher hook receives.
 * @param {object} c context from the launcher
 */
function createContext(c) {
  const level = resolveLevel({
    option: c.args.logLevel,
    env: process.env[levelVariable(c.identity.name)],
    setting: c.config.log_level,
    variable: levelVariable(c.identity.name),
  });
  configureLogging({ name: c.identity.name, level, file: 'launcher.log' });
  return {
    config: c.config,
    client: createClient({ name: c.identity.name, version: c.identity.version, port: c.config.port }),
    log: getLogger('launcher'),
  };
}

function helpText(c) {
  const { name, version } = c.identity;
  const script = c.script || 'index.js';
  const lines = [
    `${name} ${version}`,
    '',
    'Usage:',
    `  node ${script} [options]`,
    `  node ${script} health`,
    `  node ${script} list`,
    `  node ${script} call <tool> [json|@file] [--argument value ...]`,
    `  node ${script} call <tool> --help`,
    `  node ${script} init [json|@file] [--setting value ...]`,
    `  node ${script} init --help`,
    '',
    'Options:',
    '  (none)             Start the server in the background and wait until it is healthy',
    '  --stop             Stop the running server',
    '  --restart          Stop the running server, if any, and start it again',
    '  --stdio            Run as a stdio bridge to the server, for MCP clients',
    '  --debug            Start the server with its log also written to this terminal',
    '  --log-level <lvl>  Start the server at trace, debug, info, warn or error',
    '  --help, -h         Show this help',
  ];
  for (const o of c.def.options) lines.push(`  ${o.name.padEnd(18)} ${o.description}`);
  lines.push(
    '',
    'Commands:',
    '  health             Print the running server\'s health as JSON',
    '  list               List the tools and their parameters',
    '  call <tool> ...    Call a tool on the running server',
    '  init               Show or change the settings in the configuration file',
    '',
    `Configuration file: ${configFile(name)}`,
    `Default port: ${c.def.defaultPort} (current setting: ${c.config.port})`
  );
  return lines.join('\n');
}

async function runHealth(c) {
  const client = createClient({ name: c.identity.name, version: c.identity.version, port: c.config.port });
  const h = await client.health();
  if (h.status !== 200 || h.json === null) {
    throw new UserError(`unhealthy: /health answered status ${h.status}: ${h.text.slice(0, 200)}`);
  }
  c.io.out(JSON.stringify(h.json, null, 2));
  return 0;
}

function runList(c) {
  const tools = requireTools(c);
  const lines = [];
  for (const tool of tools) {
    lines.push(`${tool.name}: ${tool.description}`);
    const schema = toJsonSchema(tool);
    const required = schema.required || [];
    for (const [key, node] of Object.entries(schema.properties || {})) {
      const info = classify(node);
      const mark = required.includes(key) ? 'required' : 'optional';
      lines.push(`  ${key}  ${typeDisplay(node)}  ${mark}${info.description ? `  ${info.description}` : ''}`);
    }
  }
  c.io.out(lines.join('\n'));
  return 0;
}

function formatArgumentHelp(title, description, schema) {
  const rows = describeArguments(schema);
  const lines = [title, description, '', 'Arguments:'];
  if (rows.length === 0) lines.push('  (none)');
  for (const r of rows) {
    const req = r.required ? 'required' : 'optional';
    const def = r.default !== undefined ? `  default ${JSON.stringify(r.default)}` : '';
    lines.push(`  --${r.name} <${r.type}>  ${req}${def}${r.description ? `  ${r.description}` : ''}`);
    for (const n of r.notes) lines.push(`      ${n}`);
  }
  return lines.join('\n');
}

function readJsonArgument(text, cwd) {
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
    throw new UserError(`the arguments must be valid JSON or @file (${err.message})`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UserError('the arguments must be a JSON object');
  }
  return parsed;
}

async function runCall(c) {
  const rest = c.args.rest;
  const wantsHelp = rest.includes('--help') || rest.includes('-h');
  const toolName = rest.find((t) => !t.startsWith('-'));
  const usage = `usage: call <tool> [json|@file] [--argument value ...]; list shows the tools, call <tool> --help shows a tool's arguments`;
  if (!toolName) {
    if (wantsHelp) { c.io.out(usage); return 0; }
    throw new UserError(usage);
  }
  const tools = requireTools(c);
  const tool = tools.find((t) => t.name === toolName);
  const tokens = rest.filter((t, i) => !(i === rest.indexOf(toolName)));
  const cwd = c.cwd || process.cwd();

  if (wantsHelp) {
    if (!tool) throw new UserError(`unknown tool "${toolName}"; run list to see the tools`);
    c.io.out(formatArgumentHelp(`call ${tool.name}`, tool.description, toJsonSchema(tool)));
    return 0;
  }

  let args;
  if (!tool) {
    // A tool registered at run time: JSON only.
    const { positional, flags } = parseTokens(tokens);
    if (positional.length === 0 && flags.length === 0) throw new UserError(`unknown tool "${toolName}"; run list to see the tools`);
    if (flags.length) throw new UserError(`"${toolName}" has no declared schema, so flag-style arguments cannot be used; give a JSON object or @file`);
    args = readJsonArgument(positional[0], cwd);
  } else {
    const schema = toJsonSchema(tool);
    const { positional, flags } = parseTokens(tokens, booleanChecker(schema));
    if (positional.length > 1) throw new UserError(`unexpected argument "${positional[1]}"; only one JSON object or @file may be given`);
    const base = positional.length ? readJsonArgument(positional[0], cwd) : {};
    args = buildArguments({ schema, flags, base, label: `tool "${tool.name}"`, cwd, now: c.now });
  }

  const ctx = createContext(c);
  if (c.def.defaultArguments) {
    const adjusted = await c.def.defaultArguments(toolName, JSON.parse(JSON.stringify(args)), ctx);
    // The user's own values win over what the MCP would default.
    if (adjusted && typeof adjusted === 'object') args = deepMerge(adjusted, args);
  }
  const result = await ctx.client.callTool(toolName, args);
  if (result.isError) {
    c.io.err(result.text);
    return 1;
  }
  c.io.out(result.text);
  return 0;
}

/**
 * Modes other than start, stop and restart.
 * @param {object} c context from the launcher
 * @returns {Promise<number>} exit code
 */
async function run(c) {
  const { mode, command } = c.args;
  if (mode === 'help') { c.io.out(helpText(c)); return 0; }
  if (mode === 'extra') {
    await c.args.extra.handler(createContext(c));
    return 0;
  }
  if (mode === 'command') {
    if (command === 'health') return runHealth(c);
    if (command === 'list') return runList(c);
    if (command === 'call') return runCall(c);
    if (command === 'init') return require('./init').runInit(c, createContext);
  }
  if (mode === 'stdio') return require('./bridge').runBridge(c, createContext);
  throw new UserError(`${command || mode} is not available`);
}

module.exports = { run, helpText, typeDisplay, formatArgumentHelp, createContext };
