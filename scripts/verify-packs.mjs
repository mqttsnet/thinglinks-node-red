#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const supportedPackages = [
  '@mqttsnet/thinglinks-node-red-common',
  '@mqttsnet/thinglinks-edge-nodes',
  '@mqttsnet/thinglinks-cloud-nodes',
];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    ...options,
  });
}

function valuesFor(flag, args) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) values.push(args[index + 1]);
  }
  return values.filter(Boolean);
}

function valueFor(flag, args) {
  return valuesFor(flag, args).at(-1);
}

export function inspectArchive(archivePath, packResult) {
  archivePath = realpathSync(archivePath);
  const archive = readFileSync(archivePath);
  const files = run('tar', ['-tzf', archivePath])
    .trim()
    .split('\n')
    .filter(Boolean)
    .sort();
  if (packResult) {
    const packedFiles = packResult.files.map(({ path: filePath }) => `package/${filePath}`).sort();
    if (JSON.stringify(files) !== JSON.stringify(packedFiles)) {
      throw new Error(`pnpm pack JSON does not match tar contents for ${packResult.name}`);
    }
  }
  const manifest = JSON.parse(run('tar', ['-xOzf', archivePath, 'package/package.json']));

  return {
    commonDependency: manifest.dependencies?.['@mqttsnet/thinglinks-node-red-common'],
    files,
    hasNodeRedMetadata: Object.hasOwn(manifest, 'node-red'),
    integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
    manifest,
    name: manifest.name,
    nodeTypes: Object.keys(manifest['node-red']?.nodes ?? {}).sort(),
    private: manifest.private === true,
    sha512: createHash('sha512').update(archive).digest('hex'),
    shasum: createHash('sha1').update(archive).digest('hex'),
    tarball: archivePath,
    version: manifest.version,
  };
}

function packOne(packageName, destination) {
  const before = new Set(readdirSync(destination));
  const packResult = JSON.parse(run('pnpm', [
    '--filter', packageName,
    '--fail-if-no-match',
    'pack',
    '--json',
    '--pack-destination', destination,
  ]));
  if (packResult.name !== packageName) {
    throw new Error(`Filter ${packageName} packed ${packResult.name ?? 'an unknown package'}`);
  }

  const archivePath = realpathSync(packResult.filename);
  if (path.dirname(archivePath) !== destination) {
    throw new Error(`pnpm pack wrote outside the requested directory: ${archivePath}`);
  }
  const createdFiles = readdirSync(destination).filter((name) => !before.has(name));
  if (createdFiles.length !== 1 || createdFiles[0] !== path.basename(archivePath)) {
    throw new Error(`Expected one new tarball for ${packageName}, created ${createdFiles.join(', ')}`);
  }
  return inspectArchive(archivePath, packResult);
}

export function packPackages(options = {}) {
  const packageNames = options.packageNames?.length ? options.packageNames : supportedPackages;
  for (const packageName of packageNames) {
    if (!supportedPackages.includes(packageName)) {
      throw new Error(`Unsupported package: ${packageName}`);
    }
  }

  let temporary = false;
  let destination;
  if (options.outputDirectory) {
    mkdirSync(options.outputDirectory, { recursive: true });
    destination = realpathSync(options.outputDirectory);
  } else {
    temporary = true;
    destination = realpathSync(mkdtempSync(path.join(tmpdir(), 'thinglinks-node-red-pack-')));
  }

  try {
    return {
      outputDirectory: destination,
      packageManager: `pnpm@${run('pnpm', ['--version']).trim()}`,
      packages: packageNames.map((packageName) => packOne(packageName, destination)),
    };
  } finally {
    if (temporary) rmSync(destination, { force: true, recursive: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  const result = packPackages({
    outputDirectory: valueFor('--output', args),
    packageNames: valuesFor('--package', args),
  });
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  for (const pkg of result.packages) {
    process.stdout.write(`✓ ${pkg.name}@${pkg.version}: ${pkg.files.length} files; ${pkg.integrity}\n`);
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
