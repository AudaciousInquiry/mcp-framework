'use strict';

const { UserError } = require('./errors');

/**
 * Modes other than start, stop and restart. Filled in as each is written.
 * @param {object} c context from the launcher
 * @returns {Promise<number>} exit code
 */
async function run(c) {
  throw new UserError(`${c.args.mode === 'command' ? c.args.command : c.args.mode} is not available yet`);
}

module.exports = { run };
