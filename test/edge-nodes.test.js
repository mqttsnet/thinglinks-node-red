'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { flush, input, loadNode } = require('./helpers/node-red.js');

const edgeDirectory = path.resolve(__dirname, '../packages/edge-nodes');
const originalFetch = global.fetch;
const originalEnvironment = {
  TLE_MANAGER_URL: process.env.TLE_MANAGER_URL,
  TLE_INGEST_TOKEN: process.env.TLE_INGEST_TOKEN,
  TLE_INSTANCE_ID: process.env.TLE_INSTANCE_ID,
};

function configureManager() {
  process.env.TLE_MANAGER_URL = 'http://manager.internal:3000';
  process.env.TLE_INGEST_TOKEN = 'test-token';
  process.env.TLE_INSTANCE_ID = 'edge-01';
}

function captureRequests(response = { ok: true, status: 204 }) {
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    return response;
  };
  return requests;
}

test.beforeEach(configureManager);

test.afterEach(() => {
  global.fetch = originalFetch;
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test('runtime package registers exactly tl-device, tl-tag, and tl-uplink', () => {
  const registrations = ['tl-device.js', 'tl-tag.js', 'tl-uplink.js']
    .map((file) => loadNode(path.join(edgeDirectory, file)).type);

  assert.deepEqual(registrations, ['tl-device', 'tl-tag', 'tl-uplink']);
});

test('tl-device reports device and status endpoints while passing the original message object', async () => {
  const requests = captureRequests();
  const runtime = loadNode(path.join(edgeDirectory, 'tl-device.js'));
  const node = runtime.create({
    deviceId: ' plc/1 ',
    name: 'PLC 1',
    protocol: 'modbus-tcp',
    address: '192.0.2.10:502',
    model: 'M1',
    manufacturer: 'ThingLinks',
  });
  await flush();

  const message = { payload: { temperature: 23 } };
  const sent = await input(node, message);
  await flush();

  assert.strictEqual(sent[0], message);
  assert.equal(requests[0].url, 'http://manager.internal:3000/api/edge/devices');
  assert.deepEqual(requests[0].body, {
    nodeId: 'plc/1',
    name: 'PLC 1',
    protocol: 'modbus-tcp',
    address: '192.0.2.10:502',
    model: 'M1',
    manufacturer: 'ThingLinks',
  });
  assert.equal(requests[1].url, 'http://manager.internal:3000/api/edge/devices/plc%2F1/status');
  assert.deepEqual(requests[1].body, { online: true });
});

test('tl-tag reports tag and value endpoints while passing the original message object', async () => {
  const requests = captureRequests();
  const runtime = loadNode(path.join(edgeDirectory, 'tl-tag.js'));
  const node = runtime.create({
    deviceId: 'plc-1',
    tagId: 'temperature',
    name: 'Temperature',
    unit: '°C',
    dataType: 'float',
  });
  await flush();

  const message = { payload: { temperature: 23, humidity: 60 }, quality: 'uncertain' };
  const sent = await input(node, message);
  await flush();

  assert.strictEqual(sent[0], message);
  assert.equal(requests[0].url, 'http://manager.internal:3000/api/edge/tags');
  assert.deepEqual(requests[0].body, {
    nodeId: 'plc-1',
    tagId: 'temperature',
    name: 'Temperature',
    unit: '°C',
    dataType: 'float',
  });
  assert.equal(requests[1].url, 'http://manager.internal:3000/api/edge/values');
  assert.deepEqual(requests[1].body, {
    values: [{ nodeId: 'plc-1', tagId: 'temperature', value: 23, quality: 'uncertain' }],
  });
});

test('tl-uplink reports the uplink endpoint and passes the original message object', async () => {
  const requests = captureRequests();
  const runtime = loadNode(path.join(edgeDirectory, 'tl-uplink.js'));
  const node = runtime.create({ serviceId: 'configured', deviceId: 'configured-device' });
  const message = {
    payload: { temperature: 23 },
    serviceId: 'message-service',
    nodeId: 'message-device',
  };

  const sent = await input(node, message);

  assert.strictEqual(sent[0], message);
  assert.equal(requests[0].url, 'http://manager.internal:3000/api/edge/uplink');
  assert.deepEqual(requests[0].body, {
    serviceId: 'configured',
    nodeId: 'message-device',
    data: { temperature: 23 },
  });
});

test('empty uplink payload is skipped without calling Manager and still passes the message', async () => {
  const requests = captureRequests();
  const runtime = loadNode(path.join(edgeDirectory, 'tl-uplink.js'));
  const node = runtime.create({});
  const message = { payload: null };

  const sent = await input(node, message);

  assert.strictEqual(sent[0], message);
  assert.equal(requests.length, 0);
  assert.deepEqual(node.statuses, [{ fill: 'yellow', shape: 'ring', text: 'payload 为空，已跳过' }]);
});

test('invalid node configuration is a node error and does not become a Manager report failure', () => {
  const requests = captureRequests();
  const device = loadNode(path.join(edgeDirectory, 'tl-device.js')).create({ deviceId: '  ' });
  const tag = loadNode(path.join(edgeDirectory, 'tl-tag.js')).create({ deviceId: 'plc-1', tagId: '' });

  assert.deepEqual(device.errors, ['tl-device：设备标识不能为空']);
  assert.deepEqual(tag.errors, ['tl-tag：设备标识与点位标识都不能为空']);
  assert.equal(device.handlers.has('input'), false);
  assert.equal(tag.handlers.has('input'), false);
  assert.equal(requests.length, 0);
});

test('Manager failure remains a warning/failure status and never blocks the flow message', async () => {
  captureRequests({ ok: false, status: 503 });
  const runtime = loadNode(path.join(edgeDirectory, 'tl-uplink.js'));
  const node = runtime.create({ serviceId: 'env' });
  const message = { payload: 7 };

  const sent = await input(node, message);

  assert.strictEqual(sent[0], message);
  assert.deepEqual(node.warnings, ['回报失败 uplink：HTTP 503']);
  assert.equal(node.statuses.at(-1).text, '提交失败');
});
