package dev.agentbubble

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val Ink = Color(0xFF203A30)
private val Muted = Color(0xFF7A887F)
private val Paper = Color(0xFFF5F7F2)
private val Wash = Color(0xFFE9F0E6)
private val Line = Color(0xFFE0E7DD)

@Composable fun BubbleTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = lightColorScheme(primary = Color(0xFF315F48), onPrimary = Color.White,
        background = Paper, surface = Color.White, surfaceVariant = Wash, onSurface = Ink, onSurfaceVariant = Muted,
        outline = Line, secondary = Color(0xFF55745D)), content = content)
}

@Composable fun BubbleHome(model: BubbleModel, floating: Boolean, onClose: () -> Unit,
    onToggleBubble: () -> Unit, onOpenApp: (() -> Unit)? = null, onDrag: ((Float, Float) -> Unit)? = null) {
    val state by model.state.collectAsState()
    var settingsOpen by remember { mutableStateOf(false) }
    if (!floating) BackHandler(state.screen != "tasks") { model.screen("tasks") }
    Column(Modifier.fillMaxSize().clip(RoundedCornerShape(if (floating) 24.dp else 0.dp)).background(Paper)
        .then(if (floating) Modifier else Modifier.windowInsetsPadding(WindowInsets.safeDrawing))) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 6.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (!floating && state.screen != "tasks") IconButton({ model.screen("tasks") }, Modifier.size(40.dp)) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "返回收件匣", Modifier.size(21.dp))
            }
            Row(Modifier.weight(1f).then(if (floating && onDrag != null) Modifier.pointerInput(Unit) {
                detectDragGestures { change, amount -> change.consume(); onDrag(amount.x, amount.y) }
            } else Modifier), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(if (floating) 30.dp else 36.dp).clip(RoundedCornerShape(12.dp)).background(Wash), contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.AutoAwesome, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
                }
                Column(Modifier.padding(start = 9.dp)) {
                    Text("Agent Bubble", fontSize = if (floating) 14.sp else 17.sp, fontWeight = FontWeight.SemiBold)
                    Text(if (state.connected) "个人后端已连接" else if (state.settings.ready) "后端暂不可达" else "连接你的个人后端", fontSize = 10.sp, color = Muted)
                }
            }
            if (floating) IconButton({ model.screen("tasks"); model.refresh() }, Modifier.size(38.dp), enabled = !state.submitting) {
                Icon(Icons.Filled.Forum, "最近对话", Modifier.size(19.dp))
            } else IconButton({ settingsOpen = true }, Modifier.size(40.dp)) {
                Icon(Icons.Filled.Tune, "连接设置", Modifier.size(21.dp))
            }
            IconButton({ model.newTask() }, Modifier.size(40.dp), enabled = !state.submitting && !state.pendingRetry) {
                Icon(Icons.Filled.Add, "添加对话", Modifier.size(25.dp))
            }
            if (floating) IconButton(onClose, Modifier.size(38.dp)) { Icon(Icons.Filled.KeyboardArrowDown, "收起悬浮窗", Modifier.size(24.dp)) }
        }
        if (state.error != null) Surface(color = Color(0xFFF8EDE2), shape = RoundedCornerShape(12.dp), modifier = Modifier.padding(horizontal = 14.dp).fillMaxWidth()) {
            Row(Modifier.padding(start = 12.dp, top = 5.dp, bottom = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(state.error!!, fontSize = 11.sp, lineHeight = 16.sp, modifier = Modifier.weight(1f), maxLines = 4, overflow = TextOverflow.Ellipsis)
                IconButton(model::clearError, Modifier.size(32.dp)) { Icon(Icons.Filled.Close, "关闭提示", Modifier.size(15.dp)) }
            }
        }
        when (state.screen) {
            "compose" -> ComposePane(state, model, floating, Modifier.weight(1f))
            "thread" -> ThreadPane(state, model, floating, onClose, onOpenApp, Modifier.weight(1f))
            else -> InboxPane(state, model, floating, Modifier.weight(1f))
        }
        if (!floating) Row(Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.BubbleChart, null, Modifier.size(16.dp), tint = Muted)
            Text(if (state.overlayEnabled) "悬浮入口已开启" else "在阅读时随手交办", fontSize = 11.sp, color = Muted, modifier = Modifier.weight(1f).padding(start = 7.dp))
            TextButton(onToggleBubble) { Text(if (state.overlayEnabled) "关闭悬浮窗" else "开启悬浮窗", fontSize = 12.sp) }
        }
    }
    if (settingsOpen) SettingsDialog(state, model) { settingsOpen = false }
}

