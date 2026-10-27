package dev.apexnative.keychain.migration

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import dev.apexnative.keychain.AccessControl
import dev.apexnative.keychain.KeychainErrorCode
import dev.apexnative.keychain.KeystoreKeys
import dev.apexnative.keychain.fromUtf8
import dev.apexnative.keychain.isInvalidation
import java.io.File
import java.io.FileNotFoundException
import java.security.Key
import javax.crypto.AEADBadTagException
import javax.crypto.BadPaddingException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.IvParameterSpec

/**
 * The credentials react-native-keychain (10.0.0 and before) kept on Android, read without it. A service
 * has one entry, in the DataStore `RN_KEYCHAIN` (rnk 9+) or, before, in the SharedPreferences of that name, which rnk 9
 * moves into the DataStore on its first run; the DataStore's wins.
 *
 * An entry is three strings: `<service>:u` and `<service>:p` — the username and the password, each encrypted alone,
 * in Base64 with line breaks — and `<service>:c`, the cipher's name. The default service is ''. Internet credentials
 * are entries too, named after their server. Every cipher keeps its key in AndroidKeyStore under the service's name or,
 * for '', a name of its own:
 *
 * | Cipher                  | Value              | Default alias               | Authentication            |
 * |-------------------------|--------------------|-----------------------------|---------------------------|
 * | `KeystoreAESGCM_NoAuth` | IV(12) ‖ ct ‖ tag  | `KeystoreAESGCM_NoAuth`     | none                      |
 * | `KeystoreAESCBC`        | IV(16) ‖ ct, PKCS7 | `RN_KEYCHAIN_DEFAULT_ALIAS` | none                      |
 * | `KeystoreAESGCM`        | IV(12) ‖ ct ‖ tag  | `KeystoreAESGCM`            | 5 s, biometry or passcode |
 * | `KeystoreRSAECB`        | RSA PKCS#1 v1.5    | `KeystoreRSAECB`            | 5 s, biometry or passcode |
 *
 * `FacebookConceal`, of rnk 6 and before, isn't read.
 */
