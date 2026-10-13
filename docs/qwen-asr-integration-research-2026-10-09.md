# Qwen ASR file transcription integration research

Verified against official documentation on 2026-10-09. No private credentials or `.env` files were read for this research. The selected model is exactly `qwen-audio-3.0-asr-flash-filetrans`, which the official availability guide lists for Beijing and Singapore. It is distinct from `qwen3-asr-flash-filetrans` and the synchronous short-audio model. [Official availability guide](https://www.alibabacloud.com/help/en/model-studio/non-realtime-speech-recognition-user-guide)

## Endpoints and credentials

Use a configurable HTTP API base, including `/api/v1`:

| Region | Existing DashScope base | Recommended workspace base |
| --- | --- | --- |
| Beijing | `https://dashscope.aliyuncs.com/api/v1` | `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1` |
| Singapore | `https://dashscope-intl.aliyuncs.com/api/v1` | `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api/v1` |

API keys and supported models are region-specific. The workspace domain limits access to its workspace. Existing DashScope endpoints remain documented for existing integrations; the regional guide says they receive no new features after 2026-09-30. [Official regions/endpoints](https://www.alibabacloud.com/help/en/model-studio/regions)

New pay-as-you-go keys start with `sk-ws`; older `sk-` keys continue to work with identical calling capability. Key permissions come from the workspace; sub-workspaces require authorization for the requested standard model. Configure the host shown when creating the key instead of guessing region from its prefix. [Official API key guide](https://www.alibabacloud.com/help/en/model-studio/get-api-key)

`sk-sp-` keys belong to plan products and require their plan endpoints; they are not interchangeable with pay-as-you-go keys. [Official Token Plan quick start](https://www.alibabacloud.com/help/en/model-studio/token-plan-team-quickstart)

## Local file upload with only the Model Studio API key

The documented temporary storage flow is Beijing-only, model/account-bound, free, expires after 48 hours, and accepts at most 1 GB (also respect `data.max_file_size_mb`). Documentation designates it for development/testing. Upload policy credentials expire separately; `expire_in_seconds` supplies that duration.

1. `GET https://dashscope.aliyuncs.com/api/v1/uploads?action=getPolicy&model=qwen-audio-3.0-asr-flash-filetrans` with `Authorization: Bearer <key>` and `Content-Type: application/json`.
2. Read response `data`, then multipart `POST data.upload_host`:

| Form field | Value |
| --- | --- |
| `OSSAccessKeyId` | `data.oss_access_key_id` |
| `Signature` | `data.signature` |
| `policy` | `data.policy` |
| `x-oss-object-acl` | `data.x_oss_object_acl` |
| `x-oss-forbid-overwrite` | `data.x_oss_forbid_overwrite` |
| `key` | `data.upload_dir + "/" + filename` |
| `success_action_status` | `200` |
| `file` | Binary file, **last form field** |

3. Require HTTP 200, then construct `oss://` + `key`. Include `X-DashScope-OssResourceResolve: enable` when submitting it to ASR. No personal OSS AccessKey is needed: the API returns the signed upload policy. [Official temporary upload API](https://help.aliyun.com/zh/model-studio/get-temporary-file-url/)

The international translation contains an `intl` upload example despite saying Beijing-only. Prefer the Chinese specification above. Singapore temporary upload support is unverified; require a public HTTP(S) URL there unless separately verified. This is an inference from the documentation inconsistency. [English temporary storage guide](https://www.alibabacloud.com/help/en/model-studio/get-temporary-file-url)

## Submit a transcription task

`POST {api_base}/services/audio/asr/transcription` with `Authorization: Bearer <key>`, `Content-Type: application/json`, `X-DashScope-Async: enable`, plus the OSS resolution header for temporary URLs.

```json
{
  "model": "qwen-audio-3.0-asr-flash-filetrans",
  "input": {"file_urls": ["oss://uploaded/key/audio.wav"]},
  "parameters": {"channel_id": [0]}
}
```

`parameters` is mandatory for this model; `{}` is valid. Omission can submit successfully but fail during recognition. Only one file URL is supported. Channel zero is the default, and every requested channel is billed separately. `language_hints` accepts up to four codes, otherwise automatic detection applies. `diarization_enabled` defaults false and supports mono audio; optional `speaker_count` is 2–100. `keep_dialect` belongs only to 3.1. Inline `vocabulary` and `input.context` are optional accuracy enhancements.

Submission returns `output.task_id`, `output.task_status: "PENDING"`, and `request_id`. Persist task ID before polling. [Official HTTP contract](https://www.alibabacloud.com/help/en/model-studio/fun-asr-recorded-speech-recognition-http-api)

The existing Singapore DashScope route with this exact model is also explicitly shown by QwenCloud. [QwenCloud model API example](https://www.qwencloud.com/models/qwen-audio-3.0-asr-flash-filetrans)

## Poll, cancel, and retain results

`GET {api_base}/tasks/{task_id}` uses the same Bearer key, with no body. Read `output.task_status`: `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`; generic task management additionally documents `CANCELED` and `UNKNOWN`. Inspect individual `output.results[].subtask_status` and `code/message` even when the overall task says `SUCCEEDED`. Query/cancel rate limit is 20 QPS per account.

Cancellation: `POST {api_base}/tasks/{task_id}/cancel`, Bearer header, no body. It works only for `PENDING`; other states return HTTP 400 `UnsupportedOperation`. Success is a **plain JSON string containing the request ID**, not an object. The English example verifies the slash in `/tasks/{task_id}/cancel`; the Chinese page contains a missing-slash typo. Workspace and generic endpoints support task management. [Official asynchronous task API](https://www.alibabacloud.com/help/en/model-studio/manage-asynchronous-tasks)

Each successful subtask provides `transcription_url`, a signed URL to JSON. Download promptly; task results and their URLs are retained for 24 hours. Polling is separate from result download. [Official HTTP task result contract](https://www.alibabacloud.com/help/en/model-studio/fun-asr-recorded-speech-recognition-http-api)

Implementation recommendation: stop local work immediately when requested, attempt remote cancellation if still queued, and retain task ID if the task has started. Resume polling that ID instead of resubmitting paid audio. Do not forward the Model Studio Bearer credential to the signed result URL. These are application design recommendations, not additional API guarantees.

## Recognition JSON and timestamps

The result JSON contains `file_url`, `properties` (format, channels, sampling rate, `original_duration_in_milliseconds`) and `transcripts[]`. Each transcript contains `channel_id`, `content_duration_in_milliseconds`, `text`, and `sentences[]`. Sentence fields are `begin_time`, `end_time`, `text`, `sentence_id`, optional `speaker_id`, and `words[]`; word fields include timestamps, text, and punctuation. Both timestamp values are **milliseconds**. Convert to seconds or subtitle formatting in the application.

Use `transcripts[].text`, not the explanatory table's `transcript` label. The examples use the longer duration field names while one explanatory table says `content_duration`; tolerate both if reading saved historical output. Preserve raw JSON alongside normalized sentence segments. [Official ASR SDK result schema](https://help.aliyun.com/zh/model-studio/funauidio-asr-recorded-speech-recognition-python-sdk)

## Media limits and prices

Accepted containers/formats: `aac`, `amr`, `avi`, `flac`, `flv`, `m4a`, `mkv`, `mov`, `mp3`, `mp4`, `mpeg`, `ogg`, `opus`, `wav`, `webm`, `wma`, `wmv`; any sample rate. ASR accepts up to 2 GB and 12 hours, with at most two hours recommended for diarization. Temporary local upload has the stricter 1 GB limit. [Official audio specifications](https://help.aliyun.com/en/model-studio/asr-model)

International account prices: Beijing **USD 0.000032/second**, Singapore **USD 0.000035/second**; each has 600 RPM. At a nominal hour of billed audio this is USD 0.1152 / 0.126 respectively (arithmetic, excluding promotions). [Official model pricing and rate limits](https://www.alibabacloud.com/help/en/model-studio/qwen-audio-3-0-asr-flash-filetrans)

Mainland pricing documentation lists Beijing **CNY 0.00022/second**, Singapore **CNY 0.00026/second**, output free. Beijing's listed free quota is 36,000 seconds with the documented activation validity. Treat console/account pricing as authoritative for the actual account. [Official mainland model pricing](https://help.aliyun.com/zh/model-studio/model-pricing)

## Error handling

Preserve HTTP status, `request_id`, `code`, and `message` (including subtask errors). Relevant classes include `InvalidApiKey/invalid_api_key` (401), `Model.AccessDenied` / `Workspace.AccessDenied` / `AccessDenied.Unpurchased` (403), `Throttling.RateQuota` (429), and server/network failures. File errors may be `FILE_DOWNLOAD_FAILED` or `InvalidFile.DownloadFailed`, plus format, size, parse, and duration failures. Empty speech can yield no useful transcript rather than a transport error. Avoid using limits from Paraformer-specific error messages as this model's limits. [Official error codes](https://help.aliyun.com/zh/model-studio/error-code)

Expired OSS upload policy returns 403 `AccessDenied`; fetch a fresh policy. Missing OSS resolution headers can yield `invalid_parameter_error` or `InvalidParameter.DataInspection`. [Official upload troubleshooting](https://www.alibabacloud.com/help/en/model-studio/get-temporary-file-url)

Recommended retry policy: retry transient polling/download failures with capped backoff; surface authentication/permission/media errors directly. Submission retries after ambiguous network failure may duplicate billable tasks because no idempotency mechanism is documented in the inspected submit API. This last point is an implementation risk assessment, not a claimed service behavior.
