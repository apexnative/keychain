package dev.apexnative.keychain.migration

import dev.apexnative.keychain.AccessControl
import dev.apexnative.keychain.Base64
import dev.apexnative.keychain.KeychainErrorCode
import dev.apexnative.keychain.KeychainException
import javax.crypto.Cipher

/** What reading an item of another library comes to. */
internal sealed interface LegacyRead<out T> {
    /** Read without a prompt. */
    data class Found<T>(val value: T) : LegacyRead<T>

    /**
     * The item needs the user, as `Keychain.Read.Authenticate`: the prompt for [accessControl] unlocks [cipher] (its
     * `CryptoObject`) or, when it's null, opens the key's time window; then [finish] reads the item, off the main
     * thread, with what the prompt unlocked.
     */
    class NeedsAuthentication<T>(
        val accessControl: AccessControl,
        val cipher: Cipher?,
        val finish: (Cipher?) -> T,
    ) : LegacyRead<T>

    /**
     * The item can't be read: its key is gone (the app was reinstalled, or restored from a backup), its data is
     * damaged, or it's in a format the library doesn't read.
     */
    data class Unreadable(val error: KeychainException) : LegacyRead<Nothing>
}

internal fun unreadable(code: KeychainErrorCode, message: String, cause: Throwable? = null) =
    LegacyRead.Unreadable(KeychainException(code, message, nativeDomain = cause?.javaClass?.name, cause = cause))

/** Base64 as Android writes it with `Base64.DEFAULT`: line breaks every 76 characters. Null when it isn't Base64. */
internal fun decodeWrappedBase64(text: String): ByteArray? = Base64.decode(text.filterNot { it == '\n' || it == '\r' })
