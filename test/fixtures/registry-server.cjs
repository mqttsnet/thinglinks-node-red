'use strict';

const { createReadStream, readFileSync, statSync } = require('node:fs');
const { createServer } = require('node:http');

const config = JSON.parse(readFileSync(process.env.TLE_REGISTRY_CONFIG, 'utf8'));

function json(response, statusCode, body) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(statusCode, {
    'content-length': payload.length,
    'content-type': 'application/json',
  });
  response.end(payload);
}

createServer((request, response) => {
  if (request.method !== 'GET') {
    json(response, 405, { error: 'method_not_allowed' });
    return;
  }

  const rawPath = request.url.split('?')[0];
  if (rawPath === '/-/ping') {
    json(response, 200, {});
    return;
  }
  if (rawPath.startsWith('/tarballs/')) {
    const item = config.tarballs[decodeURIComponent(rawPath.slice('/tarballs/'.length))];
    if (!item) {
      json(response, 404, { error: 'not_found' });
      return;
    }
    response.writeHead(200, {
      'content-length': statSync(item.path).size,
      'content-type': 'application/octet-stream',
    });
    createReadStream(item.path).pipe(response);
    return;
  }

  const packageName = decodeURIComponent(rawPath.slice(1));
  const item = config.packages[packageName];
  if (!item) {
    json(response, 404, { error: 'not_found' });
    return;
  }
  const manifest = {
    ...item.manifest,
    dist: {
      integrity: item.integrity,
      shasum: item.shasum,
      tarball: `http://registry:4873/tarballs/${encodeURIComponent(item.filename)}`,
    },
  };
  json(response, 200, {
    name: packageName,
    'dist-tags': { latest: item.version },
    versions: { [item.version]: manifest },
  });
}).listen(4873, '0.0.0.0');
