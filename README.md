# ThingLinks Node-RED

Official Node-RED integrations for ThingLinks Edge and Cloud, maintained as independently versioned packages. This repository is Apache-2.0 licensed.

## Package boundaries

- `@thinglinks/node-red-common@0.1.0`: shared reporting runtime. It is a normal runtime dependency and intentionally has no `node-red` package field, so it is not a node directory entry and must not be added to `allowList`.
- `@thinglinks/edge-nodes@1.0.1`: the current runtime package. It contains exactly `tl-device`, `tl-tag`, and `tl-uplink`.
- `@thinglinks/cloud-nodes@0.1.0`: private reservation/skeleton only. Cloud nodes are not implemented; no seven-node set is implied.

The current round is not published. Permission to publish the `@thinglinks` scope is still to be confirmed.

## Requirements

- Node.js `^22.18.0 || ^24.12.0`
- pnpm `10.32.1`
- Node-RED `>=5.0.4 <6`

## Installation

Install the common runtime first, then the Edge nodes package:

```sh
cd ~/.node-red
npm install @thinglinks/node-red-common
npm install @thinglinks/edge-nodes
```

These packages are not published in this round. Until they are available from the registry, run `pnpm pack:check` in this repository, create the package tgz files with filtered `pnpm pack` commands, and install the common tgz before the Edge tgz.

For a deny-by-default Node-RED installation, `allowList` affects both package installation and startup loading. Allow `@thinglinks/edge-nodes`; do not allow or list `@thinglinks/node-red-common`. The common package remains in the dependency tree but does not appear in the Node-RED node directory.

## Edge Manager connection

Set these environment variables for the Node-RED process:

```sh
TLE_MANAGER_URL=http://manager.example
TLE_INGEST_TOKEN=replace-with-token
TLE_INSTANCE_ID=your-instance-id
```

The runtime uses bearer authentication and reports through these five endpoints:

- `POST /api/edge/devices`
- `POST /api/edge/devices/:nodeId/status`
- `POST /api/edge/tags`
- `POST /api/edge/values`
- `POST /api/edge/uplink`

The Manager derives the instance from the token; request bodies must not impersonate an instance by carrying an instance identity. Missing configuration, timeouts, network errors, and non-2xx responses only warn and return `false`; the Node-RED message remains the original object and continues through the flow. Invalid node configuration is a separate node-validation boundary. Tag reporting follows its own independent tag rule and validation boundary.

## Independent versions and tags

Each package keeps its own version. A tag selects exactly one workspace package:

- `edge-nodes@x.y.z`
- `cloud-nodes@x.y.z`
- `common@x.y.z`

The tag version must equal the selected package manifest. Common must be published before any Edge or Cloud version that declares it as a dependency. The current workflow validates and packs artifacts only; it does not run `npm publish`.

Internal workspace dependencies use an exact `workspace:0.1.0` source range. `pnpm pack` must convert that to the exact public dependency `0.1.0`; both forms are tested. The tag workflow creates each release tarball once, records its absolute path and SHA-512 integrity, feeds the same common/Edge tarballs to the real-container gate, and uploads the exact target tarball. For an Edge release, the locally verified common integrity must equal npm's public `dist.integrity` for exact `0.1.0`. A future publish step must consume that artifact and must never repack from the source directory.

The repository intentionally grants no OIDC permission while it is dry-run only. After each public package has been bootstrapped by an authorized maintainer, configure npm trusted publishing for owner `mqttsnet`, repository `thinglinks-node-red`, and the exact workflow filename `publish-package.yml`; then revoke the bootstrap credential. Only the future publish job should receive `id-token: write`, and stable/prerelease versions must use `latest`/`next` respectively. Protect all three tag prefixes and require the tagged commit to be reachable from protected `main`.

## Development verification

```sh
pnpm install
pnpm lint
pnpm test
pnpm pack:check
pnpm test:container
pnpm run audit
```

Official references: [Node-RED node packaging](https://nodered.org/docs/creating-nodes/packaging), [pnpm workspace protocol](https://pnpm.io/workspaces#workspace-protocol-workspace), and [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and test commands.
