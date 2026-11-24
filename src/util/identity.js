'use strict';

const { parseVersion } = require('./version');

/**
 * Validate the MCP name and version taken from its package.json.
 * @param {{name?: string, version?: string}} pkg
 * @returns {{name: string, version: string, logLevelVariable: string}}
 * @throws {Error} with a message naming the field
 */
function validateIdentity(pkg) {
  const { name, version } = pkg || {};
  if (typeof name !== 'string' || name === '') {
    throw new Error('package.json field "name" is missing');
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name) || name.endsWith('.')) {
    throw new Error(
      `package.json field "name" ("${name}") cannot be used as a directory name: use letters, digits, ".", "_" and "-"`
    );
  }
  if (typeof version !== 'string' || !parseVersion(version)) {
    throw new Error(`package.json field "version" ("${version}") is not a semver version such as 1.2.3`);
  }
  return {
    name,
    version,
    logLevelVariable: `${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_LOG_LEVEL`,
  };
}

/**
 * Find and read the nearest package.json at or above a directory, and validate
 * the name and version in it.
 * @param {string} startDir
 * @returns {{name: string, version: string, logLevelVariable: string, dir: string}}
 */
function readIdentity(startDir) {
  const fs = require('node:fs');
  const path = require('node:path');
  let dir = path.resolve(startDir);
  for (;;) {
    const file = path.join(dir, 'package.json');
    if (fs.existsSync(file)) {
      let pkg;
      try {
        pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (err) {
        throw new Error(`${file} is not valid JSON (${err.message})`);
      }
      return { ...validateIdentity(pkg), dir };
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`no package.json found at or above ${startDir}; the MCP's name and version are read from it`);
    }
    dir = parent;
  }
}

module.exports = { validateIdentity, readIdentity };
