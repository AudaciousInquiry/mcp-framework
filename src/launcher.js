'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { requireNodeVersion } = require('./util/nodeversion');
const { readIdentity } = require('./util/identity');
const { loadConfig } = require('./config');
const { resolveLevel, installFatalHandlers } = require('./log');
const { UserError } = require('./errors');
const daemon = require('./daemon');

const COMMANDS = ['health', 'list', 'call', 'init'];
const RESERVED_OPTIONS = ['--stdio', '--stop', '--restart', '--debug', '--log-level', '--help', '-h'];

function fieldError(field, problem) {
  return new UserError(`launcher definition: "${field}" ${problem}`);
}

/**
 * Check the launcher definition and fill in the defaults.
 * @param {object} def the object passed to runLauncher
 * @param {string} launcherDir directory of the launcher script
 * @returns {object} the normalized definition
 */
function validateDefinition(def, launcherDir) {
  if (!def || typeof def !== 'object') throw new UserError('runLauncher needs a definition object');
  const port = def.defaultPort;
  if (port === undefined) {
    throw fieldError('defaultPort', 'is required: declare the port this MCP listens on by default');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw fieldError('defaultPort', `must be a whole number from 1 to 65535, found ${JSON.stringify(port)}`);
  }
  const serverScript = def.serverScript === undefined ? 'server.js' : def.serverScript;
  if (typeof serverScript !== 'string' || serverScript === '') throw fieldError('serverScript', 'must be a file name');
  const serverPath = path.resolve(launcherDir, serverScript);
  if (!fs.existsSync(serverPath)) {
    throw new UserError(`the server file ${serverPath} does not exist; create it, or set "serverScript" in the launcher definition`);
  }
  const nodeArgs = def.nodeArgs === undefined ? [] : def.nodeArgs;
  if (!Array.isArray(nodeArgs) || nodeArgs.some((a) => typeof a !== 'string')) {
    throw fieldError('nodeArgs', 'must be an array of strings, for example ["--max-old-space-size=8192"]');
  }
  const startupTimeoutMs = def.startupTimeoutMs === undefined ? 30000 : def.startupTimeoutMs;
  if (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 1) {
    throw fieldError('startupTimeoutMs', 'must be a positive whole number of milliseconds');
  }
  if (def.bridgeTimeoutMs !== undefined && (!Number.isInteger(def.bridgeTimeoutMs) || def.bridgeTimeoutMs < 1)) {
    throw fieldError('bridgeTimeoutMs', 'must be a positive whole number of milliseconds');
  }
  for (const hook of ['defaultArguments', 'onBridgeStart', 'validate']) {
    if (def[hook] !== undefined && typeof def[hook] !== 'function') throw fieldError(hook, 'must be a function');
  }
  if (def.promptable !== undefined && (!Array.isArray(def.promptable) || def.promptable.some((p) => typeof p !== 'string'))) {
    throw fieldError('promptable', 'must be an array of setting names');
  }
  if (def.settings !== undefined && !(def.settings && def.settings._zod && def.settings._zod.def && def.settings._zod.def.type === 'object')) {
    throw fieldError('settings', 'must be a Zod object schema, for example z.object({ feature: z.boolean() })');
  }
  if (def.tools !== undefined && !Array.isArray(def.tools)) throw fieldError('tools', 'must come from defineTools');
  const options = def.options === undefined ? [] : def.options;
  if (!Array.isArray(options)) throw fieldError('options', 'must be an array of { name, description, handler }');
  for (const o of options) {
    if (!o || typeof o.name !== 'string' || !o.name.startsWith('-')) {
      throw fieldError('options', 'entries need a "name" that starts with "-", for example "--rebuild"');
    }
    if (RESERVED_OPTIONS.includes(o.name) || COMMANDS.includes(o.name.replace(/^-+/, ''))) {
      throw fieldError('options', `entry "${o.name}" collides with a name the framework reserves`);
    }
    if (typeof o.handler !== 'function') throw fieldError('options', `entry "${o.name}" needs a handler function`);
    if (typeof o.description !== 'string') throw fieldError('options', `entry "${o.name}" needs a description for --help`);
  }
  return {
    ...def,
    defaultPort: port, serverScript, serverPath, nodeArgs, startupTimeoutMs, options,
    defaults: { ...(def.defaults || {}), port },
  };
}

/**
 * Parse the launcher's own arguments.
 * @param {string[]} argv arguments after the script name
 * @param {object} def normalized definition
 * @returns {{mode: string, command?: string, rest: string[], debug: boolean, logLevel?: string, extra?: object}}
 */
