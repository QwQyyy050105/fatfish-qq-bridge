# Local owner API v1

此 API 供本机脚本和面板调用，当前属于**默认 API 文本模式**。高级 DSH 模式使用原控制台 API，两者不能互换。`npm run panel` 为仅配置模式，不连接 QQ；`npm start` 才启用已配置连接。监听固定在 `127.0.0.1`；默认端口 3100，可在配置文件改后重启。

所有 `/api/*` 请求需要 `Authorization: Bearer <owner-token>`。token 由首次启动生成于 `state/panel-token`，本机面板 URL 的 fragment 也携带它，浏览器加载后会移入 sessionStorage 并清除地址栏 fragment。不要放查询参数、日志、issue 或公网代理。

| 方法与路径 | 输入 | 结果 |
|---|---|---|
| GET `/api/status` | 无 | QQ 传输、身份、模型实际回复状态、退避、最近延迟与能力 |
| GET `/api/config` | 无 | 当前完整配置，不包含环境变量密钥内容 |
| PUT `/api/config` | 完整配置 JSON | 校验、应用、原子保存；返回 `{saved:true,config:...}` |
| POST `/api/model/probe` | `{}` | 独立模型请求，返回 `{actualModelReply:true,durationMs,transportTested:false}` |

写请求还必须带 `Origin: http://127.0.0.1:3100`（以实际端口为准）、`X-CSRF-Token: <owner-token>` 和 `Content-Type: application/json`。外部 Origin 和 `Sec-Fetch-Site: cross-site` 的 GET/写请求都会被拒绝。没有 CORS 放行。

错误返回 `{error:code}`：未鉴权 401；Host/Origin/CSRF 不符 403；输入超过 64KiB 为 413；并发配置更新 409；配置错误或企图通过 API 加载插件 / 修改面板地址 400；配置写盘失败 500；模型探测失败 502。POST 探测必须提交空对象 `{}`，同样执行 JSON 类型与 64KiB 检查。探测不携带聊天上下文，可能计费；同一时刻的重复点击合并为同一项探测。

脚本例子（由管理员自行提供本机 token）：

```powershell
$base = 'http://127.0.0.1:3100'
$headers = @{ Authorization = "Bearer $env:FATFISH_PANEL_TOKEN" }
Invoke-RestMethod "$base/api/status" -Headers $headers
$config = Invoke-RestMethod "$base/api/config" -Headers $headers
$config.bot.name = 'My Companion'
$headers.Origin = $base
$headers['X-CSRF-Token'] = $env:FATFISH_PANEL_TOKEN
Invoke-RestMethod "$base/api/config" -Method Put -Headers $headers `
  -ContentType 'application/json' -Body ($config | ConvertTo-Json -Depth 12)
```

读取配置不意味着已经联网。保存先构造并验证适配器，再原子持久化，最后发布新运行实例；构造或写盘失败保持旧配置与运行实例。保存支持热应用名字、人格、参与方式、安静时段、上下文、授权目标、网关和模型配置、面板外观；会取消旧请求、清空内存历史、重建连接。插件加载路径和 panel host/port 只能文件编辑后重启。`model.tokenLimitField` 是 `max_tokens` 或 `max_completion_tokens`，不向不兼容服务同时发送两个字段。`.env` 的修改需要正常重启进程才能载入。

配置权威验证逻辑是 `src/template/config.mjs`，机器可读结构见 `template.config.schema.json`。未知字段会拒绝而不是静默忽略。`schemaVersion` 为 1；未来不兼容变更需新的 schemaVersion 以及显式迁移，不假定任意新版配置都能向下兼容。
