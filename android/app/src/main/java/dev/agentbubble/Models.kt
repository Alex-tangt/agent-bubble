package dev.agentbubble

import org.json.JSONObject

data class SourceInput(val kind: String, val value: String, val title: String = "") {
    fun json(): JSONObject = JSONObject().put("kind", kind).put("value", value).apply {
        if (title.isNotBlank() && kind != "url") put("title", title)
    }
}
data class TaskItem(
    val id: String, val conversationId: String, val message: String, val status: String,
    val progress: String, val result: String?, val error: String?, val createdAt: String
) {
    val busy: Boolean get() = status == "queued" || status == "running"
    companion object {
        fun from(json: JSONObject) = TaskItem(json.getString("id"), json.getString("conversationId"),
            json.getString("message"), json.getString("status"), json.optString("progress"),
            json.nullable("result"), json.nullable("error"), json.optString("createdAt"))
    }
}
data class SourceInfo(val id: String, val title: String, val url: String?, val kind: String, val method: String, val characters: Int, val transcriptionProvider: String? = null) {
    val basis: String get() = when (method) {
        "subtitles" -> "平台字幕"
        "audio_transcription" -> if (transcriptionProvider == "qwen") "Qwen 音频转写" else "音频转写"
        else -> if (kind == "video") "视频内容" else "文章正文"
    }
    companion object {
        fun from(json: JSONObject) = SourceInfo(json.getString("id"), json.getString("title"), json.nullable("url"),
            json.getString("kind"), json.getString("method"), json.optInt("characters"), json.nullable("transcriptionProvider"))
    }
}
data class ConversationItem(val id: String, val title: String, val latest: TaskItem?) {
    companion object {
        fun from(json: JSONObject) = ConversationItem(json.getString("id"), json.getString("title"),
            json.optJSONObject("latestTask")?.let(TaskItem::from))
    }
}
data class ThreadData(val id: String, val title: String, val source: SourceInfo?, val tasks: List<TaskItem>) {
    companion object {
        fun from(json: JSONObject): ThreadData {
            val array = json.getJSONArray("tasks")
            return ThreadData(json.getString("id"), json.getString("title"), json.optJSONObject("source")?.let(SourceInfo::from),
                (0 until array.length()).map { TaskItem.from(array.getJSONObject(it)) })
        }
    }
}
data class ConnectionSettings(val url: String = "http://10.0.2.2:8787", val token: String = "") {
    val ready: Boolean get() = token.isNotBlank() && url.isNotBlank()
}
data class UiState(
    val settings: ConnectionSettings = ConnectionSettings(), val connected: Boolean = false,
    val model: String = "", val conversations: List<ConversationItem> = emptyList(), val thread: ThreadData? = null,
    val draft: SourceInput = SourceInput("url", ""), val instruction: String = "请总结这份内容，列出关键观点和需要注意的地方。",
    val followUp: String = "", val screen: String = "tasks", val submitting: Boolean = false,
    val error: String? = null, val pendingRetry: Boolean = false, val overlayEnabled: Boolean = false,
    val supplement: Boolean = false, val unread: Set<String> = emptySet()
)
fun JSONObject.nullable(key: String): String? = if (isNull(key) || !has(key)) null else getString(key)
fun statusLabel(status: String): String = when (status) {
    "queued" -> "已接收"; "running" -> "处理中"; "completed" -> "已完成"; "needs_input" -> "需要处理"
    "failed" -> "处理失败"; "cancelled" -> "已停止"; "interrupted" -> "已中断"; else -> status
}
