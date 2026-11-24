'use strict';

const REQUIRED_MAJOR = 22;

/**
 * Check the running Node.js version.
 * @param {string} [found] version string such as "22.1.0"; defaults to the running one
 * @returns {string|null} one-line message when too old, otherwise null
 */
function nodeVersionProblem(found = process.versions.node) {
  const major = Number(String(found).split('.')[0]);
  if (major >= REQUIRED_MAJOR) return null;
  return `Node.js ${REQUIRED_MAJOR} or later is required; found ${found}`;
}

/**
 * Print the problem and exit non-zero when Node.js is too old.
 */
function requireNodeVersion() {
  const problem = nodeVersionProblem();
  if (problem) {
    process.stderr.write(problem + '\n');
    process.exit(1);
  }
}

module.exports = { nodeVersionProblem, requireNodeVersion, REQUIRED_MAJOR };
