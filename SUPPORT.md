# 大肥鱼接入与收发排查

先确认运行方式。通过 `npm start` 启动的默认文本桥使用下表。通过 `npm run start:advanced` 启动的 DSH 桥使用另一份配置、面板及健康字段，请看 [DSH 的认证与健康](docs/ADVANCED_DSH.md#认证与健康)。

## 默认文本桥

打开启动时打印的本机面板，查看状态。脚本也可通过 [本机 API](docs/LOCAL_API.md) 读取 `/api/status`。记录当前的 `received` 和 `sent`，从另一账号在一个授权群发送带别名的问题，然后对照**本次计数变化**。下表中的计数和时延属于当前运行实例，面板保存设置后会重新开始统计。

| 当前现象 | 接下来检查什么 |
|---|---|
| 启动时显示 `EADDRINUSE` | 检查是否还有仅配置面板、同目录旧进程或 DSH 面板占用端口。关闭自己先前启动的那个窗口，或停止这个实例后在 `template.config.json` 设不同的 `panel.port` 再启动。 |
| `configuration_required` | `npm run doctor -- --json` 只做本地静态检查，首次常见 `transport_disabled`、`expected_account_not_configured`、`no_authorized_targets`。按 [接入步骤](README.md#连接自己的机器人) 填写相应字段。 |
| `transport=disabled_configuration_mode` 或 `disabled` | 前者表示使用了 `npm run panel`，用这个模式完成设置，关闭它再 `npm start`。后者需在面板勾选连接并保存。 |
| `transport=disconnected` 或 `error` | 检查网关进程是否在线，外部网关是否作为 OneBot v11 **正向 WebSocket 服务端**运行，填写其 WS 地址和访问令牌。WS 地址与面板的 HTTP 地址用途不同。环境变量变更后重启桥接。 |
| `identity=mismatch_or_unavailable` | 桥接通过 `get_login_info` 核对当前登录的机器人。对照网关账号与 `transport.expectedQQ`，检查网关是否允许调用该动作。 |
| 身份为 `verified`，发送一条新文字后 `received` 不增加 | 检查群号是否在 `allow.groups` 或私聊发送者是否在 `allow.private`，并确认使用另一账号发出。网关要通过同一个 WS 连接向桥接上报 OneBot `post_type: message` 事件。 |
| `received` 增加，但模型未回答 | 用带 `bot.aliases` 中别名的普通文字测试，检查安静时段。如果 `modelHealth.state=backoff`，看 `modelHealth.error` 和 `retryAt` 后再发送一条新消息；`retryAt` 是毫秒时间戳。 |
| `model_http_401`、`model_http_403`、`model_http_429` 或 `model_timeout` | 401/403 核对环境变量、服务商权限和模型访问权限；429 检查服务商限流/配额；超时核对网络及模型响应时间。用面板的模型测试单独复现，该操作可能产生费用。 |
| `lastError=gateway_send_failed` | 模型已生成文本，核对网关对 `send_group_msg` 或 `send_private_msg` 的应答与目标会话权限。超时可能发生在网关已处理发送之后，先从另一账号确认是否已经送达。 |
| `sent` 增加，接收者仍没看到 | 增加表示网关已返回成功。核对网关实际登录账号、目标群/私聊，以及接收者的聊天窗口。保留时间、网关版本和脱敏回执，再判断问题出在何处。 |

最近一次成功发送的 `lastLatencyMs` 从该条消息开始执行模型工作时计起，包含模型与网关操作。它省略前面的收信和同会话排队等待；要核对用户实际等了多久，可另记发送和收到回复的时间。

## 提交问题

记录模板提交号、操作系统、`node --version`、网关实现与版本、使用的模式、复现时间和时区。附一条虚构测试句，以及前后计数和错误类别。公开 issue 无需面板链接中的 `#` 令牌、环境变量、账号或聊天记录。[可复制的问题报告提示词](docs/BEGINNER_PROMPTS.md#排障)
