package dev.agentbubble

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

class BubbleModel(context: Context) {
    private val local = LocalState(context)
    private val api = BubbleApi()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val restoredThread = local.thread()?.let { runCatching { ThreadData.from(it) }.getOrNull() }
    private val mutable = MutableStateFlow(UiState(settings = local.settings(), thread = restoredThread,
        screen = "tasks", pendingRetry = local.pending() != null, unread = local.unread()))
    val state: StateFlow<UiState> = mutable
    var onCompleted: ((TaskItem) -> Unit)? = null
    private var viewers = 0
    private var poll: Job? = null
    private var opening: Job? = null
    private var refreshing = false
    private val notified = mutableSetOf<String>()
    private val waitingResults = restoredThread?.tasks?.filter { it.busy }?.map { it.id }?.toMutableSet() ?: mutableSetOf()
    private var pending = local.pending()
    init {
        restoredThread?.tasks?.filter { !it.busy }?.forEach { notified.add(it.id) }
        pending?.let { payload ->
            if (!payload.has("source")) mutable.update { it.copy(screen = "thread", followUp = payload.optString("message")) }
            payload.optJSONObject("source")?.let { source ->
                mutable.update { it.copy(draft = SourceInput(source.optString("kind", "url"), source.optString("value"), source.optString("title")),
                    instruction = payload.optString("message", it.instruction), screen = "compose") }
            }
        }
    }
    fun attach() { viewers++; refresh(); if (poll == null) poll = scope.launch { while (viewers > 0) { delay(4000); refresh() } } }
    fun detach() { viewers = (viewers - 1).coerceAtLeast(0); if (viewers == 0) { poll?.cancel(); poll = null } }
    fun clearError() { mutable.update { it.copy(error = null) } }
    fun showError(message: String) { mutable.update { it.copy(error = message) } }
    fun overlay(enabled: Boolean) { mutable.update { it.copy(overlayEnabled = enabled) } }
    fun newTask() {
        if (state.value.submitting) return
        if (pending != null) return showError("还有一份待发送内容，请重试提交或放弃后再创建")
        opening?.cancel()
        mutable.update { it.copy(screen = "compose", draft = SourceInput("url", ""), instruction = UiState().instruction,
            followUp = "", supplement = false, error = null) }
    }
    fun discardPending() {
        if (!local.savePending(null)) return showError("无法更新本地待发送记录，请检查设备存储空间")
        pending = null; mutable.update { it.copy(pendingRetry = false, error = null) }
    }
    fun source(kind: String, value: String, title: String = state.value.draft.title) { mutable.update { it.copy(draft = SourceInput(kind, value, title)) } }
    fun instruction(value: String) { mutable.update { it.copy(instruction = value) } }
    fun followUp(value: String) { mutable.update { it.copy(followUp = value) } }
    fun screen(value: String) { mutable.update { it.copy(screen = value, error = null) } }
    fun shared(value: String, title: String = "") {
        if (state.value.submitting) return showError("正在提交，请收到回执后再分享新的链接")
        if (pending != null) return showError("还有一份待发送内容，请先处理再接收新的分享")
        if (!Regex("https?://", RegexOption.IGNORE_CASE).containsMatchIn(value)) return showError("分享内容中没有链接，请复制文章或视频链接后再试")
        opening?.cancel()
        mutable.update { it.copy(draft = SourceInput("url", value, title), screen = "compose", instruction = UiState().instruction,
            followUp = "", supplement = false, error = null) }
    }
    fun markRead(id: String) {
        if (id !in state.value.unread) return
        mutable.update { it.copy(unread = it.unread - id) }; local.saveUnread(state.value.unread)
    }
    fun openBubble() {
        if (state.value.screen == "compose" && state.value.draft.value.isNotBlank()) { refresh(); return }
        val unread = state.value.conversations.firstOrNull { it.id in state.value.unread }
        if (unread != null && pending == null && !state.value.submitting) openConversation(unread.id)
        else if (state.value.screen == "tasks" && state.value.conversations.isEmpty() && state.value.thread == null) newTask()
        refresh()
    }
    fun supplement() {
        mutable.update { it.copy(screen = "compose", draft = SourceInput("transcript", ""), supplement = true, error = null) }
    }
    fun saveSettings(url: String, token: String, onSuccess: () -> Unit) {
        if (!BubbleApi.validServer(url)) return showError("请输入完整的 HTTP 或 HTTPS 服务地址")
        if (token.trim().length < 24) return showError("连接凭据至少 24 个字符")
        val settings = ConnectionSettings(url.trim().trimEnd('/'), token.trim())
        scope.launch {
            mutable.update { it.copy(submitting = true, error = null) }
            try {
                val health = api.health(settings)
                local.saveSettings(settings)
                mutable.update { it.copy(settings = settings, connected = true, model = health.optString("model"), submitting = false) }
                onSuccess(); refresh()
            } catch (e: Exception) { mutable.update { it.copy(submitting = false, error = message(e)) } }
        }
    }
    fun refresh() {
        if (!state.value.settings.ready || refreshing) return
        refreshing = true
        scope.launch {
            try {
                val settings = state.value.settings
                val health = api.health(settings)
                val conversations = api.conversations(settings)
                val id = state.value.thread?.id
                val thread = if (id != null) api.thread(settings, id) else null
                if (thread != null && state.value.thread?.id == id) cacheThread(thread)
                val alreadyLoaded = state.value.conversations.associateBy { it.id }
                conversations.forEach { conversation ->
                    val task = conversation.latest
                    if (task != null && !task.busy && notified.add(task.id)) {
                        if (waitingResults.remove(task.id) || alreadyLoaded[conversation.id]?.latest?.busy == true) {
                            mutable.update { it.copy(unread = it.unread + conversation.id) }
                            local.saveUnread(state.value.unread)
                            onCompleted?.invoke(task)
                        }
                    }
                }
                mutable.update { it.copy(connected = true, model = health.optString("model"), conversations = conversations,
                    thread = if (it.thread?.id == id) thread else it.thread) }
            } catch (_: Exception) { mutable.update { it.copy(connected = false) } }
            finally { refreshing = false }
        }
    }
    fun openConversation(id: String) {
        if (state.value.submitting) return
        if (pending != null && pending?.optString("conversationId") != id) return showError("请先处理待发送内容，再切换对话")
        opening?.cancel()
        opening = scope.launch {
            try { val thread = api.thread(state.value.settings, id); cacheThread(thread); mutable.update { it.copy(thread = thread, screen = "thread", followUp = if (it.thread?.id == id) it.followUp else "", error = null) } }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                if (state.value.thread?.id == id) mutable.update { it.copy(screen = "thread", connected = false, error = "后端暂不可达，正在显示上次保存的结果") }
                else showError(message(e))
            }
        }
    }
    fun submit(follow: Boolean = false) {
        if (state.value.submitting) return
        if (!state.value.settings.ready) return showError("请先在连接设置中连接个人 Agent")
        opening?.cancel()
        val snapshot = state.value
        if (pending == null) {
            val message = if (follow) snapshot.followUp.trim() else snapshot.instruction.trim().ifBlank { UiState().instruction }
            if (message.isBlank()) return showError("请输入任务要求")
            if (!follow && snapshot.draft.value.isBlank()) return showError("请贴入文章或视频链接")
            if (!follow && snapshot.draft.kind == "url" && !Regex("https?://", RegexOption.IGNORE_CASE).containsMatchIn(snapshot.draft.value)) return showError("内容中没有链接，请贴入完整的 HTTP 或 HTTPS 链接")
            if (follow && snapshot.thread == null) return showError("请选择要继续对话的结果")
            val payload = JSONObject().put("clientRequestId", UUID.randomUUID().toString()).put("message", message)
            if (follow || snapshot.supplement) payload.put("conversationId", snapshot.thread!!.id)
            if (!follow) payload.put("source", snapshot.draft.json())
            if (!local.savePending(payload)) return showError("无法保存任务，请检查设备存储空间后重试")
            pending = payload
        }
        scope.launch {
            mutable.update { it.copy(submitting = true, error = null) }
            try {
                val task = api.submit(state.value.settings, pending!!)
                waitingResults.add(task.id)
                pending = null; local.savePending(null)
                val fallback = ThreadData(task.conversationId, "正在处理", null, listOf(task))
                val thread = runCatching { api.thread(state.value.settings, task.conversationId) }.getOrDefault(fallback)
                cacheThread(thread)
                mutable.update { it.copy(submitting = false, pendingRetry = false, screen = "thread", thread = thread, followUp = "", supplement = false) }
                refresh()
            } catch (e: Exception) {
                if (e is ApiException && e.httpStatus in 400..499) { pending = null; local.savePending(null) }
                mutable.update { it.copy(submitting = false, pendingRetry = pending != null, error = message(e)) }
            }
        }
    }
    fun retryTask() { state.value.thread?.tasks?.lastOrNull()?.let { followUp(it.message); submit(true) } }
    fun cancel(id: String) { scope.launch { try { api.cancel(state.value.settings, id); refresh() } catch (e: Exception) { showError(message(e)) } } }
    private fun cacheThread(thread: ThreadData) {
        val tasks = org.json.JSONArray()
        thread.tasks.forEach { task -> tasks.put(JSONObject().put("id", task.id).put("conversationId", task.conversationId).put("message", task.message)
            .put("status", task.status).put("progress", task.progress).put("result", task.result ?: JSONObject.NULL).put("error", task.error ?: JSONObject.NULL).put("createdAt", task.createdAt)) }
        val json = JSONObject().put("id", thread.id).put("title", thread.title).put("tasks", tasks)
        thread.source?.let { source -> json.put("source", JSONObject().put("id", source.id).put("title", source.title).put("url", source.url ?: JSONObject.NULL)
            .put("kind", source.kind).put("method", source.method).put("characters", source.characters).put("transcriptionProvider", source.transcriptionProvider ?: JSONObject.NULL)) }
        local.saveThread(json.toString())
    }
    private fun message(e: Exception): String = when (e) {
        is ApiException -> e.message ?: "请求失败"
        is java.net.SocketTimeoutException -> "连接超时，内容已保留，可以重试提交"
        is java.net.ConnectException -> "无法连接个人 Agent，请检查服务地址和网络"
        else -> "连接失败，内容已保留，请检查网络后重试"
    }
}
