'use strict';

const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const FIXTURE = path.join(__dirname, 'fixtures', 'example-mcp');

/** The bearer token a local client reads from the process id file to call /shutdown. */
function shutdownToken(name = 'example-mcp') {
  try {
    return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.mcp', name, 'server.pid'), 'utf8')).token;
  } catch { return undefined; }
}

/** POST /shutdown the way a local client does, with the bearer token. */
function postShutdown(port, name = 'example-mcp') {
  const token = shutdownToken(name);
  return request(port, { method: 'POST', path: '/shutdown', headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

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
      if (!process.env.MCPFW_KEEP_HOME) fs.rmSync(home, { recursive: true, force: true });
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
        try { await postShutdown(port); } catch { /* already gone */ }
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

/** Write the user's config.json for the fixture MCP. */
function writeConfig(name, settings) {
  const dir = path.join(os.homedir(), '.mcp', name);
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(settings));
}

/**
 * Copy the fixture to a sibling folder with another version (same depth, so its
 * relative requires still work). Returns the folder; remove it when done.
 */
function fixtureVersion(version) {
  const dir = path.join(path.dirname(FIXTURE), `example-mcp-v${version}-${crypto.randomBytes(3).toString('hex')}`);
  fs.cpSync(FIXTURE, dir, { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  pkg.version = version;
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  return dir;
}

/**
 * Run a launcher script to completion. Standard error goes to a file, not a
 * pipe: a server the launcher starts inherits it and would otherwise hold a
 * pipe open until the server stops.
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
async function runLauncher(script, args = [], { env = {}, timeoutMs = 60000 } = {}) {
  const errFile = path.join(os.tmpdir(), `mcpfw-err-${crypto.randomBytes(4).toString('hex')}.txt`);
  const errFd = fs.openSync(errFile, 'w');
  const child = spawn(process.execPath, [script, ...args], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', errFd],
  });
  fs.closeSync(errFd);
  let stdout = '';
  child.stdout.on('data', (d) => { stdout += d; });
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  const code = await new Promise((resolve) => child.on('exit', (c) => resolve(c)));
  clearTimeout(timer);
  await new Promise((r) => { if (child.stdout.destroyed) r(); else { child.stdout.once('close', r); setTimeout(r, 200); } });
  const stderr = fs.readFileSync(errFile, 'utf8');
  fs.rmSync(errFile, { force: true });
  return { code, stdout, stderr };
}

/** Start the dummy server in a bad state; returns the child and a stop function. */
async function startDummy(mode, port, version) {
  const child = spawn(process.execPath, [path.join(__dirname, 'fixtures', 'dummy-server.js'), mode, String(port), version || '1.0.0'], { stdio: 'ignore' });
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const up = await new Promise((r) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
    if (up) break;
    await sleep(30);
  }
  return { child, stop: () => { try { child.kill('SIGKILL'); } catch { /* gone */ } } };
}

/**
 * Stop whatever is serving the port, and keep stopping it until nothing has
 * answered for a settle period. A server that lost a start race can still be
 * booting when the winner is stopped, and would take the port afterwards.
 */
async function shutdownAll(port, settleMs = 1500, name = 'example-mcp') {
  let quietSince = null;
  const give = Date.now() + 20000;
  while (Date.now() < give) {
    let answered = false;
    try {
      const r = await Promise.race([postShutdown(port, name), sleep(1000).then(() => null)]);
      answered = r !== null;
    } catch { /* nothing listening */ }
    if (answered) quietSince = null;
    else if (quietSince === null) quietSince = Date.now();
    else if (Date.now() - quietSince >= settleMs) return;
    await sleep(150);
  }
}

module.exports = { shutdownAll, shutdownToken, postShutdown, writeConfig, fixtureVersion, runLauncher, startDummy, tempHome, freePort, sleep, request, rpc, waitForHealth, startServer, FIXTURE, MCP_HEADERS };
