package dev.apexnative.keychain

import android.app.Application
import android.content.ComponentCallbacks2
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.lifecycle.Lifecycle
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeFalse
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * The prompt, answered by [Person] at the emulator: a finger on the sensor, a strange finger, the cancel button, the
 * PIN, the home button, a finger enrolled in Settings. Each read's prompt has a title of its own, by which the test
 * knows which prompt shows.
 */
@RunWith(AndroidJUnit4::class)
class PromptTest : PromptTestCase() {
    @Test
    fun aFingerReadsTheItem() {
        write("finger", "biometryCurrentSet")
        val accepted = Person.recognitions()
        val reading = read("finger", "Finger")
        Person.prompt("Finger")
        for (text in listOf("Subtitle", "Description", CANCEL)) assertTrue(text, Person.sees(text))
        Person.touch(Person.finger)
        assertEquals("secret of finger", reading.await().value)
        if (Person.counts) Person.waitUntil("the sensor counts one finger") { Person.recognitions() == accepted + 1 }
    }

    @Test
    fun theCancelButtonIsUserCanceled() {
        write("cancel", "biometryAny")
        val reading = read("cancel", "Cancel")
        Person.prompt("Cancel")
        Person.tap(CANCEL)
        val answer = reading.await()
        assertEquals("USER_CANCELED", answer.code)
        assertEquals(13, answer.nativeCode) // BiometricPrompt.ERROR_NEGATIVE_BUTTON
    }

    /** A finger the device doesn't know: the prompt says so and stays; the read waits for the next try. */
    @Test
    fun aStrangeFingerDoesntEndTheRead() {
        write("strange", "biometryAny")
        val rejected = Person.rejections()
        val reading = read("strange", "Strange")
        Person.prompt("Strange")
        Person.touch(Person.strangeFinger)
        // The service's count or, before Android 8, what the prompt says for a moment.
        val said = Person.sees("Not recognized")
        if (Person.counts) {
            Person.waitUntil("the sensor counts one strange finger") { Person.rejections() == rejected + 1 }
        } else {
            assertTrue("The prompt didn't say 'Not recognized': ${Person.screen()}", said)
        }
        assertTrue(Person.sees("Strange"))
        assertTrue(reading.pending)
        Person.touch(Person.finger)
        assertEquals("secret of strange", reading.await().value)
    }

