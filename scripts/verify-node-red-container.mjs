#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { inspectArchive, packPackages } from './verify-packs.mjs';

const image = 'nodered/node-red:5.0.4-24-minimal';
const edgePackage = '@thinglinks/edge-nodes';
const commonPackage = '@thinglinks/node-red-common';
const expectedEdgeTypes = ['tl-device', 'tl-tag', 'tl-uplink'];
const expectedManagerKinds = ['device-status', 'devices', 'tags', 'uplink', 'values'];
const expectedCommonPaths = ['devices', 'devices/device-01/status', 'tags', 'uplink', 'values'];

function typeFromNode(node, fallback) {
  if (typeof node === 'string') return node;
  return node?.type ?? node?.id ?? node?.name ?? fallback;
}

function typesFromEntry(entry) {
  if (Array.isArray(entry?.types)) return entry.types;
  if (Array.isArray(entry?.nodes)) return entry.nodes.map((node) => typeFromNode(node));
  if (entry?.nodes && typeof entry.nodes === 'object') {
    return Object.entries(entry.nodes).flatMap(([key, node]) => (
      Array.isArray(node?.types) ? node.types : [typeFromNode(node, key)]
    ));
  }
  return [];
}

export function nodeTypesForModule(inventory, moduleName) {
  const types = inventory
    .filter((entry) => (
      entry?.name === moduleName
      || entry?.id === moduleName
      || entry?.module === moduleName
    ))
    .flatMap(typesFromEntry);
  return [...new Set(types.filter(Boolean))].sort();
}

export function nodeTypesAcrossInventory(inventory) {
  return [...new Set(inventory.flatMap(typesFromEntry).filter(Boolean))].sort();
}

function managerRequestKind(url) {
  if (url === '/api/edge/devices') return 'devices';
  if (/^\/api\/edge\/devices\/[^/]+\/status$/.test(url)) return 'device-status';
  if (url === '/api/edge/tags') return 'tags';
  if (url === '/api/edge/values') return 'values';
  if (url === '/api/edge/uplink') return 'uplink';
  return undefined;
}

export function managerRequestKinds(requests, phase) {
  return [...new Set(requests
    .filter((request) => request.phase === phase)
    .map((request) => managerRequestKind(request.url))
    .filter(Boolean))]
    .sort();
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 12 * 1024 * 1024,
    ...options,
  });
}

