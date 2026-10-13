package dev.agentbubble

import android.app.Application

class BubbleApplication : Application() {
    val model: BubbleModel by lazy { BubbleModel(this) }
}
