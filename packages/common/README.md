# @thinglinks/node-red-common

Shared runtime for the official ThingLinks Node-RED packages. Version `0.1.0`, Apache-2.0.

This is a normal runtime dependency, not a Node-RED node package: it intentionally has no `node-red` field and must not be added to `allowList` or expected in the Node-RED node directory.

It reads `TLE_MANAGER_URL`, `TLE_INGEST_TOKEN`, and `TLE_INSTANCE_ID`, then uses bearer authentication for the five Edge Manager endpoints: `/api/edge/devices`, `/api/edge/devices/:nodeId/status`, `/api/edge/tags`, `/api/edge/values`, and `/api/edge/uplink`. The Manager derives instance identity from the token; request bodies must not impersonate an instance. Missing configuration or reporting failures only warn and resolve to `false`; callers retain the original flow message. Node configuration validation remains the caller/node boundary.

Install this package with `npm install` in the Node-RED user directory before `@thinglinks/edge-nodes`. It is not published in the current round; use a filtered `pnpm pack` generated `.tgz` when testing locally.
