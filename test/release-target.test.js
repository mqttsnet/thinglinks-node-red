'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts/release-target.mjs');

test('supported tags select one exact package and expose workflow outputs', () => {
  const cases = [
    ['edge-nodes@0.0.1', '@mqttsnet/thinglinks-edge-nodes', 'packages/edge-nodes', '0.0.1'],
    ['cloud-nodes@0.0.1', '@mqttsnet/thinglinks-cloud-nodes', 'packages/cloud-nodes', '0.0.1'],
    ['common@0.0.1', '@mqttsnet/thinglinks-node-red-common', 'packages/common', '0.0.1'],
  ];

  for (const [tag, packageName, directory, version] of cases) {
    const output = execFileSync(process.execPath, [script, tag], { cwd: root, encoding: 'utf8' });
    assert.equal(output, `package=${packageName}\ndirectory=${directory}\nversion=${version}\ndist-tag=latest\n`);
  }
});

test('tag version mismatch fails instead of packing a different version', () => {
  const result = spawnSync(process.execPath, [script, 'edge-nodes@0.0.2'], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match package version 0\.0\.1/);
});

test('unknown prefixes and non-semver versions fail closed', () => {
  for (const tag of ['edge@1.0.1', 'edge-nodes@latest', 'common@1.0', 'common@1.0.0-01']) {
    const result = spawnSync(process.execPath, [script, tag], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0, tag);
    assert.match(result.stderr, /Unsupported release tag/, tag);
  }
});

test('a matching semver prerelease selects the next dist-tag', async () => {
  const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'thinglinks-release-target-'));
  try {
    const directory = path.join(temporaryRoot, 'packages/edge-nodes');
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
      name: '@mqttsnet/thinglinks-edge-nodes',
      version: '1.1.0-rc.1+build.5',
    }));
    const { resolveReleaseTarget } = await import('../scripts/release-target.mjs');

    assert.deepEqual(resolveReleaseTarget('edge-nodes@1.1.0-rc.1+build.5', temporaryRoot), {
      directory: 'packages/edge-nodes',
      distTag: 'next',
      packageName: '@mqttsnet/thinglinks-edge-nodes',
      version: '1.1.0-rc.1+build.5',
    });
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
