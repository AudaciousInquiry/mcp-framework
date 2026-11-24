'use strict';

const { z } = require('zod');
const { defineTools } = require('../../../src');

module.exports = defineTools([
  {
    name: 'echo',
    description: 'Return the text it is given.',
    inputSchema: z.object({ text: z.string().describe('Text to echo') }),
  },
  {
    name: 'add',
    description: 'Add two whole numbers.',
    inputSchema: z.object({ a: z.number().int(), b: z.number().int() }),
  },
  {
    name: 'sleep',
    description: 'Wait for a number of milliseconds, then answer.',
    inputSchema: z.object({ ms: z.number().int().min(0) }),
  },
  {
    name: 'fail',
    description: 'Return an error result.',
    inputSchema: z.object({}),
  },
  {
    name: 'inspect',
    description: 'Return the arguments exactly as the tool received them, as JSON.',
    inputSchema: z.object({
      title: z.string().optional().describe('A string'),
      code: z.string().optional(),
      count: z.number().int().optional().describe('A whole number'),
      ratio: z.number().optional(),
      verbose: z.boolean().optional(),
      level: z.enum(['low', 'high']).optional(),
      tags: z.array(z.string()).optional().describe('A list of strings'),
      ids: z.array(z.number().int()).optional(),
      names: z.union([z.string(), z.array(z.string())]).optional(),
      since: z.iso.date().optional(),
      at: z.iso.datetime().optional(),
      path: z.string().meta({ 'x-cli': 'file' }).optional().describe('A file path'),
      content: z.string().optional(),
      provenance: z.object({
        session_id: z.string().optional(),
        agent: z.object({ name: z.string().optional() }).optional(),
      }).optional(),
    }),
  },
  {
    name: 'mixed',
    description: 'Return text, an image and more text.',
    inputSchema: z.object({}),
  },
  {
    name: 'boom',
    description: 'Throw an exception.',
    inputSchema: z.object({}),
  },
]);
