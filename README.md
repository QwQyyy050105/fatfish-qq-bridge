# Fatfish QQ Bridge

一个可独立部署、可换人格和模型的 QQ 群聊伙伴模板。默认提供 **OneBot v11 + 兼容 API + 本机管理面板**，同时保留来自 [qq-bridge](https://github.com/Derpyu520/qq-bridge) 的 **DeepSeek Harness（DSH）高级仿真链路**。

它适合希望用普通 QQ 账号通过外部 OneBot 网关参与群聊，并且愿意自行选择、安装和维护网关的人。它**不使用官方 QQ Bot API**，也不连接微信。网关、QQ 版本和账号登录是独立依赖；本仓库不附带、安装或启动第三方 QQ 客户端或网关。三个模板的选择请先看 [区别与选择](docs/CHOOSING_A_TEMPLATE.md)。

## 两种运行方式

| 项目 | 默认 API 文本模式 | 高级 DSH 模式 |
|---|---|---|
| 启动 | `npm start` | `npm run start:advanced` |
| 配置 | `template.config.json` | `config.json` |
| 模型 | 兼容 Chat Completions 的云 API / 本地端点 | 用户的 DSH provider/model，包含其支持的兼容 API provider |
| 参与 | 点名、@、连续接话，可开启概率参与 | 保留聊天、受限工具代理、二代自主仿真与唤醒 |
| 人格与设置 | 新面板与独立 persona 字段 | 原控制台 + `roles/*.md` + DSH presets |
| 工具、联网、图片、表情 | 当前不实现，不会假装具备 | 由现有 MCP 工具、模型及网关支持程度决定 |
| 语音 | ASR/TTS 未实现 | 可发送用户自行准备的语音库；自动 ASR、共享 TTS 未配置 |
| 持久上下文 | 有界内存上下文，重启清空 | 原 DSH 会话和桥接状态 |
| 适用 | 快速建立自己的轻量模板 | 需要原版复杂社交节奏、工具与仿真能力 |

直接 API 模式不会自动获得 DSH 工具、联网或二代仿真能力。两种模式不能在相同面板端口同时启动。高级部署见 [DSH 配置](docs/ADVANCED_DSH.md)。

## 先本地验证，不需要账号或 API key

安装 **Node.js 22.13+，建议 Node.js 24 LTS**。在仓库目录执行：

```powershell
npm ci
npm run demo -- --smoke
npm test
npm run doctor -- --json
```

演示只使用合成账号、mock 模型和 mock 传输，不联网、不操作 QQ。测试包含本机回环 HTTP/WS 协议验收，不连接真实网关或云模型。`doctor` 只检查本地配置；空配置输出 `configuration_required`，不会把未验证的模型标成在线。

## 连接自己的机器人

1. 先自行安装并登录一个兼容 **OneBot v11 正向 WebSocket** 的外部网关，取得 WebSocket URL 和访问 token。本模板只消费协议，不保证任意 QQ/网关版本可用。
2. 运行 `npm run init`，复制 `.env.example` 为 `.env`，在本机填写自己的模型 key 和网关 token。`.env`、配置、state 都被 Git 忽略。
3. 运行 `npm run panel`，打开终端打印的本机面板链接，默认 `http://127.0.0.1:3100/`。链接 `#` 后是管理员令牌，只给自己保存。日常启动也可在 Windows 双击 `Start_Fatfish.cmd`。`npm run panel` 始终只配置，即使保存 enabled 也不连接 QQ；`npm start` 会在面板显示后后台尝试连接。
4. 在面板填写 API Base URL（通常以 `/v1` 结尾）、准确模型 ID、确认的机器人 QQ 号，以及**授权群号 / 私聊 QQ 号**。默认无任何授权目标，也不开启网关连接。
5. 保存设置，手动点击“实际模型连接测试”。它只发送独立测试提示词，不带聊天记录，可能产生 API 费用。
6. 勾选“连接并允许自动回复”，保存；关闭仅配置面板，再运行 `npm start` 真正连接 QQ。确认状态中传输连接、账号验证均成功，再用另一个账号在授权群叫“小鲸鱼”。

模板不会替换你选择的模型，也不会根据失败偷偷切换到便宜模型。API 模式默认使用 `max_tokens`；如提供商需要 `max_completion_tokens`，在面板选择对应字段。模型 ID、能力和费用由提供商决定。使用本地兼容服务时允许 `http://127.0.0.1:端口/v1`，无需 key；远端 API 只允许 HTTPS。

## 在面板上定制

- 名字、别名、完整人格卡、风格、回复长度。
- 点名模式 / 概率参与、连续接话窗口、安静时段（本机时区）。概率默认 0，没有定时主动发言。
- 上下文条数、字数和共享范围。默认每个会话独立；主动开启共享后，**所有已授权会话**上下文相互可见。
- 模型端点、模型 ID、密钥环境变量名、超时和生成上限。
- 授权目标、机器人身份、外部网关 URL、token 环境变量名。
- 面板标题、主题色、紧凑显示。

保存会重新连接并清空内存上下文，取消旧配置下尚未发送的回复；不需要重启进程。启用插件、更改面板监听端口需要编辑配置并重启。API key 不会返回浏览器，面板只展示环境变量的名字。插件属于可信本机代码，不是供群友上传的脚本沙箱。

## 可扩展，而不是虚假完成

版本化插件通过 `apiVersion: 1` 注册模型或 OneBot 传输 provider，运行时真正调用它们。`extensions/example-model.mjs` 是可运行的离线例子。扩展约定、能力状态、应用版本边界见 [扩展接口](docs/EXTENSIONS.md)、[本机 API](docs/LOCAL_API.md) 和 [可移植性](docs/PORTABILITY.md)。当前 v1 只接线文本模型和 OneBot 传输 provider；vision、ASR、TTS 与搜索不属于已接线能力。实现这些功能需先扩展宿主媒体消息契约、验证和路由，不能只改 manifest 声称可用；当前均显示 unsupported，不会启用开发者电脑上的路径或服务。

当前重点是 Windows/PC 外部网关；桥接进程本身使用标准 Node.js 接口。Linux/macOS 仍需要各自可用的网关和实际验收，不能从 mock 测试推断已经兼容；手机端不支持本地直接部署。

## 健康、日志和隐私

QQ 连接、账号一致性、DSH 设置 API 可读、模型实际回答分开记录。默认运行的 `/api/status` 里 `reply_verified` 只在真正收到一次模型回复后出现。模型错误采用有限指数退避，并只写本机状态，不向群里重复刷 `Connection error`。回复耗时在状态中可查看；模型上游慢、限流或网关断线不能由本地测试证明已消除。

内置宿主只把明确授权的群或私聊送入聊天上下文及模型 provider。外部网关和已启用的传输插件先接收原始事件，再交给宿主校验；此过滤不隔离传输插件，也不是操作系统沙箱。所有本机插件均具有宿主进程权限，可自行访问环境和文件，必须先审核代码；请同时限制外部网关的事件订阅范围。默认上下文仅保存在内存。模型提供商会收到所选会话的上下文，这是聊天推理的必要输入。扩展插件和高级 DSH 工具应由管理员审核后配置。上传仓库前运行 `npm run check:release`，不要公开 `.env`、config、state、token、日志、音频或聊天图片。

请参阅 [新手提示词模板](docs/BEGINNER_PROMPTS.md)、[本地验证范围](docs/VALIDATION.md)、[贡献约定](CONTRIBUTING.md)、[安全说明](SECURITY.md) 和 [支持边界](SUPPORT.md)。上游归属及第三方许可边界见 [NOTICE](NOTICE.md)；本仓库代码采用 [MIT](LICENSE)。

## AI maintenance workflows

Read [AGENTS.md](AGENTS.md) for project boundaries and task routing. Reusable project skills cover release verification, adapter/provider extensions, personality edits and incident handoff under `.agents/skills/`. These files do not install a global agent or an operating-system sandbox.

Windows 可在安装依赖后双击 `Start_Panel.cmd` 打开本机配置面板；它不会自动登录平台或发送消息。终端窗口保持运行，Ctrl+C 停止服务。`Start_Panel.cmd --check` 只检查启动条件。

发布隐私、默认权限、真实模型数据流与高级路线边界见 [安全与模型扩展说明](docs/SECURITY_AND_MODELS.md)。
