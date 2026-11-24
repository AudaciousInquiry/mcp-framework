'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { deepMerge } = require('./util/merge');
const { UserError } = require('./errors');
const { FRAMEWORK_SETTINGS } = require('./settings');

/**
 * The data directory of an MCP: `~/.mcp/<name>`.
 * @param {string} name the MCP's package name
 * @returns {string}
 */
function dataDir(name) {
  return path.join(os.homedir(), '.mcp', name);
}

/** @param {string} name @returns {string} path of config.json */
function configFile(name) {
  return path.join(dataDir(name), 'config.json');
}

/** @param {string} name @returns {string} path of the logs folder */
function logsDir(name) {
  return path.join(dataDir(name), 'logs');
}

/** @param {string} name @returns {string} path of the process id file */
function pidFile(name) {
  return path.join(dataDir(name), 'server.pid');
}

/**
 * Create the data directory and its logs folder when missing.
 * @param {string} name
 * @returns {string} the data directory
 */
function ensureDataDir(name) {
  fs.mkdirSync(logsDir(name), { recursive: true });
  return dataDir(name);
}

function checkPort(port, where) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UserError(`${where}: setting "port" must be a whole number from 1 to 65535, found ${JSON.stringify(port)}`);
  }
}

/** Check the framework's own settings: type, minimum and allowed values. */
function checkFrameworkSettings(candidate, where) {
  for (const [key, spec] of Object.entries(FRAMEWORK_SETTINGS)) {
    if (key === 'port' || candidate[key] === undefined) continue;
    const v = candidate[key];
    if (spec.enum) {
      if (!spec.enum.includes(v)) throw new UserError(`${where}: setting "${key}" must be one of ${spec.enum.join(', ')}, found ${JSON.stringify(v)}`);
    } else if (!Number.isInteger(v) || v < spec.minimum) {
      throw new UserError(`${where}: setting "${key}" must be a whole number of at least ${spec.minimum}, found ${JSON.stringify(v)}`);
    }
  }
}

function snapshot(config) {
  return deepMerge({}, config);
}

function writeAtomic(fsImpl, file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fsImpl.writeFileSync(tmp, text);
    fsImpl.renameSync(tmp, file);
  } catch (err) {
    try { fsImpl.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Load the configuration of an MCP: stored values merged over the defaults.
 *
 * With `writeDefaults` true (launcher side) a missing file is created with the
 * defaults using the exclusive-create flag. The server passes false: with no
 * file it uses the defaults in memory and writes nothing.
 *
 * The result is a plain object of settings with a non-enumerable `save`
 * function: `save()` stores the current settings, `save(update)` merges the
 * update into a copy, validates and writes it, then applies it in memory.
 *
 * @param {object} options
 * @param {string} options.name the MCP's package name
 * @param {object} options.defaults default settings; `port` is required
 * @param {boolean} [options.writeDefaults] write the defaults when no file exists
 * @param {(candidate: object) => (object|void)} [options.validate] the MCP's function to
 *   validate or normalize a configuration; return a replacement or nothing; throw to reject
 * @param {object} [options.fs] file system, for tests
 * @returns {object}
 */
function loadConfig(options) {
  const { name, defaults, writeDefaults = false, validate, fs: fsImpl = fs } = options;
  const file = configFile(name);
  fsImpl.mkdirSync(logsDir(name), { recursive: true });

  let stored = {};
  let text;
  try {
    text = fsImpl.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    if (writeDefaults) {
      try {
        fsImpl.writeFileSync(file, JSON.stringify(defaults, null, 2) + '\n', { flag: 'wx' });
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        text = fsImpl.readFileSync(file, 'utf8');
      }
    }
  }
  if (text !== undefined) {
    try {
      stored = JSON.parse(text);
    } catch (err) {
      throw new UserError(`${file} is not valid JSON (${err.message}); correct the file and run the command again`);
    }
    if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
      throw new UserError(`${file} must hold a JSON object; correct the file and run the command again`);
    }
  }

  const config = deepMerge(defaults || {}, stored);
  if (config.port === undefined) {
    throw new UserError(`${name}: a default port is required: declare "port" in the defaults`);
  }
  checkPort(config.port, file);
  checkFrameworkSettings(config, file);

  function check(candidate) {
    checkPort(candidate.port, file);
    checkFrameworkSettings(candidate, file);
    if (validate) {
      const out = validate(snapshot(candidate));
      if (out && typeof out === 'object') candidate = out;
    }
    checkPort(candidate.port, file);
    checkFrameworkSettings(candidate, file);
    return candidate;
  }

  Object.defineProperty(config, 'save', {
    enumerable: false,
    value(update) {
      let candidate = update === undefined ? snapshot(config) : deepMerge(snapshot(config), update);
      candidate = check(candidate);
      fsImpl.mkdirSync(dataDir(name), { recursive: true });
      writeAtomic(fsImpl, file, JSON.stringify(candidate, null, 2) + '\n');
      for (const key of Object.keys(config)) if (!(key in candidate)) delete config[key];
      Object.assign(config, candidate);
      return snapshot(config);
    },
  });
  return config;
}

module.exports = { dataDir, configFile, logsDir, pidFile, ensureDataDir, loadConfig };