@Composable private fun ComposePane(state: UiState, model: BubbleModel, floating: Boolean, modifier: Modifier) {
    var expanded by rememberSaveable(state.pendingRetry) { mutableStateOf(state.pendingRetry) }
    val clipboard = LocalClipboardManager.current
    Column(modifier.fillMaxWidth().padding(horizontal = if (floating) 18.dp else 24.dp)) {
        val list = rememberLazyListState()
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = list, contentPadding = PaddingValues(top = if (floating) 10.dp else 26.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Text("把链接交给我", fontSize = if (floating) 23.sp else 29.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.6).sp)
                Text("你继续看，我来整理。", fontSize = 12.sp, color = Muted, modifier = Modifier.padding(top = 5.dp))
            }
            item {
                OutlinedTextField(state.draft.value, { model.source("url", it) }, label = { Text("文章或视频链接") },
                    placeholder = { Text("也可以贴入带链接的分享文字", fontSize = 12.sp) }, modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(18.dp), minLines = 2, maxLines = if (floating) 3 else 5,
                    enabled = !state.submitting && !state.pendingRetry,
                    colors = OutlinedTextFieldDefaults.colors(unfocusedContainerColor = Color.White, focusedContainerColor = Color.White))
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("文章 · B 站视频", fontSize = 10.sp, color = Muted, modifier = Modifier.weight(1f))
                    TextButton(onClick = {
                        val text = clipboard.getText()?.text.orEmpty()
                        if (text.isBlank()) model.showError("剪贴板没有文字，请长按输入框粘贴") else model.source("url", text)
                    }, enabled = !state.submitting && !state.pendingRetry, contentPadding = PaddingValues(horizontal = 8.dp)) {
                        Icon(Icons.Filled.ContentPaste, null, Modifier.size(14.dp)); Spacer(Modifier.width(5.dp)); Text("粘贴链接", fontSize = 11.sp)
                    }
                }
            }
            item {
                TextButton({ expanded = !expanded }, contentPadding = PaddingValues(0.dp)) {
                    Icon(if (expanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, null, Modifier.size(17.dp))
                    Text(if (expanded) "任务要求 · 可选" else "任务要求 · 默认总结重点", fontSize = 12.sp)
                }
                if (expanded) OutlinedTextField(state.instruction, model::instruction, label = { Text("交给 Agent 的任务") },
                    modifier = Modifier.fillMaxWidth(), minLines = 2, maxLines = 3, shape = RoundedCornerShape(16.dp), enabled = !state.submitting && !state.pendingRetry)
            }
        }
        Button({ model.submit() }, Modifier.fillMaxWidth().height(48.dp), shape = RoundedCornerShape(16.dp), enabled = !state.submitting) {
            if (state.submitting) CircularProgressIndicator(Modifier.size(17.dp), strokeWidth = 2.dp, color = Color.White)
            else Icon(Icons.Filled.AutoAwesome, null, Modifier.size(16.dp))
            Spacer(Modifier.width(8.dp)); Text(if (state.submitting) "等待后台回执…" else if (state.pendingRetry) "重试发送已保存的任务" else "交给 Agent", fontSize = 14.sp)
        }
        if (state.pendingRetry) TextButton(model::discardPending, Modifier.align(Alignment.CenterHorizontally)) { Text("放弃待发送记录，保留输入", fontSize = 11.sp) }
        else Text("收到回执后，就可以收起去阅读", fontSize = 10.sp, color = Muted, modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 8.dp, bottom = 14.dp))
    }
}

