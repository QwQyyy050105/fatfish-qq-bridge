# Extension contract v1

默认模式的组合边界在 `src/template/`，复杂 DSH 行为仍由 `src/bridge.js` 与 MCP server 承担。不要用默认模式的插件去假装已经实现高级仿真。

## 配置和真实调用

只有本机管理员能在 `template.config.json` 配置：

```json
{
  "plugins": ["./extensions/example-model.mjs"],
  "model": {"adapter": "example-echo"}
}
```

其余字段由默认值补齐。启动时读取文件并验证真实路径必须位于 `extensions/`，包括符号链接目标；面板不能加载代码或改变插件列表。宿主的聊天作用域与账号校验发生在上下文建立和模型 provider 调用前。传输 provider 是原始输入入口，先收到网关事件再交给宿主，因此不能将此过滤描述为“所有插件看不到非授权数据”。所有插件以本机进程权限运行，是可信代码，可自行访问环境与文件；本模板不提供进程或操作系统隔离。请同时限制外部网关的事件订阅范围。

```js
export default {
  apiVersion: 1,
  id: 'my-model',
  capabilities: ['model:text'],
  async setup(context) {
    return {
      dependencies: [],
      providers: {
        models: {
          'my-model': (config, { env }) => ({
            capabilities: {text: true, tools: false, vision: false, asr: false, tts: false},
            async complete(messages, { signal }) {
              // Use AbortSignal, normalize provider errors, never log env credentials.
              return {text: 'hello', usage: null};
            }
          })
        }
      },
      async dispose() {}
    };
  }
};
```

`dependencies` 是扩展自行声明的外部需求清单，不会自动安装软件或执行命令。`setup(context)` 返回值必须包含 `providers` 和 `dependencies`；`context.apiVersion` 为 1，`context.log` 可记录去敏的结构化信息。ID 使用小写英文和连字符，重复 ID 或未知 apiVersion 会拒绝加载。

模型 factory 接收 model 配置和 `{env}`；必须返回 `complete(messages,{signal})` 和准确的 `capabilities`。回复格式 `{text:string, usage?:object}`。异常应给安全的 `code`（如 `model_timeout`），由运行时做退避，原始上游异常不会发到群里。

传输插件声明 `transport:onebot-v11` 并返回 `providers.transports[id]` factory。factory 接收 transport 配置和 `{env}`，返回类似 EventEmitter 的对象，提供 `connect/close/getLoginInfo/sendGroupMessage/sendPrivateMessage/onGroupMessage/onPrivateMessage` 与 `open/close/error` 事件。发送 Promise 应在收到网关成功回执后才 resolve。runtime 仍要求事件的 `self_id` 与配置账号一致，事件必须有 `message_id` 用于去重。不要绕过授权边界或冒用其他账号。

## 能力和版本

| 能力 | 默认 API 模式 | 高级 DSH 模式 |
|---|---|---|
| 文字聊天 | 实现并离线协议验收 | 保留原链路及离线回归 |
| 模型 provider 插件 | 实现并实测加载和回复 | 使用 DSH provider 配置 |
| OneBot v11 传输插件 | 实现 factory 接线 | 自有 OneBot adapter |
| 图片、表情、合并转发 | 未实现；不把占位符当图像 | 保留工具，依赖模型和可用网关动作 |
| 自动 ASR | unsupported | unsupported；需要实际音频获取和ASR provider |
| TTS | unsupported | 共享 TTS unsupported；可选现有语音库发送 |
| 移动端本地连接 | unsupported | unsupported |

API v1 只接入文本和 OneBot provider，**不会接受** `vision/asr/tts` 等尚未接线的 manifest 能力。后续实现这些功能需增加媒体归属/获取校验、标准消息对象、取消/超时、capability negotiation 和相应端到端测试，再发布新版本；预留计划不等于当前可用。

外部网关若变更协议，应增加新的 adapter 和协议 fixture；不猜客户端内存偏移，不扫描聊天数据库，不把本机安装路径写进公共代码。OneBot 扩展动作应返回明确 unsupported，不能把不支持动作当成账号掉线。DSH 版本变化用 `NodeApiClient` 封装协议，在一次性合成会话中验证订阅、模型回复和清理，不能仅用 `settings.describe` 证明模型能回答。
