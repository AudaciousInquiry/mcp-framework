#!/usr/bin/env node
'use strict';

// A launcher for tests only: the same MCP with a bridge start-up hook controlled by the environment.
//   EXAMPLE_HOOK=log        the hook calls console.log
//   EXAMPLE_HOOK=throw      the hook throws
//   EXAMPLE_HOOK_LOG        file that gets one line per hook run
//   EXAMPLE_HOOK_CALL       file that gets the text the hook got from calling a tool
//   EXAMPLE_BRIDGE_TIMEOUT  the bridge's request timeout in milliseconds
const fs = require('node:fs');
const { runLauncher } = require('../../../src/launcher');

runLauncher({
  defaultPort: 7561,
  tools: require('./tools'),
  bridgeTimeoutMs: process.env.EXAMPLE_BRIDGE_TIMEOUT ? Number(process.env.EXAMPLE_BRIDGE_TIMEOUT) : undefined,
  async onBridgeStart(ctx) {
    if (process.env.EXAMPLE_HOOK_LOG) fs.appendFileSync(process.env.EXAMPLE_HOOK_LOG, 'hook ran\n');
    if (process.env.EXAMPLE_HOOK === 'log') console.log('stray print from the hook');
    if (process.env.EXAMPLE_HOOK === 'throw') throw new Error('hook failed on purpose');
    if (process.env.EXAMPLE_HOOK_CALL) {
      const r = await ctx.client.callTool('echo', { text: 'from the hook' });
      fs.appendFileSync(process.env.EXAMPLE_HOOK_CALL, r.text + '\n');
    }
  },
});
