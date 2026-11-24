#!/usr/bin/env node
'use strict';

const { runLauncher } = require('../../../src/launcher');

runLauncher({ defaultPort: 7561, tools: require('./tools') });
