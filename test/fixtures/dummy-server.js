'use strict';

// A stand-in for a server in a bad state. Usage: node dummy-server.js <mode> <port> [version]
//   stubborn  answers /health like a framework server but ignores /shutdown (404)
//   silent    accepts connections and never answers
const http = require('node:http');

const [mode, portText, version = '1.0.0'] = process.argv.slice(2);
const port = Number(portText);

const server = http.createServer((req, res) => {
  if (mode === 'silent') return;
  if (req.url === '/health') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', version, pid: process.pid, uptime_seconds: 1 }));
    return;
  }
  res.statusCode = 404;
  res.end('no such route');
});
server.listen(port, '127.0.0.1');
