# 蓝色大肥鱼：从一条 QQ 消息读代码

大肥鱼有两个入口。先确认你在维护哪一个：`npm start` 运行默认 API 版，`npm run start:advanced` 运行 DSH 版。修改默认版的提示词或模型插件，不会改到高级版。

| 想看或改什么 | 从这里读 | 验证方法 |
| --- | --- | --- |
| 默认版怎样启动、读取配置、打开面板 | [命令入口](../src/main.mjs) → [配置与校验](../src/template/config.mjs) → [本机面板](../src/template/panel.mjs) | 用 `npm run panel` 查看配置；此命令不会连接 QQ |
| 网关有事件，机器人为什么没接话 | [OneBot 客户端](../src/onebot-client.mjs) → [ChatRuntime](../src/template/runtime.mjs) 的 `authorized`、`handle` | 在[默认模板测试](../test/template.test.mjs)看账号不符、授权目标和重复事件用例 |
| 想换模型、接自己的文本服务 | [内置模型](../src/template/model.mjs)、[插件加载](../src/template/plugins.mjs)、[可运行的回显示例](../extensions/example-model.mjs) | 按[扩展说明](EXTENSIONS.md)注册；上面的模板测试包含真实插件经过 Mock 传输产生回复的用例 |
| 想改 DSH 的工具或群聊行为 | [高级部署说明](ADVANCED_DSH.md) → [桥接入口](../src/bridge.js) 与 [DSH 客户端](../src/dsh-client.js) | 用完整依赖运行 `npm test`；离线测试不登录 DSH，也不证明你的网关支持每项动作 |

**读一遍完整链路：** 在默认模板测试中搜索 `loopback HTTP model and OneBot transport`，可以看到本机 HTTP 模型和 WebSocket 网关如何同时参与一次收发。需要读消息格式时从这个固定输入往回找，不用采集真实聊天。
