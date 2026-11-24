'use strict';

const http = require('node:http');

/**
 * One GET /health to 127.0.0.1, with no retries. The literal address is used,
 * never `localhost`, which can resolve to IPv6 first.
 *
 * Results:
 *  - `{ state: 'responded', status, text, json }`: a server answered (`json` is null when the body is not JSON)
 *  - `{ state: 'refused' }`: nothing is listening
 *  - `{ state: 'silent' }`: a connection was accepted but no answer came in time
 *  - `{ state: 'error', error }`: any other failure
 *
 * @param {number} port
 * @param {number} [timeoutMs]
 * @returns {Promise<object>}
 */
function probeHealth(port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/health', timeout: timeoutMs, agent: false },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size <= 65536) chunks.push(c);
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch { /* not JSON */ }
          resolve({ state: 'responded', status: res.statusCode, text, json });
        });
        res.on('error', (err) => resolve({ state: 'error', error: err.message }));
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ state: 'silent' });
    });
    req.on('error', (err) => {
      resolve(err.code === 'ECONNREFUSED' ? { state: 'refused' } : { state: 'error', error: err.message });
    });
  });
}

/**
 * Whether a parsed /health body has the base fields every framework server returns.
 * @param {*} json
 * @returns {boolean}
 */
function hasHealthShape(json) {
  return Boolean(
    json && typeof json === 'object' &&
    json.status === 'ok' &&
    typeof json.version === 'string' &&
    Number.isInteger(json.pid) && json.pid > 1 &&
    typeof json.uptime_seconds === 'number'
  );
}

module.exports = { probeHealth, hasHealthShape };
