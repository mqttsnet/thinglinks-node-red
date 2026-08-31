'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('a package declaring common cannot pass until a satisfying public version exists', async () => {
  const { checkPublishedCommon } = await import('../scripts/check-published-common.mjs');
  const lookups = [];
  const result = await checkPublishedCommon('packages/edge-nodes', {
    rootDirectory: root,
    expectedIntegrity: 'sha512-common',
    lookup: async (specification) => {
      lookups.push(specification);
      return { integrity: 'sha512-common', version: '0.1.0' };
    },
  });

  assert.deepEqual(lookups, ['@thinglinks/node-red-common@0.1.0']);
  assert.deepEqual(result, {
    dependency: '@thinglinks/node-red-common@0.1.0',
    publishedIntegrity: 'sha512-common',
    publishedVersion: '0.1.0',
    required: true,
  });
});

test('published common integrity must match the tarball used by the consumer matrix', async () => {
  const { checkPublishedCommon } = await import('../scripts/check-published-common.mjs');

  await assert.rejects(
    checkPublishedCommon('packages/edge-nodes', {
      rootDirectory: root,
      expectedIntegrity: 'sha512-local',
      lookup: async () => ({ integrity: 'sha512-registry', version: '0.1.0' }),
    }),
    /registry integrity does not match the verified tarball/,
  );
});

test('missing published common fails the dependent package release gate', async () => {
  const { checkPublishedCommon } = await import('../scripts/check-published-common.mjs');

  await assert.rejects(
    checkPublishedCommon('packages/edge-nodes', {
      rootDirectory: root,
      lookup: async () => {
        throw new Error('E404');
      },
    }),
    /Publish @thinglinks\/node-red-common@0\.1\.0 before the dependent package/,
  );
});

test('packages without a common dependency do not perform a registry lookup', async () => {
  const { checkPublishedCommon } = await import('../scripts/check-published-common.mjs');
  for (const directory of ['packages/common', 'packages/cloud-nodes']) {
    const result = await checkPublishedCommon(directory, {
      rootDirectory: root,
      lookup: async () => {
        throw new Error('lookup must not run');
      },
    });
    assert.deepEqual(result, { required: false });
  }
});