function parseLauncherArgs(argv, def) {
  const out = { mode: 'start', rest: [], debug: false };
  let modeFlag = null;
  const setMode = (mode, flag) => {
    if (modeFlag) throw new UserError(`${modeFlag} and ${flag} cannot be used together; give one of --stdio, --stop, --restart, --help or an added option`);
    modeFlag = flag;
    out.mode = mode;
  };
  if (argv.length > 0 && COMMANDS.includes(argv[0])) {
    return { ...out, mode: 'command', command: argv[0], rest: argv.slice(1) };
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--stdio') setMode('stdio', a);
    else if (a === '--stop') setMode('stop', a);
    else if (a === '--restart') setMode('restart', a);
    else if (a === '--debug') out.debug = true;
    else if (a === '--help' || a === '-h') setMode('help', a);
    else if (a === '--log-level' || a.startsWith('--log-level=')) {
      const value = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
      if (value === undefined) throw new UserError('--log-level needs a value: trace, debug, info, warn or error');
      out.logLevel = resolveLevel({ option: value });
    } else {
      const extra = def.options.find((o) => o.name === a);
      if (!extra) throw new UserError(`unknown option ${a}; run with --help to see the options`);
      setMode('extra', a);
      out.extra = extra;
    }
  }
  return out;
}

/**
 * Run the launcher with explicit arguments and output, returning the exit code.
 * @param {object} definition the MCP's definition
 * @param {string[]} argv
 * @param {{out: Function, err: Function}} io
 * @param {string} launcherDir
 * @returns {Promise<number>}
 */
async function launch(definition, argv, io, launcherDir, script = 'index.js', cwd = process.cwd()) {
  const identity = readIdentity(launcherDir);
  const def = validateDefinition(definition, launcherDir);
  try {
    const args = parseLauncherArgs(argv, def);
    const isHelp = args.mode === 'help' || args.rest.includes('--help') || args.rest.includes('-h');
    const config = loadConfig({ name: identity.name, defaults: def.defaults, writeDefaults: !isHelp, validate: def.validate });
    const d = {
      name: identity.name,
      version: identity.version,
      port: config.port,
      serverPath: def.serverPath,
      nodeArgs: def.nodeArgs,
      startupTimeoutMs: config.startupTimeoutMs !== undefined ? config.startupTimeoutMs : def.startupTimeoutMs,
      drainMs: config.drainMs,
      serverDefaults: def.defaults,
      say: (m) => io.out(m),
      timeouts: def.timeouts,
    };
    const options = { debug: args.debug, logLevel: args.logLevel };
    let result;
    if (args.mode === 'start') result = await daemon.ensureRunning(d, options);
    else if (args.mode === 'restart') result = await daemon.restart(d, options);
    else if (args.mode === 'stop') result = await daemon.stop(d);
    else {
      const modes = require('./modes');
      return await modes.run({ args, def, identity, config, d, io, launcherDir, script, cwd });
    }
    (result.ok ? io.out : io.err)(result.ok ? result.message : `${identity.name}: ${result.message}`);
    return result.ok ? 0 : 1;
  } catch (err) {
    if (err instanceof UserError) {
      io.err(`${identity.name}: ${err.message}`);
      return err.exitCode;
    }
    io.err(`${identity.name}: unexpected failure: ${err && err.stack ? err.stack : err}`);
    return 1;
  }
}

/**
 * The single entry point of an MCP's launcher file. Reads the process
 * arguments, does what they ask and exits.
 * @param {object} definition
 * @param {number} definition.defaultPort required: the port the MCP listens on by default
 * @param {string} [definition.serverScript] server file relative to the launcher (default `server.js`)
 * @param {string[]} [definition.nodeArgs] Node options placed before the server script
 * @param {number} [definition.startupTimeoutMs] how long a start waits (default 30000)
 */
function runLauncher(definition) {
  requireNodeVersion();
  installFatalHandlers('launcher');
  const script = (require.main && require.main.filename) || process.argv[1];
  const launcherDir = path.dirname(path.resolve(script));
  const io = {
    out: (m) => process.stdout.write(`${m}\n`),
    err: (m) => process.stderr.write(`${m}\n`),
  };
  return launch(definition, process.argv.slice(2), io, launcherDir, path.basename(script)).then(
    (code) => process.exit(code),
    (err) => {
      if (err instanceof UserError) {
        io.err(`launcher: ${err.message}`);
        process.exit(err.exitCode);
      }
      io.err(`launcher: unexpected failure: ${err && err.stack ? err.stack : err}`);
      process.exit(1);
    }
  );
}

module.exports = { runLauncher, launch, validateDefinition, parseLauncherArgs, COMMANDS, RESERVED_OPTIONS };
