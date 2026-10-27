package dev.apexnative.keychain.migration

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.apexnative.keychain.AccessControl
import dev.apexnative.keychain.KeychainErrorCode
import dev.apexnative.keychain.KeystoreKeys
import dev.apexnative.keychain.SystemDevice
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.spec.X509EncodedKeySpec
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * Samples of react-native-keychain's and expo-secure-store's items, made the way those libraries make them: the same
 * Keystore keys, ciphers and layouts, rnk's DataStore written by DataStore itself. Deleted after each test.
 */
abstract class LegacySampleTestCase {
    internal val context = InstrumentationRegistry.getInstrumentation().targetContext
    internal val id = UUID.randomUUID().toString()
    internal val keys = KeystoreKeys()
    internal val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    internal val device = SystemDevice(context)
    internal val aliases = mutableListOf<String>()
    internal val preferenceNames = mutableListOf<String>()
    internal val directory = File(context.cacheDir, "legacy-$id").apply { mkdirs() }
    internal var stores = 0

    /** The DataStore file the last `rnk()` wrote. */
    internal var rnkFile: File? = null

    /** What DataStore itself reads from a file: the check that the library's rewrite kept it valid. */
    internal fun readWithDataStore(file: File): Map<String, String> {
        val copy = File(directory, "check-${stores++}.preferences_pb").also { file.copyTo(it) }
        val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
        val store = PreferenceDataStoreFactory.create(scope = scope, produceFile = { copy })
        return runBlocking { store.data.first() }.asMap().entries.associate { (k, v) -> k.name to v.toString() }
            .also { scope.cancel() }
    }

    @After
    fun deleteSamples() {
        aliases.forEach(keyStore::deleteEntry)
        preferenceNames.forEach(context::deleteSharedPreferences)
        directory.deleteRecursively()
    }

    // rnk's samples

    internal fun rnk(
        dataStore: Map<String, String>,
        sharedPreferences: Map<String, String> = emptyMap(),
    ): ReactNativeKeychainSource {
        // A file of its own each time: DataStore allows one store per file in a process.
        val file = File(directory, "RN_KEYCHAIN-${stores++}.preferences_pb")
        rnkFile = file
        val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
        val store = PreferenceDataStoreFactory.create(scope = scope, produceFile = { file })
        runBlocking {
            store.edit { preferences -> dataStore.forEach { (k, v) -> preferences[stringPreferencesKey(k)] = v } }
        }
        scope.cancel()
        return ReactNativeKeychainSource(file, preferences(sharedPreferences), keys)
    }

    // What `DataStorePrefsStorage.storeEncryptedEntry` writes.
    internal fun rnkEntry(service: String, cipher: String, encrypted: Pair<ByteArray, ByteArray>) = mapOf(
        "$service:u" to Base64.encodeToString(encrypted.first, Base64.DEFAULT),
        "$service:p" to Base64.encodeToString(encrypted.second, Base64.DEFAULT),
        "$service:c" to cipher,
    )

    // `CipherStorageKeystoreAesGcm` / `…AesCbc`: the IV the Keystore made, then the ciphertext.
    internal fun rnkEncrypt(key: SecretKey, transformation: String, username: String, password: String) =
        listOf(username, password).map { text ->
            val cipher = Cipher.getInstance(transformation)
            cipher.init(Cipher.ENCRYPT_MODE, key)
            cipher.iv + cipher.doFinal(text.toByteArray())
        }.let { it[0] to it[1] }

    internal fun rnkAesKey(
        alias: String,
        blockMode: String,
        padding: String,
        authentication: Boolean = false,
    ): SecretKey {
        aliases += alias
        val builder = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(blockMode)
            .setEncryptionPaddings(padding)
            .setRandomizedEncryptionRequired(true)
            .setKeySize(256)
        if (authentication) {
            builder.setUserAuthenticationRequired(true)
            rnkWindow(builder)
        }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(builder.build())
            generateKey()
        }
    }

    internal fun rnkRsaKey(alias: String): java.security.PublicKey {
        aliases += alias
        val builder = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_ECB)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_PKCS1)
            .setRandomizedEncryptionRequired(true)
            .setUserAuthenticationRequired(true)
            .setKeySize(2048)
        rnkWindow(builder)
        return KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore").run {
            initialize(builder.build())
            generateKeyPair().public
        }
    }

    // rnk's window: 5 seconds, of biometry or the passcode.
    internal fun rnkWindow(builder: KeyGenParameterSpec.Builder) {
        if (Build.VERSION.SDK_INT >= 30) {
            builder.setUserAuthenticationParameters(
                5,
                KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL,
            )
        } else {
            @Suppress("DEPRECATION")
            builder.setUserAuthenticationValidityDurationSeconds(5)
        }
    }

    // expo's samples

    internal fun expo(vararg items: Pair<String, Any>): ExpoSecureStoreSource {
        val preferences = preferences(items.associate { (k, v) -> k to v.toString() })
        return ExpoSecureStoreSource(preferences, keys)
    }

    // `AESEncryptor.initializeKeyStoreEntry`.
    internal fun expoKey(alias: String, authentication: Boolean): SecretKey {
        aliases += alias
        val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(authentication)
            .build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(spec)
            generateKey()
        }
    }

    // `AESEncryptor.createEncryptedItemWithCipher` and `SecureStoreModule.saveEncryptedItem`; the old ones had neither
    // the keychain service nor the suffix.
    internal fun expoEnvelope(
        key: SecretKey,
        value: String,
        keychainService: String?,
        requireAuthentication: Boolean?,
    ): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val gcm = cipher.parameters.getParameterSpec(javax.crypto.spec.GCMParameterSpec::class.java)
        val envelope = JSONObject()
            .put("ct", Base64.encodeToString(cipher.doFinal(value.toByteArray()), Base64.NO_WRAP))
            .put("iv", Base64.encodeToString(gcm.iv, Base64.NO_WRAP))
            .put("tlen", gcm.tLen)
            .put("scheme", "aes")
        if (keychainService != null) {
            envelope.put("usesKeystoreSuffix", true).put("keystoreAlias", keychainService)
        }
        requireAuthentication?.let { envelope.put("requireAuthentication", it) }
        return envelope.toString()
    }

    internal fun preferences(strings: Map<String, String>): android.content.SharedPreferences {
        val name = "legacy-$id-${preferenceNames.size}"
        preferenceNames += name
        return context.getSharedPreferences(name, Context.MODE_PRIVATE).also { preferences ->
            preferences.edit().apply { strings.forEach { (k, v) -> putString(k, v) } }.commit()
        }
    }

    internal fun unreadable(read: LegacyRead<*>): KeychainErrorCode? = (read as? LegacyRead.Unreadable)?.error?.code
}
