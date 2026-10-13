package dev.agentbubble

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

class MainActivity : ComponentActivity() {
    private val model get() = (application as BubbleApplication).model
    private val notifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { startBubble() }
    private val filePicker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) lifecycleScope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    contentResolver.openInputStream(uri)?.use { stream ->
                        val output = ByteArrayOutputStream()
                        val buffer = ByteArray(8192)
                        while (output.size() <= 900000) {
                            val count = stream.read(buffer, 0, minOf(buffer.size, 900001 - output.size()))
                            if (count < 0) break
                            output.write(buffer, 0, count)
                        }
                        val data = output.toByteArray()
                        require(data.size <= 900000) { "文件超过首版处理范围，请选择较短的正文或字幕" }
                        val text = String(data, Charsets.UTF_8).trim()
                        require(text.isNotBlank()) { "文件没有文本内容" }
                        text
                    } ?: error("无法读取文件")
                }
            }.onSuccess { text -> model.source(if (text.contains("-->")) "transcript" else "text", text, "分享的文本文件") }
                .onFailure { model.showError(it.message ?: "读取文件失败") }
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) handleIntent(intent)
        setContent {
            BubbleTheme {
                BubbleHome(model, floating = false, onClose = {}, onToggleBubble = ::toggleBubble)
            }
        }
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); handleIntent(intent) }
    private fun handleIntent(intent: Intent?) {
        if (intent?.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.let { model.shared(it, intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: "") }
        }
        if (intent?.getBooleanExtra("show_tasks", false) == true) model.screen("tasks")
        intent?.getStringExtra("conversation_id")?.let { model.openConversation(it) }
        if (intent?.getBooleanExtra("pick_file", false) == true) filePicker.launch(arrayOf("text/*", "application/x-subrip"))
    }
    override fun onStart() { super.onStart(); model.attach() }
    override fun onStop() { model.detach(); super.onStop() }
    private fun toggleBubble() {
        if (model.state.value.overlayEnabled) { stopService(Intent(this, BubbleService::class.java)); return }
        if (!Settings.canDrawOverlays(this)) {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            model.showError("开启悬浮权限后，回来点“开启悬浮窗”")
            return
        }
        if (Build.VERSION.SDK_INT >= 33) notifications.launch(Manifest.permission.POST_NOTIFICATIONS) else startBubble()
    }
    private fun startBubble() {
        if (!Settings.canDrawOverlays(this)) return
        startForegroundService(Intent(this, BubbleService::class.java))
    }
}
