# ThingLinks Node-RED

ThingLinks Edge 与 Cloud 的官方 Node-RED 集成，按包独立版本维护，采用 Apache-2.0 许可证。

## 三个包的职责边界

- `@thinglinks/node-red-common@0.1.0`：共享上报运行时。它是普通运行时依赖，刻意不设置 `node-red` 字段，因此不会成为节点目录条目，也不能加入 `allowList`。
- `@thinglinks/edge-nodes@1.0.1`：当前运行时包，且只注册 `tl-device`、`tl-tag`、`tl-uplink` 三个节点。
- `@thinglinks/cloud-nodes@0.1.0`：仅为未来 Cloud 集成保留的私有骨架，Cloud 节点尚未实现，不代表存在七个节点。

本轮尚未发布；`@thinglinks` scope 的发布权限仍待确认。

## 环境要求

- Node.js：`^22.18.0 || ^24.12.0`
- pnpm：`10.32.1`
- Node-RED：`>=5.0.4 <6`

## 安装

先安装 common，再安装 Edge 节点包：

```sh
cd ~/.node-red
npm install @thinglinks/node-red-common
npm install @thinglinks/edge-nodes
```

本轮尚未发布到 registry。当前应先在本仓运行 `pnpm pack:check`，再用带精确 `--filter` 的 `pnpm pack` 生成各包 `.tgz`，并按 common → edge 的顺序安装。

Node-RED 的 deny-by-default 配置中，`allowList` 同时影响安装和启动加载：只允许 `@thinglinks/edge-nodes`；不要把 `@thinglinks/node-red-common` 加入 `allowList`，也不要把它当节点包列出。common 仍会存在于依赖树中，但不会出现在 Node-RED 节点目录。

## Edge Manager 连接

为 Node-RED 进程设置：

```sh
TLE_MANAGER_URL=http://manager.example
TLE_INGEST_TOKEN=replace-with-token
TLE_INSTANCE_ID=your-instance-id
```

运行时使用 Bearer token，并通过以下五个端点上报：

- `POST /api/edge/devices`
- `POST /api/edge/devices/:nodeId/status`
- `POST /api/edge/tags`
- `POST /api/edge/values`
- `POST /api/edge/uplink`

Manager 根据 token 反查实例；请求体不得携带或冒充实例身份。配置缺失、超时、网络失败及非 2xx 响应只告警并返回 `false`，不把异常抛入用户 flow，且原始 `msg` 对象继续透传。非法节点配置属于独立的节点校验边界。tag 上报遵循独立的 tag 规则和校验边界。

## 独立版本与 tag

三个包各自维护版本，tag 只选择一个工作区包：

- `edge-nodes@x.y.z`
- `cloud-nodes@x.y.z`
- `common@x.y.z`

tag 版本必须与目标 `package.json.version` 一致。任何声明依赖 common 的 Edge/Cloud 版本都必须等 common 先发布。本轮工作流只做校验、dry-run 与打包，不执行 `npm publish`。

仓内依赖使用精确 `workspace:0.1.0`，`pnpm pack` 后必须转换成精确公共依赖 `0.1.0`，两种形态都有测试。tag 工作流只生成一次发布 tgz，记录绝对路径与 SHA-512 integrity，再把同一份 common/edge tgz 交给真容器门禁，最终上传同一目标包。发布 Edge 时，本地验收的 common integrity 还必须与 npm 上精确 `0.1.0` 的公开 `dist.integrity` 一致；未来发布步骤只能消费这份 artifact，禁止从源码目录重新 pack。

当前仅 dry-run，因此工作流刻意不授予 OIDC 权限。每个公共包由有权限的维护者完成首次引导发布后，应在 npm 绑定 Owner `mqttsnet`、仓库 `thinglinks-node-red` 与精确工作流文件名 `publish-package.yml`，随后撤销引导凭证。未来只给实际 publish job 增加 `id-token: write`；稳定版/预发布版分别使用 `latest`/`next`。三个 tag 前缀应启用 ruleset，且 tag 提交必须可从受保护 `main` 到达。

## 开发验证

```sh
pnpm install
pnpm lint
pnpm test
pnpm pack:check
pnpm test:container
pnpm run audit
```

官方依据：[Node-RED 节点打包规范](https://nodered.org/docs/creating-nodes/packaging)、[pnpm workspace 协议](https://pnpm.io/workspaces#workspace-protocol-workspace)、[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)。

开发与测试命令见 [CONTRIBUTING.md](CONTRIBUTING.md)。