@Composable private fun InboxPane(state: UiState, model: BubbleModel, floating: Boolean, modifier: Modifier) {
    val conversations = state.conversations.ifEmpty { state.thread?.let { listOf(ConversationItem(it.id, it.title, it.tasks.lastOrNull())) } ?: emptyList() }
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(horizontal = if (floating) 16.dp else 24.dp, vertical = if (floating) 10.dp else 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text(if (floating) "最近对话" else "你的收件匣", fontSize = if (floating) 21.sp else 29.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.5).sp)
            Text(if (floating) "打开结果，接着聊。" else "交办的内容，都在这里。", fontSize = 12.sp, color = Muted, modifier = Modifier.padding(top = 5.dp))
        }
        if (conversations.isEmpty()) item {
            Column(Modifier.fillMaxWidth().padding(vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Filled.Inbox, null, Modifier.size(36.dp), tint = Color(0xFFB7C8B8))
                Text("从一条链接开始", fontSize = 16.sp, modifier = Modifier.padding(top = 14.dp))
                Text("文章、视频与后续追问，会保存成对话。", fontSize = 11.sp, color = Muted, modifier = Modifier.padding(top = 6.dp))
                TextButton(model::newTask) { Text("添加对话") }
            }
        }
        val running = conversations.filter { it.latest?.busy == true }
        val settled = conversations.filter { it.latest?.busy != true }
        if (running.isNotEmpty()) item { Text("正在整理 · ${running.size}", fontSize = 11.sp, color = Muted, modifier = Modifier.padding(top = 8.dp)) }
        items(running, key = { it.id }) { ConversationCard(it, it.id in state.unread) { model.openConversation(it.id) } }
        if (settled.isNotEmpty()) item { Text("已收录 · ${settled.size}", fontSize = 11.sp, color = Muted, modifier = Modifier.padding(top = 8.dp)) }
        items(settled, key = { it.id }) { ConversationCard(it, it.id in state.unread) { model.openConversation(it.id) } }
    }
}

@Composable private fun ConversationCard(item: ConversationItem, unread: Boolean, onOpen: () -> Unit) {
    val latest = item.latest
    Card(onOpen, shape = RoundedCornerShape(19.dp), colors = CardDefaults.cardColors(containerColor = Color.White)) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (latest?.busy == true) CircularProgressIndicator(Modifier.size(11.dp), strokeWidth = 1.5.dp)
                else Box(Modifier.size(6.dp).clip(CircleShape).background(if (unread) MaterialTheme.colorScheme.primary else Color(0xFFBCCBBA)))
                Text(if (unread) "新结果" else statusLabel(latest?.status ?: "completed"), fontSize = 10.sp, color = Muted, modifier = Modifier.padding(start = 6.dp).weight(1f))
                Icon(Icons.Filled.ChevronRight, "查看结果", Modifier.size(16.dp), tint = Muted)
            }
            Text(item.title, fontSize = 15.sp, fontWeight = FontWeight.Medium, lineHeight = 22.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp))
            Text((latest?.result ?: latest?.progress ?: "打开对话").replace(Regex("[#*`\\n]"), " ").trim(), fontSize = 11.sp, color = Muted,
                maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 17.sp, modifier = Modifier.padding(top = 6.dp))
        }
    }
}

