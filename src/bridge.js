'use strict';

const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const daemon = require('./daemon');
const { reachable } = require('./client');

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const UNAVAILABLE = -32000;

/** Send console.log, console.info and console.debug to standard error, so a stray print cannot corrupt the protocol stream. */
function redirectConsole() {
  const toStderr = (...args) => console.error(...args);
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
}

function isTimeout(err) {
  const name = err && (err.name || (err.cause && err.cause.name));
  const code = err && (err.code || (err.cause && err.cause.code));
  return name === 'TimeoutError' || name === 'AbortError' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT';
}

function isHttpStatus(err) {
  return err && typeof err.code === 'number';
}

function errorResponse(id, message) {
  return { jsonrpc: '2.0', id, error: { code: UNAVAILABLE, message } };
}

/**
 * The stdio bridge (`--stdio`): forwards every message between the client on
 * standard input and output and the server's HTTP interface, starting the
 * server if needed and recovering when it dies.
 * @param {object} c context from the launcher
 * @param {Function} createContext builds the `ctx` object for hooks
 * @returns {Promise<number>} exit code
 */
async function runBridge(c, createContext) {
  redirectConsole();
  const { identity, d, def } = c;
  const stderr = (m) => process.stderr.write(`${m}\n`);
  d.say = stderr;
  const ctx = createContext(c);
  const timeoutMs = def.bridgeTimeoutMs || DEFAULT_TIMEOUT_MS;

  const started = await daemon.ensureRunning(d, { debug: c.args.debug, logLevel: c.args.logLevel });
  if (!started.ok && started.status !== 'newer') {
    stderr(`${identity.name}: ${started.message}`);
    return 1;
  }
  if (started.ok) stderr(started.message);
  if (started.status === 'newer') stderr(`${identity.name}: ${started.message} Using the running server.`);

  const runHook = async () => {
    if (!def.onBridgeStart) return;
    try {
      await def.onBridgeStart(ctx);
    } catch (err) {
      const text = err && err.stack ? err.stack : String(err);
      ctx.log.error(`bridge start-up hook failed: ${text}`);
      stderr(`${identity.name}: the bridge start-up hook failed: ${text}`);
    }
  };
  await runHook();

  const stdio = new StdioServerTransport(c.io.stdin, c.io.stdout);
  // Each POST is watched on its own, so a broken response stream fails only the request it belongs to.
  const watchedFetch = async (url, init) => {
    let id;
    try {
      const m = init && init.method === 'POST' && typeof init.body === 'string' ? JSON.parse(init.body) : null;
      if (m && m.id !== undefined && m.method !== undefined) id = m.id;
    } catch { /* not a request */ }
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (id === undefined || !response.body) return response;
    const reader = response.body.getReader();
    const body = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) controller.close(); else controller.enqueue(value);
        } catch (err) {
          streamFailed(id, err);
          controller.error(err);
        }
      },
      cancel(reason) { return reader.cancel(reason); },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  const http = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${d.port}/`), { fetch: watchedFetch });

  const inflight = new Set();
  let sending = 0;
  let recovering = false;
  let finished = false;
  let finish;
  const done = new Promise((resolve) => { finish = (code) => { if (!finished) { finished = true; resolve(code); } }; });

  const reply = (message) => stdio.send(message).catch((e) => stderr(`${identity.name}: cannot write to the client: ${e.message}`));

  const failInflight = (message) => {
    for (const id of inflight) reply(errorResponse(id, message));
    inflight.clear();
  };

  async function recover(reason) {
    if (recovering || finished) return;
    recovering = true;
    try {
    ctx.log.warn(`server unreachable (${reason}); restarting it`);
    stderr(`${identity.name}: the server is unreachable (${reason}); restarting it`);
    failInflight('The MCP server stopped; it is being restarted. Retry in a moment.');
    const r = await daemon.respawn(d);
    if (!r.ok) {
      stderr(`${identity.name}: could not restart the server: ${r.message}`);
      await http.close().catch(() => {});
      await stdio.close().catch(() => {});
      finish(1);
      return;
    }
    await runHook();
    recovering = false;
    stderr(`${identity.name}: the server was restarted`);
    } catch (err) {
      stderr(`${identity.name}: recovery failed: ${err && err.stack ? err.stack : err}`);
      await http.close().catch(() => {});
      await stdio.close().catch(() => {});
      finish(1);
    }
  }

  async function afterFailure(err) {
    if (isTimeout(err) || isHttpStatus(err)) return;
    if (!(await reachable(d.port, 1500))) await recover(err && err.message ? err.message : 'connection failed');
  }

  http.onmessage = (message) => {
    if (message && message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      inflight.delete(message.id);
    }
    reply(message);
  };
  http.onerror = (err) => {
    // Failures of a send are handled where it is awaited, and failures of a response stream in streamFailed.
    ctx.log.debug(`transport error: ${err && err.message}`);
  };

  function streamFailed(id, err) {
    if (finished || !inflight.delete(id)) return;
    reply(errorResponse(id, isTimeout(err)
      ? 'The MCP server did not answer in time.'
      : 'The MCP server connection failed. Retry in a moment.'));
    afterFailure(err).catch((e) => stderr(`${identity.name}: ${e && e.message ? e.message : e}`));
  }

  stdio.onmessage = async (message) => {
    const isRequest = message && message.id !== undefined && message.method !== undefined;
    if (recovering) {
      if (isRequest) reply(errorResponse(message.id, 'The MCP server is restarting. Retry in a moment.'));
      else ctx.log.warn(`dropped a notification while restarting the server: ${message && message.method}`);
      return;
    }
    if (isRequest) inflight.add(message.id);
    sending++;
    try {
      await http.send(message);
    } catch (err) {
      if (isRequest && inflight.delete(message.id)) {
        reply(errorResponse(message.id, isTimeout(err)
          ? 'The MCP server did not answer in time.'
          : isHttpStatus(err) ? `The MCP server answered with an error: ${err.message}`
            : 'The MCP server could not be reached. Retry in a moment.'));
      } else if (!isRequest) {
        ctx.log.warn(`a notification could not be forwarded: ${err && err.message}`);
      }
      await afterFailure(err);
    } finally {
      sending--;
    }
  };
  stdio.onerror = (err) => stderr(`${identity.name}: ${err && err.message ? err.message : err}`);

  const input = c.io.stdin || process.stdin;
  // When the client closes standard input, let requests already forwarded finish (up to 30 s), then exit.
  const end = async () => {
    const give = Date.now() + Math.min(timeoutMs, 30000);
    while (inflight.size > 0 && !recovering && Date.now() < give) await new Promise((r) => setTimeout(r, 25));
    finish(0);
  };
  input.on('end', end);
  input.on('close', end);

  await http.start();
  await stdio.start();
  const code = await done;
  await http.close().catch(() => {});
  return code;
}

module.exports = { runBridge, redirectConsole };
