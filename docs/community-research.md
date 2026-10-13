# Android AI 悬浮窗社区方案核验

研究基准：2026-10-07，Asia/Shanghai。仅采用作者仓库、源码许可和官方文档；本轮未安装 APK、编译或真机测试。不用 stars 判断成熟度。动态主分支未取得截至日期的固定提交，以下能力是本轮读取到的源码/README 声明；有明确早于基准日的更新记录时单独注明，不把页面的“Latest”直接视为截至日期的最新版本。

## 推荐优先研究的五项

| 方案 | 类型与可复用部分 | 许可与实际限制 | 维护证据 |
| --- | --- | --- | --- |
| [Operit](https://github.com/AAswordman/Operit) | 完整 Android 原生 Agent；最接近目标。可参考悬浮窗/气泡入口、工具进度、权限选择、模型配置、MCP 和工作流。 | [主库 LGPL-3.0-only](https://github.com/AAswordman/Operit/blob/main/LICENSE)；工具和依赖另查。构建还需外部归档和 terminal 子模块，不能假设直接 fork 即可构建。 | README 明确 v1.12.0 为 2026-07-01；[发布页](https://github.com/AAswordman/Operit/releases)有后续修复，精确截至提交未核验。 |
| [DroidRun / Mobilerun](https://github.com/droidrun/droidrun) | Python/CLI Agent 加 Kotlin [Portal](https://github.com/droidrun/droidrun-portal)；可参考无障碍树、截图、手势和手机控制协议。Agent 主循环在电脑/服务器，Portal 不是完整原生任务助手。 | [框架 MIT](https://github.com/droidrun/mobilerun/blob/main/LICENSE)，[Portal AGPL-3.0-or-later](https://github.com/droidrun/mobilerun-portal/blob/main/LICENSE)，不可混写为全项目 MIT。当前 Portal 有 HTTP/WebSocket/反向连接；无障碍未就绪时，UI 树、手势和截图不可用。 | 原链接目前重定向为 Mobilerun；改名日期、截至日期提交和相关能力引入时间未核验。 |
| [Open-AutoGLM](https://github.com/zai-org/Open-AutoGLM) | 手机视觉 Agent 的 Python 框架；适合复用动作协议、截图→决策→执行循环和模型适配思路，先用实验机验证任务。 | [Apache-2.0](https://github.com/zai-org/Open-AutoGLM/blob/main/LICENSE)。官方[运行说明](https://github.com/zai-org/Open-AutoGLM/blob/main/README_en.md)依赖 ADB/HDC、调试授权和 ADB Keyboard；不是可直接嵌入 APK 的 SDK。模型服务及权重许可另查。 | 发布页未取得有效版本记录；截至日期精确维护情况未核验。 |
| [Shizuku / Shizuku-API](https://github.com/RikkaApps/Shizuku) | Android 特权执行层，不是 Agent；通过 Binder/UserService 让自身 Java/JNI 代码以 shell/root 身份运行。 | [管理器 Apache-2.0](https://github.com/RikkaApps/Shizuku/blob/master/LICENSE)，[客户端 API MIT](https://github.com/RikkaApps/Shizuku-API/blob/master/LICENSE)。无 root 时需每次重启后重新启动；Android 11+ 可用无线调试，ADB 权限仍有限。 | [官方 API 说明](https://github.com/RikkaApps/Shizuku-API)可核验启动条件；精确最新维护日期未核验。 |
| [LangGraph](https://github.com/langchain-ai/langgraph) | 服务器 Agent 编排；持久状态、故障恢复、人工中断适合长任务，手机作为任务入口及结果接收端。 | [MIT](https://github.com/langchain-ai/langgraph/blob/main/LICENSE)。不是 Android UI 控制库；持久化后端、队列、鉴权和通知仍需产品自己配置。 | 作者 README 列出 durable execution 和 human-in-the-loop；截至日期最新版本未核验。 |

Operit 的 README 也声明 PhoneAgent/AutoGLM 和 virtual displays，但要求相应权限及设备支持。可作为社区实验专项验证，不能直接宣传普通 APK 在任意机型上都能后台操作其他 App。普通第三方 APK 现有无障碍/ADB GUI 路线通常占用主屏；云端工具任务才适合作为首版“交办后继续用手机”的默认体验。

## 次级候选

| 方案 | 价值与边界 | 来源、许可和日期证据 |
| --- | --- | --- |
| Mobile-Agent / GUI-Owl | 比较 GUI 模型、多角色规划和记忆；官方手机部署为 Python + ADB/HDC，云手机能力也不等于控制本机 App。 | [项目 README](https://github.com/X-PLUG/MobileAgent)、[v3 运行说明](https://github.com/X-PLUG/MobileAgent/tree/main/Mobile-Agent-v3)；主库 MIT。中文 README 有 2026-02-14 模型发布和 2026-03-31 云手机更新记录；权重另查。 |
| UI-TARS | 参考移动动作模板、坐标解析及 GUI 模型；需要自建设备执行适配层。 | [作者仓库](https://github.com/bytedance/UI-TARS)明确 MOBILE_USE 模板与 2025-09-04 更新；代码/具体权重许可本轮未逐项核验，不列为直接集成基座。 |
| AutoJs6 | 参考确定性脚本、控件查找、OCR 和浮窗；可把高频任务做成受控工具，但不是现成 AI 规划器。 | [作者 README](https://github.com/SuperMonster003/AutoJs6)、[MPL-2.0](https://github.com/SuperMonster003/AutoJs6/blob/master/LICENSE)、[v6.7.0 发布于 2026-03-14](https://github.com/SuperMonster003/AutoJs6/releases)。 |

## 选型结论与未核验项

优先组合：参考 Operit 的移动交互，云端以 LangGraph 承担可恢复任务；手机 GUI 能力单独实验，对比 DroidRun 的树+截图路线和 AutoGLM 的视觉路线。Shizuku 作为明确需要授权的高级可选后端。若直接 fork 原生应用，先评估 LGPL；若复制 Portal，单独评估 AGPL。

技术可做与商店可分发需分别评估：[Google Play 无障碍政策](https://support.google.com/googleplay/android-developer/answer/10964491?hl=en)限制通过该 API 自主发起、规划和执行操作/决策；普通 Agent 的用户启动任务、一次确认或改用 Shizuku，不能视为自动满足审核。

未核验：各机型权限/省电杀进程、锁屏/安全页面、虚拟显示兼容、任务成功率与费用、国内应用风控、具体模型权重条款、依赖清单和可复现构建。查询 GitHub 精确提交时遇到 TLS 失败，后续网络审批被中断取消，因此没有据此给出“最新维护日期”断言。
