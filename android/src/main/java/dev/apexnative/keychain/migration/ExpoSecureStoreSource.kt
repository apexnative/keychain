package dev.apexnative.keychain.migration

import android.content.Context
import android.content.SharedPreferences
import dev.apexnative.keychain.AccessControl
import dev.apexnative.keychain.KeychainErrorCode
import dev.apexnative.keychain.KeystoreKeys
import dev.apexnative.keychain.fromUtf8
import dev.apexnative.keychain.isInvalidation
import dev.apexnative.keychain.needsAuthentication
import org.json.JSONException
import org.json.JSONObject
import javax.crypto.AEADBadTagException
import javax.crypto.BadPaddingException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec

/**
 * The items expo-secure-store keeps on Android, read without it: the SharedPreferences `SecureStore`, an
 * item per `<keychainService>-<key>` — or, from older versions, `<key>` alone — whose value is a JSON envelope:
 * `ct` and `iv` (Base64), `tlen` (the GCM tag's bits), `scheme` (`aes`), `keystoreAlias` (the keychain service),
 * `usesKeystoreSuffix`, `requireAuthentication`. The keychain service's AES-256-GCM key is in AndroidKeyStore:
 * `AES/GCM/NoPadding:<service>:keystoreAuthenticated` or `…:keystoreUnauthenticated`, or, for an item without
 * `usesKeystoreSuffix`, `AES/GCM/NoPadding:<service>`. A key with authentication needs Class 3 biometry every time.
 * The scheme `hybrid`, of Android 5, isn't read.
 */
internal class ExpoSecureStoreSource(private val preferences: SharedPreferences, private val keys: KeystoreKeys) {
    /** An item as stored, still encrypted. */
    class Entry(val keychainService: String, val key: String, val envelope: JSONObject)

    /**
     * The items of the keychain service: the ones it names, and the old ones under `<key>` alone, which name none.
     */
    fun entries(keychainService: String = DEFAULT_KEYCHAIN_SERVICE): List<Entry> {
        val current = LinkedHashMap<String, Entry>()
        val old = LinkedHashMap<String, Entry>()
        for ((name, value) in preferences.all) {
            val envelope = (value as? String)?.let(::envelope) ?: continue
            when (envelope.optString(KEYSTORE_ALIAS).takeIf { it.isNotEmpty() }) {
                keychainService -> {
                    val prefix = "$keychainService-"
                    if (name.startsWith(prefix)) {
                        val key = name.removePrefix(prefix)
                        current[key] = Entry(keychainService, key, envelope)
                    }
                }
                null -> old[name] = Entry(keychainService, name, envelope)
            }
        }
        // One entry per key: expo reads `<service>-<key>` first, `<key>` only without it.
        return current.values + old.filterKeys { it !in current }.values
    }

    /** The entry of the key, as expo's `getItemAsync` finds it; null when there is none. */
    fun entry(keychainService: String, key: String) = entries(keychainService).firstOrNull { it.key == key }

    /** Whether reading the entry needs the user, as its envelope says. */
    fun requiresAuthentication(entry: Entry) = entry.envelope.optBoolean(REQUIRE_AUTHENTICATION, false)

    /**
     * Deletes the key's every variant, as expo's `deleteItemAsync` does — `<service>-<key>` and `<key>` — and the
     * Keystore key, once no item left of the keychain service needs it.
     */
    fun remove(entry: Entry) {
        val names = listOf("${entry.keychainService}-${entry.key}", entry.key)
        // The keys of both variants, each with the envelope that says which.
        val removed = names.mapNotNull { name ->
            val envelope = (preferences.all[name] as? String)?.let(::envelope) ?: return@mapNotNull null
            alias(Entry(entry.keychainService, entry.key, envelope))
        }
        preferences.edit().apply { names.forEach(::remove) }.commit()
        val left = entries(entry.keychainService).map(::alias).toSet()
        for (alias in removed.toSet() - left) keys.delete(alias)
    }

