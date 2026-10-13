package dev.agentbubble

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.graphics.Rect
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.WindowManager
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.unit.dp
import androidx.lifecycle.*
import androidx.savedstate.*
import kotlinx.coroutines.*

class BubbleService : Service(), LifecycleOwner, ViewModelStoreOwner, SavedStateRegistryOwner {
    private val registry = LifecycleRegistry(this)
    override val lifecycle: Lifecycle get() = registry
    override val viewModelStore = ViewModelStore()
    private val savedController = SavedStateRegistryController.create(this)
    override val savedStateRegistry: SavedStateRegistry get() = savedController.savedStateRegistry
    private val model get() = (application as BubbleApplication).model
    private val windows by lazy { getSystemService(WINDOW_SERVICE) as WindowManager }
    private var bubble: ComposeView? = null
    private var panel: ComposeView? = null
    private lateinit var bubbleParams: WindowManager.LayoutParams
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var attached = false
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    override fun onCreate() {
        super.onCreate()
        savedController.performAttach(); savedController.performRestore(null)
        registry.handleLifecycleEvent(Lifecycle.Event.ON_CREATE)
        registry.handleLifecycleEvent(Lifecycle.Event.ON_START)
        registry.handleLifecycleEvent(Lifecycle.Event.ON_RESUME)
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("bubble", "悬浮入口", NotificationManager.IMPORTANCE_LOW))
        manager.createNotificationChannel(NotificationChannel("results", "任务结果", NotificationManager.IMPORTANCE_DEFAULT))
        val stop = PendingIntent.getService(this, 2, Intent(this, BubbleService::class.java).setAction("stop"), PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(this, "bubble").setSmallIcon(R.drawable.ic_bubble).setContentTitle("Agent Bubble 悬浮入口已开启")
            .setContentText("点击查看任务；任务在个人 Agent 主机执行").setContentIntent(openIntent()).setOngoing(true)
            .addAction(Notification.Action.Builder(null, "关闭悬浮窗", stop).build()).build()
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) else startForeground(1, notification)
        if (!Settings.canDrawOverlays(this)) { stopSelf(); return }
        runCatching { showBubble() }.onFailure { model.showError("无法开启悬浮窗，请检查系统悬浮权限"); stopSelf(); return }
        model.overlay(true); model.attach(); attached = true
        model.onCompleted = { task -> notifyResult(task) }
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "stop") stopSelf()
        return START_NOT_STICKY
    }
    private fun view(): ComposeView = ComposeView(this).apply {
        setViewTreeLifecycleOwner(this@BubbleService)
        setViewTreeViewModelStoreOwner(this@BubbleService)
        setViewTreeSavedStateRegistryOwner(this@BubbleService)
        setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindow)
    }
    private fun showBubble() {
        val width = resources.displayMetrics.widthPixels
        bubbleParams = WindowManager.LayoutParams(dp(60), dp(64), WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN, PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.START; x = width - dp(68); y = dp(150)
        }
        bubble = view().apply {
            setContent {
                val state by model.state.collectAsState()
                BubbleTheme {
                    Box(Modifier.fillMaxSize().pointerInput(Unit) {
                        detectDragGestures(onDragEnd = {
                            bubbleParams.x = if (bubbleParams.x < width / 2) dp(8) else width - dp(68)
                            bubble?.let { windows.updateViewLayout(it, bubbleParams) }
                        }) { change, amount ->
                            change.consume()
                            bubbleParams.x = (bubbleParams.x + amount.x.toInt()).coerceIn(0, width - dp(60))
                            bubbleParams.y = (bubbleParams.y + amount.y.toInt()).coerceIn(dp(24), resources.displayMetrics.heightPixels - dp(90))
                            bubble?.let { windows.updateViewLayout(it, bubbleParams) }
                        }
                    }, contentAlignment = Alignment.Center) {
                        FilledIconButton(onClick = { if (panel == null) { model.openBubble(); showPanel() } else hidePanel() }, modifier = Modifier.size(52.dp)) {
                            Icon(Icons.Filled.AutoAwesome, "打开 Agent 悬浮窗", Modifier.size(23.dp))
                        }
                        val busy = state.conversations.any { it.latest?.busy == true } || state.thread?.tasks?.lastOrNull()?.busy == true
                        if (state.unread.isNotEmpty() || busy) Box(Modifier.align(Alignment.TopEnd).padding(4.dp).size(12.dp).clip(CircleShape)
                            .background(if (state.unread.isNotEmpty()) Color(0xFFD7E7CE) else Color(0xFFE9B768)), contentAlignment = Alignment.Center) {
                            if (state.unread.isNotEmpty()) Text("•", color = Color(0xFF315F48), fontSize = androidx.compose.ui.unit.TextUnit(10f, androidx.compose.ui.unit.TextUnitType.Sp))
                        }
                    }
                }
            }
            windows.addView(this, bubbleParams)
        }
    }
    private fun showPanel() {
        val metrics = resources.displayMetrics
        val width = minOf(dp(360), metrics.widthPixels - dp(24))
        val height = minOf(dp(470), metrics.heightPixels - dp(96))
        var restingX = (metrics.widthPixels - width) / 2
        var restingY = (metrics.heightPixels - height) / 2
        var keyboardVisible = false
        val params = WindowManager.LayoutParams(width, height, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL, PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.START; x = restingX; y = restingY
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
            if (Build.VERSION.SDK_INT >= 30) {
                // Let WindowManager fit the window to the keyboard's screen bounds.
                // IME insets of an overlay are relative to its frame, not screen height.
                setFitInsetsTypes(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.displayCutout() or android.view.WindowInsets.Type.ime())
            }
        }
        model.refresh()
        panel = view().apply {
            setContent {
                BubbleTheme { BubbleHome(model, floating = true, onClose = ::hidePanel, onToggleBubble = { stopSelf() },
                    onOpenApp = { hidePanel(); launchMain() }, onDrag = { dx, dy ->
                        restingX = (restingX + dx.toInt()).coerceIn(0, metrics.widthPixels - width)
                        val limit = if (keyboardVisible) {
                            val visible = Rect(); getWindowVisibleDisplayFrame(visible); visible.bottom - params.height - dp(12)
                        } else metrics.heightPixels - height - dp(32)
                        params.x = restingX
                        params.y = (params.y + dy.toInt()).coerceIn(dp(24), maxOf(dp(24), limit))
                        if (!keyboardVisible) restingY = params.y
                        if (panel === this) windows.updateViewLayout(this, params)
                    }) }
            }
            // The server can clamp an overlay frame while its fixed client LayoutParams
            // still measure at the old height. Resize the client to the visible display.
            viewTreeObserver.addOnGlobalLayoutListener {
                val visible = Rect()
                getWindowVisibleDisplayFrame(visible)
                if (visible.height() > 0) {
                    keyboardVisible = visible.bottom < metrics.heightPixels - dp(180)
                    val nextHeight = minOf(height, visible.height() - dp(24)).coerceAtLeast(dp(240))
                    val nextY = if (keyboardVisible) dp(12) else restingY
                    if (params.height != nextHeight || params.y != nextY) {
                        params.height = nextHeight; params.y = nextY
                        post { if (panel === this) windows.updateViewLayout(this, params) }
                    }
                }
            }
            windows.addView(this, params)
        }
    }
    private fun hidePanel() { panel?.let { windows.removeView(it) }; panel = null }
    private fun launchMain(pickFile: Boolean = false) {
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("pick_file", pickFile).putExtra("conversation_id", model.state.value.thread?.id))
    }
    private fun openIntent(conversationId: String? = null): PendingIntent = PendingIntent.getActivity(this, conversationId?.hashCode() ?: 1,
        Intent(this, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP; putExtra("show_tasks", true); if (conversationId != null) putExtra("conversation_id", conversationId) },
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    private fun notifyResult(task: TaskItem) {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val title = if (task.status == "completed") "总结已完成" else "任务需要处理"
        val notification = Notification.Builder(this, "results").setSmallIcon(R.drawable.ic_bubble).setContentTitle(title)
            .setContentText(task.result?.take(90) ?: task.error ?: task.progress).setContentIntent(openIntent(task.conversationId)).setAutoCancel(true).build()
        getSystemService(NotificationManager::class.java).notify(task.id.hashCode(), notification)
    }
    override fun onDestroy() {
        hidePanel(); bubble?.let { windows.removeView(it) }; bubble = null
        model.onCompleted = null
        if (attached) model.detach()
        model.overlay(false)
        scope.cancel()
        registry.handleLifecycleEvent(Lifecycle.Event.ON_PAUSE)
        registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
        registry.handleLifecycleEvent(Lifecycle.Event.ON_DESTROY)
        viewModelStore.clear()
        super.onDestroy()
    }
    override fun onBind(intent: Intent?): IBinder? = null
}
