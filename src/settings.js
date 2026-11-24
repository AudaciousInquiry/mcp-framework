'use strict';

/**
 * The framework's own settings, as JSON Schema properties, so `init` types and
 * describes them like the MCP's. `promptable` marks the ones `init` asks about.
 */
const FRAMEWORK_SETTINGS = {
  port: {
    type: 'integer', minimum: 1, maximum: 65535,
    description: 'Port the server listens on, on 127.0.0.1',
  },
  log_level: {
    type: 'string', enum: ['trace', 'debug', 'info', 'warn', 'error'],
    description: 'Log level: trace, debug, info, warn or error (default info)',
  },
  maxBodyBytes: {
    type: 'integer', minimum: 1,
    description: 'Largest request body the server accepts, in bytes (default 1048576)',
  },
  drainMs: {
    type: 'integer', minimum: 0,
    description: 'How long a shutdown lets in-flight requests finish, in milliseconds (default 10000)',
  },
  startupTimeoutMs: {
    type: 'integer', minimum: 1,
    description: 'How long a start waits for the server to become healthy, in milliseconds (default 30000)',
  },
};

/** Settings the framework asks about when `init` is run with no arguments. */
const FRAMEWORK_PROMPTABLE = ['port', 'log_level'];

/** Defaults the framework applies in code when the setting is absent. */
const FRAMEWORK_DEFAULTS = { log_level: 'info', maxBodyBytes: 1048576, drainMs: 10000, startupTimeoutMs: 30000 };

module.exports = { FRAMEWORK_SETTINGS, FRAMEWORK_PROMPTABLE, FRAMEWORK_DEFAULTS };
