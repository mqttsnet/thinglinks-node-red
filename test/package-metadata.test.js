'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function manifest(relativeDirectory = '.') {
  return JSON.parse(readFileSync(path.join(root, relativeDirectory, 'package.json'), 'utf8'));
}

test('root pins the approved Node.js and pnpm workspace contract', () => {
  const pkg = manifest();

  assert.equal(pkg.name, 'thinglinks-node-red');
  assert.equal(pkg.private, true);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.packageManager, 'pnpm@10.32.1');
  assert.equal(pkg.engines.node, '^22.18.0 || ^24.12.0');
  assert.equal(pkg.engines.pnpm, '10.32.1');
});

test('common is a public plain runtime package, never a Node-RED node package', () => {
  const pkg = manifest('packages/common');

  assert.equal(pkg.name, '@thinglinks/node-red-common');
  assert.equal(pkg.version, '0.1.0');
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.type, 'commonjs');
  assert.equal(pkg.main, 'tl-common.js');
  assert.equal(pkg.publishConfig.access, 'public');
  assert.equal(Object.hasOwn(pkg, 'node-red'), false);
  assert.deepEqual(pkg.files, ['tl-common.js', 'README.md', 'LICENSE']);
});

test('edge package exposes exactly the three migrated nodes and a normal common dependency', () => {
  const pkg = manifest('packages/edge-nodes');

  assert.equal(pkg.name, '@thinglinks/edge-nodes');
  assert.equal(pkg.version, '1.0.1');
  assert.equal(pkg.publishConfig.access, 'public');
  assert.equal(pkg.keywords.includes('node-red'), true);
  assert.equal(pkg.dependencies['@thinglinks/node-red-common'], 'workspace:0.1.0');
  assert.equal(pkg['node-red'].version, '>=5.0.4 <6');
  assert.deepEqual(pkg['node-red'].nodes, {
    'tl-device': 'tl-device.js',
    'tl-tag': 'tl-tag.js',
    'tl-uplink': 'tl-uplink.js',
  });
  assert.deepEqual(pkg.files, ['*.js', '*.html', 'README.md', 'LICENSE']);
});

test('cloud package is a private skeleton without fabricated Node-RED entries', () => {
  const pkg = manifest('packages/cloud-nodes');

  assert.equal(pkg.name, '@thinglinks/cloud-nodes');
  assert.equal(pkg.version, '0.1.0');
  assert.equal(pkg.private, true);
  assert.equal(Object.hasOwn(pkg, 'node-red'), false);
  assert.equal(Object.hasOwn(pkg, 'publishConfig'), false);
});

test('all package names use one scope', () => {
  const names = [
    manifest('packages/common').name,
    manifest('packages/edge-nodes').name,
    manifest('packages/cloud-nodes').name,
  ];

  assert.deepEqual(new Set(names.map((name) => name.split('/')[0])), new Set(['@thinglinks']));
});