@Composable private fun ThreadPane(state: UiState, model: BubbleModel, floating: Boolean, onClose: () -> Unit, onOpenApp: (() -> Unit)?, modifier: Modifier) {
    val thread = state.thread
    if (thread == null) { Box(modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { Text("从收件匣打开一份结果", color = Muted) }; return }
    val last = thread.tasks.lastOrNull()
    val uri = LocalUriHandler.current
    val context = LocalContext.current
    val scroll = rememberLazyListState()
    LaunchedEffect(thread.id, last?.id, last?.status) { if (last?.busy == false) model.markRead(thread.id) }
    LaunchedEffect(thread.id, thread.tasks.size) { if (thread.tasks.isNotEmpty()) scroll.scrollToItem(if (thread.tasks.size > 1) thread.tasks.size else 0) }
    Column(modifier.fillMaxWidth()) {
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = scroll, contentPadding = PaddingValues(horizontal = if (floating) 16.dp else 24.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
            item {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Wash).padding(13.dp)) {
                    Text(thread.source?.title ?: thread.title, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 2, lineHeight = 19.sp, overflow = TextOverflow.Ellipsis)
                    Text(thread.source?.let { "${it.basis} · ${it.characters.toString().reversed().chunked(3).joinToString(",").reversed()} 字 · 已保存" } ?: "后台已接收 · 可以放心收起", fontSize = 10.sp, color = Muted, modifier = Modifier.padding(top = 5.dp))
                    Row {
                        thread.source?.url?.let { url -> TextButton({ runCatching { uri.openUri(url) }.onFailure { model.showError("没有可以打开链接的应用") } }, contentPadding = PaddingValues(end = 10.dp), modifier = Modifier.height(30.dp)) { Text("原始来源 ↗", fontSize = 10.sp) } }
                        if (floating && onOpenApp != null) TextButton(onOpenApp, contentPadding = PaddingValues(0.dp), modifier = Modifier.height(30.dp)) { Text("完整阅读 ↗", fontSize = 10.sp) }
                    }
                }
            }
            items(thread.tasks, key = { it.id }) { task ->
                Column(Modifier.fillMaxWidth()) {
                    Text(task.message, fontSize = 11.sp, lineHeight = 17.sp, color = Muted, modifier = Modifier.padding(start = 8.dp, bottom = 8.dp))
                    Card(shape = RoundedCornerShape(19.dp), colors = CardDefaults.cardColors(containerColor = Color.White)) {
                        Column(Modifier.fillMaxWidth().padding(if (floating) 15.dp else 20.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                if (task.busy) CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp) else Icon(Icons.Filled.AutoAwesome, null, Modifier.size(13.dp), tint = MaterialTheme.colorScheme.primary)
                                Text("AGENT · ${statusLabel(task.status)}", fontSize = 10.sp, color = Muted, letterSpacing = 0.3.sp, modifier = Modifier.padding(start = 6.dp))
                            }
                            Spacer(Modifier.height(10.dp))
                            if (task.result != null) {
                                MarkdownBody(task.result)
                                TextButton({ context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, task.result), "分享结果").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }, contentPadding = PaddingValues(0.dp), modifier = Modifier.height(32.dp)) { Text("分享结果", fontSize = 10.sp) }
                            } else {
                                Text(task.error ?: task.progress.ifBlank { "正在整理来源内容…" }, fontSize = 12.sp, lineHeight = 19.sp)
                                if (task.busy) Text("任务留在后台，收起不会中断。", fontSize = 10.sp, color = Muted, modifier = Modifier.padding(top = 9.dp))
                            }
                        }
                    }
                }
            }
        }
        if (last?.busy == true) Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton({ model.cancel(last.id) }, enabled = !state.submitting) { Text("停止本次处理", fontSize = 11.sp, color = Muted) }
            Spacer(Modifier.weight(1f))
            if (floating) Button(onClose, shape = RoundedCornerShape(14.dp)) { Text("收起，继续看", fontSize = 12.sp) }
        } else {
            if (last?.status in listOf("failed", "needs_input", "interrupted", "cancelled")) Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("验证或登录需在电脑端完成", fontSize = 10.sp, color = Muted, modifier = Modifier.weight(1f))
                TextButton(model::retryTask, enabled = !state.submitting) { Text("原会话重试", fontSize = 11.sp) }
            }
            Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, top = 7.dp, bottom = 12.dp), verticalAlignment = Alignment.Bottom) {
                OutlinedTextField(state.followUp, model::followUp, placeholder = { Text("继续追问这份内容…", fontSize = 12.sp) },
                    modifier = Modifier.weight(1f), maxLines = 3, shape = RoundedCornerShape(18.dp), enabled = !state.submitting && !state.pendingRetry,
                    colors = OutlinedTextFieldDefaults.colors(unfocusedContainerColor = Color.White, focusedContainerColor = Color.White))
                Spacer(Modifier.width(8.dp))
                FilledIconButton({ model.submit(true) }, Modifier.size(50.dp), shape = RoundedCornerShape(17.dp), enabled = !state.submitting && (state.followUp.isNotBlank() || state.pendingRetry)) {
                    if (state.submitting) CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
                    else Icon(Icons.AutoMirrored.Filled.Send, if (state.pendingRetry) "重试发送" else "发送追问", Modifier.size(20.dp))
                }
            }
            if (state.pendingRetry) TextButton(model::discardPending, Modifier.align(Alignment.CenterHorizontally).height(30.dp)) { Text("放弃待发送记录，保留输入", fontSize = 10.sp) }
        }
    }
}

