// A test has no React instance to give the module its context: the legacy `BridgeReactContext` is the one to make.
@file:Suppress("DEPRECATION")

package dev.apexnative.keychain

import android.content.pm.PackageManager
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.PromiseImpl
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.BeforeClass
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * The module as JavaScript calls it: the arguments as the codegen passes them, the answers and the rejections in the
 * shapes of src/native/NativeApexKeychain.ts. It uses the process's storage, in a service of its own.
 */
@RunWith(AndroidJUnit4::class)
class KeychainModuleTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val module = KeychainModule(BridgeReactContext(context))
    private val service = "test.module.${UUID.randomUUID()}"
    private val store = JavaOnlyMap().apply { putString("service", service) }

    private val prompt = JavaOnlyMap().apply { putBoolean("confirmationRequired", true) }
    private val device = SystemDevice(context)

    private fun options(label: String? = null, accessControl: String = "none", authValidity: Double = 0.0) =
        JavaOnlyMap().apply {
            putString("accessible", "afterFirstUnlock")
            putString("accessControl", accessControl)
            putDouble("authValidity", authValidity)
            putBoolean("synchronizable", false)
            putString("keyStorage", "tee")
            label?.let { putString("label", it) }
        }

    @After
    fun clear() {
        call { module.clear(store, it) }
    }

    @Test
    fun storage() {
        assertNull(call { module.setItem(store, "token", "c2VjcmV0", "base64", options("ivan"), it) }.value)

        val item = call { module.getItem(store, "token", "utf8", prompt, it) }.value as ReadableMap
        assertEquals("secret", item.getString("value"))
        assertEquals("ivan", item.getString("label"))
        assertEquals(true, call { module.hasItem(store, "token", it) }.value)

        val info = call { module.getItemInfo(store, "token", it) }.value as ReadableMap
        assertEquals("token", info.getString("key"))
        assertEquals("ivan", info.getString("label"))
        assertEquals("afterFirstUnlock", info.getString("accessible"))
        assertEquals("none", info.getString("accessControl"))
        assertFalse(info.getBoolean("synchronizable"))
        assertTrue(info.getDouble("createdAt") > 1.7e12)
        assertEquals(info.getDouble("createdAt"), info.getDouble("modifiedAt"), 0.0)
        // A key of the TEE's profile: where the Keystore attests such a key lives.
        assertEquals(Attestation.securityLevel().jsName, info.getString("securityLevel"))

        val keys = call { module.getAllKeys(store, it) }.value as ReadableArray
        assertEquals(listOf("token"), keys.toArrayList())

        assertNull(call { module.removeItem(store, "token", it) }.value)
        assertNull(call { module.getItem(store, "token", "utf8", prompt, it) }.value)
        assertEquals(false, call { module.hasItem(store, "token", it) }.value)
        assertNull(call { module.getItemInfo(store, "token", it) }.value)
    }

    @Test
    fun anEmptyLabelCrossesAsALabel() {
        call { module.setItem(store, "empty", "v", "utf8", options(""), it) }
        call { module.setItem(store, "none", "v", "utf8", options(), it) }
        val empty = call { module.getItem(store, "empty", "utf8", prompt, it) }.value as ReadableMap
        assertEquals("", empty.getString("label"))
        val none = call { module.getItem(store, "none", "utf8", prompt, it) }.value as ReadableMap
        assertFalse(none.hasKey("label"))
        assertEquals("", (call { module.getItemInfo(store, "empty", it) }.value as ReadableMap).getString("label"))
        assertFalse((call { module.getItemInfo(store, "none", it) }.value as ReadableMap).hasKey("label"))
    }

    @Test
    fun aRejectionHasTheCodeAndTheNativeDetails() {
        val currentSetWithWindow = options(accessControl = "biometryCurrentSet", authValidity = 30.0)
        val forbidden = call { module.setItem(store, "k", "v", "utf8", currentSetWithWindow, it) }
        assertEquals("INVALID_ARGUMENT", forbidden.error?.getString("code"))

        val invalid = call { module.setItem(store, "k", "v", "hex", options(), it) }
        assertEquals("INVALID_ARGUMENT", invalid.error?.getString("code"))
        assertTrue(invalid.error!!.getString("message")!!.isNotEmpty())

        call { module.setItem(store, "bytes", "/w==", "base64", options(), it) }
        val notText = call { module.getItem(store, "bytes", "utf8", prompt, it) }
        assertEquals("INVALID_ARGUMENT", notText.error?.getString("code"))
    }

    @Test
    fun nativeDetailsGoInTheUserInfo() {
        val error = KeychainException(
            KeychainErrorCode.DATA_CORRUPTED,
            "damaged",
            nativeCode = -30,
            nativeDomain = "javax.crypto.AEADBadTagException",
        )
        val rejection = call { it.rejectWith(error) }.error!!
        assertEquals("DATA_CORRUPTED", rejection.getString("code"))
        assertEquals("damaged", rejection.getString("message"))
        val userInfo = rejection.getMap("userInfo")!!
        assertEquals(-30, userInfo.getInt("nativeCode"))
        assertEquals("javax.crypto.AEADBadTagException", userInfo.getString("nativeDomain"))

        val failure = failure(error).getMap("error")!!
        assertEquals("DATA_CORRUPTED", failure.getString("code"))
        assertEquals("damaged", failure.getString("message"))
        assertEquals(-30, failure.getInt("nativeCode"))
        assertEquals("javax.crypto.AEADBadTagException", failure.getString("nativeDomain"))

        val plain = call { it.rejectWith(KeychainException(KeychainErrorCode.AUTH_REQUIRED, "prompt")) }.error!!
        assertFalse(plain.getMap("userInfo")?.hasKey("nativeCode") ?: false)
    }

    @Test
    fun synchronousMethods() {
        assertEquals(0, module.setItemSync(store, "token", "текст", options()).toHashMap().size)
        assertEquals("текст", module.getItemSync(store, "token").getString("value"))
        assertEquals(true, module.hasItemSync(store, "token").getBoolean("value"))
        assertEquals(0, module.removeItemSync(store, "token").toHashMap().size)
        assertFalse(module.getItemSync(store, "token").hasKey("value"))
        assertEquals(false, module.hasItemSync(store, "token").getBoolean("value"))
    }

    @Test
    fun aSynchronousMethodReturnsItsFailure() {
        val result = module.setItemSync(store, "", "v", options())
        val error = result.getMap("error")!!
        assertEquals("INVALID_ARGUMENT", error.getString("code"))
        assertTrue(error.getString("message")!!.isNotEmpty())

        val currentSetWithWindow = options(accessControl = "biometryCurrentSetOrPasscode", authValidity = 5.0)
        val forbidden = module.setItemSync(store, "k", "v", currentSetWithWindow).getMap("error")!!
        assertEquals("INVALID_ARGUMENT", forbidden.getString("code"))
    }

    @Test
    fun aProtectedReadWithoutAnActivityIsNoActivity() {
        val android11 = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
        assumeTrue("Needs a screen lock and Android 11", device.isSecure && android11)
        assertNull(call { module.setItem(store, "token", "v", "utf8", options(accessControl = "passcode"), it) }.error)
        // A test has no activity: the prompt has nowhere to go.
        val read = call { module.getItem(store, "token", "utf8", prompt, it) }
        assertEquals("NO_ACTIVITY", read.error?.getString("code"))
        // The synchronous read doesn't even try.
        assertEquals("AUTH_REQUIRED", module.getItemSync(store, "token").getMap("error")?.getString("code"))
        // Writing with access control shows no prompt, synchronously too.
        assertEquals(0, module.setItemSync(store, "token", "w", options(accessControl = "passcode")).toHashMap().size)
    }

    @Test
    fun theDeviceInTheContractsShapes() {
        val none = call { module.canUseAccessControl("none", it) }.value as ReadableMap
        assertTrue(none.getBoolean("available"))
        assertFalse(none.hasKey("reason"))
        assertEquals("INVALID_ARGUMENT", call { module.canUseAccessControl("faceID", it) }.error?.getString("code"))
    }

    /**
     * The emulator as scripts/test-android.sh describes it: a PIN, fingers enrolled, a fingerprint sensor only, no
     * StrongBox; its keys where the Keystore attests them.
     */
    @Test
    fun theEmulatorAsItIsSetUp() {
        Person.assumePresent()
        assertEquals(true, call { module.isPasscodeSet(it) }.value)
        for (accessControl in AccessControl.entries) {
            val answer = call { module.canUseAccessControl(accessControl.jsName, it) }.value as ReadableMap
            // Before Android 11 the passcode variants can't be.
            val unsupported = accessControl.allowsPasscode && Build.VERSION.SDK_INT < Build.VERSION_CODES.R
            assertEquals(accessControl.jsName, !unsupported, answer.getBoolean("available"))
            assertEquals(accessControl.jsName, if (unsupported) "unsupportedOS" else null, answer.getString("reason"))
        }
        assertEquals(listOf("fingerprint"), (call { module.getBiometryTypes(it) }.value as ReadableArray).toArrayList())
        val state = call { module.getBiometryState(it) }.value as String
        assertTrue(state, state.matches(Regex("[0-9a-f]{16}")))
        assertEquals(state, call { module.getBiometryState(it) }.value)
        assertFalse(context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE))
        assertEquals(Attestation.securityLevel().jsName, call { module.getHardwareSecurityLevel(it) }.value)
    }

    /**
     * A synchronous call runs after the asynchronous ones JavaScript made before it, as on iOS: a read sees a write
     * that wasn't awaited. The executor is held until both are queued, so that the write can't be done first by luck.
     */
    @Test
    fun aSynchronousCallWaitsForTheCallsBeforeIt() {
        val held = CountDownLatch(1)
        KeychainExecutor.execute { held.await() }
        val written = CountDownLatch(1)
        module.setItem(store, "token", "unawaited", "utf8", options(), PromiseImpl({ written.countDown() }, {}))
        val javaScript = Executors.newSingleThreadExecutor()
        try {
            val read = javaScript.submit<ReadableMap> { module.getItemSync(store, "token") }
            val removed = javaScript.submit<ReadableMap> {
                module.removeItem(store, "token", PromiseImpl({}, {}))
                module.hasItemSync(store, "token")
            }
            val deadline = System.currentTimeMillis() + 10_000
            while (KeychainExecutor.queue.size < 2 && System.currentTimeMillis() < deadline) Thread.sleep(10)
            assertFalse("the synchronous read didn't wait", read.isDone)
            held.countDown()
            assertEquals("unawaited", read.get(10, TimeUnit.SECONDS).getString("value"))
            assertFalse(removed.get(10, TimeUnit.SECONDS).getBoolean("value"))
            assertTrue(written.await(10, TimeUnit.SECONDS))
        } finally {
            held.countDown()
            javaScript.shutdown()
        }
    }

    @Test
    fun theDefaultService() {
        assertEquals(context.packageName, module.getDefaultService())
    }

    private class Answer(val value: Any?, val error: ReadableMap?)

    /** Calls an asynchronous method and waits for its promise: its value, or the error object JavaScript gets. */
    private fun call(method: (Promise) -> Unit): Answer {
        val settled = CountDownLatch(1)
        var answer: Answer? = null
        method(
            PromiseImpl(
                { args ->
                    answer = Answer(args.firstOrNull(), null)
                    settled.countDown()
                },
                { args ->
                    answer = Answer(null, args.first() as ReadableMap)
                    settled.countDown()
                },
            ),
        )
        assertTrue(settled.await(30, TimeUnit.SECONDS))
        return answer!!
    }

    companion object {
        // Promises and maps live in React Native's C++.
        @BeforeClass
        @JvmStatic
        fun loadReactNative() {
            SoLoader.init(InstrumentationRegistry.getInstrumentation().targetContext, OpenSourceMergedSoMapping)
        }
    }
}
