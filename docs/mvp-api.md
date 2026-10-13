# MVP 接口与执行约定

服务由个人使用，`/api/*` 使用 `Authorization: Bearer <AGENT_BUBBLE_TOKEN>`。手机只传连接凭据，模型 key 留在服务器。默认地址 `http://127.0.0.1:8787`；USB 手机可用 adb reverse，模拟器使用 `10.0.2.2`。

## 提交与追问

`POST /api/tasks`，首次提交：

```json
{
  "clientRequestId": "a-new-stable-uuid",
  "message": "总结关键观点，保留时间点",
  "source": {
    "kind": "url",
    "value": "分享文案中的 https://www.bilibili.com/video/..."
  }
}
```

`source.kind` 为 `url`、`text` 或 `transcript`。正文 / 字幕可选 `title`。链接分享文案上限 12,000 字符；正文 / 字幕上限 300,000 字符；任务指令上限 6,000 字符。

手机先保存本次 payload 与 `clientRequestId`，再发请求。网络异常时重发完全相同的 payload；同 ID 不重复创建任务。修改任务内容时使用新 ID。服务保存 SQLite 事务后返回 `202` 和 Task；重复请求返回 `200` 和原 Task；同 ID 不同内容返回 `409`。

原会话追问：

```json
{
  "clientRequestId": "another-stable-uuid",
  "conversationId": "the-conversation-uuid",
  "message": "这里的结论有什么前提？"
}
```

取不到来源时可以在相同 `conversationId` 下提交 `source` 补充正文 / 字幕。已有可用来源的会话不接受替换来源；新的来源创建新会话。补充内容会保留先前分享的来源链接，并明确总结依据来自用户补充。

## 查询与操作

| 接口 | 返回 / 行为 |
|---|---|
| `GET /health` | 无凭据的基本存活状态与版本 |
| `GET /api/health` | 校验凭据；返回模型名称与版本 |
| `GET /api/conversations` | 最近 100 个会话，每项有 `latestTask` |
| `GET /api/conversations/:id` | 来源元信息、按顺序排列的任务 / 回答 |
| `GET /api/tasks/:id` | 状态、进度、最终结果、错误、用量、来源元信息 |
| `POST /api/tasks/:id/cancel` | 停止当前或排队任务，保留其他结果 |
| `GET /api/tasks/:id/result.md` | 已完成结果的 Markdown 下载 |
| `GET /api/tasks/:id/events` | SSE 关键事件与即时文本增量，支持 `Last-Event-ID` |
| `GET /api/sources/:id` | 已取得的正文 / 字幕全文，仅持有效连接凭据可读 |
| `GET /api/article-browser/login` | 浏览器登录窗口状态、是否启用、队列是否等待登录 |
| `POST /api/article-browser/login` | `{ "site": "zhihu" 或 "wechat" }`；在后台主机打开专用登录 / 验证窗口 |
| `POST /api/article-browser/login/finish` | 保存并关闭窗口，恢复队列；也可以直接关闭原生浏览器窗口 |

安卓首版轮询状态，每 4 秒刷新一次；没有可见 App 或浮窗时停止轮询。服务不会因为 HTTP / SSE 客户端断开而取消任务。会话 API 不暴露 Pi 会话文件路径或原始上传内容；需要全文可读来源接口。

## 任务状态

`queued` → `running` → `completed / needs_input / failed / cancelled / interrupted`。

- `needs_input`：未得到有效正文 / 字幕，在调用模型前停止，用户可补充输入。
- `failed`：模型、网络或执行失败；可以在原会话提交新的重试任务。
- `cancelled`：用户停止本次处理。
- `interrupted`：后台服务停止 / 重启时正在执行，提示原会话重试。

Task 增加可空的 `errorCode`，旧客户端可继续使用 `error` 文案。访问限制为 `ACCESS_DENIED`，要求登录为 `AUTH_REQUIRED`，访问验证为 `VERIFICATION_REQUIRED`，没有正文为 `CONTENT_UNAVAILABLE`；这些情况在调用模型前进入 `needs_input`。`HTTP_TRANSIENT`、`FETCH_TIMEOUT`、`RATE_LIMITED`、`READER_UNAVAILABLE`、`CONTENT_INCOMPLETE` 为可在原会话重试的 `failed`；任务总超时为 `RUN_TIMEOUT`。HTTP 临时连接失败 / 超时自动重试一次，限流不自动重试，也不切换浏览器重复请求。

登录窗口状态为 `idle / opening / waiting / closing`，仅描述窗口生命周期。`lastClosedAt` 不代表登录成功或站点会话有效期；有效访问在实际抓取时验证，站点要求重新登录时保留原会话并等待补充 / 重试。任务与会话详情增加 `loginSite`（`zhihu / wechat / null`），供客户端显示重新登录入口，仍不公开原始输入或 Cookie。

登录接口需相同连接凭据，只接受已知站点枚举。执行中的任务会使打开登录请求返回 `409 TASKS_BUSY`；不会中断当前任务。窗口打开期间新任务仍持久接收，执行队列暂停；关闭窗口或调用 finish 自动恢复，打开失败也会恢复。重复打开返回现有窗口状态。该接口用于个人主机的可见浏览器；没有图形会话的服务器需要另行设计人工验证入口。安卓本轮未新增重登按钮，可继续原会话重试，网页登录入口可在桌面客户端使用。

文章按 HTTP 抽取 → 必要时浏览器渲染 → 完整性检查 → 来源缓存 → Pi 总结执行；已有来源的追问直接使用缓存。模型没有抓取工具，收到的是来源全文。正文稳定性与平台结尾标记是实用校验，不能保证任意网页都已取得全文。

知乎默认 renderer 为独立 Electron worker（`ARTICLE_BROWSER_ZHIHU_ENGINE=electron`），其余文章保留 Playwright。来源方法仍为 `browser_readability`，安卓请求与响应契约不变。知乎登录 / finish 接口复用同一 Electron 持久会话；该 worker 需要主机有图形运行环境。模型 key、服务 token 与浏览器凭据不会发送给远程页面或进入模型来源。

已经接收但尚未执行的队列在服务重启后继续执行。正在执行的工具不会自动从任意一步续跑；已有来源缓存、模型会话与历史结果保留。首版串行执行，避免同时写同一个 Pi 会话。默认每次运行最多 5 分钟、12 次模型调用、每次回复最多 4,096 tokens。

关键状态与进度事件持久化；SSE 文本增量临时广播，重连以最终持久结果为准。Task 的 `usage` 来自 Pi 的实际模型响应，包含输入、输出和总 token 数，未估算费用。

## 目录职责

- `data/bubble.sqlite`：会话索引、任务与事件。
- `data/sources/*.json`：来源与带时间点字幕缓存。
- `data/results/*.md`：结果文件。
- `data/sessions/<conversationId>/*.jsonl`：Pi 管理的模型会话。
- `data/pi-config/`：隔离的 Pi 运行配置；模型 key 通过运行时注入。
- `data/article-browser/`：文章专用浏览器会话，可能含站点 Cookie；后台与配置窗口不能同时使用。
- `data/article-electron-browser/`：知乎独立 Electron 会话，可能含站点 Cookie；与 Playwright 目录隔离。
- `skills/summarize-article/`、`skills/summarize-video/`：总结与追问的方法。

备份整个 `data/` 可同时保留产品记录、来源与 Pi 会话。不要只备份 SQLite 后删除来源或会话文件。
