// A test has no React instance to give the module its context: the legacy `BridgeReactContext` is the one to make.
@file:Suppress("DEPRECATION")

package dev.apexnative.keychain

import android.app.Activity
import android.app.Application
import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.PromiseImpl
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader
import org.junit.After
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * The module in an activity, as an app has it, with [Person] at the emulator to answer its prompts. The activity's
 * lifecycle reaches the module as ReactActivity passes it on: resumed and paused. Each test has a service of its own,
 * cleared after.
 */
abstract class PromptTestCase {
    internal val instrumentation = InstrumentationRegistry.getInstrumentation()
    internal val context = instrumentation.targetContext
    internal val reactContext = BridgeReactContext(context)
    internal val module = KeychainModule(reactContext)
    internal val service = "test.prompt.${UUID.randomUUID()}"
    internal val store = JavaOnlyMap().apply { putString("service", service) }
    internal lateinit var scenario: ActivityScenario<FragmentActivity>

    private val lifecycle = object : Application.ActivityLifecycleCallbacks {
        override fun onActivityResumed(activity: Activity) = reactContext.onHostResume(activity)
        override fun onActivityPaused(activity: Activity) = reactContext.onHostPause()
        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
        override fun onActivityStarted(activity: Activity) = Unit
        override fun onActivityStopped(activity: Activity) = Unit
        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
        override fun onActivityDestroyed(activity: Activity) = Unit
    }

    @Before
    fun showActivity() {
        Person.assumePresent()
        Person.unlock()
        SoLoader.init(context, OpenSourceMergedSoMapping)
        (context.applicationContext as Application).registerActivityLifecycleCallbacks(lifecycle)
        scenario = ActivityScenario.launch(FragmentActivity::class.java)
    }

    @After
    fun closeActivity() {
        if (!::scenario.isInitialized) return
        (context.applicationContext as Application).unregisterActivityLifecycleCallbacks(lifecycle)
        scenario.close()
        call { module.clear(store, it) }
        module.invalidate()
    }

    /** The activity in front again, after the home screen or Settings. */
    internal fun bringBack() {
        // As the launcher does: the task comes back with the activity in it.
        val launcher = Intent.makeMainActivity(ComponentName(context, FragmentActivity::class.java))
        context.startActivity(launcher.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        val deadline = System.currentTimeMillis() + Person.PATIENCE_MILLIS
        while (scenario.state != Lifecycle.State.RESUMED) {
            if (System.currentTimeMillis() > deadline) fail("The activity didn't come back")
            Thread.sleep(POLL_MILLIS)
        }
    }

    internal fun prompt(title: String) = JavaOnlyMap().apply {
        putString("title", title)
        putString("subtitle", "Subtitle")
        putString("description", "Description")
        putString("cancel", CANCEL)
        putBoolean("confirmationRequired", false)
    }

    internal fun options(accessControl: String, authValidity: Double = 0.0, accessible: String = "afterFirstUnlock") =
        JavaOnlyMap().apply {
            putString("accessible", accessible)
            putString("accessControl", accessControl)
            putDouble("authValidity", authValidity)
            putBoolean("synchronizable", false)
            putString("keyStorage", "tee")
        }

    internal fun write(
        key: String,
        accessControl: String,
        authValidity: Double = 0.0,
        accessible: String = "afterFirstUnlock",
        value: String = "secret of $key",
    ) {
        val options = options(accessControl, authValidity, accessible)
        val answer = call { module.setItem(store, key, value, "utf8", options, it) }
        assertNull(answer.error?.getString("message"), answer.error)
    }

    /** Starts a read; its prompt, if it has one, is titled [title]. */
    internal fun read(key: String, title: String): Started =
        start { module.getItem(store, key, "utf8", prompt(title), it) }

    /** How a read ended: its item's value, or null — no item — or its error. */
    internal class Answer(val value: String?, val isNull: Boolean, val error: ReadableMap?) {
        val code: String? get() = error?.getString("code")

        val nativeCode: Int? get() = error?.getMap("userInfo")?.takeIf { it.hasKey("nativeCode") }?.getInt("nativeCode")
    }

    internal class Raw(val value: Any?, val error: ReadableMap?)

    internal class Started(private val settled: CountDownLatch, private val answer: () -> Raw) {
        val pending: Boolean get() = settled.count > 0

        fun raw(seconds: Long = PATIENCE_SECONDS): Raw {
            assertTrue("no answer in time", settled.await(seconds, TimeUnit.SECONDS))
            return answer()
        }

        fun await(seconds: Long = PATIENCE_SECONDS): Answer = raw(seconds).let {
            Answer((it.value as? ReadableMap)?.getString("value"), it.value == null && it.error == null, it.error)
        }
    }

    internal fun start(method: (Promise) -> Unit): Started {
        val settled = CountDownLatch(1)
        var raw: Raw? = null
        method(
            PromiseImpl(
                { args ->
                    raw = Raw(args.firstOrNull(), null)
                    settled.countDown()
                },
                { args ->
                    raw = Raw(null, args.first() as ReadableMap)
                    settled.countDown()
                },
            ),
        )
        return Started(settled) { raw!! }
    }

    internal fun call(method: (Promise) -> Unit): Raw = start(method).raw()

    internal companion object {
        const val CANCEL = "Not now"
        const val PATIENCE_SECONDS = 30L
        const val POLL_MILLIS = 100L
    }
}
