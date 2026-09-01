'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('release artifact selector binds target and consumer-matrix tarballs by package name', async () => {
  const { selectArtifactOutputs } = await import('../scripts/artifact-outputs.mjs');
  const metadata = {
    packages: [
      { name: '@mqttsnet/thinglinks-node-red-common', integrity: 'sha512-common', tarball: '/out/common.tgz' },
      { name: '@mqttsnet/thinglinks-edge-nodes', integrity: 'sha512-edge', tarball: '/out/edge.tgz' },
    ],
  };

  assert.deepEqual(selectArtifactOutputs(metadata, '@mqttsnet/thinglinks-edge-nodes'), {
    commonIntegrity: 'sha512-common',
    commonTarball: '/out/common.tgz',
    edgeTarball: '/out/edge.tgz',
    targetIntegrity: 'sha512-edge',
    targetTarball: '/out/edge.tgz',
  });
});

test('release artifact selector fails when the exact tagged package was not packed', async () => {
  const { selectArtifactOutputs } = await import('../scripts/artifact-outputs.mjs');

  assert.throws(
    () => selectArtifactOutputs({ packages: [] }, '@mqttsnet/thinglinks-cloud-nodes'),
    /Packed metadata does not contain @mqttsnet\/thinglinks-cloud-nodes/,
  );
});
