# Attribution and third-party boundaries

The advanced QQ/DSH bridge, console, presets and regression harness derive from
[Derpyu520/qq-bridge](https://github.com/Derpyu520/qq-bridge), MIT licensed.
The original copyright notice is retained in LICENSE. This template adds a modular
default runtime, a provider plugin contract and a public-protocol OneBot client.

The OneBot v11 adapter in `src/onebot-client.mjs` is independently implemented from
the [public protocol](https://github.com/botuniverse/onebot-11/blob/master/communication/ws.md).
It does not contain gateway binaries, upstream SDK source or gateway tool-catalog snapshots.
The project neither installs nor starts SnowLuma, QQ or any other third-party gateway.
`fetch_custom_face` and some advanced media actions are explicitly optional gateway
extensions, not requirements guaranteed by OneBot v11.

SnowLuma and its SDK/MCP packages are not included as dependencies. Users choosing
any external gateway must obtain and run it separately under its own terms.
The MIT license here does not grant rights to those products or QQ itself.

Declared npm dependencies retain their own notices and licenses in their packages.
`@deepseek-ai/dsh-host-apiproxy` and `@deepseek-ai/schemastery` support the optional
advanced adapter; `@modelcontextprotocol/sdk`, `js-yaml`, `zod` and `ws` supply
protocol, configuration and validation utilities. No account tokens, personal
chat history, voice assets or private persona relationships are distributed.