private fun inlineText(text: String): AnnotatedString {
    val result = AnnotatedString.Builder()
    val pattern = Regex("\\*\\*(.+?)\\*\\*|`([^`]+)`")
    var at = 0
    pattern.findAll(text).forEach { match ->
        result.append(text.substring(at, match.range.first))
        result.pushStyle(SpanStyle(fontWeight = if (match.groupValues[1].isNotEmpty()) FontWeight.SemiBold else FontWeight.Normal,
            background = if (match.groupValues[2].isNotEmpty()) Wash else Color.Unspecified))
        result.append(match.groupValues[1].ifEmpty { match.groupValues[2] }); result.pop(); at = match.range.last + 1
    }
    result.append(text.substring(at)); return result.toAnnotatedString()
}

@Composable private fun MarkdownBody(text: String) {
    SelectionContainer {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            text.lines().filter { it.isNotBlank() }.forEach { line ->
                val trimmed = line.trim()
                val heading = trimmed.startsWith("#")
                val rule = trimmed.matches(Regex("[-*_]{3,}"))
                val body = trimmed.replace(Regex("^#{1,6}\\s*"), "").replace(Regex("^[-*]\\s+"), "• ")
                if (rule) HorizontalDivider(color = Line, modifier = Modifier.padding(vertical = 4.dp))
                else Text(inlineText(body), fontSize = if (heading) 16.sp else 13.sp,
                    fontWeight = if (heading) FontWeight.SemiBold else FontWeight.Normal, lineHeight = if (heading) 24.sp else 22.sp,
                    modifier = Modifier.padding(top = if (heading) 5.dp else 0.dp))
            }
        }
    }
}

@Composable private fun SettingsDialog(state: UiState, model: BubbleModel, onDismiss: () -> Unit) {
    var url by remember { mutableStateOf(state.settings.url) }
    var token by remember { mutableStateOf(state.settings.token) }
    AlertDialog(onDismissRequest = { if (!state.submitting) onDismiss() }, title = { Text("连接个人后端") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("手机负责交办与阅读，任务在你的电脑上处理。", fontSize = 12.sp, color = Muted)
            OutlinedTextField(url, { url = it }, label = { Text("服务地址") }, singleLine = true, enabled = !state.submitting)
            OutlinedTextField(token, { token = it }, label = { Text("连接凭据") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), enabled = !state.submitting)
            state.error?.let { Text(it, fontSize = 11.sp, color = MaterialTheme.colorScheme.error) }
        }
    }, confirmButton = { TextButton({ model.saveSettings(url, token, onDismiss) }, enabled = !state.submitting) { Text(if (state.submitting) "正在连接…" else "连接") } },
        dismissButton = { TextButton(onDismiss, enabled = !state.submitting) { Text("取消") } })
}
