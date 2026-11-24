'use strict';

// Helper process for the logging tests. Usage: node log-child.js '<json options>'
const { Worker, isMainThread } = require('node:worker_threads');
const log = require('../../src/log');

if (isMainThread) {
  const o = JSON.parse(process.argv[2]);
  log.installFatalHandlers('server');
  log.configureLogging({ name: o.name, level: o.level || 'info', debug: !!o.debug, maxLogSize: o.maxLogSize });
  const logger = log.getLogger(o.category || 'child');
  if (o.mode === 'timer-throw') {
    logger.info('about to throw');
    setTimeout(() => { throw new Error('boom in timer'); }, 20);
  } else if (o.mode === 'rejection') {
    Promise.reject(new Error('boom rejected'));
  } else if (o.mode === 'worker') {
    const w = new Worker(__filename);
    w.on('exit', async () => { await log.shutdownLogging(); process.exit(0); });
  } else if (o.mode === 'many') {
    for (let i = 0; i < o.count; i++) logger.info('line ' + i + ' ' + 'x'.repeat(200));
    log.shutdownLogging().then(() => process.exit(0));
  } else if (o.mode === 'steady') {
    // Log for a while so a test can close standard error part way through.
    let n = 0;
    logger.info('first');
    const timer = setInterval(async () => {
      logger.info('tick ' + (++n));
      if (n >= 10) {
        clearInterval(timer);
        logger.info('finished');
        await log.shutdownLogging();
        process.exit(0);
      }
    }, 50);
  } else {
    logger.info('hello');
    logger.debug('a debug line');
    log.shutdownLogging().then(() => process.exit(0));
  }
} else {
  const logger = log.getLogger('worker');
  logger.debug('hello from the worker');
  log.shutdownLogging().then(() => process.exit(0));
}
