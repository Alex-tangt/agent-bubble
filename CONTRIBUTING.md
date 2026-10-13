# 参与开发

欢迎通过 Issue 报告问题或提交 Pull Request。当前项目是个人阅读助手 MVP，优先改善来源获取、任务可靠性与浮窗体验。

## 开发与验证

后端需要 Node.js 24。执行 `npm ci`、`npm run build`、`npm test` 和 `npm run test:host`。自动化测试使用模拟模型与独立临时目录，不需要模型 key。需要使用真实模型或网站的验证脚本另见 README，运行前自行配置 `.env`。

安卓用 Android Studio 打开 `android/`，或配置 JDK 17、SDK 35 后用 Gradle Wrapper：

```sh
cd android
./gradlew assembleDebug testDebugUnitTest lintDebug
```

界面与任务状态改动请说明如何验证：回执前后、后台执行、重试、取消、键盘与历史恢复。抓取改动区分缓存命中、实际获取、登录状态与内容完整性。

## 提交要求

- 问题说明包含复现步骤、系统/版本、预期与实际结果。
- 不提交 `.env`、Cookie、模型 key、连接凭据、网站会话、私人笔记或设备标识。日志与截图先脱敏。
- 新机制注明复用的框架与自身实现；AI 辅助生成的代码仍需检查、验证，不把未完成的测试写成通过。
- PR 说明具体行为变化及验证结果。项目源码采用 MIT；第三方组件保留原许可证。
