'use strict';

const { McpServerBase, textResult } = require('../../../src');
const tools = require('./tools');

class MyServer extends McpServerBase {
  registerTools(server, context) {
    this.register(server, tools, {
      echo: ({ text }) => textResult(text),
      add: ({ a, b }) => textResult(String(a + b)),
    });
  }
}

module.exports = MyServer;

if (require.main === module) new MyServer().run();