function docker(args, options = {}) {
  return run('docker', args, options).trim();
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function valueFor(flag, args) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function readNdjson(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function waitFor(description, predicate, attempts = 80) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`);
}

function removeContainer(containerName) {
  try {
    docker(['rm', '--force', containerName], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    // A missing uniquely named acceptance container needs no cleanup.
  }
}

function removeNetwork(networkName) {
  try {
    docker(['network', 'rm', networkName], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    // A missing uniquely named acceptance network needs no cleanup.
  }
}

function dockerResourceExists(kind, name) {
  try {
    docker([kind, 'inspect', name], { stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function resolveArtifacts(packsDirectory, args) {
  const commonTarball = valueFor('--common-tarball', args);
  const edgeTarball = valueFor('--edge-tarball', args);
  if (Boolean(commonTarball) !== Boolean(edgeTarball)) {
    throw new Error('--common-tarball and --edge-tarball must be provided together');
  }

  let artifacts;
  if (commonTarball) {
    artifacts = [inspectArchive(commonTarball), inspectArchive(edgeTarball)];
  } else {
    artifacts = packPackages({
      outputDirectory: packsDirectory,
      packageNames: [commonPackage, edgePackage],
    }).packages;
  }
  const common = artifacts.find((artifact) => artifact.name === commonPackage);
  const edge = artifacts.find((artifact) => artifact.name === edgePackage);
  if (!common || !edge) throw new Error('Acceptance requires common and Edge tarballs');
  assert.equal(common.version, '0.1.0');
  assert.equal(common.hasNodeRedMetadata, false);
  assert.equal(edge.version, '1.0.1');
  assert.equal(edge.commonDependency, '0.1.0');
  assert.deepEqual(edge.nodeTypes, expectedEdgeTypes);
  return { common, edge };
}

function registryConfig(artifacts) {
  const entries = [
    [artifacts.common, 'common.tgz', '/packs/common.tgz'],
    [artifacts.edge, 'edge.tgz', '/packs/edge.tgz'],
  ];
  return {
    packages: Object.fromEntries(entries.map(([artifact, filename]) => [artifact.name, {
      filename,
      integrity: artifact.integrity,
      manifest: artifact.manifest,
      shasum: artifact.shasum,
      version: artifact.version,
    }])),
    tarballs: Object.fromEntries(entries.map(([, filename, containerPath]) => [filename, {
      path: containerPath,
    }])),
  };
}

function settingsSource(allowEdge) {
  const allowList = allowEdge ? [edgePackage] : [];
  return `'use strict';

module.exports = {
  uiPort: 1880,
  userDir: '/data',
  flowFile: 'flows.json',
  flowFilePretty: true,
  credentialSecret: false,
  functionExternalModules: false,
  logging: { console: { level: 'info', metrics: false, audit: false } },
  externalModules: {
    autoInstall: false,
    palette: {
      allowInstall: false,
      allowList: ${JSON.stringify(allowList)},
      denyList: ['*'],
      allowUpload: false,
      allowUpdate: false
    },
    modules: {
      allowInstall: false,
      allowList: [],
      denyList: ['*']
    }
  }
};
`;
}

function acceptanceFlow(phase) {
  const outputFile = '/results/flow-output.ndjson';
  const errorFile = '/results/flow-errors.ndjson';
  return [
    { id: 'acceptance-flow', type: 'tab', label: `Acceptance ${phase}`, disabled: false, info: '' },
    {
      id: 'acceptance-inject', type: 'inject', z: 'acceptance-flow', name: 'Trigger five routes',
      props: [{ p: 'payload' }, { p: 'quality', v: 'good', vt: 'str' }],
      repeat: '', crontab: '', once: true, onceDelay: 0.2, topic: '',
      payload: JSON.stringify({ phase, temperature: 23 }), payloadType: 'json',
      quality: 'good', qualityType: 'str', x: 120, y: 100, wires: [['acceptance-device']],
    },
    {
      id: 'acceptance-device', type: 'tl-device', z: 'acceptance-flow', name: 'Device 01',
      deviceId: 'device-01', protocol: 'modbus-tcp', address: '192.0.2.10:502',
      model: 'M1', manufacturer: 'ThingLinks', x: 310, y: 100, wires: [['acceptance-tag']],
    },
    {
      id: 'acceptance-tag', type: 'tl-tag', z: 'acceptance-flow', name: 'Temperature',
      deviceId: 'device-01', tagId: 'temperature', unit: '°C', dataType: 'float',
      x: 500, y: 100, wires: [['acceptance-uplink']],
    },
    {
      id: 'acceptance-uplink', type: 'tl-uplink', z: 'acceptance-flow', name: 'Uplink',
      serviceId: 'acceptance', deviceId: 'device-01', x: 680, y: 100,
      wires: [['acceptance-format']],
    },
    {
      id: 'acceptance-format', type: 'function', z: 'acceptance-flow', name: 'Record output',
      func: 'msg.payload = JSON.stringify({ phase: msg.payload.phase, temperature: msg.payload.temperature });\nreturn msg;',
      outputs: 1, timeout: 0, noerr: 0, initialize: '', finalize: '', libs: [],
      x: 870, y: 100, wires: [['acceptance-output']],
    },
    {
      id: 'acceptance-output', type: 'file', z: 'acceptance-flow', name: 'Flow output',
      filename: outputFile, filenameType: 'str', appendNewline: true, createDir: false,
      overwriteFile: 'false', encoding: 'none', x: 1060, y: 100, wires: [[]],
    },
    {
      id: 'acceptance-catch', type: 'catch', z: 'acceptance-flow', name: 'Unexpected errors',
      scope: ['acceptance-device', 'acceptance-tag', 'acceptance-uplink'], uncaught: false,
      x: 660, y: 180, wires: [['acceptance-error-format']],
    },
    {
      id: 'acceptance-error-format', type: 'function', z: 'acceptance-flow', name: 'Record error',
      func: `msg.payload = JSON.stringify({ phase: ${JSON.stringify(phase)}, error: msg.error });\nreturn msg;`,
      outputs: 1, timeout: 0, noerr: 0, initialize: '', finalize: '', libs: [],
      x: 860, y: 180, wires: [['acceptance-error-output']],
    },
    {
      id: 'acceptance-error-output', type: 'file', z: 'acceptance-flow', name: 'Flow errors',
      filename: errorFile, filenameType: 'str', appendNewline: true, createDir: false,
      overwriteFile: 'false', encoding: 'none', x: 1060, y: 180, wires: [[]],
    },
  ];
}

function invalidFlow() {
  return [
    { id: 'invalid-flow', type: 'tab', label: 'Invalid configuration', disabled: false, info: '' },
    {
      id: 'invalid-device', type: 'tl-device', z: 'invalid-flow', name: 'Invalid device',
      deviceId: '  ', protocol: '', address: '', model: '', manufacturer: '', x: 200, y: 100, wires: [[]],
    },
    {
      id: 'invalid-tag', type: 'tl-tag', z: 'invalid-flow', name: 'Invalid tag',
      deviceId: 'device-01', tagId: '', unit: '', dataType: '', x: 200, y: 160, wires: [[]],
    },
  ];
}

function writePhase(dataDirectory, resultsDirectory, phase, mode, flows, allowEdge) {
  writeFileSync(path.join(resultsDirectory, 'phase'), `${phase}\n`);
  writeFileSync(path.join(resultsDirectory, 'mode'), `${mode}\n`);
  writeFileSync(path.join(dataDirectory, 'flows.json'), `${JSON.stringify(flows, null, 2)}\n`);
  writeFileSync(path.join(dataDirectory, 'settings.js'), settingsSource(allowEdge));
}

async function waitForContainerHttp(containerName, url) {
  await waitFor(`${containerName} ${url}`, () => {
    try {
      docker(['exec', containerName, 'node', '-e', `fetch(${JSON.stringify(url)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`]);
      return true;
    } catch {
      return false;
    }
  });
}

function startRegistry(names, networkName, runtimeImage, artifacts, configPath) {
  docker([
    'run', '--detach', '--name', names.registry, '--network', networkName,
    '--network-alias', 'registry',
    '--volume', `${realpathSync(configPath)}:/acceptance/registry.json:ro`,
    '--volume', `${artifacts.common.tarball}:/packs/common.tgz:ro`,
    '--volume', `${artifacts.edge.tarball}:/packs/edge.tgz:ro`,
    '--volume', `${realpathSync('test/fixtures/registry-server.cjs')}:/acceptance/server.cjs:ro`,
    '--env', 'TLE_REGISTRY_CONFIG=/acceptance/registry.json',
    '--entrypoint', 'node', runtimeImage, '/acceptance/server.cjs',
  ]);
}

function startManager(names, networkName, runtimeImage, resultsDirectory) {
  docker([
    'run', '--detach', '--name', names.manager, '--network', networkName,
    '--network-alias', 'manager',
    '--volume', `${resultsDirectory}:/results`,
    '--volume', `${realpathSync('test/fixtures/manager-server.cjs')}:/acceptance/server.cjs:ro`,
    '--env', 'TLE_ACCEPTANCE_RESULTS=/results',
    '--entrypoint', 'node', runtimeImage, '/acceptance/server.cjs',
  ]);
}

function initializeData(dataDirectory) {
  writeFileSync(path.join(dataDirectory, 'package.json'), `${JSON.stringify({
    name: 'thinglinks-node-red-acceptance', private: true, version: '0.0.0',
  }, null, 2)}\n`);
}

function installFromRegistry(networkName, runtimeImage, dataDirectory) {
  const command = [
    'cd /data',
    '&& npm install --save-exact --ignore-scripts --omit=dev --no-audit --no-fund',
    '--registry=http://registry:4873',
    `${edgePackage}@1.0.1`,
    '&& chmod -R a+rwX /data',
  ].join(' ');
  docker([
    'run', '--rm', '--network', networkName, '--user', 'root',
    '--volume', `${dataDirectory}:/data`,
    '--env', 'NPM_CONFIG_REGISTRY=http://registry:4873',
    '--entrypoint', 'sh', runtimeImage, '-c', command,
  ]);
}

function verifyInstalledDependency(dataDirectory, artifacts) {
  const packageJson = JSON.parse(readFileSync(path.join(dataDirectory, 'package.json'), 'utf8'));
  assert.equal(packageJson.dependencies[edgePackage], '1.0.1');
  assert.equal(Object.hasOwn(packageJson.dependencies, commonPackage), false);

  const installedEdge = JSON.parse(readFileSync(
    path.join(dataDirectory, 'node_modules/@thinglinks/edge-nodes/package.json'), 'utf8',
  ));
  const installedCommon = JSON.parse(readFileSync(
    path.join(dataDirectory, 'node_modules/@thinglinks/node-red-common/package.json'), 'utf8',
  ));
  assert.equal(installedEdge.version, artifacts.edge.version);
  assert.equal(installedEdge.dependencies[commonPackage], artifacts.common.version);
  assert.equal(installedCommon.version, artifacts.common.version);

  const lockfile = JSON.parse(readFileSync(path.join(dataDirectory, 'package-lock.json'), 'utf8'));
  assert.equal(lockfile.packages['node_modules/@thinglinks/edge-nodes'].integrity, artifacts.edge.integrity);
  assert.equal(lockfile.packages['node_modules/@thinglinks/node-red-common'].integrity, artifacts.common.integrity);
}

function startNodeRed(names, networkName, runtimeImage, dataDirectory, resultsDirectory) {
  docker([
    'run', '--detach', '--name', names.nodeRed, '--network', networkName,
    '--network-alias', 'node-red',
    '--volume', `${dataDirectory}:/data`,
    '--volume', `${resultsDirectory}:/results`,
    '--volume', `${realpathSync('test/fixtures/common-hook.cjs')}:/acceptance/common-hook.cjs:ro`,
    '--env', 'TLE_MANAGER_URL=http://manager:3000',
    '--env', 'TLE_INGEST_TOKEN=container-test-token',
    '--env', 'TLE_INSTANCE_ID=container-instance',
    '--env', 'TLE_ACCEPTANCE_RESULTS=/results',
    '--env', 'NODE_OPTIONS=--require=/acceptance/common-hook.cjs',
    runtimeImage,
  ]);
}

async function waitForInventory(containerName) {
  const probe = [
    "fetch('http://127.0.0.1:1880/nodes', { headers: { accept: 'application/json' } })",
    ".then(async (response) => { if (!response.ok) process.exit(1); console.log(JSON.stringify(await response.json())); })",
    '.catch(() => process.exit(1))',
  ].join('');
  return waitFor('Node-RED Admin /nodes', async () => {
    let body;
    try {
      body = JSON.parse(docker(['exec', containerName, 'node', '-e', probe]));
    } catch {
      return undefined;
    }
    if (Array.isArray(body)) return body;
    if (Array.isArray(body.modules)) return body.modules;
    throw new Error(`Unexpected /nodes body: ${JSON.stringify(body).slice(0, 400)}`);
  }, 120);
}

function assertEdgeInventory(inventory, expectedLoaded) {
  const edgeTypes = nodeTypesForModule(inventory, edgePackage);
  const commonTypes = nodeTypesForModule(inventory, commonPackage);
  assert.deepEqual(edgeTypes, expectedLoaded ? expectedEdgeTypes : []);
  assert.deepEqual(commonTypes, []);
  if (!expectedLoaded) {
    const allTypes = nodeTypesAcrossInventory(inventory);
    for (const type of expectedEdgeTypes) assert.equal(allTypes.includes(type), false, type);
  }
  return { commonTypes, edgeTypes };
}

function phaseRecords(resultsDirectory, filename, phase) {
  return readNdjson(path.join(resultsDirectory, filename)).filter((record) => record.phase === phase);
}

async function waitForManagerPhase(resultsDirectory, phase) {
  return waitFor(`${phase} five Manager requests`, () => {
    const records = phaseRecords(resultsDirectory, 'manager-requests.ndjson', phase);
    return JSON.stringify(managerRequestKinds(records, phase)) === JSON.stringify(expectedManagerKinds)
      ? records
      : undefined;
  });
}

async function waitForCommonPhase(resultsDirectory, phase) {
  return waitFor(`${phase} five common calls`, () => {
    const records = phaseRecords(resultsDirectory, 'common-calls.ndjson', phase);
    const paths = [...new Set(records.map((record) => record.path))].sort();
    return JSON.stringify(paths) === JSON.stringify(expectedCommonPaths) ? records : undefined;
  });
}

async function waitForFlowOutput(resultsDirectory, phase) {
  return waitFor(`${phase} downstream flow output`, () => readNdjson(
    path.join(resultsDirectory, 'flow-output.ndjson'),
  ).find((record) => record.phase === phase));
}

function assertNoFlowError(resultsDirectory, phase) {
  assert.equal(readNdjson(path.join(resultsDirectory, 'flow-errors.ndjson'))
    .some((record) => record.phase === phase), false);
}

function verifyManagerBodies(records, phase) {
  for (const record of records) {
    assert.equal(Object.hasOwn(record.body, 'instanceId'), false);
  }
  const byKind = Object.fromEntries(records.map((record) => [managerRequestKind(record.url), record]));
  assert.equal(byKind.devices.body.nodeId, 'device-01');
  assert.deepEqual(byKind['device-status'].body, { online: true });
  assert.deepEqual(byKind.tags.body, {
    nodeId: 'device-01', tagId: 'temperature', name: 'Temperature', unit: '°C', dataType: 'float',
  });
  assert.deepEqual(byKind.values.body, {
    values: [{ nodeId: 'device-01', tagId: 'temperature', value: 23, quality: 'good' }],
  });
  assert.deepEqual(byKind.uplink.body, {
    serviceId: 'acceptance', nodeId: 'device-01', data: { phase, temperature: 23 },
  });
}

async function verifySuccessOrFailurePhase(context, phase, mode) {
  writePhase(
    context.dataDirectory, context.resultsDirectory, phase, mode,
    acceptanceFlow(phase), true,
  );
  startNodeRed(
    context.names, context.networkName, context.runtimeImage,
    context.dataDirectory, context.resultsDirectory,
  );
  try {
    const inventory = await waitForInventory(context.names.nodeRed);
    const state = assertEdgeInventory(inventory, true);
    const managerRecords = await waitForManagerPhase(context.resultsDirectory, phase);
    const commonRecords = await waitForCommonPhase(context.resultsDirectory, phase);
    assert.equal(managerRecords.length, 5, `${phase} Manager request count`);
    assert.equal(commonRecords.length, 5, `${phase} common call count`);
    const output = await waitForFlowOutput(context.resultsDirectory, phase);
    assert.deepEqual(output, { phase, temperature: 23 });
    assertNoFlowError(context.resultsDirectory, phase);
    verifyManagerBodies(managerRecords, phase);
    return { ...state, commonCallCount: commonRecords.length, managerKinds: expectedManagerKinds };
  } finally {
    removeContainer(context.names.nodeRed);
  }
}

async function verifyInvalidConfiguration(context) {
  const phase = 'invalid-config';
  writePhase(context.dataDirectory, context.resultsDirectory, phase, 'success', invalidFlow(), true);
  startNodeRed(
    context.names, context.networkName, context.runtimeImage,
    context.dataDirectory, context.resultsDirectory,
  );
  try {
    const inventory = await waitForInventory(context.names.nodeRed);
    assertEdgeInventory(inventory, true);
    const logs = await waitFor('invalid configuration logs', () => {
      const output = docker(['logs', context.names.nodeRed]);
      return output.includes('tl-device：设备标识不能为空')
        && output.includes('tl-tag：设备标识与点位标识都不能为空')
        ? output
        : undefined;
    });
    assert.match(logs, /tl-device：设备标识不能为空/);
    assert.equal(phaseRecords(context.resultsDirectory, 'manager-requests.ndjson', phase).length, 0);
    assert.equal(phaseRecords(context.resultsDirectory, 'common-calls.ndjson', phase).length, 0);
    return { managerRequests: 0, nodeErrorsVerified: true };
  } finally {
    removeContainer(context.names.nodeRed);
  }
}

async function verifyNegativePhase(context) {
  const phase = 'negative';
  writePhase(
    context.dataDirectory, context.resultsDirectory, phase, 'success',
    acceptanceFlow(phase), false,
  );
  startNodeRed(
    context.names, context.networkName, context.runtimeImage,
    context.dataDirectory, context.resultsDirectory,
  );
  try {
    const inventory = await waitForInventory(context.names.nodeRed);
    const state = assertEdgeInventory(inventory, false);
    await waitFor('negative missing-type startup state', () => {
      const logs = docker(['logs', context.names.nodeRed]);
      return logs.includes('Waiting for missing types to be registered') ? true : undefined;
    });
    await sleep(500);
    assert.equal(phaseRecords(context.resultsDirectory, 'manager-requests.ndjson', phase).length, 0);
    assert.equal(phaseRecords(context.resultsDirectory, 'common-calls.ndjson', phase).length, 0);
    verifyInstalledDependency(context.dataDirectory, context.artifacts);
    return { ...state, edgePackageStillInstalled: true };
  } finally {
    removeContainer(context.names.nodeRed);
  }
}

async function runAcceptance(args = []) {
  const temporaryRoot = realpathSync(mkdtempSync(
    path.join(tmpdir(), 'thinglinks-node-red-container-'),
  ));
  const packsDirectory = path.join(temporaryRoot, 'packs');
  const dataDirectory = path.join(temporaryRoot, 'data');
  const resultsDirectory = path.join(temporaryRoot, 'results');
  const registryConfigPath = path.join(temporaryRoot, 'registry.json');
  const suffix = `${process.pid}-${Date.now().toString(36)}`;
  const names = {
    manager: `tl-manager-${suffix}`,
    nodeRed: `tl-node-red-${suffix}`,
    registry: `tl-registry-${suffix}`,
  };
  const networkName = `tl-node-red-net-${suffix}`;
  let diagnosticLogs = '';
  let completed = false;

  mkdirSync(packsDirectory);
  mkdirSync(dataDirectory);
  mkdirSync(resultsDirectory);
  chmodSync(dataDirectory, 0o777);
  chmodSync(resultsDirectory, 0o777);

  try {
    docker(['version', '--format', '{{.Server.Version}}']);
    docker(['pull', image]);
    const imageId = docker(['image', 'inspect', '--format', '{{.Id}}', image]);
    const repoDigests = JSON.parse(docker(['image', 'inspect', '--format', '{{json .RepoDigests}}', image]));
    const runtimeImage = imageId;
    const artifacts = resolveArtifacts(packsDirectory, args);
    writeFileSync(registryConfigPath, `${JSON.stringify(registryConfig(artifacts), null, 2)}\n`);

    docker(['network', 'create', '--internal', networkName]);
    startRegistry(names, networkName, runtimeImage, artifacts, registryConfigPath);
    startManager(names, networkName, runtimeImage, resultsDirectory);
    await waitForContainerHttp(names.registry, 'http://127.0.0.1:4873/-/ping');

    initializeData(dataDirectory);
    installFromRegistry(networkName, runtimeImage, dataDirectory);
    verifyInstalledDependency(dataDirectory, artifacts);

    const context = {
      artifacts, dataDirectory, names, networkName, resultsDirectory, runtimeImage,
    };
    const positive = await verifySuccessOrFailurePhase(context, 'positive', 'success');
    const managerFailure = await verifySuccessOrFailurePhase(context, 'manager-503', 'failure');
    const invalidConfiguration = await verifyInvalidConfiguration(context);
    const negative = await verifyNegativePhase(context);
    const recovery = await verifySuccessOrFailurePhase(context, 'recovery', 'success');

    const result = {
      artifacts: {
        common: { integrity: artifacts.common.integrity, tarball: artifacts.common.tarball },
        edge: { integrity: artifacts.edge.integrity, tarball: artifacts.edge.tarball },
      },
      image,
      imageId,
      repoDigests,
      registryInstall: { commonVersion: '0.1.0', edgeVersion: '1.0.1', networkInternal: true },
      positive,
      managerFailure,
      invalidConfiguration,
      negative,
      recovery,
    };
    completed = true;
    return result;
  } catch (error) {
    diagnosticLogs = [names.nodeRed, names.manager, names.registry].map((name) => {
      try {
        return `${name}:\n${docker(['logs', name])}`;
      } catch {
        return '';
      }
    }).filter(Boolean).join('\n');
    throw new Error(`${error.message}${diagnosticLogs ? `\nContainer logs:\n${diagnosticLogs.slice(-12000)}` : ''}`, {
      cause: error,
    });
  } finally {
    removeContainer(names.nodeRed);
    removeContainer(names.manager);
    removeContainer(names.registry);
    removeNetwork(networkName);
    rmSync(temporaryRoot, { force: true, recursive: true });
    if (completed) {
      const residual = [names.nodeRed, names.manager, names.registry]
        .filter((name) => dockerResourceExists('container', name));
      if (dockerResourceExists('network', networkName)) residual.push(networkName);
      if (residual.length > 0) throw new Error(`Acceptance cleanup left resources: ${residual.join(', ')}`);
    }
  }
}

async function main() {
  const result = await runAcceptance(process.argv.slice(2));
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  process.stdout.write(`✓ image pulled and fixed for this run: ${result.imageId}\n`);
  process.stdout.write('✓ private registry: Edge installed by name with exact common@0.1.0 integrity\n');
  process.stdout.write(`✓ positive routes: ${result.positive.managerKinds.join(', ')}; common executed\n`);
  process.stdout.write('✓ Manager HTTP 503: five reports failed without blocking downstream flow\n');
  process.stdout.write('✓ invalid configuration: node errors remained separate from Manager failures\n');
  process.stdout.write('✓ negative: installed Edge package removed from the global loaded-type inventory\n');
  process.stdout.write(`✓ recovery: ${result.recovery.edgeTypes.join(', ')} and five routes restored\n`);
  process.stdout.write('✓ common: dependency present, absent from allowList and Node-RED node inventory\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
