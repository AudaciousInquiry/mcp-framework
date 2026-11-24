'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { loadConfig, pidFile } = require('./config');
const log = require('./log');
const { probeHealth, hasHealthShape } = require('./probe');
const { readIdentity } = require('./util/identity');
const { register } = require('./tools');

const { DEFAULTS_ENV } = require('./constants');
const DEFAULT_MAX_BODY_BYTES = 1048576;
const DEFAULT_DRAIN_MS = 10000;
const DISCARD_CAP = 100 * 1024 * 1024;

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * Base class for an MCP's server. It carries stateless HTTP on loopback,
 * `/health`, port-in-use handling, the process id file, the graceful shutdown
 * and logging. An author overrides only what is specific to the MCP.
 *
 * Order: `startup`, bind, process id file, `afterListening`. On shutdown the
 * in-flight requests drain, then `shutdown` runs, then the process exits.
 *
 * @example
 * class MyServer extends McpServerBase {
 *   registerTools(server, context) { this.register(server, tools, handlers); }
 * }
 * module.exports = MyServer;
 * if (require.main === module) new MyServer().run();
 */
class McpServerBase {
  /**
   * @param {object} [options]
   * @param {string} [options.packageDir] directory to start looking for package.json (default: the running script's)
   * @param {object} [options.defaults] default settings, `port` required (default: the launcher's, from the environment)
   * @param {(candidate: object) => (object|void)} [options.validate] configuration validation and normalization
   */
  constructor(options = {}) {
    this.options = options;
    this.config = null;
    this.log = null;
    this.context = undefined;
    this.httpServer = null;
    this.sockets = new Set();
    this.stopping = false;
    this.bound = false;
    this.startedAt = Date.now();
  }

  /**
   * Create long-lived resources once, before the port is bound. Runs before
   * anything is served; slow setup belongs in `afterListening`.
   * @param {object} config the merged configuration (also `this.config`)
   * @param {object} logger the server logger (also `this.log`)
   * @returns {Promise<*>|*} the context passed to the other methods
   */
  // eslint-disable-next-line no-unused-vars
  async startup(config, logger) {
    return undefined;
  }

  /**
   * Register the tools on a fresh SDK server. Runs on every request, so it must
   * be cheap: register tools, never create resources. Required.
   * @param {object} server the SDK McpServer for this request
   * @param {*} context what `startup` returned
   */
  // eslint-disable-next-line no-unused-vars
  registerTools(server, context) {
    throw new Error('registerTools is required: override registerTools(server, context) in the server class');
  }

  /**
   * Runs once the server is listening, for background work such as timers or
   * workers, and for slow setup. A failure shuts the server down non-zero.
   * @param {*} context what `startup` returned
   */
  // eslint-disable-next-line no-unused-vars
  async afterListening(context) {}

  /**
   * Extra fields for `/health`. Base fields cannot be overwritten.
   * @param {*} context what `startup` returned
   * @returns {object}
   */
  // eslint-disable-next-line no-unused-vars
  healthExtension(context) {
    return {};
  }

  /**
   * Release resources. Runs after in-flight requests drain, before the process exits.
   * @param {*} context what `startup` returned
   */
  // eslint-disable-next-line no-unused-vars
  async shutdown(context) {}

  /**
   * Attach handlers to the declared tools. See {@link register}.
   * @param {object} server
   * @param {ReadonlyArray<object>} tools
   * @param {Record<string, Function>} handlers
   */
  register(server, tools, handlers) {
    register(server, tools, handlers);
  }

  /** Exit the process; a seam for tests. @param {number} code */
  exit(code) {
    process.exit(code);
  }

