# 本机部署与外出连接

后端继续运行在这台 Windows 电脑上。手机负责入口与显示，抓取、字幕、转写调度、总结和会话都在电脑上处理。远程连接使用 Tailscale Serve：手机 → 私人 Tailscale 网络中的 HTTPS 地址 → 电脑上的 `127.0.0.1:8787`。DeepSeek 和 Qwen 仍由后端调用。

## 日常启动

首次部署或更新后，在项目目录运行 `npm run build`。日常可以直接双击这些文件：

- `scripts/backend-start.cmd`：在后台启动；同一服务重复启动会提示，不创建第二份。
- `scripts/backend-status.cmd`：检查后端健康状态和后台进程。
- `scripts/backend-stop.cmd`：关闭由启动器管理的后端，保留任务、结果和网站登录状态。

终端中也可以使用 `npm run host:start`、`npm run host:status`、`npm run host:stop`、`npm run host:logs`。日志放在 `DATA_DIR/host/logs/`，默认是 `data/host/logs/`，会过滤三种已配置的连接凭据。启动器在十分钟内最多重启五次；持续失败时停止重试，修正配置后先停止、再启动。

本机桌面已创建 `Agent Bubble` 文件夹，里面是 `Backend start`、`Backend status`、`Backend stop`、`Backend build`、`Open project folder`、手机连接指南和本指南的快捷方式，还有日常说明 `Readme.txt`。启动窗口显示结果后等待按键，关闭窗口不会停止后台。`Backend status` 同时显示电脑 Tailscale 状态与手机服务地址。需要重新生成时执行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backend-shortcuts.ps1`。

桌面目录原先只有快捷方式，在那里运行 `npm run build` 会因找不到 `package.json` 而失败。现在生成了命令代理，也可以直接在桌面目录运行 `npm run build`，它会转发到真实项目目录；不复制源码或依赖，桌面目录不用运行 `npm install`。平时使用后台不用重新构建。

如果此前用 `npm start` 或 `npm run dev` 启动过服务，启动器会检测到健康服务，但不会接管或停止该进程。先在原终端按 Ctrl+C，再使用新的启动方式。

## 登录 Windows 后自动启动

可选执行一次：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backend-startup.ps1
```

这会为当前用户创建 Windows 启动文件夹快捷方式。注销后重新登录时启动；不要求管理员权限，也不把后台放到 SYSTEM 账号下，便于网站浏览器继续使用当前用户会话。启动器最多等待 120 秒，期间显示进度，必须通过 HTTP 健康检查才报告启动成功。运行以下命令撤销：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backend-startup.ps1 -Remove
```

这是“登录后自启”。电脑重启后必须先登录一次；睡眠、关机、断网期间手机无法访问。外出期间让电脑保持开机联网，并在 Windows「设置 → 系统 → 电源」中根据自己的使用习惯设置睡眠时间；关闭屏幕或锁屏本身不会关闭后端。当前脚本不修改系统电源设置。

## 外出使用：一次性设置 Tailscale

1. 在电脑安装 [Tailscale Windows 客户端](https://tailscale.com/download/windows)，登录自己的账号。
2. 在手机安装 [Tailscale Android 客户端](https://tailscale.com/download/android)，登录同一个账号，按系统提示允许 VPN 连接。
3. 保持项目 `.env` 中 `HOST=127.0.0.1`，先启动本机后端。
4. 在项目目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/remote-access.ps1
```

底层命令是 `tailscale serve --bg --https=443 http://127.0.0.1:8787`。首次使用可能要求在 Tailscale 管理页面启用 HTTPS；按命令给出的账号链接完成后再执行脚本。此配置可能使用设备名申请公开可验证的证书，设备名会出现在证书透明度记录中；服务访问仍限于私人网络，详见 [官方 HTTPS 说明](https://tailscale.com/docs/how-to/set-up-https-certificates)。若电脑已有其他 Tailscale Serve 服务，请先检查 `tailscale serve status` 并选择不冲突的端口，不覆盖其他服务。

设置命令最多等待 60 秒；超时会退出，保留已登录的 Tailscale 客户端。完成页面操作后重新运行脚本即可，不需要让终端一直等待。手机如果没有 Google Play，可使用 [官方安装包服务器](https://pkgs.tailscale.com/stable/) 的 Android APK；直接安装版需要自己更新。

5. 命令会显示类似 `https://你的电脑.你的网络.ts.net` 的真实地址。打开手机 Agent Bubble 的连接设置，把「服务地址」改成这个完整 HTTPS 地址，不要填写示例，也不必添加 `:8787`。
6. 「连接凭据」沿用现有 Agent Bubble 凭据。需要重新填写时，在电脑执行 `scripts/copy-connection-token.ps1` 复制；凭据只粘到自己的 Agent Bubble，不要发到聊天。
7. 手机保持 Tailscale 已连接，关掉 Wi-Fi、使用移动数据，重新连接 Agent Bubble，提交一条链接并完成追问。这才算外出路径验收通过。

已通过 USB 连接且安装调试版时，也可以运行 `node scripts/set-phone-url.mjs <adb设备序列号> <真实HTTPS地址>` 更新地址。这个工具保留手机已加密的凭据，会关闭并重新打开 Agent Bubble；之后需要在应用内重新开启悬浮窗。普通日常使用不需要 USB。

Tailscale Serve 只提供给所在私人网络的设备，支持给本机 HTTP 服务代理 HTTPS，见 [官方 Serve 命令说明](https://tailscale.com/docs/reference/tailscale-cli/serve)。两端安装和加入同一网络的流程见 [官方快速开始](https://tailscale.com/docs/how-to/quickstart)。当前没有配置公网端口映射或 Tailscale Funnel。电脑已开启 Tailscale 无人值守模式，服务为自动启动；手机日常无需 USB。手机首次设置见 [无线连接指南](phone-wireless-setup.md)。

关闭本项目的远程 HTTPS 入口：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/remote-access.ps1 -Disable
```

这关闭该设备的 Serve HTTPS 443 入口；在设备上共享其他服务时应先确认配置。`host:stop` 只停止后端，Serve 配置继续保留，再次启动后端即可恢复。

## 保存与更新

文章浏览器登录态、B 站 Cookie、SQLite、来源缓存和会话都留在现有 `data/`；模型 key 留在现有 `.env`。不要把这些私人文件上传到仓库。

更新后端：先等正在处理的任务完成，再 `npm run host:stop` → `npm run build` → `npm run host:start`。备份时先停止后台，再一起复制 `.env` 和完整 `data/` 到私人备份目录，完成后重新启动。不要只复制运行中的 SQLite 主文件。

## 当前验收状态

启动器用独立临时数据库验证启动、重复启动、子进程崩溃恢复、正常停止及对其他启动方式不接管；不调用付费模型。远程路径必须在 Tailscale 两端安装、登录后用手机移动数据另行验证，不能用 USB 测试代替。
