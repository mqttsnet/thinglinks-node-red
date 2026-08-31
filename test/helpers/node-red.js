'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

function loadNode(runtimePath) {
  const commonPath = require.resolve('@thinglinks/node-red-common', {
    paths: [path.dirname(runtimePath)],
  });
  delete require.cache[commonPath];
  delete require.cache[require.resolve(runtimePath)];

  let registered;
  const RED = {
    nodes: {
      createNode(node) {
        node.handlers = new Map();
        node.errors = [];
        node.statuses = [];
        node.warnings = [];
        node.on = (event, handler) => node.handlers.set(event, handler);
        node.error = (value) => node.errors.push(value);
        node.status = (value) => node.statuses.push(value);
        node.warn = (value) => node.warnings.push(value);
      },
      registerType(type, constructor) {
        registered = { type, constructor };
      },
    },
  };

  require(runtimePath)(RED);
  assert.ok(registered, `${runtimePath} did not register a node type`);

  return {
    create(config) {
      return new registered.constructor(config);
    },
    type: registered.type,
  };
}

function input(node, message) {
  const handler = node.handlers.get('input');
  assert.ok(handler, 'node has no input handler');

  return new Promise((resolve, reject) => {
    const sent = [];
    const send = (value) => sent.push(value);
    const done = (error) => {
      if (error) reject(error);
      else resolve(sent);
    };

    Promise.resolve(handler(message, send, done)).catch(reject);
  });
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

module.exports = { flush, input, loadNode };
