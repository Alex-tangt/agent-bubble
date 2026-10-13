# 桌面启动与手机无线连接诊断

用户报告手机未连接、桌面启动窗口快速关闭，以及在桌面控制目录运行 `npm run build` 失败。

## 已复现与定位

- 本机后台实际运行，`/health` 返回 `status: ok`，鉴权后的 `/api/health` 也正常；后台从当日 08:55 启动，日志约 08:56 就绪。
- 在 `<desktop>/Agent Bubble` 执行 `npm run build` 复现 `ENOENT`，缺少该目录的 `package.json`。目录原本只有指向真实项目的快捷方式。
- 从同一目录执行原 `backend-start.cmd` 返回“Launcher already running”并以 0 退出。正常退出也会关闭双击弹出的窗口，不能据此判断后台失败。
- 日志记录一次冷启动需要 61,247ms，原启动器最多等待 60 秒，可能提前报告失败，后台却随后正常启动。
- Tailscale 为 `Stopped`，且未配置 Serve；原手机调试地址依赖 USB reverse，不能直接作为无线入口。本次未连接 ADB，未读取手机当前设置。

## 修复

- 桌面目录生成 `package.json` 命令代理，`npm run build` 转发到真实项目；新增 `Backend build`、`Open project folder`、`Phone connection guide` 与日常说明。
- 启动 / 停止窗口显示结果后等待按键；关闭启动窗口不会停止后台。
- 抽出实际启动等待逻辑，先增加复现 61 秒启动的失败测试，再将等待改为 120 秒。已有启动器也必须等待后台 HTTP 健康，不能只因 PID 存在就报告可用。
- 状态和启动命令同时显示 Tailscale 状态及手机实际应填写的 HTTPS 地址。
- 电脑 Tailscale 已恢复连接并开启无人值守模式。用户完成账号 Serve / HTTPS 启用后，配置 `serve --bg --https=443 http://127.0.0.1:8787`。没有配置 Funnel 或公网端口转发。

## 已通过验证

- 原桌面命令 `npm run build` 重新执行，退出码为 0。
- 实际启动批处理在输出成功后保持等待，发送回车后退出码为 0；后台仍正常运行。
- 四项启动等待回归测试通过，包含 61 秒冷启动、已有进程等待 HTTP 可用、失败状态和始终不可达的 HTTP。
- 独立启动器集成测试通过，含重复启动、故障恢复、正常停止及不接管无关进程。
- 私人 HTTPS 使用真实证书验证成功；未带服务凭据请求返回 401，正确凭据返回 200；确认 DeepSeek Flash、Qwen ASR 模型配置正常。
- 手机 Redmi K60 已在同一 Tailscale 网络在线；电脑收到手机的 Tailscale ping 回复，通过 Tokyo DERP 中继约 144ms。中继可用不等于必须建立直连。
- 这些无线网络检查时 ADB 没有连接设备，不依赖 USB reverse。
- 公共源码 / 文档凭据扫描通过，没有新增模型 key 或连接凭据。

手机应用实际连接、移动数据提交链接和后续追问仍需手机端验收，不能仅凭电脑 TLS 检查或手机在线就报告全部完成。

用户操作见 `docs/phone-wireless-setup.md` 和桌面控制目录的 `Readme.txt`。

> 开源副本说明：个人路径、设备标识或分享参数已脱敏；历史验收条件和未完成项按原日期保留。
