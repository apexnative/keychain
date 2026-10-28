package dev.apexnative.keychain

import android.os.Build
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.StrongBoxUnavailableException
import android.security.keystore.UserNotAuthenticatedException
import androidx.biometric.BiometricPrompt
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import javax.crypto.AEADBadTagException
import javax.crypto.BadPaddingException

/** The codes of `KeychainError`: the `code` a promise rejects with, and a synchronous `Failure`'s. */
enum class KeychainErrorCode {
    USER_CANCELED,
    USER_FALLBACK,
    SYSTEM_CANCELED,
    AUTH_FAILED,
    LOCKOUT,
    LOCKOUT_PERMANENT,
    BIOMETRY_NOT_ENROLLED,
    BIOMETRY_NOT_AVAILABLE,
    PASSCODE_NOT_SET,
    KEY_INVALIDATED,
    INTERACTION_NOT_ALLOWED,
    AUTH_REQUIRED,
    MISSING_ENTITLEMENT,
    MISSING_USAGE_DESCRIPTION,
    HARDWARE_UNAVAILABLE,
    NO_ACTIVITY,
    UNSUPPORTED,
    INVALID_ARGUMENT,
    DATA_CORRUPTED,
    UNKNOWN,
}

/**
 * A failure with its code: what a method rejects with, or returns as a `Failure`. `nativeCode` and `nativeDomain` say
 * where it came from: the class of the platform's exception and, when it has one, its numeric code.
 */
internal open class KeychainException(
    val code: KeychainErrorCode,
    message: String,
    val nativeCode: Int? = null,
    val nativeDomain: String? = null,
    cause: Throwable? = null,
) : Exception(message, cause)

/**
 * A prompt succeeded, yet its operation can't be used: Android 15+ binds the PIN that recovers a locked-out biometry to
 * it. [PromptQueue] shows the prompt once more; AUTH_FAILED only when that one ends the same way.
 */
internal class PromptAgainException(cause: Throwable) : KeychainException(
    KeychainErrorCode.AUTH_FAILED,
    "The authentication didn't unlock the item's key.",
    nativeDomain = cause.javaClass.name,
    cause = cause,
)

/**
 * The [KeychainException] an exception of a call becomes. The cause chain is searched, since the
 * Keystore wraps its errors in one another.
 */
internal fun Throwable.toKeychainException(): KeychainException {
    if (this is KeychainException) return this
    val chain = generateSequence(this) { it.cause }.take(MAX_CAUSES).toList()
    chain.firstNotNullOfOrNull { it as? KeychainException }?.let { return it }
    val known = chain.firstNotNullOfOrNull { cause -> knownCode(cause)?.let { cause to it } }
    if (known != null) {
        val (cause, code) = known
        return KeychainException(code, knownMessage(code), keyStoreCode(chain), cause.javaClass.name, this)
    }
    val description = message?.let { "${javaClass.simpleName}: $it" } ?: javaClass.simpleName
    return KeychainException(KeychainErrorCode.UNKNOWN, description, keyStoreCode(chain), javaClass.name, this)
}

private const val MAX_CAUSES = 8

private fun knownCode(cause: Throwable): KeychainErrorCode? = when {
    cause is KeyPermanentlyInvalidatedException -> KeychainErrorCode.KEY_INVALIDATED
    // A key that needs an unlocked device, used while it's locked (`setUnlockedDeviceRequired`): Android 15+ says it
    // with the Keystore's LOCKED, in a plain `InvalidKeyException`.
    cause is UserNotAuthenticatedException || isKeystoreLocked(cause) -> KeychainErrorCode.INTERACTION_NOT_ALLOWED
    // A tag that doesn't match, or a wrapped key that doesn't unwrap.
    cause is AEADBadTagException || cause is BadPaddingException -> KeychainErrorCode.DATA_CORRUPTED
    isStrongBoxUnavailable(cause) -> KeychainErrorCode.HARDWARE_UNAVAILABLE
    else -> null
}

private fun knownMessage(code: KeychainErrorCode) = when (code) {
    KeychainErrorCode.KEY_INVALIDATED -> "The Keystore key was invalidated."
    KeychainErrorCode.INTERACTION_NOT_ALLOWED -> "The device is locked, and the key works only while it's unlocked."
    KeychainErrorCode.DATA_CORRUPTED -> "The item can't be decrypted: the stored data is damaged."
    KeychainErrorCode.HARDWARE_UNAVAILABLE -> "StrongBox can't hold the key on this device."
    else -> code.name
}

internal fun Throwable.causes() = generateSequence(this) { it.cause }.take(MAX_CAUSES)

/** Whether the Keystore reported a dead key: `KeyPermanentlyInvalidatedException`, sometimes wrapped. */
internal fun Throwable.isInvalidation() = causes().any { it is KeyPermanentlyInvalidatedException }

/**
 * Whether the Keystore refused a key for want of authentication: `UserNotAuthenticatedException` when an operation
 * starts, a Keystore error when it ends (Android 13+ says which).
 */
