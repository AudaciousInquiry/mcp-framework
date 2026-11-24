'use strict';

/**
 * An error the user can act on: reported as one line prefixed with the MCP's
 * name, without a stack trace. Anything else is an unexpected failure and is
 * reported with its stack.
 */
class UserError extends Error {
  /**
   * @param {string} message
   * @param {number} [exitCode]
   */
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'UserError';
    this.exitCode = exitCode;
  }
}

module.exports = { UserError };