    /**
     * Too many strange fingers. Android 15+ doesn't end the prompt with LOCKOUT: it asks for the PIN to recover
     * biometry, and goes on; the PIN's token then spoils the read's operation, so the finger that follows is
     * accepted and doesn't unlock the item, and the library shows the prompt once more. Before, the
     * read ends with LOCKOUT. A lockout is no reason not to use the access control: it stays available all along.
     */
    @Test
    fun aLockout() {
        write("lockout", "biometryAny")
        val reading = read("lockout", "Lockout")
        Person.prompt("Lockout")
        val available = mutableSetOf<Boolean>()
        fun checkAvailable() {
            val answer = call { module.canUseAccessControl("biometryAny", it) }.value as ReadableMap
            available += answer.getBoolean("available")
        }
        repeat(LOCKOUT_ATTEMPTS) {
            Person.touch(Person.strangeFinger)
            checkAvailable()
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            Person.enterPin()
            Person.prompt("Lockout")
            checkAvailable()
            val accepted = Person.recognitions()
            Person.touch(Person.finger)
            Person.waitUntil("the sensor counts the finger") { Person.recognitions() == accepted + 1 }
            // Shown once more, and the read waits for it.
            Thread.sleep(AGAIN_MILLIS)
            Person.prompt("Lockout")
            assertTrue(reading.pending)
            Person.touch(Person.finger)
            assertEquals("secret of lockout", reading.await().value)
        } else {
            assertEquals("LOCKOUT", reading.await().code)
            checkAvailable()
            // The PIN on the lock screen ends the lockout, for the tests after this one; Android 7 and 8 wait it out.
            Person.lockScreen()
            Person.unlock()
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) Thread.sleep(LOCKOUT_MILLIS)
        }
        assertEquals(setOf(true), available)
    }

    /** The passcode alone: the PIN's screen, with no cancel button of the library's. */
    @Test
    fun thePasscode() {
        assumeAndroid11()
        write("passcode", "passcode")
        val reading = read("passcode", "Passcode")
        Person.prompt("Passcode")
        assertFalse(Person.sees(CANCEL, GLANCE_MILLIS))
        Person.enterPin()
        assertEquals("secret of passcode", reading.await().value)
    }

    /** Either: a finger, or the PIN after 'Use PIN'. */
    @Test
    fun biometryOrThePasscode() {
        assumeAndroid11()
        write("either", "biometryAnyOrPasscode")
        val byFinger = read("either", "Either")
        Person.prompt("Either")
        Person.touch(Person.finger)
        assertEquals("secret of either", byFinger.await().value)

        val byPin = read("either", "Either, the PIN")
        Person.prompt("Either, the PIN")
        Person.tap(USE_PIN)
        Person.enterPin()
        assertEquals("secret of either", byPin.await().value)
    }

    /**
     * `authValidity`: the first read prompts, even right after the screen was unlocked with the PIN, which opens the
     * Keystore's window; the reads inside the window don't; the first read after it does again.
     */
    @Test
    fun aWindowNeedsOnePromptUntilItEnds() {
        assumeAndroid11()
        write("window", "biometryAny", authValidity = WINDOW_SECONDS.toDouble())
        val first = read("window", "Window")
        Person.prompt("Window")
        Person.touch(Person.finger)
        assertEquals("secret of window", first.await().value)
        val opened = System.currentTimeMillis()

        assertEquals("secret of window", read("window", "Inside, not expected").await(NO_PROMPT_SECONDS).value)

        Thread.sleep(maxOf(0, opened + WINDOW_SECONDS * 1_000 + 500 - System.currentTimeMillis()))
        val after = read("window", "After the window")
        Person.prompt("After the window")
        Person.touch(Person.finger)
        assertEquals("secret of window", after.await().value)
    }

    /**
     * The window outlives a pause — an activity on top, a share sheet — and ends when the app's UI goes to the
     * background. The system tells the app so with `onTrimMemory(TRIM_MEMORY_UI_HIDDEN)`, but never
     * a process under instrumentation, which it keeps in the foreground: the test sends it as the system's
     * `ActivityThread` does, through the `Application`.
     */
    @Test
    fun theWindowOutlivesAPauseNotTheBackground() {
        assumeAndroid11()
        write("window", "passcode", authValidity = 300.0)
        val first = read("window", "Window")
        Person.prompt("Window")
        Person.enterPin()
        assertEquals("secret of window", first.await().value)

        // A translucent activity of the test's on top: the activity pauses, the app's UI stays.
        scenario.moveToState(Lifecycle.State.STARTED)
        scenario.moveToState(Lifecycle.State.RESUMED)
        assertEquals("secret of window", read("window", "After a pause, not expected").await(NO_PROMPT_SECONDS).value)

        trimMemory(@Suppress("DEPRECATION") ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW)
        assertEquals("secret of window", read("window", "Low memory, not expected").await(NO_PROMPT_SECONDS).value)

        trimMemory(ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN)
        val after = read("window", "After the background")
        Person.prompt("After the background")
        Person.enterPin()
        assertEquals("secret of window", after.await().value)
    }

    // The passcode and `authValidity` need Android 11.
    private fun assumeAndroid11() =
        assumeTrue("The passcode and authValidity need Android 11", Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)

    private fun trimMemory(level: Int) =
        instrumentation.runOnMainSync { (context.applicationContext as Application).onTrimMemory(level) }

    /**
     * One window per service and access control: two items with the same access control, one
     * `whenUnlocked` — two Keystore keys — read after one prompt.
     */
    @Test
    fun oneWindowForTheServicesItems() {
        assumeAndroid11()
        write("unlocked", "passcode", authValidity = 300.0, accessible = "whenUnlocked")
        write("always", "passcode", authValidity = 300.0)
        val first = read("unlocked", "Both")
        val second = read("always", "Second, not expected")
        Person.prompt("Both")
        Person.enterPin()
        assertEquals("secret of unlocked", first.await().value)
        assertEquals("secret of always", second.await(NO_PROMPT_SECONDS).value)
        assertFalse(Person.sees("Second, not expected", GLANCE_MILLIS))
    }

    /** Two reads wait their turn, one prompt each, in the order they asked; a read without a prompt doesn't wait. */
    @Test
    fun promptsWaitTheirTurnAndPlainReadsDont() {
        write("first", "biometryAny")
        write("second", "biometryAny")
        write("plain", "none")
        val first = read("first", "First")
        val second = read("second", "Second")
        Person.prompt("First")
        assertEquals("secret of plain", read("plain", "Plain").await(NO_PROMPT_SECONDS).value)
        assertFalse(Person.sees("Second", GLANCE_MILLIS))
        assertTrue(first.pending && second.pending)

        Person.touch(Person.finger)
        assertEquals("secret of first", first.await().value)
        Person.prompt("Second")
        assertTrue(second.pending)
        Person.touch(Person.finger)
        assertEquals("secret of second", second.await().value)
    }

    /**
     * The home button while a prompt shows: the reads waiting behind it end SYSTEM_CANCELED at once; the shown one the
     * system closes, and says why — Android 11+ calls the home button the user's cancel. Back in the
     * app, the queue goes on. Before Android 9 the prompt is androidx.biometric's dialog in the activity, which nothing
     * closes: it's still there when the app comes back, and answers.
     */
    @Test
    fun theBackgroundCancels() {
        write("shown", "biometryAny")
        write("waiting", "biometryAny")
        val shown = read("shown", "Shown")
        val waiting = read("waiting", "Waiting")
        Person.prompt("Shown")
        Person.pressHome()
        assertEquals("SYSTEM_CANCELED", waiting.await().code)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val expected = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) "USER_CANCELED" else "SYSTEM_CANCELED"
            assertEquals(expected, shown.await().code)
            // Nor does the read behind it get its prompt, over the home screen, before the activity's pause comes.
            assertFalse(Person.sees("Waiting", GLANCE_MILLIS))
            bringBack()
        } else {
            assertTrue(shown.pending)
            bringBack()
            Person.prompt("Shown")
            Person.touch(Person.finger)
            assertEquals("secret of shown", shown.await().value)
        }

        val again = read("waiting", "Again")
        Person.prompt("Again")
        Person.touch(Person.finger)
        assertEquals("secret of waiting", again.await().value)
    }

    // An item changed while its read waits for the prompt: the read starts over, and finds the new item or none.

    @Test
    fun aRemoveDuringThePromptReadsNothing() {
        write("token", "biometryAny")
        val reading = read("token", "Removed")
        Person.prompt("Removed")
        assertNull(call { module.removeItem(store, "token", it) }.error)
        Person.touch(Person.finger)
        val answer = reading.await()
        assertNull(answer.code, answer.code)
        assertTrue(answer.isNull)
    }

    /** A clear deletes the keys too: the read's operation outlives its key, a window's read finds no key. */
    @Test
    fun aClearDuringThePromptReadsNothing() {
        val windows = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) listOf(0.0, 30.0) else listOf(0.0)
        for (authValidity in windows) {
            write("token", "biometryAny", authValidity = authValidity)
            val reading = read("token", "Cleared, $authValidity")
            Person.prompt("Cleared, $authValidity")
            assertNull(call { module.clear(store, it) }.error)
            Person.touch(Person.finger)
            val answer = reading.await()
            assertNull(answer.code, answer.code)
            assertTrue(answer.isNull)
        }
    }

    /** A new item with access control needs its own prompt: the old one's operation can't open it. */
    @Test
    fun aWriteDuringThePromptReadsTheNewItem() {
        write("token", "biometryAny")
        val reading = read("token", "Written")
        Person.prompt("Written")
        write("token", "biometryAny", value = "new secret")
        Person.touch(Person.finger)
        Thread.sleep(AGAIN_MILLIS)
        Person.prompt("Written")
        assertTrue(reading.pending)
        Person.touch(Person.finger)
        assertEquals("new secret", reading.await().value)

        val plain = read("token", "Written plain")
        Person.prompt("Written plain")
        write("token", "none", value = "plain secret")
        Person.touch(Person.finger)
        assertEquals("plain secret", plain.await().value)
    }

    /**
     * Migration: a react-native-keychain entry in RSA, whose key has a window of 5 seconds, read through the prompt
     * queue, then removed.
     */
    @Test
    fun aProtectedLegacyItem() {
        val alias = "prompt.legacy"
        val publicKey = rnkRsaKey(alias)
        val encrypt = { text: String ->
            val cipher = Cipher.getInstance("RSA/ECB/PKCS1Padding")
            cipher.init(Cipher.ENCRYPT_MODE, publicKey)
            Base64.encodeToString(cipher.doFinal(text.toByteArray()), Base64.DEFAULT)
        }
        // rnk 8's SharedPreferences, where the module looks too.
        val preferences = context.getSharedPreferences("RN_KEYCHAIN", 0)
        preferences.edit().putString("$alias:u", encrypt("ivan")).putString("$alias:p", encrypt("rnk secret"))
            .putString("$alias:c", "KeystoreRSAECB").commit()
        try {
            val query = JavaOnlyMap().apply {
                putString("library", "reactNativeKeychain")
                putArray("services", JavaOnlyArray.of(alias))
                putArray("servers", JavaOnlyArray())
            }
            val sources = call { module.getMigrationSources(query, it) }.value as ReadableArray
            val source = sources.getMap(0)!!
            assertTrue(source.getBoolean("requiresAuth"))
            val reading = start { module.readMigrationSource(source, prompt("Legacy"), it) }
            Person.prompt("Legacy")
            Person.touch(Person.finger)
            assertEquals("rnk secret", reading.raw().value)
            assertNull(call { module.finishMigrationSource(source, true, it) }.error)
            assertTrue(preferences.all.keys.none { it.startsWith(alias) })
        } finally {
            preferences.edit().clear().commit()
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(alias)
        }
    }

    // react-native-keychain's RSA key: PKCS#1, a window of 5 seconds of biometry or the passcode.
    private fun rnkRsaKey(alias: String): java.security.PublicKey {
        val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_ECB)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_PKCS1)
            .setUserAuthenticationRequired(true)
            .setKeySize(2048)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            spec.setUserAuthenticationParameters(
                5,
                KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL,
            )
        } else {
            @Suppress("DEPRECATION")
            spec.setUserAuthenticationValidityDurationSeconds(5)
        }
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore")
        generator.initialize(spec.build())
        val public = generator.generateKeyPair().public
        return KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(public.encoded))
    }

    /**
     * A new fingerprint, enrolled in Settings: the Keystore invalidates the keys of `biometryCurrentSet` — the read
     * ends KEY_INVALIDATED, from `KeyPermanentlyInvalidatedException`, without a prompt, and the item is gone —
     * `getBiometryState` changes, and `biometryAny` reads with the new finger. The finger is deleted after. A key of
     * the test's own witnesses that the Keystore saw the new finger at all. The emulator's fingerprint HAL before
     * Android 10 keeps its authenticator id across enrollments (the API 24 and 28 images), so nothing is ever
     * invalidated there; on API 24 deleting the finger also leaves the sensor deaf to the next prompts.
     */
    @Test
    fun aNewFingerprintInvalidatesCurrentSet() {
        val oldEmulator = Setup.console != null && Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
        assumeFalse("The emulator's fingerprint HAL before Android 10 keeps its authenticator id", oldEmulator)
        write("currentSet", "biometryCurrentSet")
        write("any", "biometryAny")
        val before = call { module.getBiometryState(it) }.value as String
        val witness = witnessKey()
        val newFinger = (Setup.fingers.max() + 1..Setup.fingers.max() + 9).first { it != Person.strangeFinger }
        val name = Person.enrollFinger(newFinger)
        try {
            bringBack()
            val seen = invalidated(witness)
            assumeTrue("The fingerprint HAL keeps its authenticator id: the Keystore can't see a new finger", seen)
            assertNotEquals(before, call { module.getBiometryState(it) }.value)

            val invalidated = read("currentSet", "Invalidated, not expected").await(NO_PROMPT_SECONDS)
            assertEquals("KEY_INVALIDATED", invalidated.code)
            assertEquals(
                "android.security.keystore.KeyPermanentlyInvalidatedException",
                invalidated.error?.getMap("userInfo")?.getString("nativeDomain"),
            )
            assertEquals(false, call { module.hasItem(store, "currentSet", it) }.value)

            val any = read("any", "Any")
            Person.prompt("Any")
            Person.touch(newFinger)
            assertEquals("secret of any", any.await().value)
        } finally {
            Person.deleteFinger(name)
            bringBack()
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(WITNESS)
        }
    }

    // A key a new fingerprint invalidates, as `biometryCurrentSet`'s are, made by the test itself.
    private fun witnessKey(): SecretKey {
        val spec = KeyGenParameterSpec.Builder(WITNESS, KeyProperties.PURPOSE_ENCRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(spec.build())
            generateKey()
        }
    }

    private fun invalidated(key: SecretKey) = try {
        Cipher.getInstance("AES/GCM/NoPadding").init(Cipher.ENCRYPT_MODE, key)
        false
    } catch (e: KeyPermanentlyInvalidatedException) {
        true
    }

    private companion object {
        const val WITNESS = "apexnative.keychain.test/witness"
        const val USE_PIN = "Use PIN"
        const val LOCKOUT_ATTEMPTS = 5
        const val LOCKOUT_MILLIS = 31_000L
        const val WINDOW_SECONDS = 5
        const val NO_PROMPT_SECONDS = 5L
        const val GLANCE_MILLIS = 1_500L
        const val AGAIN_MILLIS = 1_000L
    }
}