    private fun alias(entry: Entry): String {
        val authenticated = requiresAuthentication(entry)
        return if (entry.envelope.optBoolean(USES_KEYSTORE_SUFFIX, false)) {
            "$ALIAS_PREFIX${entry.keychainService}:${if (authenticated) AUTHENTICATED else UNAUTHENTICATED}"
        } else {
            "$ALIAS_PREFIX${entry.keychainService}"
        }
    }

    fun read(entry: Entry): LegacyRead<String> {
        val envelope = entry.envelope
        if (envelope.optString(SCHEME) != AES_SCHEME) {
            return unreadable(
                KeychainErrorCode.UNSUPPORTED,
                "'${entry.key}' is in the scheme '${envelope.optString(SCHEME)}', which the library doesn't read.",
            )
        }
        val ciphertext = envelope.optString(CIPHERTEXT).let(::decodeWrappedBase64)
        val iv = envelope.optString(IV).let(::decodeWrappedBase64)
        val tagBits = envelope.optInt(TAG_LENGTH, 0)
        if (ciphertext == null || iv == null || tagBits < MIN_TAG_BITS) {
            return unreadable(KeychainErrorCode.DATA_CORRUPTED, "The envelope of '${entry.key}' is damaged.")
        }
        val requiresAuthentication = requiresAuthentication(entry)
        val alias = alias(entry)
        return try {
            val key = keys.secretKey(alias)
                ?: return unreadable(KeychainErrorCode.KEY_INVALIDATED, "The key of '${entry.key}' is gone.")
            fun cipher() = Cipher.getInstance(CIPHER).apply {
                init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(tagBits, iv))
            }
            fun open(cipher: Cipher) = fromUtf8(cipher.doFinal(ciphertext)) ?: throw BadPaddingException("Not UTF-8")
            if (requiresAuthentication) {
                authenticate(::cipher, ::open)
            } else {
                try {
                    LegacyRead.Found(open(cipher()))
                } catch (e: Exception) {
                    // An old item that doesn't say its key needs authentication.
                    if (!e.needsAuthentication()) throw e
                    authenticate(::cipher, ::open)
                }
            }
        } catch (e: Exception) {
            when {
                e.isInvalidation() ->
                    unreadable(KeychainErrorCode.KEY_INVALIDATED, "The key of '${entry.key}' was invalidated.", e)
                e is AEADBadTagException || e is BadPaddingException ->
                    unreadable(KeychainErrorCode.DATA_CORRUPTED, "'${entry.key}' doesn't decrypt.", e)
                else -> unreadable(KeychainErrorCode.UNKNOWN, "'${entry.key}' can't be read: $e", e)
            }
        }
    }

    // Every read needs Class 3 biometry, for the cipher it unlocks; the key is invalidated by a new enrollment.
    private fun authenticate(cipher: () -> Cipher, open: (Cipher) -> String): LegacyRead<String> {
        val locked = cipher()
        return LegacyRead.NeedsAuthentication(AccessControl.BIOMETRY_CURRENT_SET, locked) { open(it ?: locked) }
    }

    private fun envelope(text: String): JSONObject? = try {
        JSONObject(text).takeIf { it.has(SCHEME) }
    } catch (e: JSONException) {
        null
    }

    companion object {
        const val DEFAULT_KEYCHAIN_SERVICE = "key_v1"

        private const val NAME = "SecureStore"
        private const val CIPHER = "AES/GCM/NoPadding"
        private const val ALIAS_PREFIX = "$CIPHER:"
        private const val AUTHENTICATED = "keystoreAuthenticated"
        private const val UNAUTHENTICATED = "keystoreUnauthenticated"
        private const val AES_SCHEME = "aes"
        private const val SCHEME = "scheme"
        private const val CIPHERTEXT = "ct"
        private const val IV = "iv"
        private const val TAG_LENGTH = "tlen"
        private const val KEYSTORE_ALIAS = "keystoreAlias"
        private const val USES_KEYSTORE_SUFFIX = "usesKeystoreSuffix"
        private const val REQUIRE_AUTHENTICATION = "requireAuthentication"
        private const val MIN_TAG_BITS = 96

        fun of(context: Context, keys: KeystoreKeys) =
            ExpoSecureStoreSource(context.getSharedPreferences(NAME, Context.MODE_PRIVATE), keys)
    }
}