  /**
   * Run the server: load configuration and logging, call `startup`, bind,
   * write the process id file and call `afterListening`.
   * @returns {Promise<void>} resolves once the server is listening
   */
  async run() {
    log.installFatalHandlers('server');
    let identity;
    try {
      if (this.registerTools === McpServerBase.prototype.registerTools) {
        throw new Error('registerTools is required: override registerTools(server, context) in the server class');
      }
      const startDir = this.options.packageDir ||
        (require.main && require.main.filename ? path.dirname(require.main.filename) : process.cwd());
      identity = readIdentity(startDir);
      this.identity = identity;
      this.config = this.loadConfiguration(identity);
      const level = log.resolveLevel({
        option: argValue(process.argv, '--log-level'),
        env: process.env[identity.logLevelVariable],
        setting: this.config.log_level,
        variable: identity.logLevelVariable,
      });
      log.configureLogging({ name: identity.name, level, debug: process.argv.includes('--debug') });
      this.log = log.getLogger('server');
    } catch (err) {
      process.stderr.write(`server: ${err.message}\n`);
      this.exit(1);
      return;
    }

    process.on('SIGTERM', () => this.stop(0, 'SIGTERM'));
    process.on('SIGINT', () => this.stop(0, 'SIGINT'));

    try {
      this.context = await this.startup(this.config, this.log);
    } catch (err) {
      this.log.fatal(`startup failed: ${err && err.stack ? err.stack : err}`);
      await log.shutdownLogging();
      this.exit(1);
      return;
    }

    this.removeStalePidFile();
    this.httpServer = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => this.fail(res, err));
    });
    this.httpServer.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });

    await new Promise((resolve) => {
      this.httpServer.once('error', async (err) => {
        await this.bindFailed(err);
        resolve();
      });
      this.httpServer.listen(this.config.port, '127.0.0.1', () => {
        this.httpServer.removeAllListeners('error');
        this.httpServer.on('error', (e) => this.log.error(`http server error: ${e.stack || e}`));
        this.afterBind();
        resolve();
      });
    });
  }

  loadConfiguration(identity) {
    let defaults = this.options.defaults;
    if (!defaults && process.env[DEFAULTS_ENV]) defaults = JSON.parse(process.env[DEFAULTS_ENV]);
    if (!defaults) defaults = {};
    return loadConfig({ name: identity.name, defaults, writeDefaults: false, validate: this.options.validate });
  }

  removeStalePidFile() {
    const file = pidFile(this.identity.name);
    try {
      const pid = Number(fs.readFileSync(file, 'utf8').trim());
      if (!Number.isInteger(pid) || !processAlive(pid)) fs.rmSync(file, { force: true });
    } catch { /* no file */ }
  }

  afterBind() {
    this.bound = true;
    try {
      fs.writeFileSync(pidFile(this.identity.name), String(process.pid));
    } catch (err) {
      this.log.error(`cannot write the process id file: ${err.message}`);
    }
    this.log.info(`${this.identity.name} ${this.identity.version} listening on 127.0.0.1:${this.config.port} (pid ${process.pid})`);
    Promise.resolve()
      .then(() => this.afterListening(this.context))
      .catch((err) => {
        this.log.fatal(`afterListening failed: ${err && err.stack ? err.stack : err}`);
        return this.stop(1, 'afterListening failure');
      });
  }

  async bindFailed(err) {
    if (err.code !== 'EADDRINUSE') {
      this.log.fatal(`cannot listen on 127.0.0.1:${this.config.port}: ${err.stack || err}`);
      await this.releaseWithoutBind();
      this.exit(1);
      return;
    }
    const probe = await probeHealth(this.config.port, 5000);
    if (probe.state === 'responded' && hasHealthShape(probe.json)) {
      this.log.info(`port ${this.config.port} is already served by this MCP (pid ${probe.json.pid}); exiting`);
      await this.releaseWithoutBind();
      this.exit(0);
      return;
    }
    const seen = probe.state === 'responded' ? `answered /health with status ${probe.status}: ${probe.text.slice(0, 200)}` : `gave no usable /health answer (${probe.state})`;
    this.log.fatal(`port ${this.config.port} is in use by another program, which ${seen}`);
    await this.releaseWithoutBind();
    this.exit(1);
  }

  async releaseWithoutBind() {
    try { await this.shutdown(this.context); } catch (e) { this.log.error(`shutdown failed: ${e.stack || e}`); }
    await log.shutdownLogging();
  }

  /**
   * Begin the graceful shutdown: stop accepting, let in-flight requests
   * finish for `drainMs`, destroy the rest, run `shutdown`, remove the process
   * id file and exit. A second trigger is ignored.
   * @param {number} [code] exit status
   * @param {string} [reason] for the log
   */
  async stop(code = 0, reason = 'requested') {
    if (this.stopping) return;
    this.stopping = true;
    this.log.info(`shutting down (${reason})`);
    const drainMs = this.config.drainMs !== undefined ? this.config.drainMs : DEFAULT_DRAIN_MS;
    if (this.httpServer && this.httpServer.listening) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          for (const s of this.sockets) s.destroy();
        }, drainMs);
        this.httpServer.close(() => { clearTimeout(timer); resolve(); });
        this.httpServer.closeIdleConnections();
      });
    }
    try {
      await this.shutdown(this.context);
    } catch (err) {
      this.log.error(`shutdown failed: ${err && err.stack ? err.stack : err}`);
    }
    if (this.bound) {
      try { fs.rmSync(pidFile(this.identity.name), { force: true }); } catch { /* ignore */ }
    }
    await log.shutdownLogging();
    this.exit(code);
  }

  healthBody() {
    const base = {
      status: 'ok',
      version: this.identity.version,
      pid: process.pid,
      uptime_seconds: Math.floor((Date.now() - this.startedAt) / 1000),
    };
    let extra = {};
    try {
      extra = this.healthExtension(this.context) || {};
    } catch (err) {
      this.log.error(`health extension failed: ${err && err.stack ? err.stack : err}`);
      extra = { extension_error: err && err.message ? err.message : String(err) };
    }
    return { ...extra, ...base };
  }

  sendJson(res, status, body, headers = {}) {
    if (res.headersSent) { res.end(); return; }
    const text = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), ...headers });
    res.end(text);
  }

  fail(res, err) {
    this.log.error(`request failed: ${err && err.stack ? err.stack : err}`);
    if (res.headersSent) { res.end(); return; }
    this.sendJson(res, 500, { error: err && err.message ? err.message : String(err) });
  }

  allowedHost(host) {
    if (!host) return false;
    const port = this.config.port;
    return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host.toLowerCase());
  }

  async handle(req, res) {
    // Refuse browser and rebinding requests before anything else.
    if (req.headers.origin !== undefined) {
      this.sendJson(res, 403, { error: 'requests carrying an Origin header are refused' });
      return;
    }
    if (!this.allowedHost(req.headers.host)) {
      this.sendJson(res, 403, { error: 'the Host header must be 127.0.0.1, localhost or [::1] with this server\'s port' });
      return;
    }
    const url = new URL(req.url, 'http://127.0.0.1');
    const route = url.pathname;
    if (route === '/health' && req.method === 'GET') {
      this.sendJson(res, 200, this.healthBody());
    } else if (route === '/shutdown' && req.method === 'POST') {
      res.on('finish', () => { this.stop(0, 'shutdown request'); });
      this.sendJson(res, 200, { status: 'shutting_down' }, { Connection: 'close' });
    } else if (route === '/') {
      if (req.method === 'POST') {
        await this.handleMcp(req, res);
      } else if (req.method === 'GET' || req.method === 'DELETE') {
        this.sendJson(res, 405, { error: 'this server is stateless: it has no streams to open and no sessions to close' }, { Allow: 'POST' });
      } else {
        this.sendJson(res, 404, { error: 'not found' });
      }
    } else {
      this.sendJson(res, 404, { error: 'not found' });
    }
  }

  readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let exceeded = false;
      req.on('data', (c) => {
        size += c.length;
        if (exceeded) {
          if (size > DISCARD_CAP) req.destroy();
          return;
        }
        if (size > limit) { exceeded = true; chunks.length = 0; return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(exceeded ? null : Buffer.concat(chunks)));
      req.on('error', reject);
      req.on('aborted', () => resolve(undefined));
    });
  }

  async handleMcp(req, res) {
    const limit = this.config.maxBodyBytes !== undefined ? this.config.maxBodyBytes : DEFAULT_MAX_BODY_BYTES;
    const raw = await this.readBody(req, limit);
    if (raw === undefined) return;
    if (raw === null) {
      this.sendJson(res, 413, { error: `request body is larger than ${limit} bytes; the MCP can raise the maxBodyBytes setting` });
      return;
    }
    let body;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      this.sendJson(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: the body is not valid JSON' }, id: null });
      return;
    }
    const server = new McpServer({ name: this.identity.name, version: this.identity.version });
    this.registerTools(server, this.context);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }
}

module.exports = { McpServerBase, DEFAULTS_ENV };
