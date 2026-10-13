# 手机无线连接：不需要 USB

本机私人 HTTPS 入口已配置并验证。手机日常通过 Tailscale 网络访问电脑，USB 只在安装调试或自动化测试时才可能使用。

## 第一次设置

1. 在手机安装 Tailscale。可以从 [Google Play](https://play.google.com/store/apps/details?id=com.tailscale.ipn) 安装；没有 Google Play 时，从 [官方安装包页面](https://pkgs.tailscale.com/stable/) 选择 Android 通用 APK，按手机系统提示允许安装。
2. 打开手机 Tailscale，登录电脑上同一个账号，允许系统 VPN 请求，开启连接。电脑端也需要保持 Tailscale 为已连接。
3. 在电脑双击桌面 `Agent Bubble → Backend status`，找到 `Phone server URL`。这是手机的服务地址。不要使用 `localUrl` 的 `127.0.0.1` 地址。
4. 打开手机 Agent Bubble，点右上角「连接设置」，把「服务地址」改为该完整 HTTPS 地址。「连接凭据」保持原值，然后点「连接」。地址没有 `:8787`，不需要填写 `/api`。
5. 连接成功后，分享文章或 B 站链接到 Agent Bubble，或用加号贴入链接交办。

如果连接凭据已经为空，可以在电脑运行项目的 `scripts/copy-connection-token.ps1`，把复制的服务凭据填写到自己的 Agent Bubble。它与模型 API key 不同；手机不需要 DeepSeek 或 Qwen key。

## 验证外出访问

拔掉 USB，在手机关闭 Wi-Fi、使用移动数据。保持手机 Tailscale 连接，再连接 Agent Bubble，提交一条链接，完成后继续追问。此步骤成功才说明外出路径已经通过验收。

目前电脑端已验证：私人 HTTPS 证书有效；不带服务凭据访问 `/api/health` 返回 401，带正确凭据返回 200。手机实际连接和移动数据验收需要在手机端完成。

## 未连接时怎么判断

- `Backend status` 中 `backendHealthy` 为 `false`：点 `Backend start`，等启动结果。冷启动可能超过一分钟，启动器会等待最多两分钟。
- 后台正常，但 Tailscale 是 `Stopped`：开启电脑 Tailscale，再检查手机 Tailscale 的连接状态和账号。
- 手机地址还是 `http://127.0.0.1:8787`：改为 `Phone server URL`，这个旧地址依赖 USB 调试转发。
- 想先确认网络：在手机浏览器打开服务地址后加 `/health`。返回 `status: ok` 就表示手机能访问主机；如果这一步能访问但应用不能连接，检查应用地址与连接凭据。

Tailscale Serve 的 HTTPS 服务访问范围是私人网络，参见 [官方 Serve 文档](https://tailscale.com/docs/reference/tailscale-cli/serve)。两端安装并登录同一网络的步骤见 [官方快速开始](https://tailscale.com/docs/how-to/quickstart)。
