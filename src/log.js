'use strict';

/*
 * The logging module. This is the only file that imports log4js, so the
 * library can be replaced without touching anything else.
 */

const fs = require('node:fs');
const path = require('node:path');
const log4js = require('log4js');
const { logsDir } = require('./config');
const { UserError } = require('./errors');

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error'];
const ENV_KEY = 'MCP_FRAMEWORK_LOGGING';
const LAYOUT = { type: 'pattern', pattern: '%d{ISO8601_WITH_TZ_OFFSET} %p %c %m' };

let configured = false;
let mirrorOn = false;

/**
 * Name of the environment variable that overrides the level for one MCP.
 * @param {string} name the MCP's package name
 * @returns {string} for example MY_MCP_LOG_LEVEL
 */
function levelVariable(name) {
  return `${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_LOG_LEVEL`;
}

/**
 * Pick the log level: launcher option, then environment variable, then the
 * `log_level` setting, then `info`.
 * @param {object} sources
 * @param {string} [sources.option] value of --log-level
 * @param {string} [sources.env] value of the environment variable
 * @param {string} [sources.setting] value of the log_level setting
 * @param {string} [sources.variable] environment variable name, for the message
 * @returns {string}
 * @throws {Error} naming where the invalid value came from
 */
function resolveLevel({ option, env, setting, variable = 'the environment variable' } = {}) {
  const candidates = [
    ['--log-level', option],
    [variable, env],
    ['setting "log_level"', setting],
  ];
  for (const [source, value] of candidates) {
    if (value === undefined || value === null || value === '') continue;
    const level = String(value).toLowerCase();
    if (!LEVELS.includes(level)) {
      throw new UserError(`${source} is "${value}"; the allowed values are ${LEVELS.join(', ')}`);
    }
    return level;
  }
  return 'info';
}

function canWrite(file) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.closeSync(fs.openSync(file, 'a'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Configure logging for this process and, through the environment, for worker
 * threads it starts.
 * @param {object} options
 * @param {string} options.name the MCP's package name
 * @param {string} options.level resolved level
 * @param {boolean} [options.debug] mirror the log to standard error
 * @param {number} [options.maxLogSize] roll-over size in bytes (default 10 MB)
 * @param {string} [options.file] log file name in the logs folder (default `server.log`)
 */
function configureLogging({ name, level, debug = false, maxLogSize = 10 * 1024 * 1024, file: fileName = 'server.log' }) {
  process.env[ENV_KEY] = JSON.stringify({ name, level, debug, maxLogSize, file: fileName });
  const file = path.join(logsDir(name), fileName);
  const appenders = {};
  const names = [];
  if (canWrite(file)) {
    appenders.file = {
      type: 'dateFile',
      filename: file,
      pattern: 'yyyy-MM-dd',
      numBackups: 7,
      maxLogSize,
      keepFileExt: true,
      alwaysIncludePattern: false,
      layout: LAYOUT,
    };
    names.push('file');
  } else {
    appenders.fallback = { type: 'stderr', layout: LAYOUT };
    names.push('fallback');
  }
  if (debug) {
    appenders.mirror = { type: 'stderr', layout: LAYOUT };
    names.push('mirror');
    // A closed terminal makes writes to standard error fail; ignore that.
    process.stderr.on('error', () => {});
    mirrorOn = true;
  }
  log4js.configure({
    appenders,
    categories: { default: { appenders: names, level } },
  });
  configured = true;
}

/**
 * Get a named logger writing to the same file, with the same format, level and
 * rotation as the framework. In a worker thread the logging configures itself
 * from the environment the main thread set.
 * @param {string} category
 * @returns {{trace: Function, debug: Function, info: Function, warn: Function, error: Function, fatal: Function}}
 */
function getLogger(category) {
  if (!configured) {
    const raw = process.env[ENV_KEY];
    if (raw) configureLogging(JSON.parse(raw));
  }
  return log4js.getLogger(category);
}

/**
 * Flush and close the log files.
 * @returns {Promise<void>}
 */
function shutdownLogging() {
  if (!configured) return Promise.resolve();
  return new Promise((resolve) => log4js.shutdown(() => resolve()));
}

/**
 * Write uncaught exceptions and unhandled rejections with their stack trace,
 * then exit non-zero.
 * @param {string} label who is running: launcher, server, bridge
 */
function installFatalHandlers(label) {
  let handling = false;
  const fatal = (kind, err) => {
    if (handling) return;
    handling = true;
    const text = err && err.stack ? err.stack : String(err);
    if (configured) {
      try { getLogger(label).fatal(`${kind}: ${text}`); } catch { /* ignore */ }
    }
    if (!mirrorOn) {
      try { process.stderr.write(`${label}: ${kind}: ${text}\n`); } catch { /* ignore */ }
    }
    const done = () => process.exit(1);
    if (configured) {
      shutdownLogging().then(done, done);
    } else {
      done();
    }
  };
  process.on('uncaughtException', (err) => fatal('uncaught exception', err));
  process.on('unhandledRejection', (reason) => fatal('unhandled rejection', reason));
}

/**
 * Run a job and, at debug level or lower, log it when it held the thread
 * longer than a threshold. At other levels this is one function call.
 * @template T
 * @param {{isDebugEnabled: () => boolean, debug: Function}} logger
 * @param {string} job name of the job
 * @param {() => T} fn the job
 * @param {number} [thresholdMs]
 * @returns {T}
 */
function timed(logger, job, fn, thresholdMs = 100) {
  if (!logger.isDebugEnabled()) return fn();
  const start = process.hrtime.bigint();
  try {
    return fn();
  } finally {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (ms >= thresholdMs) logger.debug(`${job} held the main thread for ${ms.toFixed(1)} ms`);
  }
}

module.exports = {
  LEVELS,
  levelVariable,
  resolveLevel,
  configureLogging,
  getLogger,
  shutdownLogging,
  installFatalHandlers,
  timed,
};
