# Local validation boundaries

## 2026-11-11 本地移植验收

Windows 11 x64、Node.js 24.22.1。在含中文和空格的新目录导出候选源码，从另一工作目录用 `npm --prefix` 运行。安装使用已缓存的锁定依赖，未携带账号配置。

| 命令 | 实际结果 |
|---|---|
| `npm ci --omit=optional --offline`、`npm run test:core` | 精简安装 3 个包，2/2 组核心套件通过。另做两次同时运行，均通过并清除了各自的夹具。 |
| `npm ci --include=optional --offline`、`npm test` | 完整安装后，32/32 组离线套件通过。 |
| `npm run demo -- --smoke`、`npm run doctor -- --json` | 演示中 1 条授权回复，重复与越权事件均被挡住。空配置诊断结果为 `configuration_required`。 |
| `Start_Panel.cmd --check`、`npm run check:release` | 精简依赖通过面板启动前检查；Node 20 或缺少 `json-bigint` 时检查失败。候选源码扫描通过。 |

这次实测覆盖本机 HTTP/WS、配置读写、面板与离线 DSH 用例。真实 QQ 账号、外部网关、运行中的 DSH 宿主、云模型与其他操作系统需要独立验收。

同日补验了 DSH 中止事件。向高级桥接的实际事件处理器依次注入三个中止回合和一个完成回合，模拟 QQ 私聊输出恰好一条正常回复，本机活动记录含三次中止。二代唤醒用例验证中止后可继续接收下一次点名，同时维持原未行动计数。可用 `node scripts/test-audit-regressions.mjs` 单独复验。

## 维护者复验

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

精简安装可以运行 `npm run test:core`，执行会话路由以及 `test/` 中的配置、传输、面板、模型和发布策略测试，包括回环 HTTP 与 WebSocket 实际收发。它与完整回归共用用例和运行器，省略依赖高级组件的旧版 DSH 脚本。测试夹具按每次执行分配独立目录。

没有测试会自动连接真实 QQ、读取个人配置、调用云模型、使用实际 token 或操作桌面。测试临时文件放在仓库 `.test_tmp/` 下并清理；该目录被忽略。直接执行单个旧 test 脚本并不等于运行完整离线策略，请优先用 `npm test`。

这些结果证明代码在合成协议输入和隔离 fixtures 下的行为，不代表某个 QQ 版本、网关产品、远端模型或 DSH 新版本已经真实联通。上线前由部署者在自己授权的测试会话验收：收到一条来信→所选模型回答→正确会话发送→不重复→重启后重新连接。模板默认不替用户完成实际群发。

`doctor` 不发网络请求，`configuration_required` 是正常初始结果。面板“实际模型连接测试”是显式在线动作，可能计费，但不传聊天上下文；它只验证模型，不验证 QQ。首次实际回复后的 `reply_verified` 才证明模型链路曾成功，QQ 的成功回执仍是另一层状态。
