package dev.apexnative.keychain

import com.facebook.react.bridge.JavaOnlyMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OptionsTest {
    private val defaults = mapOf(
        "accessible" to "whenUnlocked",
        "accessControl" to "none",
        "authValidity" to 0.0,
        "synchronizable" to false,
        "keyStorage" to "strongbox",
        "label" to "ivan",
    )

    private fun options(vararg changes: Pair<String, Any?>) = map(defaults + changes)

    private fun without(name: String) = map(defaults - name)

    // What JavaScript passes: strings, numbers as doubles, booleans and nulls.
    private fun map(values: Map<String, Any?>) = JavaOnlyMap().apply {
        for ((name, value) in values) {
            when (value) {
                null -> putNull(name)
                is String -> putString(name, value)
                is Double -> putDouble(name, value)
                is Boolean -> putBoolean(name, value)
                else -> error("$name: $value")
            }
        }
    }

    @Test
    fun readsEveryOption() {
        assertEquals(
            WriteOptions(Accessible.WHEN_UNLOCKED, AccessControl.NONE, 0, KeyStorage.STRONGBOX, "ivan"),
            WriteOptions.of(options()),
        )
        assertEquals(30, WriteOptions.of(options("authValidity" to 30.0)).authValidity)
        assertNull(WriteOptions.of(options("label" to null)).label)
        assertNull(WriteOptions.of(without("label")).label)
        // An empty label is a label.
        assertEquals("", WriteOptions.of(options("label" to "")).label)
    }

    @Test
    fun everyNameOfTheContract() {
        for (accessible in Accessible.entries) {
            assertEquals(accessible, WriteOptions.of(options("accessible" to accessible.jsName)).accessible)
        }
        for (accessControl in AccessControl.entries) {
            assertEquals(accessControl, WriteOptions.of(options("accessControl" to accessControl.jsName)).accessControl)
        }
        for (keyStorage in KeyStorage.entries) {
            assertEquals(keyStorage, WriteOptions.of(options("keyStorage" to keyStorage.jsName)).keyStorage)
        }
        assertEquals(Encoding.UTF8, encodingOf("utf8"))
        assertEquals(Encoding.BASE64, encodingOf("base64"))
    }

    @Test
    fun aValueNativeDoesntKnowIsInvalidArgument() {
        for (bad in listOf(
            options("accessible" to "always"),
            options("accessControl" to "faceID"),
            options("keyStorage" to "tpm"),
            options("accessible" to null),
            options("accessible" to 1.0),
            options("label" to 5.0),
            options("authValidity" to 1.5),
            options("authValidity" to -1.0),
            options("authValidity" to "30"),
            without("authValidity"),
        )) {
            assertCode(KeychainErrorCode.INVALID_ARGUMENT) { WriteOptions.of(bad) }
        }
        assertCode(KeychainErrorCode.INVALID_ARGUMENT) { encodingOf("hex") }
    }

    @Test
    fun theServiceOfAStore() {
        assertEquals("vault", map(mapOf("service" to "vault", "accessGroup" to "group")).service())
        assertCode(KeychainErrorCode.INVALID_ARGUMENT) { JavaOnlyMap().service() }
    }
}
