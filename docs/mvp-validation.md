# Agent Bubble 0.1.0 MVP 验证

日期：2026-10-08。实施与测试在 Windows 上完成。模型为真实 `deepseek-flash`，使用本地 `.env` 中的 key；没有把 key 写进源码或安装包。安卓验证包括 Android 15 / API 35、AOSP x86_64 模拟器，以及用户的 Redmi K60（系统型号 23013RK75C，Android 15 / API 35、HyperOS 3.0）真机。

## 交付范围

原生安卓分享入口、可拖动悬浮球 / 浮窗、交办、最近任务、结果与追问、正文 / 字幕文件选择、结果分享；Node 后台使用完整 Pi SDK、SQLite 与来源 / 结果文件。后台绑定 `127.0.0.1:8787`，手机连接步骤见 README。

没有新增云账号或购买服务器。运行后台的电脑需要保持运行；手机离开页面不影响已接收任务。

## 已完成的验证

| 验证 | 结果 | 证据 |
|---|---|---|
| TypeScript 编译 | 通过 | `npm run build` |
| 后台自动测试 | 30 / 30 通过 | `npm test`；`server/tests/` |
| 真实模型总结与追问 | 通过 | 12 人每天各 3 次，追问返回 36；`scripts/smoke-live.ts` |
| 关闭 / 重建后台后恢复模型会话 | 通过 | Pi 会话文件路径保持，重建服务后继续追问同一来源 |
| 真实公开网页正文 | 通过 | MDN DOM 页面经 Readability 提取 20,796 字符，真实模型生成中文摘要与来源链接 |
| 视频字幕总结 | 通过 | SRT 的 `[0:03]`、`[0:18]`、`[0:42]` 在结果中保留 |
| B 站真实链接工具调用 | 正确请求补充输入 | yt-dlp 成功返回元数据，但该测试视频未取得可用字幕；没有调用模型编造视频内容 |
| 安卓编译 / APK 打包 | 通过 | `assembleDebug`、`assembleDebugAndroidTest` |
| 安卓单元测试 | 1 / 1 通过 | `BubbleApiTest`：本地 / HTTPS 地址可用，拒绝嵌入凭据等无效地址 |
| 安卓设备测试 | 模拟器 2 / 2、真机 2 / 2 通过 | `ReadingFlowTest`：真实服务分享总结与追问、Activity 重建、浮窗服务启动；Keystore 与待发送记录保存 |
| 真机自动连接 | 1 / 1 通过 | `ConnectionSetupTest`：真实后台校验、Keystore 保存；退出测试进程后再次检查手机持久化地址为 8787 |
| Android Lint | 通过，无错误 | `lintDebug`；仍有 KTX 使用 / 平台配置等建议性警告 |
| 桌面浮窗交互 | 通过 | 回到系统桌面仍显示悬浮球，点击打开结果，软键盘开启后输入和发送可用 |
| 浮窗追问与收起取回 | 通过 | 浮窗发送 `12x3` 后收起，再打开看到真实后台结果 36 |
| Redmi K60 桌面浮窗与键盘 | 通过 | 回到桌面仍有悬浮球；浮窗追问输入框下边界 1894px，窗口可见范围下边界 1929px，软键盘弹出后输入与发送仍可见 |
| 真机日常后端总结 / 追问 | 通过 | 日常 8787 后端接收 147 字符测试正文并完成；同一会话接收用户追问并完成；浮窗前台服务在桌面保持运行 |
| 桌面网页客户端 | 通过 | Playwright 验证连接、实际结果、来源切换和桌面 / 手机宽度，无页面 JS 错误或水平溢出 |
| 凭据打包检查 | 通过 | `scripts/audit-secrets.py` 检查分发源码与 APK 解压后的全部条目，不含模型 key 或本地连接 token |

后台自动测试中的 Agent 使用测试实现，用来控制执行时间与取消；真实模型能力另由 live 测试和安卓设备测试验证。本轮文章获取、错误分类与完整性检查的详细记录见 [文章工作流验收](article-workflow-validation.md)。

2026-10-09 新增可反复使用的网站登录 / 验证入口、队列暂停与恢复。实际登录后的知乎访问结果和退出机制见 [浏览器登录验收](browser-login-validation.md)。

后台测试覆盖：未授权请求、参数校验、收到回执后的客户端断开、稳定 ID 去重与冲突、重启后结果 / 队列保留、同会话顺序执行、运行 / 排队任务取消、缺字幕前置停止、同会话补充字幕并保留原始链接、正文抽取、字幕解析与错误凭据隐藏。

真实 API 报告保存在被忽略的 `data-smoke/live-test-report.json`。其中含摘要与各次调用用量，不含凭据。Android 测试使用隔离的 `data/android-test/` 和回环端口 8788，不污染实际使用的会话。

