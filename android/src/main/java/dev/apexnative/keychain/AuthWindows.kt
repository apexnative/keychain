package dev.apexnative.keychain

import android.os.SystemClock
import java.util.concurrent.ConcurrentHashMap

/**
 * The library's own windows of `authValidity`, as iOS keeps its `LAContext`: when the last
 * prompt for a service and an access control succeeded. The Keystore opens its window on any authentication of a key's
 * kinds, unlocking the screen included, and for every key with a window at once; a read goes without a prompt only
 * while both windows are open. So the first read after the app starts or comes back from the background shows a
 * prompt, and one prompt serves every item of the service with that access control, as on iOS.
 */
internal class AuthWindows(private val now: () -> Long = SystemClock::elapsedRealtime) {
    // When each window opened, in milliseconds of [now], by service and access control.
    private val opened = ConcurrentHashMap<Pair<String, AccessControl>, Long>()

    fun isOpen(service: String, accessControl: AccessControl, seconds: Int): Boolean {
        val at = opened[service to accessControl] ?: return false
        return now() - at < seconds * MILLIS_PER_SECOND
    }

    fun open(service: String, accessControl: AccessControl) {
        opened[service to accessControl] = now()
    }

    /** The app went to the background: every window closes. */
    fun closeAll() = opened.clear()

    private companion object {
        const val MILLIS_PER_SECOND = 1_000L
    }
}
