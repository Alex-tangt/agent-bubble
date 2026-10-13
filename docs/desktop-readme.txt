Agent Bubble 日常使用

这里是控制入口，源码仍在 D:\path\to\agent-bubble。

1. Backend start：启动后台。窗口会显示结果并等待按键；关闭窗口不会停止后台。
2. Backend status：检查后台，以及电脑 Tailscale 状态和手机应填写的服务地址。
3. Backend stop：停止后台。历史记录和网站登录状态保留。
4. Backend build：修改程序后才需要构建；平时不用点。构建后若要加载更新，等任务结束再停止、启动后台。
5. Open project folder：打开真正的源码目录。
6. Phone connection guide：第一次设置手机无线连接的详细步骤。

手机日常不需要 USB。在手机 Tailscale 登录电脑同一个账号、允许 VPN 并连接；Agent Bubble 的服务地址使用 Backend status 显示的 Phone server URL，连接凭据保持原值。

不要使用手机里的 http://127.0.0.1:8787 作为日常无线地址，它指向手机本身；此前只有 USB 调试转发能让它连接电脑。

登录 Windows 后后台自动启动；电脑要保持开机联网。屏幕关闭或锁屏可以，关机、睡眠、断网期间不能访问。Tailscale 已设置无人值守模式。

如果习惯在此目录运行 npm run build，现在也能使用：命令会转发到真实项目目录。此目录不需要执行 npm install。
