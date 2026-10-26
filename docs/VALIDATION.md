# Local validation boundaries

公共版的默认验证命令：

```text
npm ci
npm test
npm run demo -- --smoke
npm run doctor -- --json
npm run check:release
```

`npm test` 通过 `scripts/test-offline.mjs` 的明确 allowlist 运行：

- 新模块行为：安全默认配置、严格 schema、原子保存、账号错配/越权/重复事件、连续接话、会话上下文范围、配置变更取消发送、模型错误归一化和退避。
- 插件：真实加载本地 example provider，并用于一次合成聊天回答；拒绝未知版本和目录逃逸。
- 面板：本机 HTTP、owner token、CSRF、配置校验、定制保存、模型探测端点（mock backend）。
- OneBot：本机真实 WebSocket echo、retcode、事件与超时；HTTP 模型与 WS 网关合成端到端。
- 原 DSH 高级模式：保留消息/提示词/排队、MCP 权限、持久状态故障、人格、模型视图、收尾/等待、媒体解析和费用账本等纯离线回归。

没有测试会自动连接真实 QQ、读取个人配置、调用云模型、使用实际 token 或操作桌面。测试临时文件放在仓库 `.test_tmp/` 下并清理；该目录被忽略。直接执行单个旧 test 脚本并不等于运行完整离线策略，请优先用 `npm test`。

这些结果证明代码在合成协议输入和隔离 fixtures 下的行为，不代表某个 QQ 版本、网关产品、远端模型或 DSH 新版本已经真实联通。上线前由部署者在自己授权的测试会话验收：收到一条来信→所选模型回答→正确会话发送→不重复→重启后重新连接。模板默认不替用户完成实际群发。

`doctor` 不发网络请求，`configuration_required` 是正常初始结果。面板“实际模型连接测试”是显式在线动作，可能计费，但不传聊天上下文；它只验证模型，不验证 QQ。首次实际回复后的 `reply_verified` 才证明模型链路曾成功，QQ 的成功回执仍是另一层状态。
