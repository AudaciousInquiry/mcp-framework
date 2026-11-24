'use strict';

const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const FIXTURE = path.join(__dirname, 'fixtures', 'example-mcp');

/**
 * Point HOME and USERPROFILE at a fresh temporary folder for the calling test.
 * @returns {{home: string, restore: () => void}}
 */
function tempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpfw-'));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return {
    home,
    restore() {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

/** @returns {Promise<number>} a port nothing is listening on */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Make an HTTP request with full control of the headers (fetch refuses to set Host and Origin).
 * @param {number} port
 * @param {{method?: string, path?: string, headers?: object, body?: string|Buffer}} [options]
 * @returns {Promise<{status: number, headers: object, text: string, json: *}>}
 */
function request(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('response aborted: the connection was closed')));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const MCP_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

/** Send one JSON-RPC message to the MCP route and return the parsed reply. */
async function rpc(port, message, extraHeaders = {}) {
  const res = await request(port, {
    method: 'POST',
    path: '/',
    headers: { ...MCP_HEADERS, ...extraHeaders },
    body: JSON.stringify(message),
  });
  let reply = res.json;
  if (!reply && res.text.includes('data:')) {
    const line = res.text.split(/\r?\n/).find((l) => l.startsWith('data:'));
    reply = JSON.parse(line.slice(5));
  }
  return { ...res, reply };
}

async function waitForHealth(port, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await request(port, { path: '/health' });
      if (r.status === 200) return r.json;
    } catch { /* not up yet */ }
    await sleep(50);
  }
  throw new Error(`no health answer on port ${port} within ${timeoutMs} ms`);
}

/**
 * Start the fixture's server.js directly (not through a launcher) on a free port.
 * @param {object} [options]
 * @param {object} [options.env] extra environment variables
 * @param {string[]} [options.args] extra arguments
 * @param {object} [options.defaults] extra default settings
 * @param {number} [options.port]
 * @param {boolean} [options.waitHealthy] wait for /health (default true)
 */
async function startServer({ env = {}, args = [], defaults = {}, port, waitHealthy = true } = {}) {
  port = port || await freePort();
  const child = spawn(process.execPath, [path.join(FIXTURE, 'server.js'), ...args], {
    env: {
      ...process.env,
      MCP_FRAMEWORK_DEFAULTS: JSON.stringify({ port, ...defaults }),
      ...env,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const server = {
    child, port, exited,
    get stderr() { return stderr; },
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        try { await request(port, { method: 'POST', path: '/shutdown' }); } catch { /* already gone */ }
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
        await exited;
        clearTimeout(timer);
      }
    },
  };
  if (waitHealthy) {
    try {
      server.health = await waitForHealth(port);
    } catch (err) {
      child.kill('SIGKILL');
      throw new Error(`${err.message}; stderr: ${stderr}`);
    }
  }
  return server;
}

module.exports = { tempHome, freePort, sleep, request, rpc, waitForHealth, startServer, FIXTURE, MCP_HEADERS };
