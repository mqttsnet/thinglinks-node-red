#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const commonPackage = '@thinglinks/node-red-common';
const edgePackage = '@thinglinks/edge-nodes';

export function selectArtifactOutputs(metadata, targetPackage) {
  const target = metadata.packages.find((pkg) => pkg.name === targetPackage);
  if (!target) throw new Error(`Packed metadata does not contain ${targetPackage}`);
  const common = metadata.packages.find((pkg) => pkg.name === commonPackage);
  const edge = metadata.packages.find((pkg) => pkg.name === edgePackage);

  return {
    ...(common ? { commonIntegrity: common.integrity, commonTarball: common.tarball } : {}),
    ...(edge ? { edgeTarball: edge.tarball } : {}),
    targetIntegrity: target.integrity,
    targetTarball: target.tarball,
  };
}

function main() {
  const [metadataPath, targetPackage] = process.argv.slice(2);
  if (!metadataPath || !targetPackage) {
    throw new Error('Usage: artifact-outputs.mjs <pack-metadata.json> <target-package>');
  }
  const outputs = selectArtifactOutputs(
    JSON.parse(readFileSync(metadataPath, 'utf8')),
    targetPackage,
  );
  for (const [key, value] of Object.entries(outputs)) {
    const outputName = key.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
    process.stdout.write(`${outputName}=${value}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
