package dev.apexnative.keychain

import android.os.Build
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKey

/**
 * What the device can do for the items: none of it touches the items or shows a
 * prompt. The storage asks [unavailable] before it writes an item with access control, so that a write and
 * `canUseAccessControl` always agree.
 */
internal class Capabilities(private val device: Device, private val keys: KeystoreKeys) {
    private val random by lazy { SecureRandom() }

    @Volatile
    private var hardwareLevel: SecurityLevel? = null

    val isPasscodeSet: Boolean get() = device.isSecure

    /**
     * Why the access control can't protect an item now, or null when it can; the first reason of four, in this order:
     * unsupportedOS → noHardware → passcodeNotSet → notEnrolled. The passcode variants need
     * Android 11. 'biometryAnyOrPasscode' takes the passcode alone; the other biometric variants need Class 3 biometry,
     * enrolled — 'currentSet' too, since a key made without any would be bound to the passcode alone and never
     * invalidated.
     */
    fun unavailable(accessControl: AccessControl): UnavailableReason? {
        if (accessControl == AccessControl.NONE) return null
        if (accessControl.allowsPasscode && device.sdk < Build.VERSION_CODES.R) return UnavailableReason.UNSUPPORTED_OS
        val needsBiometry = accessControl.allowsBiometry && accessControl != AccessControl.BIOMETRY_ANY_OR_PASSCODE
        val biometry = if (needsBiometry) device.canAuthenticate(Authenticators.BIOMETRIC_STRONG) else null
        return when {
            biometry == BiometricManager.BIOMETRIC_ERROR_UNSUPPORTED -> UnavailableReason.UNSUPPORTED_OS
            biometry == BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE ||
                biometry == BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE ||
                biometry == BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED -> UnavailableReason.NO_HARDWARE
            !device.isSecure -> UnavailableReason.PASSCODE_NOT_SET
            biometry == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> UnavailableReason.NOT_ENROLLED
            else -> null
        }
    }

    /**
     * The modalities that can unlock a key, enrolled or not: the device's sensors, when it has Class 3 biometry at all.
     * Android doesn't say the class of each sensor, so a device with a Class 3 fingerprint lists its face too.
     */
    fun biometryTypes(): List<BiometryType> = when (device.canAuthenticate(Authenticators.BIOMETRIC_STRONG)) {
        BiometricManager.BIOMETRIC_SUCCESS,
        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED,
        BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE,
        -> device.biometricSensors
        else -> emptyList()
    }

    /**
     * A token that changes when the set of enrolled biometrics does, null without enrolled biometry. Android has no
     * such state: the token is the generation of a canary key that a new enrollment invalidates.
     */
    @Synchronized
    fun biometryState(): String? {
        if (device.canAuthenticate(Authenticators.BIOMETRIC_STRONG) != BiometricManager.BIOMETRIC_SUCCESS) return null
        val canaries = keys.aliases(KeyAliases.BIOMETRY_STATE).sorted()
        val current = canaries.lastOrNull()?.takeIf { alias ->
            val canary = try {
                keys.secretKey(alias)
            } catch (e: Exception) {
                if (!e.isInvalidation()) throw e
                null
            }
            canary != null && isAlive(canary)
        }
        for (alias in canaries) if (alias != current) keys.delete(alias)
        if (current != null) return current.removePrefix(KeyAliases.BIOMETRY_STATE)
        val generation = ByteArray(CANARY_BYTES).also(random::nextBytes).joinToString("") { "%02x".format(it) }
        keys.generateCanary(KeyAliases.BIOMETRY_STATE + generation)
        return generation
    }

    /** The best hardware a new key can live in: StrongBox, or where a key made to see lives. Measured once. */
    fun hardwareSecurityLevel(): SecurityLevel {
        hardwareLevel?.let { return it }
        if (device.sdk >= Build.VERSION_CODES.P && device.hasStrongBox) return SecurityLevel.STRONGBOX
        val alias = KeyAliases.PROBE + ByteArray(CANARY_BYTES).also(random::nextBytes).joinToString("") {
            "%02x".format(it)
        }
        return try {
            keys.securityLevel(alias, keys.generateProbe(alias), KeyHardware.TEE, device.sdk)
        } finally {
            keys.delete(alias)
        }.also { hardwareLevel = it }
    }

    // `Cipher.init` on a key with authentication needs no prompt, and throws for a dead key.
    private fun isAlive(canary: SecretKey): Boolean = try {
        Cipher.getInstance("AES/GCM/NoPadding").init(Cipher.ENCRYPT_MODE, canary)
        true
    } catch (e: Exception) {
        if (!e.isInvalidation()) throw e
        false
    }

    private companion object {
        const val CANARY_BYTES = 8
    }
}
