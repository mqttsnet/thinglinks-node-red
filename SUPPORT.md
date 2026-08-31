# Support

请先确认 Node.js `^22.18.0 || ^24.12.0`、pnpm `10.32.1` 和 Node-RED `>=5.0.4 <6`，并提供最小复现、包版本、脱敏日志及验证命令。

配置 Edge Manager 时检查 `TLE_MANAGER_URL`、`TLE_INGEST_TOKEN`、`TLE_INSTANCE_ID`。上报失败只会告警并返回 `false`，原始 flow 消息仍会透传；非法节点配置则是独立的节点校验问题。Manager 会从 token 反查实例，请不要在请求体中添加实例身份。

当前只有 `@thinglinks/edge-nodes` 的 `tl-device`、`tl-tag`、`tl-uplink` 运行时实现；common 是普通依赖，Cloud 包仍是私有骨架。本轮未发布，`@thinglinks` scope 发布权限待确认。

安全漏洞、token、私钥或其他敏感信息不要提交到 issue，请通过维护者认可的私下渠道报告。
