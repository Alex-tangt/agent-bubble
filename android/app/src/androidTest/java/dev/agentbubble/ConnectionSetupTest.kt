package dev.agentbubble

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Debug APK companion only: receives a private one-time file through authorized ADB. */
class ConnectionSetupTest {
    @Test fun connectToPersonalBackend() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val file = context.filesDir.resolve("debug-connection.json")
        try {
            val config = JSONObject(file.readText(Charsets.UTF_8))
            val url = config.getString("url")
            val token = config.getString("token")
            val model = (context.applicationContext as BubbleApplication).model
            val completion = CountDownLatch(1)
            instrumentation.runOnMainSync { model.saveSettings(url, token) { completion.countDown() } }
            val saved = completion.await(30, TimeUnit.SECONDS)
            assertTrue("Backend connection failed: ${model.state.value.error}", saved)
            // Instrumentation can exit before apply() is flushed by an Activity lifecycle.
            assertTrue("Connection credential was not persisted",
                context.getSharedPreferences("agent_bubble", 0).edit().commit())
            assertTrue(model.state.value.connected)
            assertEquals(url, LocalState(context).settings().url)
            assertTrue("Connection credential was not saved", token == LocalState(context).settings().token)
        } finally { file.delete() }
    }
}
