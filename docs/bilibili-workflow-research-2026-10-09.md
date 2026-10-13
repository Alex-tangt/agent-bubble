# B 站视频工作流调研

调研日期：2026-10-09。范围是自用 Android 入口 + Windows 电脑后端，沿用 Node.js / TypeScript、Pi 和 DeepSeek；程序负责获取内容、状态、取消、缓存和报错，模型负责对已有文本进行总结与追问。本文记录调研与只读元数据探测，不代表音频下载、真实 ASR 或手机联调已经通过。

## 建议采用的最小方案

`链接 → 确定 BV / 当前 P → 读取平台字幕 → 无可用字幕时获取公开音轨 → 固定 ASR 程序 → 保存带时间戳的转写 → 现有总结 / 原会话追问`

继续使用 yt-dlp 获取视频元数据和音轨，以独立 Python 子进程接入 faster-whisper，暂定多语言 `small`、CPU、`int8`。这项选择是结合本机硬件与现有 Python 环境的工程判断，需要真实中文样例验证识别质量与时间。ASR 本身是专用模型推理，执行方式是固定程序；不需要 LLM 自行决定爬取步骤或操作下载工具。

默认执行字幕优先。字幕确实缺失、匿名不可见、字幕请求失败必须分别记录；只要完整音轨可以正常取得，就可以自动改走 ASR，并向用户展示实际来源与降级原因。不能把“字幕需要登录”说成“这个视频没有字幕”，也不能把播放受限、付费试看或下载失败当成已取得完整音频。

## yt-dlp 的已确认行为与现有缺口

