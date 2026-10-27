package dev.apexnative.keychain

import android.os.Build
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.security.KeyStore
import java.security.PrivateKey

/**
 * Items with access control, as far as no prompt is needed: writing, what a read asks for, a key gone, what the
 * device can do. The prompt itself is PromptTest's. The tests that need real keys need the device to have a screen
 * lock and, for biometry, an enrolled fingerprint; without them they're skipped.
 */
@RunWith(AndroidJUnit4::class)
class AuthenticationTest : KeychainTestCase() {
    private val hasScreenLock = device.isSecure
    private val hasBiometry =
        device.canAuthenticate(Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS

    @Test
    fun writingNeedsNoPromptAndReadingDoes() {
        assumeTrue(NEEDS_LOCK_BIOMETRY_11, hasScreenLock && hasBiometry && device.sdk >= 30)
        for (accessControl in AccessControl.entries - AccessControl.NONE) {
            val key = accessControl.jsName
            keychain.setItem(service, key, "secret", Encoding.UTF8, options(accessControl = accessControl, label = key))
            assertTrue(keychain.hasItem(service, key))
            assertEquals(accessControl, keychain.getItemInfo(service, key)?.accessControl)
            assertEquals(key, keychain.getItemInfo(service, key)?.label)
            assertCode(KeychainErrorCode.AUTH_REQUIRED) { keychain.getItem(service, key, Encoding.UTF8) }
            val read = keychain.read(service, key, Encoding.UTF8) as Keychain.Read.Authenticate
            assertEquals(accessControl, read.accessControl)
            // Every read needs the prompt to unlock this very cipher.
            assertNotNull(read.cipher)
        }
        val written = (AccessControl.entries - AccessControl.NONE).map { it.jsName }.toSet()
        assertEquals(written, keychain.getAllKeys(service).toSet())
        // A key per access control, each an RSA key in the Keystore.
        val aliases = keystoreAliases(service)
        assertEquals(AccessControl.entries.size - 1, aliases.size)
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        for (alias in aliases) assertTrue(keyStore.getKey(alias, null) is PrivateKey)
    }

    @Test
    fun theFileHasTheWrappedKey() {
        assumeTrue(NEEDS_LOCK_11, hasScreenLock && device.sdk >= 30)
        val passcode = options(accessControl = AccessControl.PASSCODE)
        keychain.setItem(service, "token", "a visible secret", Encoding.UTF8, passcode)
        val item = storedItems(service).getValue("token")
        assertEquals(Scheme.RSA_OAEP_AES_GCM, item.scheme)
        assertEquals(256, Base64.decode(item.wrappedKey!!)!!.size)
        assertEquals(AesGcm.IV_BYTES, Base64.decode(item.iv)!!.size)
        assertFalse(storeFile(service).readText().contains("a visible secret"))
        assertEquals(Attestation.securityLevel(), keychain.getItemInfo(service, "token")!!.securityLevel)
    }

    @Test
    fun aTimeWindowIsKeptAndAskedForWhenClosed() {
        assumeTrue(NEEDS_LOCK_11, hasScreenLock && device.sdk >= 30)
        val oneSecond = options(accessControl = AccessControl.PASSCODE, authValidity = 1)
        keychain.setItem(service, "token", "v", Encoding.UTF8, oneSecond)
        assertEquals(1, storedItems(service).getValue("token").authValidity)
        Thread.sleep(1_500)
        // The window is closed: the prompt opens it, without a cipher of its own.
        val read = keychain.read(service, "token", Encoding.UTF8) as Keychain.Read.Authenticate
        assertNull(read.cipher)
        // Another window is another key.
        keychain.setItem(service, "other", "v", Encoding.UTF8, options(accessControl = AccessControl.PASSCODE))
        assertEquals(2, keystoreAliases(service).size)
    }

    /** The key gone — the app's data restored without its keys: a new fingerprint is PromptTest's. */
    @Test
    fun anItemWhoseKeyIsGoneIsInvalidatedAndDeleted() {
        assumeTrue(NEEDS_LOCK_11, hasScreenLock && device.sdk >= 30)
        keychain.setItem(service, "token", "v", Encoding.UTF8, options(accessControl = AccessControl.PASSCODE))
        val alias = storedItems(service).getValue("token").alias
        deleteKeystoreKey(alias)
        assertCode(KeychainErrorCode.KEY_INVALIDATED) { keychain.read(service, "token", Encoding.UTF8) }
        assertFalse(keychain.hasItem(service, "token"))
        // A new generation for the next write.
        keychain.setItem(service, "token", "again", Encoding.UTF8, options(accessControl = AccessControl.PASSCODE))
        assertNotEquals(alias, storedItems(service).getValue("token").alias)
        assertTrue(keychain.read(service, "token", Encoding.UTF8) is Keychain.Read.Authenticate)
    }

    @Test
    fun protectionIsNeverWeakerThanAsked() {
        device.isSecure = false
        device.authenticationStatus = BiometricManager.BIOMETRIC_SUCCESS
        for (accessControl in AccessControl.entries - AccessControl.NONE) {
            assertCode(code(accessControl, UnavailableReason.PASSCODE_NOT_SET)) { write(accessControl) }
        }
        device.isSecure = true
        device.authenticationStatus = BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED
        assertCode(KeychainErrorCode.BIOMETRY_NOT_ENROLLED) { write(AccessControl.BIOMETRY_ANY) }
        val currentSetOrPasscode = AccessControl.BIOMETRY_CURRENT_SET_OR_PASSCODE
        assertCode(code(currentSetOrPasscode, UnavailableReason.NOT_ENROLLED)) { write(currentSetOrPasscode) }
        device.authenticationStatus = BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE
        assertCode(KeychainErrorCode.BIOMETRY_NOT_AVAILABLE) { write(AccessControl.BIOMETRY_CURRENT_SET) }
        device.authenticationStatus = BiometricManager.BIOMETRIC_ERROR_UNSUPPORTED
        assertCode(KeychainErrorCode.UNSUPPORTED) { write(AccessControl.BIOMETRY_ANY) }
        assertEquals(emptyList<String>(), keystoreAliases(service))
    }

    @Test
    fun beforeAndroid11ThereIsNoPasscodeAndNoWindow() {
        device.sdk = 29
        device.isSecure = true
        device.authenticationStatus = BiometricManager.BIOMETRIC_SUCCESS
        for (accessControl in AccessControl.entries.filter { it.allowsPasscode }) {
            assertCode(KeychainErrorCode.UNSUPPORTED) { write(accessControl) }
        }
        assertCode(KeychainErrorCode.UNSUPPORTED) { write(AccessControl.BIOMETRY_ANY, authValidity = 30) }
        assertEquals(emptyList<String>(), keystoreAliases(service))
    }

    @Test
    fun currentSetWithAWindowIsInvalidArgument() {
        for (accessControl in AccessControl.entries.filter { it.currentSet }) {
            assertCode(KeychainErrorCode.INVALID_ARGUMENT) { write(accessControl, authValidity = 30) }
        }
    }

    @Test
    fun whatAnAccessControlNeeds() {
        val capabilities = Capabilities(device, KeystoreKeys())
        assertNull(capabilities.unavailable(AccessControl.NONE))

        device.isSecure = false
        device.authenticationStatus = BiometricManager.BIOMETRIC_SUCCESS
        for (accessControl in AccessControl.entries - AccessControl.NONE) {
            val expected = onThisAndroid(accessControl, UnavailableReason.PASSCODE_NOT_SET)
            assertEquals(expected, capabilities.unavailable(accessControl))
        }

        device.isSecure = true
        device.authenticationStatus = BiometricManager.BIOMETRIC_SUCCESS
        for (accessControl in AccessControl.entries) {
            assertEquals(onThisAndroid(accessControl, null), capabilities.unavailable(accessControl))
        }

        device.authenticationStatus = BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED
        assertEquals(UnavailableReason.NOT_ENROLLED, capabilities.unavailable(AccessControl.BIOMETRY_CURRENT_SET))
        assertEquals(onThisAndroid(AccessControl.PASSCODE, null), capabilities.unavailable(AccessControl.PASSCODE))

        device.authenticationStatus = BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE
        assertEquals(UnavailableReason.NO_HARDWARE, capabilities.unavailable(AccessControl.BIOMETRY_ANY))

        device.sdk = 29
        assertEquals(UnavailableReason.UNSUPPORTED_OS, capabilities.unavailable(AccessControl.PASSCODE))
        assertEquals(UnavailableReason.UNSUPPORTED_OS, capabilities.unavailable(AccessControl.BIOMETRY_ANY_OR_PASSCODE))
    }

    @Test
    fun theFirstReasonComesFirst() {
        // The order: unsupportedOS → noHardware → passcodeNotSet → notEnrolled.
        val capabilities = Capabilities(device, KeystoreKeys())
        fun reason(accessControl: AccessControl) = capabilities.unavailable(accessControl)

        device.sdk = 29
        device.isSecure = false
        device.authenticationStatus = BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE
        assertEquals(UnavailableReason.UNSUPPORTED_OS, reason(AccessControl.PASSCODE))
        assertEquals(UnavailableReason.UNSUPPORTED_OS, reason(AccessControl.BIOMETRY_CURRENT_SET_OR_PASSCODE))
        // Biometry alone works before Android 11: the hardware is the first reason there.
        assertEquals(UnavailableReason.NO_HARDWARE, reason(AccessControl.BIOMETRY_ANY))
        device.authenticationStatus = BiometricManager.BIOMETRIC_ERROR_UNSUPPORTED
        assertEquals(UnavailableReason.UNSUPPORTED_OS, reason(AccessControl.BIOMETRY_ANY))

        device.sdk = 30
        device.authenticationStatus = BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE
        assertEquals(UnavailableReason.NO_HARDWARE, reason(AccessControl.BIOMETRY_CURRENT_SET))
        assertEquals(UnavailableReason.NO_HARDWARE, reason(AccessControl.BIOMETRY_CURRENT_SET_OR_PASSCODE))
        // The passcode alone does without biometry.
        assertEquals(UnavailableReason.PASSCODE_NOT_SET, reason(AccessControl.BIOMETRY_ANY_OR_PASSCODE))
        assertEquals(UnavailableReason.PASSCODE_NOT_SET, reason(AccessControl.PASSCODE))

        device.authenticationStatus = BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED
        assertEquals(UnavailableReason.PASSCODE_NOT_SET, reason(AccessControl.BIOMETRY_ANY))
        device.isSecure = true
        assertEquals(UnavailableReason.NOT_ENROLLED, reason(AccessControl.BIOMETRY_ANY))
        assertNull(reason(AccessControl.BIOMETRY_ANY_OR_PASSCODE))
        assertNull(reason(AccessControl.PASSCODE))
    }

    @Test
    fun theLibrarysWindowComesFirst() {
        assumeTrue(NEEDS_LOCK_11, hasScreenLock && device.sdk >= 30)
        val passcode = options(accessControl = AccessControl.PASSCODE, authValidity = 300)
        keychain.setItem(service, "token", "v", Encoding.UTF8, passcode)
        // Whatever the Keystore's window — unlocking the screen opens it — the library's is closed: a prompt.
        assertNull((keychain.read(service, "token", Encoding.UTF8) as Keychain.Read.Authenticate).cipher)
        keychain.windows.open(service, AccessControl.PASSCODE)
        assertTrue(keychain.windows.isOpen(service, AccessControl.PASSCODE, 300))
        // The background closes it.
        keychain.forgetAuthentications()
        assertFalse(keychain.windows.isOpen(service, AccessControl.PASSCODE, 300))
        assertTrue(keychain.read(service, "token", Encoding.UTF8) is Keychain.Read.Authenticate)
    }

    @Test
    fun theRealDeviceAgreesWithItsWrites() {
        // What `canUseAccessControl` says is what a write does: it writes, or fails with the reason's code.
        val capabilities = keychain.capabilities
        for (accessControl in AccessControl.entries - AccessControl.NONE) {
            when (val reason = capabilities.unavailable(accessControl)) {
                null -> write(accessControl)
                else -> assertCode(CODES.getValue(reason)) { write(accessControl) }
            }
        }
    }

    @Test
    fun biometryTypes() {
        val capabilities = Capabilities(device, KeystoreKeys())
        device.biometricSensors = listOf(BiometryType.FINGERPRINT, BiometryType.FACE)
        device.authenticationStatus = BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED
        assertEquals(listOf(BiometryType.FINGERPRINT, BiometryType.FACE), capabilities.biometryTypes())
        device.authenticationStatus = BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE
        assertEquals(emptyList<BiometryType>(), capabilities.biometryTypes())
    }

    @Test
    fun biometryStateIsAStableToken() {
        val capabilities = Capabilities(device, KeystoreKeys())
        device.authenticationStatus = BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED
        assertNull(capabilities.biometryState())

        device.authenticationStatus = null
        assumeTrue("Needs a fingerprint enrolled", hasBiometry)
        val state = capabilities.biometryState()!!
        assertEquals(state, capabilities.biometryState())
        // A canary gone is a new state, as the app's data restored without its keys; a new fingerprint is
        // PromptTest's.
        deleteKeystoreKey(KeyAliases.BIOMETRY_STATE + state)
        val next = capabilities.biometryState()!!
        assertNotEquals(state, next)
        assertEquals(next, capabilities.biometryState())
    }

    /**
     * `biometryCurrentSetOrPasscode` remembers the biometry it was written with: a new set — here a canary gone, a new
     * fingerprint is PromptTest's — or none at all ends the item, KEY_INVALIDATED without a prompt, as the Keystore
     * ends `biometryCurrentSet`'s. A sensor that can't say leaves the item be; the other access controls don't
     * remember.
     */
    @Test
    fun currentSetOrPasscodeRemembersTheBiometry() {
        assumeTrue(NEEDS_LOCK_BIOMETRY_11, hasScreenLock && hasBiometry && device.sdk >= 30)
        val currentSetOrPasscode = options(accessControl = AccessControl.BIOMETRY_CURRENT_SET_OR_PASSCODE)
        keychain.setItem(service, "token", "v", Encoding.UTF8, currentSetOrPasscode)
        val either = options(accessControl = AccessControl.BIOMETRY_ANY_OR_PASSCODE)
        keychain.setItem(service, "either", "v", Encoding.UTF8, either)
        val state = keychain.capabilities.biometryState()
        assertNotNull(state)
        assertEquals(state, storedItems(service).getValue("token").biometryState)
        assertNull(storedItems(service).getValue("either").biometryState)
        assertTrue(keychain.read(service, "token", Encoding.UTF8) is Keychain.Read.Authenticate)

        device.authenticationStatus = BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE
        assertTrue(keychain.read(service, "token", Encoding.UTF8) is Keychain.Read.Authenticate)
        device.authenticationStatus = null

        deleteKeystoreKey(KeyAliases.BIOMETRY_STATE + state)
        assertCode(KeychainErrorCode.KEY_INVALIDATED) { keychain.read(service, "token", Encoding.UTF8) }
        assertFalse(keychain.hasItem(service, "token"))
        assertTrue(keychain.read(service, "either", Encoding.UTF8) is Keychain.Read.Authenticate)

        // A new item belongs to the new set; when no biometry is left, it goes too.
        keychain.setItem(service, "token", "w", Encoding.UTF8, currentSetOrPasscode)
        assertNotEquals(state, storedItems(service).getValue("token").biometryState)
        device.authenticationStatus = BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED
        assertCode(KeychainErrorCode.KEY_INVALIDATED) { keychain.read(service, "token", Encoding.UTF8) }
        assertFalse(keychain.hasItem(service, "token"))
    }

    /** The file can't make the item forget its biometry: DATA_CORRUPTED, and the item stays. */
    @Test
    fun currentSetOrPasscodeWithoutItsBiometryIsDataCorrupted() {
        assumeTrue(NEEDS_LOCK_BIOMETRY_11, hasScreenLock && hasBiometry && device.sdk >= 30)
        val currentSetOrPasscode = options(accessControl = AccessControl.BIOMETRY_CURRENT_SET_OR_PASSCODE)
        keychain.setItem(service, "token", "v", Encoding.UTF8, currentSetOrPasscode)
        val item = storedItems(service).getValue("token")
        writeStore(service, mapOf("token" to item.copy(biometryState = null)))
        assertCode(KeychainErrorCode.DATA_CORRUPTED) { newKeychain().read(service, "token", Encoding.UTF8) }
        assertTrue(newKeychain().hasItem(service, "token"))
    }

    /** The real device's level: StrongBox where there is one, else where the Keystore attests a new key lives. */
    @Test
    fun hardwareSecurityLevel() {
        val expected = Attestation.securityLevel(strongBox = device.hasStrongBox)
        if (device.hasStrongBox) assertEquals(SecurityLevel.STRONGBOX, expected)
        assertEquals(expected, Capabilities(device, KeystoreKeys()).hardwareSecurityLevel())
        assertTrue(KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.aliases().toList().none {
            it.startsWith(KeyAliases.PROBE)
        })
    }

    private fun write(accessControl: AccessControl, authValidity: Int = 0) =
        keychain.setItem(
            service,
            "k",
            "v",
            Encoding.UTF8,
            options(accessControl = accessControl, authValidity = authValidity),
        )

    // Before Android 11 the passcode variants are unsupported, whatever else the device lacks.
    private fun onThisAndroid(accessControl: AccessControl, reason: UnavailableReason?) =
        if (accessControl.allowsPasscode && device.sdk < Build.VERSION_CODES.R) {
            UnavailableReason.UNSUPPORTED_OS
        } else {
            reason
        }

    private fun code(accessControl: AccessControl, reason: UnavailableReason) =
        CODES.getValue(onThisAndroid(accessControl, reason)!!)

    private companion object {
        // The error of a write for each reason `canUseAccessControl` gives.
        val CODES = mapOf(
            UnavailableReason.UNSUPPORTED_OS to KeychainErrorCode.UNSUPPORTED,
            UnavailableReason.NO_HARDWARE to KeychainErrorCode.BIOMETRY_NOT_AVAILABLE,
            UnavailableReason.PASSCODE_NOT_SET to KeychainErrorCode.PASSCODE_NOT_SET,
            UnavailableReason.NOT_ENROLLED to KeychainErrorCode.BIOMETRY_NOT_ENROLLED,
        )
        const val NEEDS_LOCK_11 = "Needs a screen lock and Android 11"
        const val NEEDS_LOCK_BIOMETRY_11 = "Needs a screen lock, a fingerprint enrolled and Android 11"
    }
}
