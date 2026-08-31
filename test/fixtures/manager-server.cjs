'use strict';

const { appendFileSync, readFileSync } = require('node:fs');
const { createServer } = require('node:http');
const path = require('node:path');

const resultsDirectory = process.env.TLE_ACCEPTANCE_RESULTS;
const requestsFile = path.join(resultsDirectory, 'manager-requests.ndjson');
const allowedPaths = [
  /^\/api\/edge\/devices$/,
  /^\/api\/edge\/devices\/[^/]+\/status$/,
  /^\/api\/edge\/tags$/,
  /^\/api\/edge\/values$/,
  /^\/api\/edge\/uplink$/,
];

function current(name, fallback) {
  try {
    return readFileSync(path.join(resultsDirectory, name), 'utf8').trim() || fallback;
  } catch {
    return fallback;
  }
}

createServer((request, response) => {
  if (request.method !== 'POST' || !allowedPaths.some((pattern) => pattern.test(request.url))) {
    response.writeHead(404).end();
    return;
  }
  if (request.headers.authorization !== 'Bearer container-test-token') {
    response.writeHead(401).end();
    return;
  }

  const chunks = [];
  let size = 0;
  let rejected = false;
  request.on('data', (chunk) => {
    if (rejected) return;
    size += chunk.length;
    if (size > 1024 * 1024) {
      rejected = true;
      response.writeHead(413).end();
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on('end', () => {
    if (rejected) return;
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      response.writeHead(400).end();
      return;
    }
    appendFileSync(requestsFile, `${JSON.stringify({
      body,
      method: request.method,
      phase: current('phase', 'unknown'),
      url: request.url,
    })}\n`);
    response.writeHead(current('mode', 'success') === 'failure' ? 503 : 204).end();
  });
}).listen(3000, '0.0.0.0');