现有 `server/sources.ts` 的参数有 `--dump-single-json --skip-download`，没有开启字幕提取。yt-dlp 的 `InfoExtractor.extract_subtitles()` 只在 `writesubtitles` 或 `listsubtitles` 设置时调用站点字幕实现，因此现有命令可能根本没有请求 B 站字幕。应增加 `--write-subs --sub-langs all,-danmaku`，保持 JSON 模拟获取；采用 Python API 时则设置 `writesubtitles=True`，并明确不下载。[yt-dlp 通用字幕实现](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/common.py#L3599)

B 站 extractor 通过平台字幕接口获取列表，将可见字幕转换为内联 SRT，放在 `subtitles` 中。平台 `ai-zh`、`ai-en` 等自动字幕也可能位于这个字段，不能套用 YouTube 的 `automatic_captions` 判断方式。`danmaku` 是弹幕，必须排除。该 extractor 对 `need_login_subtitle` 会发出登录提示；当前代码与上游社区报告相互印证。[Bilibili extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/bilibili.py#L235)、[上游字幕分类问题 #14463](https://github.com/yt-dlp/yt-dlp/issues/14463)

建议固定字幕优先顺序：人工中文字幕 → `ai-zh` 等平台中文自动字幕 → 其他语言字幕；同时保留语言与字幕类型。实际取不到可解析文本再降级，不能只检查 JSON 中有没有字幕字段。

`?p=N` 是分 P 选择，必须保留。对多 P 视频，`--no-playlist` 配合未指定 P 的链接默认读取第一 P；明确指定 P 时只处理该 P。不要自动下载整套课程。合集、番剧、充电专属、互动分支与普通视频并非同一种结构，首版可以明确限定普通投稿单个 P。短链接先跟随重定向，再校验最终站点与 BV / P。[分 P 与互动视频解析代码](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/bilibili.py#L732)

模型 API key 与 B 站登录凭据无关。现有 `BILIBILI_COOKIES_FILE` 可以继续支持用户自行提供的专用 Cookie 文件；不需要读取或导出日常浏览器的全部 Cookie。匿名能取音频不保证能取字幕，登录能取字幕也不保证每个付费或地区受限视频能完整下载。[yt-dlp Cookie 说明](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp)

## 音轨下载和 FFmpeg

音频分支应显式选择 `-f bestaudio` 或经过限制的纯音轨格式，不能使用默认视频加音频选择。DASH `.m4a` 可直接交给 PyAV 解码；下载单独音轨不必先转成 WAV，也不必先下载画面。`-x --audio-format wav` 属于转码操作，会增加系统 FFmpeg 依赖。[yt-dlp 格式选择](https://github.com/yt-dlp/yt-dlp#format-selection)、[音频提取示例](https://github.com/yt-dlp/yt-dlp#embedding-yt-dlp)

音轨选择建议优先一般 AAC `.m4a`，避免为语音识别选择无损或杜比音轨；设置下载字节上限、当前 P 时长上限、网络超时和有限重试，取消时结束下载子进程。签名 CDN URL 与 Cookie 不应写入客户端结果、研究报告或一般日志。元数据中的音轨 URL 只证明平台当前返回过音轨信息，完整下载需要另行验证。

## ASR 框架比较

本机只读检查：AMD Ryzen 7 7735H，8 核 / 16 线程，约 27.7 GiB 内存，AMD 核显；已有 Python 3.12 和 yt-dlp 2026.08.19。当前没有 faster-whisper 和系统 FFmpeg。

| 方案 | 与当前环境的关系 | 首版取舍 |
|---|---|---|
| faster-whisper | Python 包、CTranslate2，可 CPU int8；PyAV 包含解码用 FFmpeg 库 | 推荐。已有 Python 子进程结构，直接接收 `.m4a`，不需要 CUDA |
| whisper.cpp | 支持 Windows 和 CPU，支持量化；标准 CLI 需要 16 位 WAV，也可选 Vulkan / CUDA 等构建 | 可作为后续可替换实现。首次需要挑选二进制 / 编译产物、模型和 WAV 转换方式 |
| 国内云 ASR | 专用服务凭据、网络调用、音频上传或可供服务获取的文件 URL | 保留提供者接口，但目前没有额外 ASR 服务凭据，不能假设 DeepSeek key 能用 |

上述能力依据 [faster-whisper 官方说明](https://github.com/SYSTRAN/faster-whisper#requirements)、[CPU 用法](https://github.com/SYSTRAN/faster-whisper#usage)、[whisper.cpp Windows 支持与 CLI 要求](https://github.com/ggml-org/whisper.cpp#quick-start)。CTranslate2 有 Windows x86-64 Python wheel，但需要 Visual C++ runtime；faster-whisper 官方 GPU 安装路线主要依赖 NVIDIA CUDA，本机不应按这个路线安装。[CTranslate2 安装说明](https://opennmt.net/CTranslate2/installation.html)

首次模型下载应作为明确的环境准备步骤，下载到项目专用缓存，允许重试与退出；不能让第一次普通视频任务在不明原因下长时间下载模型。faster-whisper 用模型名初始化时会从 Hugging Face 获取对应 CTranslate2 权重。优先使用多语言 `small`，不要用仅英文的 `small.en`。首次真实测试可以调小参数验证连通性，但正式结果需要验证完整转写。[模型下载行为](https://github.com/SYSTRAN/faster-whisper#model-conversion)

输出采用现有 `segments: {start, end, text}[]` 与 `[mm:ss] 文本`，不必先实现逐字对齐、说话人分离。开启 VAD 以减少静音段处理，保留模型返回的原音频时间；faster-whisper 已提供带时间戳的分段和 VAD。读取它返回的 generator 才会真正执行转写，子进程必须迭代完成并检查终态。[分段与 VAD](https://github.com/SYSTRAN/faster-whisper#usage)

长音频可以先交由框架的分段/VAD 处理；首版不用再自行搭建复杂分片队列。若未来增加显式切片，必须补回片段偏移并处理重叠，避免时间戳从零重置或丢失边界内容。现有默认任务总时限 5 分钟可能不足以覆盖 CPU 转写，需要为视频设置独立、可取消的总预算；实际速度必须在本机测量，不能拿官方另一台 CPU 的跑分当作承诺。

Whisper 可能产生误听、重复或未说出的文本，专业名词、方言、背景音乐需要重点抽查。因此结果应标注“音频转写”，总结引用时间点时提醒依据的是转写；不能把机器转写标成作者已校对字幕。[Whisper 模型局限](https://huggingface.co/openai/whisper-small#performance-and-limitations)

## 云 ASR 的可选路线与成本

阿里云百炼 Paraformer 文件转写提供异步任务 API：提交音频文件 URL、查询状态、获取带时间戳的结果。需要另行开通服务与 DashScope 凭据，音频文件通常还要有对象存储 URL 或临时上传地址；本机私有 `.m4a` 路径不能直接传给云端读取。[Paraformer HTTP API](https://help.aliyun.com/zh/model-studio/paraformer-recorded-speech-recognition-restful-api)

截至本次查询，北京地域 Paraformer 文件识别页面价格为每秒 0.00008 元，按此输入价计算为每小时 0.288 元；免费额度、地域与实际账单仍以账号为准。另需考虑存储、上传、网络与总结 token 费用。暂不自动开通付费服务。[百炼模型价格](https://help.aliyun.com/zh/model-studio/model-pricing)

本地方案没有逐秒 ASR API 账单，但有首次模型下载、磁盘缓存、CPU / 电力和等待时间成本。现有 DeepSeek 总结仍按原配置调用与计费，缓存转写可以避免追问时重复下载和识别。

## 2026-10-09 元数据实测

没有使用登录 Cookie，没有读取浏览器会话，没有下载音视频或模型。CLI 继承当前进程环境。以下只记录公开链接与必要元数据，不保存签名 CDN URL。

最小 CLI 参数：

```text
python -m yt_dlp --ignore-config --no-cache-dir --no-colors
  --skip-download --write-subs --sub-langs all,-danmaku
  --no-playlist --dump-single-json -f bestaudio
  --socket-timeout 15 --retries 1 --extractor-retries 1 -- URL
```

| 样例 | 本轮元数据 | 匿名字幕结果 | 音轨结果 |
|---|---|---|---|
| 用户：[`BV1t2HQ6EEaD?p=1`](https://www.bilibili.com/video/BV1t2HQ6EEaD/?p=1)，耗时两个月，烧掉 100 亿 Token，我终于把它开源了！ | 603.268 秒；平台页面列表仅 1 P | 仅 `danmaku`；报告字幕需要登录 | 3 条 `.m4a`，选择 `30280`；低码率估计约 4.94 MB |
| 用户：[`BV1jXHC6GEke?p=1`](https://www.bilibili.com/video/BV1jXHC6GEke/?p=1)，DeepSeek Harness 教程 | 当前 P 为 1438.92 秒；平台页面列表共 11 P；已明确选第 1 P | 仅 `danmaku`；报告字幕需要登录 | 3 条 `.m4a`，选择 `30280`；低码率估计约 11.90 MB |
| 开发短样例：[`BV1WkYMzaE7Q`](https://www.bilibili.com/video/BV1WkYMzaE7Q/)，我摸会鱼 | 73.498 秒 | 匿名仅 `danmaku`；上游报告登录时有 `ai-zh` / `ai-en`，本机未验证登录后字幕 | 3 条 `.m4a`，低码率估计约 0.60 MB |
| 备用：[`BV12N4y1M7rh`](https://www.bilibili.com/video/BV12N4y1M7rh)，联发科 / Arm 芯片科普 | 313.557 秒 | 匿名仅 `danmaku`；上游 extractor 自带用例明确注明字幕需登录 | 3 条 `.m4a`，低码率估计约 2.64 MB |

用户第二条“无字幕”是用户观察与待核验条件，本次匿名结果不能独立确认平台没有任何字幕；第一条用户可见字幕也没有在匿名后端中拿到。两条仍可用于验证“字幕不可用 → 尝试音轨 ASR”的完整路径。公开元数据页数来自 B 站 `/x/web-interface/view?bvid=...` 响应，均为 `code=0`，不是遍历下载合集。

探测过程曾在 Python API 路径遇到 `No video formats found`，允许忽略该错误的元数据探测得到音轨信息；随后上述正式 CLI 在短样例和两条用户样例均返回成功。短样例的 CLI 对照中，默认格式与显式 `bestaudio` 都成功；继承代理环境与去除代理环境也都成功。因此目前证据不足以把曾出现的错误归因于系统 FFmpeg、代理或单一参数。`--ignore-no-formats-error` 不能用来假装下载成功，上游也将它定义为尽量取得元数据的选项。需要在业务实现中保存脱敏诊断、验证真正下载并正确处理失败。[yt-dlp 下载与格式实现](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/YoutubeDL.py)

## 实现与验收建议

1. 修复字幕提取参数，单测人工 / 平台自动中文 / 弹幕排除、字幕不可见、无可用字幕和损坏字幕。当前匿名环境不能验证平台字幕成功分支，必须保留这个验收缺口。
2. 用 73 秒短样例验证真实音轨下载、完整 ASR、时间戳与文本保存。只有拿到实际音频并完成识别，才能说音频路径跑通。
3. 用用户的两个链接验证当前 P 全程：第一个约 10 分钟；第二个只处理 11 P 中的第 1 P，约 24 分钟。结果来源明确显示平台字幕或 ASR；不能用短样例替代这两个正式需求的验收。
4. 确认首尾内容与时长覆盖、非空段、时间戳递增、末段未超出音频；随机播放几个时间点抽查关键名词，再完成一次真实总结与原会话追问。
5. 取消必须结束下载 / ASR 子进程；超时、Cookie 过期、无音轨、无语音、模型缺失或下载失败均应返回明确可重试结果。保留补充字幕 / 转写文本的出口，拒绝用视频标题或评论冒充转写内容。
6. 转写与元数据缓存按规范化 BV + P 区分；追问复用同一来源。中间音频成功后可删除，最终带时间戳文本保留；日志与临时文件的凭据和签名 URL 需要脱敏。
7. 手机保持原来分享 / 粘贴链接、任务状态、结果和追问流程；优先补充“正在读取字幕 / 下载音频 / 音频转写 / 总结”进度说明，不需要新增一个工作流编辑器。

首版完成条件应包含：字幕路径的明确验证范围、至少一个真实 ASR 全流程、用户两条视频当前 P 的真实处理或可复现阻塞说明，以及取消、超时、失败重试与同会话追问。不要仅凭配置、测试替身或元数据返回成功宣布视频工作流完成。

## 实现时发现的兼容问题

实际安装到 PyAV 19.0.1 后，faster-whisper 1.2.1 在解码阶段抛出 `open() got an unexpected keyword argument 'metadata_errors'`。PyAV 19 删除了该参数，而 faster-whisper 当前解码代码仍传入它；这是上游已报告的兼容问题。首版固定 `av==18.1.0`，并添加一个真正解码内存 WAV 的安装检查，避免只检查模型加载就认为依赖可用。[PyAV 发布记录](https://github.com/PyAV-Org/PyAV/releases)、[faster-whisper 上游问题 #1492](https://github.com/SYSTRAN/faster-whisper/issues/1492)

第一条用户视频实际返回的 B 站 MCDN 音轨使用 HTTPS 8082，普通网页仅允许 80 / 443 的校验会拒绝它。音轨校验单独允许已支持的 B 站 CDN 域名与 80 / 443 / 8082 / 4483，继续验证协议、凭据和公开 DNS；普通文章地址规则不扩大。最终是否可下载仍以实际任务为准。
