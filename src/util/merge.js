'use strict';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Deep merge of `update` over `base` into a new object. Nested objects merge
 * key by key, arrays and every other value replace, and keys only in `base`
 * are kept. `0`, `false` and `null` in `update` are real values.
 * @param {object} base
 * @param {object} update
 * @returns {object}
 */
function deepMerge(base, update) {
  const out = {};
  for (const key of Object.keys(base)) out[key] = clone(base[key]);
  for (const key of Object.keys(update || {})) {
    const value = update[key];
    if (value === undefined) continue;
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = clone(value);
    }
  }
  return out;
}

function clone(v) {
  if (Array.isArray(v)) return v.map(clone);
  if (isPlainObject(v)) return deepMerge({}, v);
  return v;
}

module.exports = { deepMerge, isPlainObject };
