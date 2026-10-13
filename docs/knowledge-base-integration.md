# 共享知识库接入

Agent Bubble 的 pi 后端通过本机 memory-base 网关提供 `memory_search`、`memory_get`、`memory_add`。实际 pi 会话只启用这三个自定义工具；没有文件系统、命令行、覆盖或删除工具。

## 本机配置

先在知识库部署 CLI 注册 `agent-bubble` 写入身份，再在 Bubble `.env` 设置非密钥配置：

```dotenv
MEMORY_BASE_URL=http://127.0.0.1:8788
MEMORY_BASE_PYTHON=<knowledge-base deployment.json 中的 python>
MEMORY_BASE_HOME=<memory-base-home>
```

launcher 调用 `python -m memory_base host-token --profile agent-bubble`，只把返回凭据放到后台进程环境。直接运行 `npm run dev` / `npm start` 时客户端也可调用同一凭据提供器。不要把 token 写入 `.env`、日志、报告或 pi 提示。媒体和浏览器子进程会剥除 `MEMORY_BASE_TOKEN`。

`MEMORY_BASE_URL` 为空时接入关闭。`GET /api/health` 的 `memoryBase.enabled` 仅表示已配置，不代表远端可用；网络、身份或协议失败均明确报错，不返回空结果冒充无命中。

## 保存、读取和重试

每个新会话的首个成功回复作为文章或视频总结，由程序在结果落到本机 `results/<task-id>.md` 后原样提交知识库。保存不交给模型决定，也不改写生成结果。已存在成功回复的会话，其普通追问不会再自动保存；用户明确要求保存笔记时，pi 可使用 `memory_add`。网页、字幕及知识库正文中的命令不能授予笔记写入权限。

任务的 `memorySave` 持久保存以下状态：

- `saving`：正在保存，保留稳定 `requestId`。
- `saved`：返回 `uri`、`contentHash` 和 `savedAt`，校验正文 SHA-256 后才确认。
- `failed`：本机总结仍可下载，显示错误与重试；远端已提交而响应丢失时使用同一 requestId 重试。

总结生成成功仍为 `status=completed`，保存失败时 `progress=总结已完成，知识库保存失败，可重试`，旧客户端也能读取该提示。Web 显示保存 URI 或保存失败及重试按钮。重试使用带 Bubble 原有 Bearer 的 `POST /api/tasks/<id>/memory/retry`，请求体 `{}`，返回更新的 Task。已保存任务再次重试直接返回，无新增写入；普通追问没有自动保存请求，返回 409。重试不重新调用模型。

`memory_tool` 任务事件只记录工具名，供验收确认真实 pi 调用了检索和读取。具体原文保留于知识库与原有 pi session，事件不再复制正文或凭据。

## 检查

```powershell
npm run build
npm test
npm run test:host
```

实际接入完成后，Lead 在管理的后台运行时执行：

```powershell
node --env-file-if-exists=.env --import tsx scripts/smoke-memory-live.ts
```

该脚本定向复用已有真实文章、视频的原始 URL 输入和缓存，只创建两个新总结以及一条跨来源知识库读取追问；核对原样保存、稳定重试 URI、pi 实际工具调用和历史来源文件未改动。报告写入 `data/knowledge-base-acceptance/<时间>/report.json`，不批量回填历史私有总结。

> 开源副本说明：个人路径、设备标识或分享参数已脱敏；历史验收条件和未完成项按原日期保留。
