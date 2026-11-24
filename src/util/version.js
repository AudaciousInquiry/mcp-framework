'use strict';

/**
 * Parse the major, minor and patch numbers of a semver string. A pre-release
 * or build suffix is ignored.
 * @param {string} text
 * @returns {number[]|null} [major, minor, patch], or null when not semver
 */
function parseVersion(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(text).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * Compare two semver strings by major, minor and patch.
 * @param {string} a
 * @param {string} b
 * @returns {number} negative when a is older, 0 when equal, positive when newer
 */
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) {
    throw new Error(`Cannot compare versions "${a}" and "${b}": not semver`);
  }
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

module.exports = { parseVersion, compareVersions };
