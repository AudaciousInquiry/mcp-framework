'use strict';

/*
 * Starting, stopping and checking the detached server. Every function takes
 * one object, `d`, describing the MCP:
 *   name, version, port, serverPath, nodeArgs, startupTimeoutMs, serverDefaults,
 *   say(message)            where progress messages go (may be a no-op)
 *   timeouts                optional overrides, mainly for tests
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { dataDir, pidFile, logsDir } = require('./config');
const { DEFAULTS_ENV } = require('./constants');
const { probeHealth, hasHealthShape } = require('./probe');
const { compareVersions } = require('./util/version');

const TIMEOUTS = {
  probeMs: 5000,
  shutdownRequestMs: 5000,
  gracefulExitMs: 30000,
  killGraceMs: 15000,
  portFreeMs: 5000,
};

function timeouts(d) {
  return { ...TIMEOUTS, ...(d.timeouts || {}) };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {object} d @returns {number|null} the process id in the file, or null */
function readPid(d) {
  try {
    const pid = Number(fs.readFileSync(pidFile(d.name), 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** @param {number} pid @returns {boolean} */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function removePidFile(d) {
  try { fs.rmSync(pidFile(d.name), { force: true }); } catch { /* ignore */ }
}

/** Remove the process id file when it names a process that is not running. */
function removeStalePidFile(d) {
  const pid = readPid(d);
  if (pid === null || !isAlive(pid)) removePidFile(d);
}

function logFile(d) {
  return path.join(logsDir(d.name), 'server.log');
}

/**
 * Probe the server once.
 * @returns {Promise<{kind: string, health?: object, probe: object}>}
 *  kind is one of: down, busy, up, other
 */
async function check(d) {
  const probe = await probeHealth(d.port, timeouts(d).probeMs);
  if (probe.state === 'refused') return { kind: 'down', probe };
  if (probe.state === 'silent') return { kind: 'busy', probe };
  if (probe.state === 'responded' && hasHealthShape(probe.json)) return { kind: 'up', health: probe.json, probe };
  return { kind: 'other', probe };
}

function describeOther(probe) {
  if (probe.state === 'responded') return `it answered /health with status ${probe.status}: ${probe.text.slice(0, 200)}`;
  return `it gave no usable answer (${probe.error || probe.state})`;
}

function busyMessage(d) {
  const pid = readPid(d);
  const who = pid !== null && isAlive(pid) ? ` (pid ${pid})` : '';
  return `${d.name} is running${who} but not answering on port ${d.port}; it may be busy. ` +
    `It was left running. Use --stop to end it.`;
}

function spawnServer(d, { debug = false, logLevel } = {}) {
  const args = [...(d.nodeArgs || []), d.serverPath];
  if (debug) args.push('--debug');
  if (logLevel) args.push('--log-level', logLevel);
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', 'ignore', 'inherit'],
    cwd: path.dirname(d.serverPath),
    env: { ...process.env, [DEFAULTS_ENV]: JSON.stringify(d.serverDefaults) },
  });
  child.unref();
  return child;
}

/**
 * Start the server and wait for one of: the child exiting, the process id file
 * appearing (then one health probe), or the startup timeout (then a final check).
 * @returns {Promise<{ok: boolean, status: string, pid?: number, message: string}>}
 */
async function startAndWait(d, options = {}) {
  fs.mkdirSync(logsDir(d.name), { recursive: true });
  removeStalePidFile(d);
  const timeoutMs = d.startupTimeoutMs;
  const child = spawnServer(d, options);

  return new Promise((resolve) => {
    let settled = false;
    let watcher;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (watcher) watcher.close();
      resolve(result);
    };
    const healthy = async (how) => {
      const r = await check(d);
      if (r.kind === 'up') {
        finish({ ok: true, status: how, pid: r.health.pid, message: `${d.name} ${r.health.version} ${how === 'started' ? 'started' : 'is running'} (pid ${r.health.pid}) on port ${d.port}` });
        return true;
      }
      return false;
    };

    child.on('error', (err) => finish({ ok: false, status: 'failed', message: `cannot start the server: ${err.message}` }));
    child.on('exit', async (code, signal) => {
      if (settled) return;
      if (code === 0 && await healthy('already-running')) return;
      finish({
        ok: false, status: 'exited',
        message: `the server exited prematurely (${signal ? `signal ${signal}` : `exit code ${code}`}); see the output above and the log ${logFile(d)}`,
      });
    });

    const onPidFile = async () => {
      // Only a process id file holding the child's own pid counts; a leftover file does not.
      if (settled || readPid(d) !== child.pid) return;
      if (await healthy('started')) return;
      finish({ ok: false, status: 'unhealthy', message: `the server wrote its process id file but did not answer a health check; see the log ${logFile(d)}` });
    };
    try {
      watcher = fs.watch(dataDir(d.name), () => { onPidFile(); });
      watcher.on('error', () => {});
    } catch { /* the timeout still covers us */ }
    onPidFile();

    timer = setTimeout(async () => {
      if (settled) return;
      if (readPid(d) === child.pid && await healthy('started')) return;
      finish({
        ok: false, status: 'timeout', pid: child.pid,
        message: `the server (pid ${child.pid}) was not healthy after ${Math.round(timeoutMs / 1000)} s; it may still be starting. ` +
          `It was left running. Log: ${logFile(d)}`,
      });
    }, timeoutMs);
  });
}

function postShutdown(port, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/shutdown', method: 'POST', timeout: timeoutMs, agent: false },
      (res) => { res.resume(); res.on('end', () => resolve(res.statusCode === 200)); res.on('error', () => resolve(false)); }
    );
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end();
  });
}

