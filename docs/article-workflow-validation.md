# 文章工作流与真实链接验收

更新日期：2026-10-09。先独立验证后端，再进行手机联调。本轮没有修改 APK。用户提交链接和要求；程序负责获取、错误处理、缓存、任务 / 会话映射；模型只负责总结和后续交流。

## 当前结果

| 样本 | 获取正文 | 真实模型总结 + 同会话追问 |
|---|---|---|
| 知乎 `2071183687383771052` | 9,967 字符，标题与结尾检查通过 | 通过 |
| 知乎 `2091499653074371284` | 3,152 字符，标题与结尾检查通过 | 通过 |
| 36 氪 `4016577580208006` | 7,114 字符，结尾检查通过 | 通过 |
| 36 氪 `4013875644682372` | 4,747 字符，结尾检查通过 | 通过 |
| 公众号 `bb5MPl205ZMWu41v0nc63Q` | 3,937 字符，结尾检查通过 | 通过 |

三篇已取得正文的文章使用 `browser_readability`，通过真实 DeepSeek API 总结和同一 Pi 会话追问。报告：`data/article-validation/2026-10-08T14-51-29-499Z/report.json`。该运行未发生模型抓取工具调用。

2026-10-09 将独立 Electron 44.7.0 渲染器接入知乎后，`npm run test:articles -- --site=zhihu --llm` 两篇通过：`data/article-validation/2026-10-08T17-51-18-441Z/report.json`（目录时间为 UTC）。这次从原始 URL 自动获取、提取、缓存，校验准确标题及已知末段，再使用真实 DeepSeek 总结与同一 Pi session 追问；没有手贴正文，也没有依赖 Codex 内置浏览器或复制其会话。字符数来自规范化正文，与浏览器 `innerText` 的 10,164 / 3,150 不同。验收证明任务链路和来源完整性，不把有输出视为模型引用文字必然准确。

更新正在运行的本机服务后，又通过真实 HTTP `POST /api/tasks` 提交两篇完整原链接。两篇开始前的来源缓存均不存在，服务自行抓取正文后完成总结与追问；两组会话已在日常 `data/` 任务历史中，追问来源 ID 不变。报告 `data/zhihu-production-validation/2026-10-08T18-08-22-179Z/report.json`，两个 `priorSourceCached` 均为 false。当前服务 PID 记录位于 `data/backend.pid`，监听 `127.0.0.1:8787`；验收结束时无排队 / 执行中任务。

最终将 fixture 改为用户提供的完整分享链接（保留 `share_code` / `channel` 等参数），再次独立抓取五篇，结果仍为三篇通过、两篇知乎 `ACCESS_DENIED`：`data/article-validation/2026-10-08T15-09-43-588Z/report.json`。三个通过样本均命中预期结尾。

增加 36 氪运行时结尾检查后，两篇再次通过正文复测：`data/article-validation/2026-10-08T14-59-58-136Z/report.json`。这次公众号受整个抓取阶段 60 秒测试预算限制而超时；扩大独立抓取预算后再测通过，耗时约 61 秒：`data/article-validation/2026-10-08T15-04-31-945Z/report.json`。不能把一次通过当成长期成功率；公众号仍可能需要人工验证或遇到网络超时。

上述报告中，知乎专用可见 Chrome 与自动读取均返回站点 40362；用户日常 Chrome / Edge 与专用 profile 的会话不同。关闭登录建议弹窗只在页面已经提供正文时有用。社区方案见 [知乎访问社区简查](zhihu-access-research.md)。

2026-10-09 的内置浏览器对照是找到修复路径的起点：第二篇正常可读，现有选择器命中 3,150 字符。随后独立 Electron 原型在全新 profile 读取两篇 HTTP 200；正式适配器已完成上述两篇工作流验收。早期 Chrome 路径的失败记录仍保留作为对照。证据与边界见 [浏览器登录验证](browser-login-validation.md) 与 [社区诊断](zhihu-community-diagnosis-2026-10-09.md)。

## 程序执行边界

1. 保存任务回执，后台按顺序执行，与手机连接生命周期分开。
2. HTTP 获取 HTML，使用站点容器或 Mozilla Readability 提取正文；临时连接失败 / 超时有限重试一次。
3. 需要动态页面时，知乎使用独立 Electron worker，其他站点使用 Playwright；等待正文稳定，再提取。两个引擎各自使用项目持久目录。
4. 检查正文并缓存全文、标题、URL、取得时间和方法。失败停止在模型调用之前，保存 `error` 与 `errorCode`。
5. 把全文 JSON 与用户要求交给 Pi。当前 `tools: []`，模型不决定爬虫、浏览器或重试步骤。
6. 同会话追问使用已保存来源与 Pi session；中断 / 失败可在原会话重试。

平台正文容器检查、正文稳定等待和已知结尾断言能发现本轮遇到的半篇问题。它们属于实用校验，不能证明任意网页都完整。36 氪 `.article-content` 当前要求提供平台声明结尾；页面结构变化时可能返回 `CONTENT_INCOMPLETE`，需要维护适配器。

Playwright 复用 [浏览器渲染与网络控制](https://playwright.dev/docs/network)，Mozilla Readability 负责 [正文提取](https://github.com/mozilla/readability#basic-usage)；没有另建 AI 浏览器或通用抓取框架。项目浏览器不会加载用户日常 Chrome profile；模型 key 与服务 token 从其子进程环境移除。

## 复现与验证

```powershell
npm run build
npm test
npm run test:articles                    # 五篇正文，无模型调用
npm run test:articles -- --site=wechat    # 指定平台
npm run test:articles -- --llm            # 正文通过才执行真实总结与追问
npm run test:live                        # 真实模型、服务重建后追问、字幕时间点、公开网页
```

文章测试使用独立来源 / 任务目录，但复用专用浏览器 profile。运行前先停止已使用此 profile 的后台 / 配置窗口。报告与会话均在被忽略的 `data/` 下；`--llm` 和 `test:live` 会产生模型 API 用量。独立正文抓取最多等待 `min(MAX_RUN_MS, 180000)` 毫秒，线上任务总预算默认五分钟。

当前 TypeScript 编译通过，后台自动测试 30 / 30 通过，覆盖正文保留、动态页面回退、半篇拒绝、访问验证前置停止、限流停止、有限重试与取消、错误持久化、原会话继续、登录与队列恢复，以及 Electron worker 通信、取消、崩溃恢复和凭据隔离。模型总结链路另由真实 API 测试验证。

同步总结规则后，2026-10-08 15:06 UTC 的 `test:live` 再次通过：正文总结、关闭并重建后台后恢复同一 Pi 会话（12 × 3 = 36）、字幕时间点总结，以及 20,796 字符公开网页总结。证据为 `data-smoke/live-test-report.json`。

站点要求正常登录或验证时，停止后台后运行 `npm run browser:setup`，知乎登录页用 `npm run browser:setup -- --zhihu`。用户自行操作后关闭整个窗口，后台再复用该 profile。此过程不能保证解除站点限制；不可读时仍需明确反馈或补充正文。

## 下一阶段

知乎后端原链接工作流已通过，可进行手机分享链接的联调。视频工作流按已明确需求采用“平台字幕 → 无字幕时音频转写 → 总结与追问”；音频下载与 ASR 尚未实现，本轮没有修改 B 站抓取逻辑。
