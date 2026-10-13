# 知乎程序获取：社区机制与本项目对照

调研日期：2026-10-09，Asia/Shanghai。范围是 `scripts/fixtures/articles.json` 中两篇原始专栏分享链接的自动获取。只阅读首方源码、Issue / PR 和官方浏览器文档；本调研不修改生产代码，不导出浏览器凭据。

## 当前结论

后续正式验收：独立 Electron adapter 已接入，TypeScript 编译和 30 项自动测试通过；两篇原链接通过真实模型总结与同一 Pi 会话追问。运行中本机服务的 HTTP API 也通过，两篇请求开始前均无来源缓存，结果已写入日常任务历史：`data/zhihu-production-validation/2026-10-08T18-08-22-179Z/report.json`。规范化正文分别为 9,967 / 3,152 字符，标题及已知末段匹配。实际网页登录窗口的打开 / 退出和队列恢复通过，取消 / worker 崩溃恢复已由协议回归测试覆盖。下文研究阶段的“待正式验收”描述保留为当时证据边界，当前完整记录见 [文章工作流验收](article-workflow-validation.md)。

本项目已有独立于 Codex 的可读程序路径：默认 Electron `BrowserWindow` 在全新项目目录中读取两篇原链接，均为 HTTP 200，得到标题及包含末段的正文，分别为 10,164 与 3,150 个可见字符。这是本项目实测，强于社区项目声称“支持知乎”。探针代码为 `.tools/electron-probe/main.cjs`；结果见 `data/zhihu-electron-probe/2026-10-08T17-34-42-483Z/report.json`，时间目录为 UTC。

探针使用 Electron 44.7.0 / Chromium 152.0.7977.130，`show:false`、`nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`、`webSecurity:true`；没有覆盖 UA、导入日常浏览器 Cookie 或使用 stealth。此前项目 Playwright Chrome（包括用户完成登录的 profile）、全新默认 Chrome / bundled Chromium / Edge 均未读到第一篇；同 profile 普通可见 Chrome 的两篇也被限制。用户提供的内置浏览器会话可读是找到这一对照的起点，相关历史见 [浏览器验证](browser-login-validation.md)。

