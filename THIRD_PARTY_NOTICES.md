# 第三方组件

本仓原创代码采用 MIT，第三方组件保留各自许可证。依赖通过包管理器安装，未将其源码整体复制到本仓。

| 组件 | 用途 | 许可证 / 原件 |
|---|---|---|
| Pi (`@earendil-works/pi-coding-agent`, `pi-ai`) | 模型会话、上下文管理、可选记忆工具 | MIT；安装包内 LICENSE |
| Mozilla Readability | 文章正文提取 | Apache-2.0；安装包内 LICENSE |
| jsdom / Fastify / Electron / Zod / TypeBox | DOM、HTTP、浏览器运行时和数据验证 | MIT；各安装包 LICENSE |
| Playwright | 浏览器采集 | Apache-2.0；安装包内 LICENSE |
| Gradle Wrapper | 安卓构建入口；仓库含脚本与 wrapper JAR | Apache-2.0；脚本原版权头和 [许可证全文](LICENSES/Apache-2.0.txt) |
| Kotlin / AndroidX / Jetpack Compose | 安卓客户端 | Apache-2.0；构建依赖中的许可证 |

yt-dlp、faster-whisper、PyAV 和模型文件为独立下载的可选工具，未随仓库分发。使用者应遵守各工具及模型的许可证；平台上的文章、视频和字幕不由本项目许可证授权。

项目以 AI 辅助方式实现与验证，并复用上述开源框架。产品入口、任务持久化、调度、来源校验和服务接入是本仓的应用代码；没有把 Pi、ASR 模型或浏览器框架称为自研。
