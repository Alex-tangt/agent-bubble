package dev.agentbubble

import org.junit.Assert.*
import org.junit.Test

class BubbleApiTest {
    @Test fun serverAddressAllowsDevelopmentAndHttpsButRejectsEmbeddedCredentials() {
        assertTrue(BubbleApi.validServer("http://10.0.2.2:8787"))
        assertTrue(BubbleApi.validServer("https://agent.example.com"))
        assertFalse(BubbleApi.validServer("https://user:secret@agent.example.com"))
        assertFalse(BubbleApi.validServer("file:///data/private"))
        assertFalse(BubbleApi.validServer("https://agent.example.com?token=secret"))
        assertFalse(BubbleApi.validServer("agent.example.com"))
    }
}
