'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('inventory parser identifies loaded Edge node types without treating common as a node module', async () => {
  const { nodeTypesForModule } = await import('../scripts/verify-node-red-container.mjs');
  const inventory = [
    { name: 'node-red', nodes: [{ type: 'inject' }, { type: 'debug' }] },
    {
      name: '@thinglinks/edge-nodes',
      nodes: [{ type: 'tl-device' }, { type: 'tl-tag' }, { type: 'tl-uplink' }],
    },
  ];

  assert.deepEqual(nodeTypesForModule(inventory, '@thinglinks/edge-nodes'), [
    'tl-device',
    'tl-tag',
    'tl-uplink',
  ]);
  assert.deepEqual(nodeTypesForModule(inventory, '@thinglinks/node-red-common'), []);
});

test('inventory parser supports Node-RED maps and reports an allow-list removal as no loaded types', async () => {
  const { nodeTypesForModule } = await import('../scripts/verify-node-red-container.mjs');
  const allowed = [{
    id: '@thinglinks/edge-nodes',
    nodes: {
      'tl-uplink': { type: 'tl-uplink' },
      'tl-device': { type: 'tl-device' },
      'tl-tag': { type: 'tl-tag' },
    },
  }];

  assert.deepEqual(nodeTypesForModule(allowed, '@thinglinks/edge-nodes'), [
    'tl-device',
    'tl-tag',
    'tl-uplink',
  ]);
  assert.deepEqual(nodeTypesForModule([], '@thinglinks/edge-nodes'), []);
});

test('inventory parser aggregates every flat node-set returned for one scoped package', async () => {
  const { nodeTypesForModule } = await import('../scripts/verify-node-red-container.mjs');
  const inventory = [
    {
      id: '@thinglinks/edge-nodes/tl-device',
      module: '@thinglinks/edge-nodes',
      types: ['tl-device'],
    },
    {
      id: '@thinglinks/edge-nodes/tl-tag',
      module: '@thinglinks/edge-nodes',
      types: ['tl-tag'],
    },
    {
      id: '@thinglinks/edge-nodes/tl-uplink',
      module: '@thinglinks/edge-nodes',
      types: ['tl-uplink'],
    },
  ];

  assert.deepEqual(nodeTypesForModule(inventory, '@thinglinks/edge-nodes'), [
    'tl-device',
    'tl-tag',
    'tl-uplink',
  ]);
});

test('global inventory parser catches Edge types even if they appear under another module', async () => {
  const { nodeTypesAcrossInventory } = await import('../scripts/verify-node-red-container.mjs');
  const inventory = [
    { module: 'unexpected-module', types: ['tl-uplink', 'inject'] },
    { module: '@thinglinks/edge-nodes', types: ['tl-device', 'tl-tag'] },
  ];

  assert.deepEqual(nodeTypesAcrossInventory(inventory).filter((type) => type.startsWith('tl-')), [
    'tl-device',
    'tl-tag',
    'tl-uplink',
  ]);
});

test('Manager request classifier requires all five Edge routes per phase', async () => {
  const { managerRequestKinds } = await import('../scripts/verify-node-red-container.mjs');
  const requests = [
    { phase: 'positive', url: '/api/edge/devices' },
    { phase: 'positive', url: '/api/edge/devices/device-01/status' },
    { phase: 'positive', url: '/api/edge/tags' },
    { phase: 'positive', url: '/api/edge/values' },
    { phase: 'positive', url: '/api/edge/uplink' },
    { phase: 'other', url: '/api/edge/uplink' },
  ];

  assert.deepEqual(managerRequestKinds(requests, 'positive'), [
    'device-status',
    'devices',
    'tags',
    'uplink',
    'values',
  ]);
});
