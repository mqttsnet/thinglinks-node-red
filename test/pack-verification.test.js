'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { mkdtempSync, readFileSync, realpathSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts/verify-packs.mjs');

test('real pnpm tarballs contain only the intended package boundaries', () => {
  const outputDirectory = realpathSync(mkdtempSync(path.join(tmpdir(), 'thinglinks-pack-test-')));
  let result;
  try {
    const output = execFileSync(process.execPath, [
      script,
      '--json',
      '--output', outputDirectory,
    ], {
      cwd: root,
      encoding: 'utf8',
    });
    result = JSON.parse(output);

    for (const pkg of result.packages) {
      assert.equal(path.dirname(pkg.tarball), outputDirectory);
      const archive = readFileSync(pkg.tarball);
      assert.equal(pkg.sha512, createHash('sha512').update(archive).digest('hex'));
      assert.equal(pkg.integrity, `sha512-${createHash('sha512').update(archive).digest('base64')}`);
    }
  } finally {
    rmSync(outputDirectory, { force: true, recursive: true });
  }

  assert.equal(result.packageManager, 'pnpm@10.32.1');
  assert.deepEqual(result.packages.map(({ name, version }) => [name, version]), [
    ['@mqttsnet/thinglinks-node-red-common', '0.0.1'],
    ['@mqttsnet/thinglinks-edge-nodes', '0.0.1'],
    ['@mqttsnet/thinglinks-cloud-nodes', '0.0.1'],
  ]);

  const common = result.packages[0];
  assert.equal(common.hasNodeRedMetadata, false);
  assert.deepEqual(common.files, [
    'package/LICENSE',
    'package/README.md',
    'package/package.json',
    'package/tl-common.js',
  ]);

  const edge = result.packages[1];
  assert.equal(edge.commonDependency, '0.0.1');
  assert.deepEqual(edge.nodeTypes, ['tl-device', 'tl-tag', 'tl-uplink']);
  assert.deepEqual(edge.files, [
    'package/LICENSE',
    'package/README.md',
    'package/package.json',
    'package/tl-device.html',
    'package/tl-device.js',
    'package/tl-tag.html',
    'package/tl-tag.js',
    'package/tl-uplink.html',
    'package/tl-uplink.js',
  ]);

  const cloud = result.packages[2];
  assert.equal(cloud.private, true);
  assert.equal(cloud.hasNodeRedMetadata, false);
  assert.deepEqual(cloud.files, [
    'package/LICENSE',
    'package/README.md',
    'package/package.json',
  ]);
});
