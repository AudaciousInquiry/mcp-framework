'use strict';

const { z } = require('zod');
const { getLogger } = require('./log');

const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

function isZodObject(schema) {
  return Boolean(schema && typeof schema.safeParse === 'function' && schema._zod && schema._zod.def && schema._zod.def.type === 'object');
}

/**
 * Declare the tools of an MCP: a name, a description and a Zod input schema
 * for each, and no handlers. Both the launcher and the server load this file.
 * @param {Array<{name: string, description: string, inputSchema: object}>} declarations
 * @returns {ReadonlyArray<{name: string, description: string, inputSchema: object}>}
 * @throws {Error} naming the tool and the problem
 */
function defineTools(declarations) {
  if (!Array.isArray(declarations)) {
    throw new Error('defineTools expects an array of tool declarations');
  }
  const seen = new Set();
  const tools = declarations.map((d, index) => {
    const where = d && typeof d.name === 'string' ? `tool "${d.name}"` : `tool at index ${index}`;
    if (!d || typeof d.name !== 'string' || !NAME_PATTERN.test(d.name)) {
      throw new Error(`${where}: "name" must be 1 to 128 letters, digits, "_", "." or "-"`);
    }
    if (typeof d.description !== 'string' || d.description.trim() === '') {
      throw new Error(`${where}: "description" must be a non-empty string`);
    }
    if (!isZodObject(d.inputSchema)) {
      throw new Error(`${where}: "inputSchema" must be a Zod object schema, for example z.object({ query: z.string() })`);
    }
    if (seen.has(d.name)) {
      throw new Error(`${where}: declared more than once`);
    }
    seen.add(d.name);
    return Object.freeze({ name: d.name, description: d.description, inputSchema: d.inputSchema });
  });
  return Object.freeze(tools);
}

/**
 * Convert a tool's input schema to JSON Schema, keeping `.meta()` markers
 * such as `x-cli: 'file'`.
 * @param {{inputSchema: object}} tool
 * @returns {object}
 */
function toJsonSchema(tool) {
  return z.toJSONSchema(tool.inputSchema, { io: 'input', unrepresentable: 'any' });
}

/** @param {string} text @returns {{content: Array<{type: string, text: string}>}} */
function textResult(text) {
  return { content: [{ type: 'text', text: String(text) }] };
}

/** @param {*} value @returns {{content: Array<{type: string, text: string}>}} */
function jsonResult(value) {
  return textResult(JSON.stringify(value, null, 2));
}

/** @param {string} message @returns {{isError: true, content: Array<{type: string, text: string}>}} */
function errorResult(message) {
  return { isError: true, content: [{ type: 'text', text: String(message) }] };
}

function normalize(result) {
  if (typeof result === 'string') return textResult(result);
  if (result && typeof result === 'object' && Array.isArray(result.content)) return result;
  if (result === undefined || result === null) return textResult('');
  return jsonResult(result);
}

/**
 * Register the declared tools on an SDK server, attaching a handler to each
 * by name. Every handler is wrapped: an exception becomes an error result with
 * the stack logged, and the start, duration and outcome of each call are logged.
 * @param {object} server an SDK McpServer
 * @param {ReadonlyArray<{name: string, description: string, inputSchema: object}>} tools from defineTools
 * @param {Record<string, (args: object, extra: object) => *>} handlers by tool name
 */
function register(server, tools, handlers) {
  const log = getLogger('tools');
  const described = new Set(tools.map((t) => t.name));
  for (const name of Object.keys(handlers)) {
    if (!described.has(name)) {
      throw new Error(`handler "${name}" has no tool declared with that name in the tools file`);
    }
  }
  for (const tool of tools) {
    const handler = handlers[tool.name];
    if (typeof handler !== 'function') {
      throw new Error(`tool "${tool.name}" is declared but has no handler`);
    }
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args, extra) => {
        const start = process.hrtime.bigint();
        const took = () => `${Math.round(Number(process.hrtime.bigint() - start) / 1e6)} ms`;
        log.info(`tool ${tool.name} start`);
        try {
          const result = normalize(await handler(args, extra));
          log.info(`tool ${tool.name} end ${result.isError ? 'error' : 'ok'} in ${took()}`);
          return result;
        } catch (err) {
          log.error(`tool ${tool.name} threw: ${err && err.stack ? err.stack : err}`);
          log.info(`tool ${tool.name} end error in ${took()}`);
          return errorResult(`${tool.name} failed: ${err && err.message ? err.message : err}`);
        }
      }
    );
  }
}

module.exports = { defineTools, toJsonSchema, register, textResult, jsonResult, errorResult };
