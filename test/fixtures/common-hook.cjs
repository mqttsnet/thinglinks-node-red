'use strict';

const { appendFileSync, readFileSync } = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const originalLoad = Module._load;
const wrapped = Symbol.for('thinglinks.node-red-common.acceptance-wrapped');

Module._load = function load(request, parent, isMain) {
  const runtime = originalLoad.call(this, request, parent, isMain);
  if (request !== '@thinglinks/node-red-common' || runtime[wrapped]) return runtime;

  const originalReport = runtime.report;
  runtime.report = async function report(node, reportPath, body) {
    const resultsDirectory = process.env.TLE_ACCEPTANCE_RESULTS;
    let phase = 'unknown';
    try {
      phase = readFileSync(path.join(resultsDirectory, 'phase'), 'utf8').trim() || phase;
    } catch {
      // The acceptance runner creates phase before Node-RED starts.
    }
    appendFileSync(
      path.join(resultsDirectory, 'common-calls.ndjson'),
      `${JSON.stringify({ body, path: reportPath, phase })}\n`,
    );
    return originalReport(node, reportPath, body);
  };
  Object.defineProperty(runtime, wrapped, { value: true });
  return runtime;
};
