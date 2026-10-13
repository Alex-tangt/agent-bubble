# Pi 作为自用 Personal Agent 内核

核验日期：2026-10-08。Pi 按 `badlogic/pi-mono` 理解；若指其他同名产品，结论不适用。旧官方地址本轮重定向到 [earendil-works/pi](https://github.com/badlogic/pi-mono)，当前文档包名是 `@earendil-works/*`。未固定历史提交；实施应锁定版本，并按该版本类型声明核对 API。

**建议复用 `pi-coding-agent` 的 SDK 或 RPC。** 名称虽偏编程，工具和提示可替换，能直接继承会话与压缩机制，符合“不自建 harness”的要求。

| 层 | 已核验能力 | 本项目取舍 |
| --- | --- | --- |
| [pi-agent-core](https://github.com/earendil-works/pi/tree/main/packages/agent) | 有状态 Agent、工具循环、流式事件、取消、steering/follow-up、上下文变换钩子；SQLite 会话后端是独立包。 | 更底层，需要自行组合产品所需服务，首版没有必要从这里起步。 |
| [pi-coding-agent SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md) | Node.js/Bun 进程内 `createAgentSession()`；管理会话、模型、工具、资源、压缩和扩展；可订阅事件、prompt/abort。 | 在个人电脑/小服务器运行，安卓通过薄网关提交内容、接收结果。 |
| [RPC](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md) | `pi --mode rpc` 为长驻子进程；stdin/stdout 使用 JSONL 命令、响应及事件。 | 适合非 TypeScript 网关或进程隔离；RPC 本身不是 HTTP 服务。 |

会话默认持久化为 JSONL 树，保存完整历史和分支；[官方示例](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/11-sessions.ts)提供 `SessionManager.create/open/continueRecent/list`。可恢复聊天，不代表下载、转写等工具在进程崩溃后自动从中间继续；网关仍需保存任务与 session 的对应关系。

[自动压缩](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md)在接近上下文上限时生成旧消息摘要，保留近期内容，并有溢出恢复；原记录仍在会话文件。压缩有损，关键原文、字幕、时间戳和最终产物应另存，避免把长期资料只寄托于摘要。

[Skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)是按需加载的 `SKILL.md` 与参考资源，适合定义总结格式；[Extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)是可执行 TypeScript，可注册工具、命令和事件处理。SDK 也允许自定义及限定工具。首版只接“读取文章正文、读取/获取字幕、必要时转写、保存结果”；内容采集仍要实现或接现有服务，Pi 不会自动取得当前 App 的完整文章或视频。

[模型说明](https://github.com/earendil-works/pi/tree/main/packages/coding-agent#providers--models)覆盖 OpenAI、Anthropic、Google、DeepSeek、OpenRouter 等，兼容接口可配置自定义模型；是否支持图片、工具调用和费用取决于具体模型。不要把供应商选择能力等同于全部模型都能直接总结视频。

自用优势是现成会话、压缩、扩展和多供应商，软件为 [MIT](https://github.com/earendil-works/pi/blob/main/LICENSE)。集成工作集中在 Android 分享/浮窗、薄网关与内容工具；无需重写工具循环。代价是额外 Node 运行环境与个人服务维护。默认工具含文件写入和 shell，Pi 以启动用户权限运行；只做总结可用工具白名单替换默认能力。[主 README](https://github.com/earendil-works/pi#permissions--containerization)

官方支持 [Termux Android 运行](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/termux.md)，但这不等于原生 APK SDK，也未验证锁屏保活。优先把 Pi 放个人电脑/服务器；若必须全手机运行，再做 Termux 桥接实验。SDK/RPC 的会话内消息排队也不是已经部署好的可靠后台任务队列。本轮没有运行 SDK、真机或媒体采集测试。