证据支持“访问运行环境组合影响结果”，尚未隔离其中的引擎版本、请求头、启动方式、网络会话等因素。不能单独认定 UA、自动化标记、IP、无头模式或 Cookie 为根因。Electron 官方明确 `show:false` 的窗口初始页面可见性仍可能为 `visible`；隐藏窗口不能直接等同 Chrome headless。[官方页面可见性说明](https://www.electronjs.org/docs/latest/api/browser-window#page-visibility)

因此当前最直接的工程选择是把已验证的 Electron 渲染器做成知乎来源适配器，保留既有正文提取、任务状态、总结和同会话追问。探针通过还不能代表生产 API 全链路已通过，也不保证知乎今后或所有环境下持续放行。

## 社区的同码案例揭示了什么

| 首方证据 | 实际场景与机制 | 对本项目的适用范围 |
| --- | --- | --- |
| [fxzhihu PR #64](https://github.com/frostming/fxzhihu/pull/64)，2026-09-30，调研时 Open | 提交者报告专栏签名请求 `40362`；更新 Cookie 无效，同主机保持签名逻辑，用完整浏览器 UA 得 200，缩写 `Mozilla/5.0` 得 403；两篇文章的部署验证有全文长度记录 | 有对照的社区修复声明，尚未合并审核。本项目默认 Playwright Chrome 已有完整 UA，故不能照搬“换 UA 即修好”结论，也无需引入其签名路径 |
| [fxzhihu PR #65](https://github.com/frostming/fxzhihu/pull/65)，2026-10-06，调研时 Open | 回答请求 `40362`，文章和想法仍正常；提交者补齐请求头、Cookie 与路径签名后报告部署成功 | 同一错误码可发生在不同内容入口；回答接口的修复不是专栏 HTML 的验收 |
| [RSSHub Issue #20402](https://github.com/DIYgod/RSSHub/issues/20402)，2025-10-31，及其关联 [PR #22319](https://github.com/DIYgod/RSSHub/pull/22319) | 用户动态 API 即使配置 `__zse_ck` / `d_c0` / `z_c0` 也报 403；关联修改涉及在 JSDOM 中生成站点挑战 Cookie | Cookie 存在不等于可读；这是动态 API 和特定挑战实现，不是本文两篇链接的实测结果。本项目不接入挑战模拟 |
| [zhihu-download Issue #35](https://github.com/chenluda/zhihu-download/issues/35)，2025-08-29，Open | 专栏 HTML 下载出现 403；报告者只说明填了一个 SESSIONID，页面无已验证修复 | 同类下载器也会在获取阶段失败，不能用“成熟爬虫项目”代替原链接验收 |

上述是项目参与者的现场报告，不是知乎官方公开的访问判定规则。调研没有找到能把本项目 Playwright 与 Electron 差异唯一归因的首方证据。

## 可整合的代码机制

**专栏下载器与已加载页面采集是两种实现。** `chenluda/zhihu-download` 的 [Python 下载器](https://github.com/chenluda/zhihu-download/blob/0c4fa675ccdaadb6cf322620adb7a409282fbb1c/main_zhihu.py#L14) 使用 `requests.Session` 与配置 Cookie 获取 HTML；它不会自动获得日常浏览器的已加载 DOM。同仓库 [油猴脚本](https://github.com/chenluda/zhihu-download/blob/0c4fa675ccdaadb6cf322620adb7a409282fbb1c/tampermonkey.js#L225) 的单篇处理则直接读 `h1.Post-Title`、`div.Post-RichTextContainer`、作者、日期和当前 URL，再转 Markdown。后者能复用正常页面已完成的浏览器加载，但前提是该页已经可读，不会解除 403。

**通用剪藏器可以参考，当前无需更换解析库。** Obsidian 官方 Web Clipper 的 [内容脚本](https://github.com/obsidianmd/obsidian-clipper/blob/6d56d618b00bd970aa738d6a7a61edee27783e81/src/content.ts#L210) 从当前 `document` 运行 Defuddle，返回正文和元数据，有异步解析超时与同步回退。MarkDownload 的 [内容脚本](https://github.com/deathau/markdownload/blob/7e8cc1a2156a5b413db133677641c3f8a23cd39d/src/contentScript/contentScript.js#L6) 返回当前页面 HTML，[清单](https://github.com/deathau/markdownload/blob/7e8cc1a2156a5b413db133677641c3f8a23cd39d/src/manifest.json#L33) 包含 Readability / Turndown；但该脚本会修改页面、其清单仍为 MV2，不应整套复制为新 Chrome 扩展。本项目现有知乎正文选择器已命中全文，获取层适配比替换 Readability 更有依据。这一优先级属于工程判断。

**正常会话的采集桥接有官方机制。** Chrome 的 `activeTab` 加 `scripting` 支持用户点击扩展后读取当前页面；权限为临时授权，可将正文而非 Cookie 交给后台。它通常多一次点击，适合作为可读日常浏览器的补充入口，不应算作服务器只凭链接自动获取通过。[Chrome 官方说明](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) Chrome 136 起默认用户目录不接受常规远程调试开关；官方建议隔离专用目录，因此直接对接日常浏览器默认 profile 不是稳妥的复用设计。[Chrome 调试变更](https://developer.chrome.com/blog/remote-debugging-port)

## Electron 适配器的能力与边界

官方支持主进程创建浏览器窗口、加载 URL，再以 `webContents.executeJavaScript` 取得 DOM 计算结果；不必向远程页面开放 Node 或业务 IPC。该 API 会等待页面停止加载，`loadURL` 完成也不等于动态正文已经完整，应为正文等待、执行脚本和整个子进程均保留截止时间，并处理 `did-fail-load` / `render-process-gone`。[Electron webContents](https://www.electronjs.org/docs/latest/api/web-contents#contentsexecutejavascriptcode-usergesture)

需要正常登录时，可以使用独立持久 `persist:` session / 项目 `userData`，同一会话供登录窗口与采集窗口使用；浏览器关闭只证明生命周期结束，下一次实际获取才验证会话可用。`BrowserWindow.close()` 可受页面 `beforeunload` 阻止，取消 / 截止时应有 `destroy()` 或进程终止的可靠出口。[BrowserWindow 会话与关闭 API](https://www.electronjs.org/docs/latest/api/browser-window)

页面仅允许正常 HTTPS 站点访问；主进程和模型收到经过校验的标题、URL、正文，不收到 Cookie / 浏览器存储。远程页面保留沙箱、上下文隔离、同源策略，限制导航、弹窗、下载与权限；Electron / Chromium 更新后应重跑原链接验证，不能靠长期冻结旧引擎维持成功。[Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)

这仍是桌面后台主机上的浏览器 worker；迁移到 Linux / 无桌面云端需要重新验证依赖与运行环境，本文没有云端成功证据。安卓自有 WebView 是后续另一条需要实测的采集路径。官方允许 `loadUrl` 和启用 JavaScript，但说明系统浏览器不会与应用共享其数据；不能认为用户已登录 Chrome 就已登录应用 WebView，也不能直接向外部知乎页面暴露宽泛 `addJavascriptInterface`。[Android WebView 文档](https://developer.android.com/develop/ui/views/layout/webapps/webview)

## 三个直接可复现实验

1. **原链接独立 worker 验收。** 使用上述探针，两篇 fixture 保留完整分享参数；先复现全新目录的 HTTP 200、标题、正文长度和末段，再关闭进程、用正式适配器重开获取。输出只记录版本、状态、字符数、来源方法和文件路径。初始探针已通过；正式适配器重启验证仍需补齐。通过标准是取得完整来源，而非错误页、标题页或缓存旧正文。
2. **来源 → 总结 → 同会话追问。** 从正式 `POST /api/tasks` 提交两篇 URL，让程序自行启动采集；检查来源方法、全文末段、摘要，再以同一 `conversationId` 追问。此轮同时覆盖收据、任务完成、来源缓存和会话恢复，不用“手贴正文成功”代替 URL 工作流。相关可借鉴机制见专栏油猴源码与 Electron API，当前后台契约见 [MVP API](mvp-api.md)。
3. **失败与退出。** 在独立测试会话验证采集超时 / abort、worker 崩溃、正常登录窗口退出和重新采集；确认为有界错误、无遗留窗口、无重复模型调用。使用真实窗口时不自动替用户完成登录或验证；对于实际访问限制保留明确错误与重登入口。`executeJavaScript` 等待加载与 `close()` 可取消这一官方行为是必须覆盖的生命周期风险。

本文记录社区签名 / 挑战实现以判断证据边界，不把这些机制加入方案；本项目已经找到普通 Electron 页面加载的可读路径，应先验证它的完整工作流。
