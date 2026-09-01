#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const commonPackage = '@mqttsnet/thinglinks-node-red-common';
const publicRegistry = 'https://registry.npmjs.org';

async function npmLookup(specification) {
  const cacheDirectory = mkdtempSync(path.join(tmpdir(), 'thinglinks-npm-cache-'));
  try {
    const output = execFileSync('npm', [
      'view',
      specification,
      'version',
      'dist.integrity',
      '--json',
      `--registry=${publicRegistry}`,
    ], {
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: cacheDirectory },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(output);
    return {
      integrity: parsed['dist.integrity'],
      version: parsed.version,
    };
  } finally {
    rmSync(cacheDirectory, { force: true, recursive: true });
  }
}

export async function checkPublishedCommon(packageDirectory, options = {}) {
  const rootDirectory = options.rootDirectory ?? process.cwd();
  const lookup = options.lookup ?? npmLookup;
  const expectedIntegrity = options.expectedIntegrity;
  const manifestPath = path.join(rootDirectory, packageDirectory, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const range = manifest.dependencies?.[commonPackage];

  if (!range) {
    return { required: false };
  }

  const registryRange = range.startsWith('workspace:') ? range.slice('workspace:'.length) : range;
  const dependency = `${commonPackage}@${registryRange}`;
  let published;
  try {
    published = await lookup(dependency);
  } catch (error) {
    throw new Error(`Publish ${dependency} before the dependent package`, { cause: error });
  }
  if (!published?.version) throw new Error(`Registry returned no version for ${dependency}`);
  if (expectedIntegrity && published.integrity !== expectedIntegrity) {
    throw new Error(`${dependency} registry integrity does not match the verified tarball`);
  }
  return {
    dependency,
    publishedIntegrity: published.integrity,
    publishedVersion: published.version,
    required: true,
  };
}

async function main() {
  const packageDirectory = process.argv[2];
  if (!packageDirectory) throw new Error('Usage: check-published-common.mjs <package-directory>');
  const integrityIndex = process.argv.indexOf('--expected-integrity');
  const result = await checkPublishedCommon(packageDirectory, {
    expectedIntegrity: integrityIndex === -1 ? undefined : process.argv[integrityIndex + 1],
  });
  if (result.required) {
    process.stdout.write(`common-prerequisite=${result.dependency}\n`);
    process.stdout.write(`published-version=${result.publishedVersion}\n`);
    process.stdout.write(`published-integrity=${result.publishedIntegrity}\n`);
  } else {
    process.stdout.write('common-prerequisite=not-required\n');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