## 实际修复的问题

- 分享 Intent 处理一次，Activity 重建保留正在阅读的会话；后续分享走 `onNewIntent`。
- 浮窗场景启动分享结果的系统 chooser 使用正确的 Activity flag。
- 文件读取采用 Android 8 可用的有界流读取，拒绝过大的输入。
- 浮窗键盘开启时，WindowManager 避让 IME，并按可见区域同步客户端高度，输入框与发送按钮保持可见。依据 [Android WindowManager.LayoutParams](https://developer.android.com/reference/android/view/WindowManager.LayoutParams) 的窗口 inset 接口，实际效果另以模拟器软键盘验证。
- 待发送任务写入本地失败时停止发送；网络重试复用已保存的请求 ID。
- 极快完成的已接收任务仍进入结果通知检测，不要求客户端先观察到一次“处理中”。

截图位于 `artifacts/screenshots/`：`android-bubble-home.png`、`android-floating-result.png`、`android-floating-keyboard.png` 和网页验证截图。APK 位于 `artifacts/agent-bubble-0.1.0-debug.apk`。

真机截图为 `phone-app-result.png`、`phone-floating-keyboard.png`；后者只保留本应用浮窗区域。此次没有修改主 APK 的产品代码，增加了 USB 检查与自动连接脚本，以及调试伴随包中的连接测试。

真机自动配置最初在内存中校验成功，但测试进程立即退出后仍恢复旧地址。连接测试现等待同步 `commit()` 完成，再由电脑读取手机持久化文件确认地址；模型 key 不进入手机，凭据不输出到日志。依据 [SharedPreferences.Editor 官方文档](https://developer.android.com/reference/android/content/SharedPreferences.Editor)，`commit()` 会等待未完成的 `apply()` 写入。

## 本次未覆盖的情况

- 已测试用户给出的五篇文章：36 氪两篇、公众号一篇、知乎两篇均已取得正文并完成真实总结 / 同会话追问；知乎通过独立 Electron 适配器修复，详见文章验收记录。这些样本不能代表全平台成功率。没有配置用户 B 站 Cookie 验证登录字幕，不能据此承诺所有 B 站视频都可自动总结。
- 已加入动态网页浏览器抓取；没有音频 ASR、视频画面理解和手机通用自动操作。
- Pi 自动上下文压缩已启用；本次短会话没有触发接近模型上下文上限的压缩测试。
- 真机覆盖了安装、USB 连接、分享、总结与追问、页面重建、桌面浮窗和键盘；尚未覆盖锁屏长时间待机、厂商省电清理或重启手机。通知权限与浮窗前台服务已确认，未独立核验结果通知的展示；未接 FCM 等云推送。

## 复现安卓设备测试

先构建 `assembleDebug assembleDebugAndroidTest`，启动自己的模拟器。可用 `node scripts/install-emulator.mjs` 安装项目内的官方模拟器和 Android 15 系统镜像；首次安装体积较大，可使用现成 Android Studio 模拟器代替。

启动隔离测试后台：

```powershell
node --env-file-if-exists=.env --import tsx scripts/serve-android-test.ts
```

另一个终端安装两份 APK，并在**选定的测试模拟器**上运行（将 `<测试设备>` 替换为 adb 设备序列号）：

```powershell
$taskAdb = '.\.tools\android-sdk\platform-tools\adb.exe'
& $taskAdb -s <测试设备> install -r android/app/build/outputs/apk/debug/app-debug.apk
& $taskAdb -s <测试设备> install -r android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
& $taskAdb -s <测试设备> shell appops set dev.agentbubble SYSTEM_ALERT_WINDOW allow
& $taskAdb -s <测试设备> shell pm grant dev.agentbubble android.permission.POST_NOTIFICATIONS
& $taskAdb -s <测试设备> shell am instrument -w -r -e serverUrl http://10.0.2.2:8788 -e connectionToken android-instrumentation-test-token-20261008 dev.agentbubble.test/androidx.test.runner.AndroidJUnitRunner
```

测试 token 只供该回环测试服务使用，不能用于连接实际后台。真实 UI 测试会产生少量模型 API 用量。

真实手机使用 `adb reverse tcp:8788 tcp:8788`，测试参数 `serverUrl` 改为 `http://127.0.0.1:8788`。本次 HyperOS 真机的测试页面启动需要用 ADB 协助发送匹配的 launcher Intent（`-a android.intent.action.MAIN -c android.intent.category.LAUNCHER -f 0x10008000 -n dev.agentbubble/.MainActivity`）；随后两个测试通过。测试结束后运行 `scripts/connect-phone.mjs` 恢复日常后端连接，关闭隔离测试服务并移除 8788 转发。
