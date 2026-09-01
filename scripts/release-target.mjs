#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const targets = {
  'edge-nodes': {
    directory: 'packages/edge-nodes',
    packageName: '@mqttsnet/thinglinks-edge-nodes',
  },
  'cloud-nodes': {
    directory: 'packages/cloud-nodes',
    packageName: '@mqttsnet/thinglinks-cloud-nodes',
  },
  common: {
    directory: 'packages/common',
    packageName: '@mqttsnet/thinglinks-node-red-common',
  },
};

const numericIdentifier = '(?:0|[1-9]\\d*)';
const prereleaseIdentifier = `(?:${numericIdentifier}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;
const semverPattern = new RegExp(
  `^${numericIdentifier}\\.${numericIdentifier}\\.${numericIdentifier}`
  + `(?:-(${prereleaseIdentifier}(?:\\.${prereleaseIdentifier})*))?`
  + '(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$',
);

export function resolveReleaseTarget(tag, rootDirectory = process.cwd()) {
  const match = /^(edge-nodes|cloud-nodes|common)@(.+)$/.exec(tag ?? '');
  if (!match) {
    throw new Error(`Unsupported release tag: ${tag ?? ''}`);
  }

  const [, prefix, version] = match;
  const semver = semverPattern.exec(version);
  if (!semver) throw new Error(`Unsupported release tag: ${tag}`);
  const target = targets[prefix];
  const packagePath = path.join(rootDirectory, target.directory, 'package.json');
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));

  if (manifest.name !== target.packageName) {
    throw new Error(`Tag ${tag} selects ${target.packageName}, but ${packagePath} declares ${manifest.name}`);
  }
  if (manifest.version !== version) {
    throw new Error(`Tag version ${version} does not match package version ${manifest.version}`);
  }

  return { ...target, distTag: semver[1] ? 'next' : 'latest', version };
}

function main() {
  const result = resolveReleaseTarget(process.argv[2]);
  process.stdout.write(`package=${result.packageName}\n`);
  process.stdout.write(`directory=${result.directory}\n`);
  process.stdout.write(`version=${result.version}\n`);
  process.stdout.write(`dist-tag=${result.distTag}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
