package dev.agentbubble

import android.content.Context
import android.annotation.SuppressLint
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class LocalState(context: Context) {
    private val prefs = context.getSharedPreferences("agent_bubble", Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("bubble_connection", null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder("bubble_connection", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return generator.generateKey()
    }
    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        return Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }
    private fun decrypt(value: String): String {
        if (value.isBlank()) return ""
        val data = Base64.decode(value, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data.copyOfRange(0, 12))) }
        return String(cipher.doFinal(data.copyOfRange(12, data.size)), Charsets.UTF_8)
    }
    fun settings() = ConnectionSettings(prefs.getString("server_url", "http://10.0.2.2:8787")!!,
        runCatching { decrypt(prefs.getString("connection_token", "")!!) }.getOrDefault(""))
    fun saveSettings(settings: ConnectionSettings) { prefs.edit().putString("server_url", settings.url).putString("connection_token", encrypt(settings.token)).apply() }
    fun pending(): JSONObject? = prefs.getString("pending", null)?.let { runCatching { JSONObject(it) }.getOrNull() }
    // Persist the stable request ID before HTTP can send it, including before a process death.
    @SuppressLint("ApplySharedPref")
    fun savePending(payload: JSONObject?): Boolean = prefs.edit().apply { if (payload == null) remove("pending") else putString("pending", payload.toString()) }.commit()
    fun thread(): JSONObject? = prefs.getString("thread", null)?.let { runCatching { JSONObject(it) }.getOrNull() }
    fun saveThread(value: String) { prefs.edit().putString("thread", value).apply() }
    fun unread(): Set<String> = prefs.getStringSet("unread_conversations", emptySet())!!.toSet()
    fun saveUnread(ids: Set<String>) { prefs.edit().putStringSet("unread_conversations", ids).apply() }
}
