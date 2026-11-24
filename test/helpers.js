'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Point HOME and USERPROFILE at a fresh temporary folder for the calling test.
 * @returns {{home: string, restore: () => void}}
 */
function tempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpfw-'));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return {
    home,
    restore() {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

module.exports = { tempHome };