internal class ReactNativeKeychainSource(
    private val dataStoreFile: File,
    private val sharedPreferences: SharedPreferences?,
    private val keys: KeystoreKeys,
    private val sdk: Int = Build.VERSION.SDK_INT,
) {
    data class Credentials(val username: String, val password: String)

    /** An entry as stored, still encrypted. */
    class Entry(val service: String, val cipher: String, val username: String, val password: String)

    /** Every entry, by service; one without its three strings isn't one, as rnk has it. */
    fun entries(): List<Entry> {
        val strings = LinkedHashMap<String, String>()
        sharedPreferences?.all?.forEach { (name, value) -> if (value is String) strings[name] = value }
        strings.putAll(dataStoreStrings())
        return strings.keys.filter { it.endsWith(CIPHER_SUFFIX) }.mapNotNull { name ->
            val service = name.removeSuffix(CIPHER_SUFFIX)
            Entry(
                service = service,
                cipher = strings.getValue(name),
                username = strings["$service$USERNAME_SUFFIX"] ?: return@mapNotNull null,
                password = strings["$service$PASSWORD_SUFFIX"] ?: return@mapNotNull null,
            )
        }
    }

    /** Whether reading the entry needs the user: its cipher's key has a window. */
    fun requiresAuthentication(entry: Entry) = entry.cipher == AES_GCM || entry.cipher == RSA

    /**
     * The username of an entry whose key needs no authentication, decrypted without the password; null for the
     * others, and for an entry that can't be read.
     */
    fun username(entry: Entry): String? {
        if (entry.cipher != AES_GCM_NO_AUTH && entry.cipher != AES_CBC) return null
        val username = decodeWrappedBase64(entry.username) ?: return null
        return try {
            val key = keys.secretKey(alias(entry)) ?: return null
            if (entry.cipher == AES_CBC) decryptCbc(key, username) else decryptGcm(key, username)
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Deletes the entry: its three strings, from the DataStore file and from the old preferences, and its Keystore key,
     * which no other entry has. The file is rewritten whole, atomically; rnk's own DataStore, should the app still run
     * it, doesn't see the change until the app restarts.
     */
    fun remove(entry: Entry) {
        val names = setOf(
            "${entry.service}$USERNAME_SUFFIX",
            "${entry.service}$PASSWORD_SUFFIX",
            "${entry.service}$CIPHER_SUFFIX",
        )
        if (dataStoreFile.exists()) {
            val bytes = dataStoreFile.readBytes()
            val rest = PreferencesFile.without(bytes, names)
            if (rest.size != bytes.size) replaceAtomically(dataStoreFile, rest)
        }
        sharedPreferences?.edit()?.apply { names.forEach(::remove) }?.commit()
        keys.delete(alias(entry))
    }

    private fun alias(entry: Entry) = entry.service.ifEmpty { DEFAULT_ALIASES[entry.cipher] ?: entry.cipher }

    fun read(entry: Entry): LegacyRead<Credentials> {
        val username = decodeWrappedBase64(entry.username)
        val password = decodeWrappedBase64(entry.password)
        if (username == null || password == null) {
            return unreadable(KeychainErrorCode.DATA_CORRUPTED, "The entry of '${entry.service}' isn't Base64.")
        }
        val alias = alias(entry)
        return try {
            when (entry.cipher) {
                AES_GCM_NO_AUTH -> key(alias).let { key -> found(username, password) { decryptGcm(key, it) } }
                AES_CBC -> key(alias).let { key -> found(username, password) { decryptCbc(key, it) } }
                // Keys with a window of 5 seconds that biometry or the passcode opens (only biometry before Android
                // 11): the prompt opens it, without a cipher.
                AES_GCM -> {
                    val key = key(alias)
                    LegacyRead.NeedsAuthentication(promptAccessControl(), null) {
                        Credentials(decryptGcm(key, username), decryptGcm(key, password))
                    }
                }
                RSA -> {
                    val key = keys.privateKey(alias) ?: throw KeyGone()
                    LegacyRead.NeedsAuthentication(promptAccessControl(), null) {
                        Credentials(decryptRsa(key, username), decryptRsa(key, password))
                    }
                }
                else -> unreadable(
                    KeychainErrorCode.UNSUPPORTED,
                    "The entry of '${entry.service}' is in '${entry.cipher}', which the library doesn't read.",
                )
            }
        } catch (e: KeyGone) {
            unreadable(KeychainErrorCode.KEY_INVALIDATED, "The key of '${entry.service}' is gone.")
        } catch (e: Exception) {
            when {
                e.isInvalidation() ->
                    unreadable(KeychainErrorCode.KEY_INVALIDATED, "The key of '${entry.service}' was invalidated.", e)
                e is AEADBadTagException || e is BadPaddingException ->
                    unreadable(KeychainErrorCode.DATA_CORRUPTED, "The entry of '${entry.service}' doesn't decrypt.", e)
                else -> unreadable(KeychainErrorCode.UNKNOWN, "The entry of '${entry.service}' can't be read: $e", e)
            }
        }
    }

    private fun dataStoreStrings(): Map<String, String> = try {
        PreferencesFile.strings(dataStoreFile.readBytes())
    } catch (e: FileNotFoundException) {
        emptyMap()
    }

    private fun found(username: ByteArray, password: ByteArray, decrypt: (ByteArray) -> String) =
        LegacyRead.Found(Credentials(decrypt(username), decrypt(password)))

    private fun key(alias: String): Key = keys.secretKey(alias) ?: throw KeyGone()

    private fun promptAccessControl() =
        if (sdk >= Build.VERSION_CODES.R) AccessControl.BIOMETRY_ANY_OR_PASSCODE else AccessControl.BIOMETRY_ANY

    private fun decryptGcm(key: Key, bytes: ByteArray): String {
        if (bytes.size < GCM_IV_BYTES) throw BadPaddingException("Shorter than its IV")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, bytes, 0, GCM_IV_BYTES))
        return text(cipher.doFinal(bytes, GCM_IV_BYTES, bytes.size - GCM_IV_BYTES))
    }

    private fun decryptCbc(key: Key, bytes: ByteArray): String {
        if (bytes.size < CBC_IV_BYTES) throw BadPaddingException("Shorter than its IV")
        val cipher = Cipher.getInstance("AES/CBC/PKCS7Padding")
        cipher.init(Cipher.DECRYPT_MODE, key, IvParameterSpec(bytes, 0, CBC_IV_BYTES))
        return text(cipher.doFinal(bytes, CBC_IV_BYTES, bytes.size - CBC_IV_BYTES))
    }

    private fun decryptRsa(key: Key, bytes: ByteArray): String {
        val cipher = Cipher.getInstance("RSA/ECB/PKCS1Padding")
        cipher.init(Cipher.DECRYPT_MODE, key)
        return text(cipher.doFinal(bytes))
    }

    // rnk encrypts the UTF-8 of a string.
    private fun text(bytes: ByteArray) = fromUtf8(bytes) ?: throw BadPaddingException("Not UTF-8")

    private class KeyGone : Exception()

    // As DataStore writes: a file next to it, synced, then renamed over it.
    private fun replaceAtomically(file: File, bytes: ByteArray) {
        val temporary = File(file.parentFile, "${file.name}.apexnative.tmp")
        java.io.FileOutputStream(temporary).use { stream ->
            stream.write(bytes)
            stream.fd.sync()
        }
        if (!temporary.renameTo(file)) {
            temporary.delete()
            throw java.io.IOException("Can't replace $file")
        }
    }

    companion object {
        const val AES_GCM_NO_AUTH = "KeystoreAESGCM_NoAuth"
        const val AES_CBC = "KeystoreAESCBC"
        const val AES_GCM = "KeystoreAESGCM"
        const val RSA = "KeystoreRSAECB"

        private const val NAME = "RN_KEYCHAIN"
        private const val USERNAME_SUFFIX = ":u"
        private const val PASSWORD_SUFFIX = ":p"
        private const val CIPHER_SUFFIX = ":c"
        private const val GCM_IV_BYTES = 12
        private const val GCM_TAG_BITS = 128
        private const val CBC_IV_BYTES = 16

        // The alias of the default service, '', per cipher: its name, but for AES-CBC's.
        private val DEFAULT_ALIASES = mapOf(AES_CBC to "RN_KEYCHAIN_DEFAULT_ALIAS")

        /** rnk's files: DataStore's `files/datastore/RN_KEYCHAIN.preferences_pb`, and the old preferences. */
        fun of(context: Context, keys: KeystoreKeys) = ReactNativeKeychainSource(
            File(context.filesDir, "datastore/$NAME.preferences_pb"),
            context.getSharedPreferences(NAME, Context.MODE_PRIVATE),
            keys,
        )
    }
}
