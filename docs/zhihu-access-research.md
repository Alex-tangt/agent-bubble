# 知乎访问社区简查（2026-10-08）

后续更新（2026-10-09）：独立 Electron renderer 已接入，用户两篇原链接通过无预先缓存的真实 HTTP API 获取、总结与同会话追问。本文件保留早期排查结论，最新机制与首方案例见 [社区诊断](zhihu-community-diagnosis-2026-10-09.md)，正式证据见 [文章验收](article-workflow-validation.md)。

有现成解析器和会话复用方案，但本次没有找到能证明解除这两篇 `40362` 的通用修复。研究未测试其他访问入口，也未修改抓取程序。

- **错误有社区先例。** MediaCrawler 的 [issue #435](https://github.com/NanmiCoder/MediaCrawler/issues/435) 报告了同码异常；场景是搜索接口，不能直接推定专栏页原因，关闭状态也不能证明已有有效修复。
- **可借鉴正文解析。** [ShareXtract](https://github.com/wuaishare/sharextract#zhihu-public-answers-and-articles) 的专栏适配器解析页面 `js-initialData`，并声明支持匿名 SSR reader；项目仍标为 alpha，这些未文档化页面结构可能变化，README 不是实际成功率证据。可用作正常可访问页面的解析候选，不能据此宣称受限链接可读。
- **大框架不等于更可靠。** [MediaCrawler 知乎源码](https://github.com/NanmiCoder/MediaCrawler/blob/main/media_platform/zhihu/core.py) 已有登录、持久目录与文章详情流程，也包含 stealth 等额外机制。对单篇正文需求，整套接入成本偏高，这是工程判断。

建议先沿用现有 Playwright，在项目专用浏览器正常手动登录后复用会话；[官方文档](https://playwright.dev/docs/auth)支持此模式，但不能保证解除知乎限制。会话失效应明确提示重新登录。

若日常浏览器可读而后台仍不可读，可增加用户主动点击的“发送当前正文”入口，用 [Mozilla Readability](https://github.com/mozilla/readability#basic-usage) 从已加载页面提取正文，再交给现有总结流程；无需复制浏览器凭据。这是待实现的兜底，会增加一次点击。

验收必须使用用户原链接，核对完整正文、末段及后续对话；上述专用浏览器路径的两篇知乎仍未通过。验证码绕过、指纹隐匿和换 IP 不列入方案。

2026-10-09 补充实际证据：用户提供的 Codex 内置浏览器已正常打开第二篇原分享链接；工具读取到 3,150 字符正文，包含结论末段，现有 DOM 选择器命中。由此确认存在正常可读的浏览器路径，但尚未完成生产正文采集入口和该路径的总结 / 追问验收。不能再将专用 Chrome 的 403 泛化为文章不可抓取；也不能据此保证服务器仅凭 URL 就可自动读取。详见 [浏览器对照验证](browser-login-validation.md#2026-10-09内置浏览器可读的对照证据)。
