package dev.agentbubble

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

class ApiException(val httpStatus: Int, message: String) : Exception(message)
class BubbleApi {
    suspend fun request(settings: ConnectionSettings, path: String, body: JSONObject? = null): String = withContext(Dispatchers.IO) {
        val url = URL(settings.url.trimEnd('/') + "/api/" + path)
        val connection = url.openConnection() as HttpURLConnection
        connection.connectTimeout = 12000
        connection.readTimeout = 20000
        connection.setRequestProperty("Authorization", "Bearer " + settings.token)
        connection.setRequestProperty("Accept", "application/json")
        try {
            if (body != null) {
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            if (status !in 200..299) {
                val message = runCatching { JSONObject(text).optString("message", "请求失败 ($status)") }.getOrDefault("请求失败 ($status)")
                throw ApiException(status, message)
            }
            text
        } finally { connection.disconnect() }
    }
    suspend fun health(settings: ConnectionSettings): JSONObject = JSONObject(request(settings, "health"))
    suspend fun conversations(settings: ConnectionSettings): List<ConversationItem> {
        val array = JSONArray(request(settings, "conversations"))
        return (0 until array.length()).map { ConversationItem.from(array.getJSONObject(it)) }
    }
    suspend fun thread(settings: ConnectionSettings, id: String) = ThreadData.from(JSONObject(request(settings, "conversations/$id")))
    suspend fun submit(settings: ConnectionSettings, payload: JSONObject) = TaskItem.from(JSONObject(request(settings, "tasks", payload)))
    suspend fun cancel(settings: ConnectionSettings, id: String) { request(settings, "tasks/$id/cancel", JSONObject()) }
    companion object {
        fun validServer(value: String): Boolean = runCatching {
            val uri = URI(value.trim())
            uri.scheme in listOf("http", "https") && !uri.host.isNullOrBlank() && uri.userInfo == null && uri.query == null && uri.fragment == null
        }.getOrDefault(false)
    }
}
