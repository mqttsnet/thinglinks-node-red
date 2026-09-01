# Contributing

感谢参与 ThingLinks Node-RED。提交改动前请确认范围与包边界，不要把未实现的 Cloud 能力或未验证的发布状态写成已交付能力。

## 开发

使用仓库锁定的 pnpm 版本 `10.32.1`，并满足 Node.js `^22.18.0 || ^24.12.0`。安装依赖后运行：

```sh
pnpm install
pnpm lint
pnpm test
pnpm pack:check
pnpm test:container
pnpm run audit
```

改动应保持 common 为普通运行时依赖、Edge 仅注册 `tl-device`/`tl-tag`/`tl-uplink`，并保持 Node-RED `>=5.0.4 <6` 兼容范围。提交前检查打包内容、包元数据和现有测试；不要凭文档或手工启动将 Cloud 骨架或发布流程宣称为已实现/已发布。

Edge 对 common 的仓内声明必须是精确 `workspace:0.0.1`，发布 tgz 中必须转换成精确 `0.0.1`。发布门禁从 `pnpm pack --json` 解析唯一 tarball 和 integrity，内容检查、真容器与未来发布必须消费同一文件，禁止再次从源码打包。当前工作流没有 publish 或 OIDC 权限；首次引导发布、npm trusted publisher 绑定和 tag ruleset 均需维护者单独确认。

## 安全与凭证

不得提交真实的 `TLE_INGEST_TOKEN`、Manager 地址中的凭证、私钥、npm token 或其他环境密钥。测试使用假凭证和本地 fake Manager；日志、截图、测试输出和 issue 中也必须脱敏。请求体不得伪造实例身份，实例由 Manager 根据 token 反查。

## Pull request

说明受影响的包、验证命令及尚未完成的边界。未经发布门禁与维护者确认，不要执行或宣称 npm 发布；Cloud 包保持 private，不能随 common/Edge 一起发布。
