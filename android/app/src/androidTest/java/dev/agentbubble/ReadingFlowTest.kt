package dev.agentbubble

import android.content.Intent
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class ReadingFlowTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    private fun connect(): BubbleModel {
        val arguments = InstrumentationRegistry.getArguments()
        val saved = LocalState(compose.activity).settings()
        // Reuse the phone's encrypted credential so it need not appear in ADB arguments.
        val token = arguments.getString("connectionToken") ?: saved.token
        val url = arguments.getString("serverUrl") ?: saved.url
        check(token.isNotBlank()) { "Connect the phone first or supply a test connectionToken" }
        compose.onNodeWithContentDescription("连接设置").performClick()
        compose.onNodeWithText("服务地址").performTextReplacement(url)
        compose.onNodeWithText("连接凭据").performTextReplacement(token)
        compose.onNodeWithText("连接", useUnmergedTree = true).performClick()
        val model = (compose.activity.application as BubbleApplication).model
        compose.waitUntil(30000) { model.state.value.connected && !model.state.value.submitting }
        return model
    }

    private fun completed(model: BubbleModel, count: Int = 1) {
        compose.waitUntil(180000) {
            val tasks = model.state.value.thread?.tasks
            tasks?.size == count && tasks.last().status !in listOf("queued", "running")
        }
        val task = model.state.value.thread!!.tasks.last()
        assertEquals(task.error ?: task.progress, "completed", task.status)
    }

    private fun report(model: BubbleModel, case: String, started: Long) {
        val thread = model.state.value.thread!!
        InstrumentationRegistry.getInstrumentation().sendStatus(0, android.os.Bundle().apply {
            putString("bubble_case", case)
            putString("bubble_conversation", thread.id)
            putString("bubble_source_method", thread.source?.method)
            putInt("bubble_task_count", thread.tasks.size)
            putLong("bubble_elapsed_ms", android.os.SystemClock.elapsedRealtime() - started)
        })
    }

    @Test fun backgroundReceiptResultAndFollowUp() {
        val started = android.os.SystemClock.elapsedRealtime()
        val model = connect()
        val text = "安卓测试会议：首版面向 12 名试用用户，每人每天提交 3 次总结任务。后台接收后即使手机离开页面也继续处理。阅读正文与视频字幕共用个人 Agent，收到结果后可以继续追问。"
        // A deterministic backend fixture isolates receipt/recovery from website availability.
        // The production compose/share UI accepts links only.
        compose.activityRule.scenario.onActivity {
            model.newTask(); model.source("text", text, "安卓端会议记录")
        }
        compose.waitUntil(10000) { model.state.value.draft.value == text }
        compose.onNodeWithText("文章或视频链接").assertExists()
        compose.onNodeWithText("交给 Agent").performClick()
        compose.waitUntil(30000) { !model.state.value.submitting && model.state.value.thread != null }
        assertFalse(model.state.value.pendingRetry)
        compose.activityRule.scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED)
        Thread.sleep(5000)
        compose.activityRule.scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED)
        completed(model)
        assertTrue(model.state.value.thread!!.tasks.last().result!!.contains("12"))
        val conversationId = model.state.value.thread!!.id
        compose.onNodeWithText("继续追问这份内容…").performTextInput("12 人每天各提交 3 次，合计多少次？只回答计算结果。")
        compose.onNodeWithContentDescription("发送追问").performClick()
        completed(model, 2)
        assertEquals(conversationId, model.state.value.thread!!.id)
        assertTrue(model.state.value.thread!!.tasks.last().result!!.contains("36"))
        assertNotNull(LocalState(compose.activity).thread())
        compose.activityRule.scenario.recreate()
        compose.waitUntil(10000) { model.state.value.screen == "thread" && model.state.value.thread?.id == conversationId }

        compose.activityRule.scenario.onActivity { activity -> activity.startForegroundService(Intent(activity, BubbleService::class.java)) }
        compose.waitUntil(10000) { model.state.value.overlayEnabled }
        report(model, "fixture-background-follow-up-recreate-overlay", started)
    }

    @Test fun bilibiliSharedLinksProduceVideoResultsAndFollowUps() {
        val model = connect()
        val videos = listOf("BV1t2HQ6EEaD", "BV1jXHC6GEke")
        videos.forEach { video ->
            val started = android.os.SystemClock.elapsedRealtime()
            val link = "https://www.bilibili.com/video/$video"
            compose.activityRule.scenario.onActivity { activity ->
                activity.startActivity(Intent(activity, MainActivity::class.java).apply {
                    action = Intent.ACTION_SEND; type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, "安卓端 B 站分享测试 $link")
                    addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
                })
            }
            compose.waitUntil(10000) { model.state.value.draft.value.contains(video) && model.state.value.screen == "compose" }
            compose.onNodeWithText("任务要求 · 默认总结重点").performClick()
            compose.onNodeWithText("交给 Agent 的任务").performTextReplacement("用三条要点总结视频，并注明内容依据。")
            compose.onNodeWithText("交给 Agent").performClick()
            compose.waitUntil(30000) { !model.state.value.submitting && model.state.value.thread != null }
            completed(model)
            val thread = model.state.value.thread!!
            assertEquals("video", thread.source?.kind)
            assertTrue(thread.source!!.method in listOf("subtitles", "audio_transcription"))
            assertTrue(thread.source!!.characters > 1000)
            assertTrue(thread.source!!.url!!.contains(video))
            assertTrue(thread.tasks.last().result!!.isNotBlank())
            compose.onNodeWithText("继续追问这份内容…").performTextInput("基于刚才的视频，给我两条最值得实践的建议。")
            compose.onNodeWithContentDescription("发送追问").performClick()
            completed(model, 2)
            assertEquals(thread.id, model.state.value.thread!!.id)
            assertTrue(model.state.value.thread!!.tasks.last().result!!.isNotBlank())
            report(model, "bilibili-$video-summary-follow-up", started)
        }
    }

    @Test fun newConversationAcceptsLinksAndFoldsOptionalInstruction() {
        val model = (compose.activity.application as BubbleApplication).model
        compose.onNodeWithContentDescription("添加对话").performClick()
        compose.onNodeWithText("文章或视频链接").assertExists()
        compose.onNodeWithText("交给 Agent 的任务").assertDoesNotExist()
        compose.onNodeWithText("正文 / 字幕文件").assertDoesNotExist()
        compose.onNodeWithText("任务要求 · 默认总结重点").performClick()
        compose.onNodeWithText("交给 Agent 的任务").assertExists()
        compose.activityRule.scenario.onActivity { model.shared("这段分享没有链接") }
        compose.waitUntil(10000) { model.state.value.error?.contains("没有链接") == true }
        assertFalse(model.state.value.pendingRetry)
        assertFalse(model.state.value.submitting)
    }

    @Test fun pendingReceiptIdAndEncryptedConnectionSurviveStorageReopen() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val state = LocalState(context)
        val original = state.settings()
        val pending = state.pending()
        try {
            state.saveSettings(ConnectionSettings("http://127.0.0.1:8787", "instrumentation-only-token"))
            val id = java.util.UUID.randomUUID().toString()
            state.savePending(org.json.JSONObject().put("clientRequestId", id))
            assertEquals("instrumentation-only-token", LocalState(context).settings().token)
            assertEquals(id, LocalState(context).pending()!!.getString("clientRequestId"))
            assertFalse(context.getSharedPreferences("agent_bubble", 0).getString("connection_token", "")!!.contains("instrumentation-only-token"))
        } finally { state.saveSettings(original); state.savePending(pending) }
    }
}
