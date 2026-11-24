'use strict';

const net = require('node:net');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { probeHealth } = require('./probe');
const { UserError } = require('./errors');

const CALL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Whether anything accepts connections on the port; gives up within a few seconds.
 * @param {number} port
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
function reachable(port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.on('connect', () => done(true));
    socket.on('error', () => done(false));
  });
}

/**
 * A client for the running server, as the command line uses it. It never
 * starts a server.
 * @param {{name: string, version: string, port: number}} options
 */
function createClient({ name, version, port }) {
  const notReachable = () => new UserError(
    `${name} is not reachable on port ${port}; start it with the launcher (run it with no arguments)`
  );

  async function ensureReachable() {
    if (!(await reachable(port))) throw notReachable();
  }

  return {
    port,

    /**
     * Fetch /health.
     * @returns {Promise<{status: number, text: string, json: *}>}
     */
    async health() {
      const probe = await probeHealth(port, 3000);
      if (probe.state === 'refused') throw notReachable();
      if (probe.state === 'silent') throw new UserError(`${name} is running on port ${port} but is not answering; it may be busy`);
      if (probe.state === 'error') throw new UserError(`${name}: health check failed (${probe.error})`);
      return { status: probe.status, text: probe.text, json: probe.json };
    },

    /**
     * Call a tool.
     * @param {string} tool
     * @param {object} args
     * @returns {Promise<{isError: boolean, text: string, content: Array<object>}>}
     */
    async callTool(tool, args = {}) {
      await ensureReachable();
      const client = new Client({ name: `${name}-cli`, version }, { capabilities: {} });
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/`));
      try {
        await client.connect(transport);
        const result = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: CALL_TIMEOUT_MS });
        const content = Array.isArray(result.content) ? result.content : [];
        const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
        return { isError: Boolean(result.isError), text, content };
      } catch (err) {
        if (err instanceof UserError) throw err;
        const code = err && (err.code || (err.cause && err.cause.code));
        if (code === 'ECONNREFUSED') throw notReachable();
        throw new UserError(`the call to ${tool} failed: ${err && err.message ? err.message : err}`);
      } finally {
        await client.close().catch(() => {});
      }
    },
  };
}

module.exports = { createClient, reachable };
