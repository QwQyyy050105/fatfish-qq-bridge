# Optional advanced DSH bridge

此模式保留原 qq-bridge 的社交仿真、两套人格 preset、MCP 聊天工具、唤醒/潜水、表情与记忆能力。它不是 `template.config.json` 的一个开关，也不是默认 API 模式的等价别名。

## 前置准备

- Node.js 22.13+（建议 24 LTS）。
- 用户自行安装、登录和验证 OneBot v11 网关。WebSocket 和 HTTP 端点可能有不同 token。
- 用户自行安装、启动 DeepSeek Harness，并配置实际可用的模型 provider/model。
- DSH 正常启动时提供的 launch token；推荐通过 `DSH_LAUNCH_TOKEN` 环境变量传入，不提交到仓库。

复制 `config.example.json` 为 `config.json`，填写 `snowluma.expectedQQ`、`ownerQQ`、`allow.groups/private`、OneBot WS/HTTP URL 和令牌，以及 `dsh.baseUrl/provider/model`。`snowluma` 是为保留上游兼容的配置命名，连接器使用普通 OneBot 协议，不限定网关实现。空白名单保持拒绝全部，`allowAllWhenEmpty` 保持 false。公网 DSH 默认拒绝；只接本机已知端点。

配置中的账号、群号、路径和密钥属于个人配置，不要提交 GitHub。模型通过 DSH 的 provider 配置，也可选择 DSH 支持的兼容 API provider。不能把默认 API 模式的 `model.baseUrl` 直接复制成 DSH provider；两套 schema 不同。

## 安装仓库自己的 DSH 配置

先停止当前桥接。在 PowerShell 里显式指定 **自己 DSH 使用的数据根目录**，避免写错 profile：

```powershell
$env:DSH_HOME = 'D:\YourWorkspace\dsh_home'
$env:DSH_LAUNCH_TOKEN = 'your-current-normal-launch-token'
npm run setup:dsh -- web
npm run start:advanced
```

`setup:dsh` 只安装本仓库的 preset/MCP 注册和插件链接，可能调用用户已有的 `dsh install` 以解析 DSH profile 依赖。它不会安装或启动 QQ/SnowLuma。脚本在覆写 profile 配置前保留范围有限的恢复副本。不要把示例路径原样当成有效安装目录。安装后应按 DSH 的正常方式重载所选 profile，并确认其工具清单。

默认面板同样使用 3100 端口，管理员令牌及状态在本仓库 state 下。`roles/fatfish.md` 是可迁移的示例人格卡，可通过原控制台选用；群关系和私人印象不随模板分发。DSH presets 和人格卡分工不同：preset 定义工具/运行方式，人格卡定义名字、喜好、语气。advanced 模式的面板保留上游权限、CSRF 和会话白名单检查。

## 认证与健康

公共版默认只使用显式配置 / 环境变量提供的认证信息；不会隐式读取本机 DSH 凭据文件或旧启动日志。`DSH_ALLOW_LOCAL_AUTH_DISCOVERY=1` 是兼容上游的**显式本机选择**，会允许读取所指 DSH_HOME 的旧日志或本机签名凭据；一般不需要，也不建议作为正常部署依赖。不要把这个变量放在公共示例中。

控制台的 `dshReady` 仅表示控制设置 API 可读。`dshControlApi` 与 `modelHealth` 单独显示，模型仅在一次 `turn/end completed` 后才标记 `turn_verified`；该状态是“最近一次验证成功”，不是未来持续可用保证。模型失败会进入有上限的指数退避，详细错误只留本机，不在群里循环刷屏。需要确认可用时，用隔离测试会话完成真实回答，随后在一个授权群人工测试一轮。

## 支持范围

适配器保留上游 DSH 0.1.x–0.2.x 的已知协议与离线 fixtures，但未对任意新版本做真实联调保证。版本契约由 `src/dsh-client.js`、setup presets 和对应离线测试描述。升级时先跑 `npm test`，再用自己的网关/模型做一次真实收发验收。

图片、表情、拍一拍、合并转发等动作取决于网关；部分是 OneBot 以外扩展。当前模板不包含音频/图片资产、开发机共享 TTS 或自动 ASR。不要在没有实际媒体输入时要求模型编造内容。新设备适配使用 [扩展接口](EXTENSIONS.md)，不要通过作者的硬盘路径或其他账号配置“自动修复”。