// There is no event for the exit of a process that is not our child, so the
// process table is polled; this is a local system call, not a request to the server.
async function waitForExit(pid, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!isAlive(pid)) return true;
    await sleep(100);
  }
  return !isAlive(pid);
}

async function waitForPortFree(port, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const probe = await probeHealth(port, 1000);
    if (probe.state === 'refused') return true;
    await sleep(100);
  }
  return false;
}

/**
 * Stop a running server: POST /shutdown, wait for the exit, fall back to
 * terminating and then force-killing it, wait for the port to free, and
 * remove the process id file.
 * @param {object} d
 * @param {number} pid
 * @returns {Promise<'graceful'|'killed'>}
 */
async function stopProcess(d, pid) {
  const t = timeouts(d);
  let graceful = false;
  if (await postShutdown(d.port, t.shutdownRequestMs)) {
    graceful = await waitForExit(pid, t.gracefulExitMs);
  }
  if (!graceful) {
    try { process.kill(pid); } catch { /* already gone */ }
    if (!(await waitForExit(pid, t.killGraceMs))) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
      await waitForExit(pid, 5000);
    }
  }
  await waitForPortFree(d.port, t.portFreeMs);
  removePidFile(d);
  return graceful ? 'graceful' : 'killed';
}

function newerMessage(d, running) {
  return `a newer version of ${d.name} (${running}) is running than this one (${d.version}); it was left alone. ` +
    `Stop it with --stop, then start normally.`;
}

/**
 * The normal start: report an existing server, replace an older one, refuse
 * to touch a newer one, or start a new one.
 * @param {object} d
 * @param {{debug?: boolean, logLevel?: string}} [options]
 * @returns {Promise<{ok: boolean, status: string, pid?: number, message: string}>}
 */
async function ensureRunning(d, options = {}) {
  const r = await check(d);
  if (r.kind === 'busy') return { ok: false, status: 'busy', message: busyMessage(d) };
  if (r.kind === 'other') {
    return { ok: false, status: 'port-held', message: `port ${d.port} is in use by another program; ${describeOther(r.probe)}. Change the port with: init --port <number>` };
  }
  if (r.kind === 'up') {
    const cmp = compareVersions(r.health.version, d.version);
    if (cmp > 0) return { ok: false, status: 'newer', pid: r.health.pid, message: newerMessage(d, r.health.version) };
    if (cmp === 0) {
      const ignored = [];
      if (options.debug) ignored.push('--debug');
      if (options.logLevel) ignored.push('--log-level');
      const note = ignored.length ? `; ${ignored.join(' and ')} not applied, a restart is needed (use --restart)` : '';
      return { ok: true, status: 'already-running', pid: r.health.pid, message: `${d.name} is already running (version ${r.health.version}, pid ${r.health.pid})${note}` };
    }
    d.say(`${d.name} ${r.health.version} is running; replacing it with ${d.version}`);
    await stopProcess(d, r.health.pid);
    const started = await startAndWait(d, options);
    return started.ok ? { ...started, status: 'replaced' } : started;
  }
  return startAndWait(d, options);
}

/**
 * Stop a running server and start this version in its place. A newer running
 * server is refused; an unresponsive one is reported and left alone.
 * @param {object} d
 * @param {{debug?: boolean, logLevel?: string}} [options]
 */
async function restart(d, options = {}) {
  const r = await check(d);
  if (r.kind === 'busy') return { ok: false, status: 'busy', message: busyMessage(d) };
  if (r.kind === 'other') {
    return { ok: false, status: 'port-held', message: `port ${d.port} is in use by another program; ${describeOther(r.probe)}. Change the port with: init --port <number>` };
  }
  if (r.kind === 'up') {
    if (compareVersions(r.health.version, d.version) > 0) {
      return { ok: false, status: 'newer', pid: r.health.pid, message: newerMessage(d, r.health.version) };
    }
    const how = await stopProcess(d, r.health.pid);
    d.say(`${d.name} (pid ${r.health.pid}) stopped${how === 'killed' ? ' (killed)' : ''}`);
  } else {
    d.say(`${d.name} was not running`);
  }
  return startAndWait(d, options);
}

/**
 * Stop a running server and exit without starting one.
 * @param {object} d
 */
async function stop(d) {
  const r = await check(d);
  if (r.kind === 'down') {
    removeStalePidFile(d);
    return { ok: true, status: 'not-running', message: `${d.name} is not running` };
  }
  if (r.kind === 'busy') return { ok: false, status: 'busy', message: busyMessage(d) };
  if (r.kind === 'other') {
    return { ok: false, status: 'port-held', message: `port ${d.port} is in use by another program, not by ${d.name}; ${describeOther(r.probe)}` };
  }
  const how = await stopProcess(d, r.health.pid);
  return {
    ok: true, status: how, pid: r.health.pid,
    message: `${d.name} (pid ${r.health.pid}, version ${r.health.version}) ${how === 'graceful' ? 'stopped gracefully' : 'did not shut down on request and was killed'}`,
  };
}

/**
 * Start a server if none is healthy; safe for several callers at once, because
 * the port bind is the only coordination. Used by the bridge to recover.
 * @param {object} d
 * @returns {Promise<{ok: boolean, message: string}>}
 */
async function respawn(d) {
  const quiet = { ...d, say() {} };
  const r = await check(quiet);
  if (r.kind === 'up') return { ok: true, message: 'server is healthy' };
  if (r.kind === 'busy') return { ok: false, message: busyMessage(quiet) };
  if (r.kind === 'other') return { ok: false, message: `port ${d.port} is held by another program` };
  const started = await startAndWait(quiet);
  return { ok: started.ok, message: started.message };
}

module.exports = {
  check, ensureRunning, restart, stop, respawn, stopProcess, startAndWait,
  readPid, isAlive, removeStalePidFile, logFile, TIMEOUTS,
};
