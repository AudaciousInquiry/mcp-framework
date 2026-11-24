'use strict';

const fs = require('node:fs');
const { McpServerBase, textResult, jsonResult, errorResult } = require('../../../src');
const tools = require('./tools');

class ExampleServer extends McpServerBase {
  async startup(config, log) {
    if (process.env.EXAMPLE_STARTUP === 'throw') throw new Error('startup failed on purpose');
    if (process.env.EXAMPLE_STARTUP === 'slow') await new Promise((r) => setTimeout(r, 3000));
    log.info('example startup');
    return { calls: 0 };
  }

  registerTools(server, context) {
    if (process.env.EXAMPLE_REGISTER === 'throw') throw new Error('registration failed on purpose');
    this.register(server, tools, {
      echo: ({ text }) => { context.calls++; return textResult(text); },
      add: ({ a, b }) => textResult(String(a + b)),
      sleep: async ({ ms }) => { await new Promise((r) => setTimeout(r, ms)); return textResult(`slept ${ms}`); },
      inspect: (args) => jsonResult(args),
      mixed: () => ({ content: [{ type: 'text', text: 'first' }, { type: 'image', data: 'aGk=', mimeType: 'image/png' }, { type: 'text', text: 'second' }] }),
      fail: () => errorResult('this tool always fails'),
      boom: () => { throw new Error('this tool always throws'); },
    });
  }

  async afterListening(context) {
    if (process.env.EXAMPLE_AFTER === 'throw') throw new Error('afterListening failed on purpose');
    if (process.env.EXAMPLE_AFTER === 'slow') await new Promise((r) => setTimeout(r, 60000));
  }

  healthExtension(context) {
    if (process.env.EXAMPLE_HEALTH === 'throw') throw new Error('health extension failed on purpose');
    if (process.env.EXAMPLE_HEALTH === 'clash') return { status: 'bad', pid: -1, example: true };
    return { example: true, calls: context.calls };
  }

  async shutdown(context) {
    if (process.env.EXAMPLE_MARKER) {
      await new Promise((r) => setTimeout(r, 200));
      fs.writeFileSync(process.env.EXAMPLE_MARKER, 'shutdown ran');
    }
  }
}

module.exports = ExampleServer;

if (require.main === module) new ExampleServer().run();
