'use strict';

/*
 * Helpers that read a JSON Schema (as produced by z.toJSONSchema) and say what
 * kind of command-line value each property takes.
 */

function nonNull(schemas) {
  return schemas.filter((s) => !(s && s.type === 'null'));
}

/**
 * Classify a JSON Schema node.
 * @param {object} schema
 * @returns {{kind: string, schema: object, file: boolean, description?: string, values?: any[], items?: object, properties?: object, required?: string[], additional?: (boolean|object)}}
 *  kind: string, date, date-time, integer, number, boolean, enum, array, object, string-or-list, untyped
 */
function classify(schema) {
  const s = schema || {};
  const base = { schema: s, file: s['x-cli'] === 'file', description: s.description };
  if (Array.isArray(s.enum)) return { ...base, kind: 'enum', values: s.enum };
  if (s.const !== undefined) return { ...base, kind: 'enum', values: [s.const] };

  const branches = s.anyOf || s.oneOf;
  if (Array.isArray(branches)) {
    const live = nonNull(branches);
    if (live.length === 1) {
      const inner = classify(live[0]);
      return { ...inner, description: s.description || inner.description, file: inner.file || base.file };
    }
    if (live.length === 2) {
      const kinds = live.map(classify);
      const str = kinds.find((k) => k.kind === 'string');
      const arr = kinds.find((k) => k.kind === 'array' && classify(k.items).kind === 'string');
      if (str && arr) return { ...base, kind: 'string-or-list', items: arr.items, file: base.file || str.file };
    }
    return { ...base, kind: 'untyped' };
  }

  let type = s.type;
  if (Array.isArray(type)) {
    const live = type.filter((t) => t !== 'null');
    type = live.length === 1 ? live[0] : undefined;
  }
  switch (type) {
    case 'string':
      if (s.format === 'date') return { ...base, kind: 'date' };
      if (s.format === 'date-time') return { ...base, kind: 'date-time' };
      return { ...base, kind: 'string' };
    case 'integer': return { ...base, kind: 'integer' };
    case 'number': return { ...base, kind: 'number' };
    case 'boolean': return { ...base, kind: 'boolean' };
    case 'array': return { ...base, kind: 'array', items: s.items || {} };
    case 'object':
      return {
        ...base, kind: 'object',
        properties: s.properties || {},
        required: s.required || [],
        additional: s.additionalProperties === undefined ? false : s.additionalProperties,
      };
    default: return { ...base, kind: 'untyped' };
  }
}

/** Whether an object schema accepts names it does not list. */
function allowsExtra(info) {
  const a = info.additional;
  return a === true || (a && typeof a === 'object');
}

/**
 * Resolve a dotted path against a schema.
 * @param {object} schema the root object schema
 * @param {string[]} segments path segments
 * @returns {{info: object, extra: boolean}|{error: string, valid?: string[]}} the field, or why not
 */
function resolvePath(schema, segments) {
  let info = classify(schema);
  let extra = false;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const walked = segments.slice(0, i).join('.');
    if (info.kind === 'object') {
      if (info.properties && Object.prototype.hasOwnProperty.call(info.properties, seg)) {
        info = classify(info.properties[seg]);
      } else if (allowsExtra(info)) {
        const more = info.additional && typeof info.additional === 'object' ? info.additional : {};
        info = classify(more);
        extra = true;
      } else {
        return { error: 'unknown', at: walked, segment: seg, valid: Object.keys(info.properties || {}) };
      }
    } else if (info.kind === 'array') {
      if (!/^\d+$/.test(seg)) return { error: 'index', at: walked, segment: seg };
      info = classify(info.items);
    } else if (info.kind === 'untyped') {
      // Nothing is known below an untyped value: take the rest as it comes.
      info = classify({});
      extra = true;
    } else {
      return { error: 'scalar', at: walked, segment: seg };
    }
  }
  return { info, extra };
}

/**
 * Build an object schema for `init` from the framework's settings, the MCP's
 * settings schema and the defaults: a setting with no declared type is typed
 * from the type of its default value.
 * @param {object|null} declared JSON Schema of the MCP's settings (may be null)
 * @param {object} defaults default settings
 * @param {object} frameworkProperties JSON Schema properties of the framework's own settings
 * @returns {object} object schema; `x-untyped` marks a setting typed from a null default
 */
function settingsSchema(declared, defaults, frameworkProperties) {
  const properties = { ...frameworkProperties, ...((declared && declared.properties) || {}) };
  const fromValue = (v) => {
    if (typeof v === 'boolean') return { type: 'boolean' };
    if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer' } : { type: 'number' };
    if (typeof v === 'string') return { type: 'string' };
    if (Array.isArray(v)) {
      const first = v.find((x) => x !== null && x !== undefined);
      return { type: 'array', items: first === undefined ? {} : fromValue(first) };
    }
    if (v && typeof v === 'object') {
      const props = {};
      for (const [k, x] of Object.entries(v)) props[k] = fromValue(x);
      return { type: 'object', properties: props };
    }
    return { 'x-untyped': true };
  };
  for (const [key, value] of Object.entries(defaults || {})) {
    if (!properties[key]) properties[key] = fromValue(value);
  }
  return { type: 'object', properties, required: (declared && declared.required) || [] };
}

module.exports = { classify, resolvePath, allowsExtra, settingsSchema };