internal fun Throwable.needsAuthentication() = causes().any {
    it is UserNotAuthenticatedException ||
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            (it as? android.security.KeyStoreException)?.requiresUserAuthentication() == true
        } else {
            // A hidden class before Android 13, which says so only in its message.
            it.javaClass.name == "android.security.KeyStoreException" &&
                it.message?.contains("user not authenticated", ignoreCase = true) == true
        }
}

/**
 * The error of a prompt that ended without success: the code of `BiometricPrompt` in `nativeCode`.
 * The platform's message is in the user's language; the contract's is in English.
 */
internal fun promptError(errorCode: Int): KeychainException {
    val (code, message) = when (errorCode) {
        BiometricPrompt.ERROR_USER_CANCELED, BiometricPrompt.ERROR_NEGATIVE_BUTTON ->
            KeychainErrorCode.USER_CANCELED to "The user canceled the prompt."
        BiometricPrompt.ERROR_CANCELED, BiometricPrompt.ERROR_TIMEOUT ->
            KeychainErrorCode.SYSTEM_CANCELED to "The system closed the prompt."
        BiometricPrompt.ERROR_LOCKOUT -> KeychainErrorCode.LOCKOUT to "Too many attempts: biometry is locked a while."
        BiometricPrompt.ERROR_LOCKOUT_PERMANENT ->
            KeychainErrorCode.LOCKOUT_PERMANENT to "Too many attempts: biometry is locked until the screen is unlocked."
        BiometricPrompt.ERROR_NO_BIOMETRICS -> KeychainErrorCode.BIOMETRY_NOT_ENROLLED to "No biometry is enrolled."
        BiometricPrompt.ERROR_HW_NOT_PRESENT, BiometricPrompt.ERROR_HW_UNAVAILABLE ->
            KeychainErrorCode.BIOMETRY_NOT_AVAILABLE to "The biometric sensor isn't available."
        BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL ->
            KeychainErrorCode.PASSCODE_NOT_SET to "The device has no screen lock."
        else -> KeychainErrorCode.UNKNOWN to "The prompt failed."
    }
    return KeychainException(code, message, errorCode, PROMPT_DOMAIN)
}

private const val PROMPT_DOMAIN = "androidx.biometric.BiometricPrompt"

/**
 * Whether the Keystore refused a key as locked: keystore2's LOCKED, a numeric code public since Android 13; before, a
 * hidden class that says so only in its message.
 */
private fun isKeystoreLocked(cause: Throwable) = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
    (cause as? android.security.KeyStoreException)?.numericErrorCode == KEYSTORE_LOCKED
} else {
    cause.javaClass.name == "android.security.KeyStoreException" &&
        cause.message?.equals("Device locked", ignoreCase = true) == true
}

// keystore2's `ResponseCode::LOCKED`: the user's keys that need an unlocked device, while it's locked.
private const val KEYSTORE_LOCKED = 2

/** Whether StrongBox refused a key: `StrongBoxUnavailableException`, a class of API 28. */
internal fun isStrongBoxUnavailable(cause: Throwable) =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && cause is StrongBoxUnavailableException

/** The numeric code of a Keystore error in the chain: public since Android 13, hidden before. */
private fun keyStoreCode(chain: List<Throwable>): Int? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
    chain.firstNotNullOfOrNull { (it as? android.security.KeyStoreException)?.numericErrorCode }
} else {
    null
}

/**
 * Rejects the promise as src/native/NativeApexKeychain.ts says ("Errors"): the code, the message and, in the user
 * info, `nativeCode` and `nativeDomain` when there are.
 */
internal fun Promise.reject(
    code: KeychainErrorCode,
    message: String,
    nativeCode: Int? = null,
    nativeDomain: String? = null,
    cause: Throwable? = null,
) {
    reject(code.name, message, cause, nativeDetails(nativeCode, nativeDomain))
}

/** Rejects with a [KeychainException]: not `reject(Throwable)`, Promise's own, which loses the code. */
internal fun Promise.rejectWith(error: KeychainException) =
    reject(error.code, error.message.orEmpty(), error.nativeCode, error.nativeDomain, error.cause ?: error)

/** The answer of a synchronous method that failed: `{ error: { code, message, nativeCode?, nativeDomain? } }`. */
internal fun failure(
    code: KeychainErrorCode,
    message: String,
    nativeCode: Int? = null,
    nativeDomain: String? = null,
): WritableMap {
    val error = nativeDetails(nativeCode, nativeDomain).apply {
        putString("code", code.name)
        putString("message", message)
    }
    return Arguments.createMap().apply { putMap("error", error) }
}

internal fun failure(error: KeychainException): WritableMap =
    failure(error.code, error.message.orEmpty(), error.nativeCode, error.nativeDomain)

private fun nativeDetails(nativeCode: Int?, nativeDomain: String?): WritableMap = Arguments.createMap().apply {
    nativeCode?.let { putInt("nativeCode", it) }
    nativeDomain?.let { putString("nativeDomain", it) }
}
