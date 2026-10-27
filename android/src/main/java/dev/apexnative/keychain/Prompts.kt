package dev.apexnative.keychain

import android.content.ComponentCallbacks2
import android.content.res.Configuration
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.biometric.BiometricManager.Authenticators
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactApplicationContext

/**
 * The prompts of protected reads: one `BiometricPrompt` at a time, in the order the reads asked; reads
 * without authentication never come here. The queue lives on the main thread; the reads' crypto stays on
 * [KeychainExecutor]. When the activity pauses, the reads still waiting are SYSTEM_CANCELED; the prompt that's showing
 * is closed by the system, which says why — Android 11+ calls the home button the user's cancel — or, before Android 9,
 * stays in the activity until the user answers it. When the app's UI goes
 * to the background, [onBackground] closes the windows of `authValidity`, as iOS does on `didEnterBackground`: a
 * dialog or an activity on top of the app's (a share sheet, a permission request) leaves them open.
 */
internal class PromptQueue(
    private val context: ReactApplicationContext,
    private val onBackground: () -> Unit,
) : LifecycleEventListener {
    /**
     * A read waiting for its prompt. [reread] reads the item again; with [rereadAtTurn] — a key with a time window — it
     * does when the read's turn comes, since another prompt may have opened the window already.
     */
    class Request(
        val texts: PromptTexts,
        val read: Keychain.Read.Authenticate,
        val reread: () -> Keychain.Read,
        val rereadAtTurn: Boolean,
        val resolve: (Keychain.Item?) -> Unit,
        val reject: (KeychainException) -> Unit,
        /** Whether this is the prompt shown once more after one whose operation couldn't be used. */
        val again: Boolean = false,
    ) {
        // Settled once: a prompt the queue gave up on may still call back.
        var done = false

        /** The same read, its prompt shown once more with a new operation. */
        fun once() = Request(texts, read, reread, rereadAtTurn = true, resolve, reject, again = true)
    }

    private val main = Handler(Looper.getMainLooper())
    private val waiting = ArrayDeque<Request>()
    private var current: Request? = null
    private var currentPrompt: BiometricPrompt? = null
    private var listening = false

    // The read whose prompt was showing when the app paused.
    private var showingAtPause: Request? = null

    private val background = object : ComponentCallbacks2 {
        override fun onTrimMemory(level: Int) {
            if (level >= ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN) onBackground()
        }

        override fun onConfigurationChanged(newConfig: Configuration) = Unit

        @Deprecated("Deprecated in Java")
        override fun onLowMemory() = Unit
    }

    init {
        context.applicationContext.registerComponentCallbacks(background)
    }

    fun enqueue(request: Request) {
        main.post {
            if (!listening) {
                context.addLifecycleEventListener(this)
                listening = true
            }
            waiting.addLast(request)
            next()
        }
    }

    /**
     * The system closes a prompt when its app leaves the foreground, and says so — almost always: when too many failed
     * attempts send Android 16 to the lock screen, the prompt never calls back. Its read ends when the app comes back.
     */
    override fun onHostResume() {
        val stale = showingAtPause ?: return
        showingAtPause = null
        main.post {
            if (current !== stale) return@post
            currentPrompt?.cancelAuthentication()
            finish(stale) { stale.reject(promptError(BiometricPrompt.ERROR_CANCELED)) }
        }
    }

    // On the main thread, before anything else there: no waiting read gets its prompt after the app has gone.
    override fun onHostPause() {
        cancelWaiting()
        // Before Android 9 the prompt is androidx.biometric's own dialog, in the activity, and nothing cancels it: it
        // waits there for the user to come back and answer it. A cancel would leave the dialog, and androidx.biometric
        // would show no prompt after it. The real version, not the device's: it's androidx.biometric that chooses.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return
        showingAtPause = current
    }

    // A prompt whose activity is gone may never call back: its read ends here, so that the queue doesn't stop.
    override fun onHostDestroy() {
        cancelWaiting()
        current?.let { request -> finish(request) { request.reject(promptError(BiometricPrompt.ERROR_CANCELED)) } }
    }

    /** The end of the module: the reads still waiting end too. */
    fun close() {
        main.post {
            context.removeLifecycleEventListener(this)
            context.applicationContext.unregisterComponentCallbacks(background)
            cancelWaiting()
        }
    }

    private fun cancelWaiting() {
        while (waiting.isNotEmpty()) {
            val request = waiting.removeFirst()
            request.done = true
            request.reject(promptError(BiometricPrompt.ERROR_CANCELED))
        }
    }

    private fun next() {
        if (current != null) return
        begin(waiting.removeFirstOrNull() ?: return)
    }

    // The read's turn: its prompt, or first a read again.
    private fun begin(request: Request) {
        current = request
        if (!request.rereadAtTurn) return show(request, request.read)
        KeychainExecutor.execute {
            val read = try {
                request.reread()
            } catch (e: Exception) {
                main.post { finish(request) { request.reject(e.toKeychainException()) } }
                return@execute
            }
            main.post {
                // Ended meanwhile: the app went to the background.
                if (request.done) return@post
                when (read) {
                    is Keychain.Read.Value -> finish(request) { request.resolve(read.item) }
                    is Keychain.Read.Authenticate -> show(request, read)
                }
            }
        }
    }

    /**
     * The request is done: the next one's turn, on a later pass of the main thread. A prompt shown from inside the
     * previous one's callback would share the fragment androidx.biometric is removing then, and never call back.
     * [pauseMillis] later when the prompt may have closed because the app is leaving: the activity's pause can come
     * after the prompt's error, and the next prompt would show over the home screen.
     */
    private fun finish(request: Request, pauseMillis: Long = 0, settle: () -> Unit) {
        if (request.done) return
        request.done = true
        if (current === request) {
            current = null
            currentPrompt = null
        }
        settle()
        main.postDelayed({ next() }, pauseMillis)
    }

    // The read ended after its prompt: the operation that couldn't be used gets its prompt once more, with a new one.
    private fun failedAfterPrompt(request: Request, error: KeychainException) {
        if (error is PromptAgainException && !request.again && !request.done && current === request) {
            request.done = true
            begin(request.once())
        } else {
            finish(request) { request.reject(error) }
        }
    }

    private fun show(request: Request, read: Keychain.Read.Authenticate) {
        val activity = context.currentActivity
        if (activity !is FragmentActivity || activity.isFinishing || activity.isDestroyed) {
            val error = KeychainException(KeychainErrorCode.NO_ACTIVITY, "There's no activity to show the prompt in.")
            return finish(request) { request.reject(error) }
        }
        // Paused, on its way to the background: the system would close the prompt anyway.
        if (activity.supportFragmentManager.isStateSaved ||
            !activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
        ) {
            return finish(request) { request.reject(promptError(BiometricPrompt.ERROR_CANCELED)) }
        }
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            // The read ends on the executor; the queue goes on when it has, so that a prompt shown once more comes
            // before the next read's.
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                val unlocked = result.cryptoObject?.cipher
                currentPrompt = null
                KeychainExecutor.execute {
                    val item = try {
                        read.finish(unlocked)
                    } catch (e: Exception) {
                        main.post { failedAfterPrompt(request, e.toKeychainException()) }
                        return@execute
                    }
                    main.post { finish(request) { request.resolve(item) } }
                }
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                // Closed by the system or by the user — the home button among the ways; the cancel button is the
                // app's.
                val leaving =
                    errorCode == BiometricPrompt.ERROR_CANCELED || errorCode == BiometricPrompt.ERROR_USER_CANCELED
                finish(request, if (leaving) LEAVING_MILLIS else 0) { request.reject(promptError(errorCode)) }
            }
        }
        try {
            // The previous prompt's fragment is gone before this one's comes.
            activity.supportFragmentManager.executePendingTransactions()
            val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback)
            currentPrompt = prompt
            val info = promptInfo(request.texts, read.accessControl, activity)
            val cipher = read.cipher
            if (cipher != null) {
                prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
            } else {
                prompt.authenticate(info)
            }
        } catch (e: Exception) {
            finish(request) { request.reject(e.toKeychainException()) }
        }
    }

    /**
     * The prompt for the access control: Class 3 biometry, the passcode, or either. With the passcode
     * there's no negative button: the passcode's screen has its own way back.
     */
    private fun promptInfo(texts: PromptTexts, accessControl: AccessControl, activity: FragmentActivity) =
        BiometricPrompt.PromptInfo.Builder()
            // The app's name when there's no title: the prompt needs one.
            .setTitle(texts.title?.takeIf { it.isNotEmpty() } ?: appName(activity))
            .setSubtitle(texts.subtitle)
            .setDescription(texts.description)
            .setConfirmationRequired(texts.confirmationRequired)
            .setAllowedAuthenticators(
                (if (accessControl.allowsBiometry) Authenticators.BIOMETRIC_STRONG else 0) or
                    (if (accessControl.allowsPasscode) Authenticators.DEVICE_CREDENTIAL else 0),
            )
            .apply {
                if (!accessControl.allowsPasscode) {
                    setNegativeButtonText(
                        texts.cancel?.takeIf { it.isNotEmpty() } ?: activity.getString(android.R.string.cancel),
                    )
                }
            }
            .build()

    private fun appName(activity: FragmentActivity) = activity.applicationInfo.loadLabel(activity.packageManager)
}

// How long the next prompt waits after one the system or the user closed: the activity's pause, if the app is leaving,
// comes within it — tens of milliseconds after the prompt's error on Android 16.
private const val LEAVING_MILLIS = 500L
