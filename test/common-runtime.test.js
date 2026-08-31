'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const modulePath = path.resolve(__dirname, '../packages/common/tl-common.js');
const originalFetch = global.fetch;
const originalEnvironment = {
  TLE_MANAGER_URL: process.env.TLE_MANAGER_URL,
  TLE_INGEST_TOKEN: process.env.TLE_INGEST_TOKEN,
  TLE_INSTANCE_ID: process.env.TLE_INSTANCE_ID,
};

function setEnvironment(values) {
  for (const name of Object.keys(originalEnvironment)) {
    if (values[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = values[name];
    }
  }
}

function loadCommon(values) {
  setEnvironment(values);
  delete require.cache[modulePath];
  return require(modulePath);
}

function fakeNode() {
  return {
    statuses: [],
    warnings: [],
    status(value) {
      this.statuses.push(value);
    },
    warn(value) {
      this.warnings.push(value);
    },
  };
}

test.afterEach(() => {
  global.fetch = originalFetch;
  setEnvironment(originalEnvironment);
  delete require.cache[modulePath];
});

test('missing Manager configuration warns and resolves false without calling fetch', async () => {
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    return { ok: true, status: 204 };
  };
  const common = loadCommon({});
  const node = fakeNode();

  assert.equal(common.enabled(), false);
  assert.equal(await common.report(node, 'uplink', { data: 1 }), false);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(node.warnings, [
    '未注入 TLE_MANAGER_URL / TLE_INGEST_TOKEN，本节点只透传不回报',
  ]);
});

test('successful report posts JSON with bearer token and never sends instanceId in the body', async () => {
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 204 };
  };
  const common = loadCommon({
    TLE_MANAGER_URL: 'http://manager.internal:3000',
    TLE_INGEST_TOKEN: 'test-token',
    TLE_INSTANCE_ID: 'edge-01',
  });
  const node = fakeNode();

  assert.equal(await common.report(node, 'values', { values: [{ value: 7 }] }), true);
  assert.equal(request.url, 'http://manager.internal:3000/api/edge/values');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(request.options.headers, {
    'content-type': 'application/json',
    authorization: 'Bearer test-token',
  });
  assert.deepEqual(JSON.parse(request.options.body), { values: [{ value: 7 }] });
  assert.equal(JSON.parse(request.options.body).instanceId, undefined);
  assert.equal(request.options.signal instanceof AbortSignal, true);
  assert.equal(common.INSTANCE_ID, 'edge-01');
});

test('non-2xx Manager response becomes a warning and false status, not a thrown flow error', async () => {
  global.fetch = async () => ({ ok: false, status: 503 });
  const common = loadCommon({
    TLE_MANAGER_URL: 'http://manager.internal:3000',
    TLE_INGEST_TOKEN: 'test-token',
  });
  const node = fakeNode();

  assert.equal(await common.report(node, 'devices', {}), false);
  assert.deepEqual(node.warnings, ['回报失败 devices：HTTP 503']);
  assert.deepEqual(node.statuses, [{ fill: 'red', shape: 'ring', text: 'HTTP 503' }]);
});

test('network failure becomes a warning and false status, not a thrown flow error', async () => {
  global.fetch = async () => {
    throw new Error('connection refused');
  };
  const common = loadCommon({
    TLE_MANAGER_URL: 'http://manager.internal:3000',
    TLE_INGEST_TOKEN: 'test-token',
  });
  const node = fakeNode();

  assert.equal(await common.report(node, 'tags', {}), false);
  assert.deepEqual(node.warnings, ['回报失败 tags：connection refused']);
  assert.deepEqual(node.statuses, [{ fill: 'red', shape: 'ring', text: '管理台不可达' }]);
});
