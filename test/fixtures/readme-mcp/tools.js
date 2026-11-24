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
]);
