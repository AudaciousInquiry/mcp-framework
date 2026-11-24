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
    name: 'boom',
    description: 'Throw an exception.',
    inputSchema: z.object({}),
  },
]);
