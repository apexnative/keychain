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
 * The readers of react-native-keychain's and expo-secure-store's items, on samples made the way those libraries make
 * them: the same Keystore keys, ciphers and layouts, rnk's DataStore written by DataStore itself.
 */
/**
 * The readers of react-native-keychain's and expo-secure-store's items, on samples made the way those libraries make
 * them.
 */
@RunWith(AndroidJUnit4::class)
class LegacySourcesTest : LegacySampleTestCase() {
    // react-native-keychain

    @Test
    fun rnkWithoutAuthentication() {
        val gcm = rnkAesKey("rnk.$id.gcm", KeyProperties.BLOCK_MODE_GCM, KeyProperties.ENCRYPTION_PADDING_NONE)
        // The default service, '', has AES-CBC's alias of its own.
        val cbc =
            rnkAesKey("RN_KEYCHAIN_DEFAULT_ALIAS", KeyProperties.BLOCK_MODE_CBC, KeyProperties.ENCRYPTION_PADDING_PKCS7)
        val gcmEntry = rnkEncrypt(gcm, "AES/GCM/NoPadding", "ivan", "пароль 🔑")
        val source = rnk(
            dataStore = rnkEntry("rnk.$id.gcm", "KeystoreAESGCM_NoAuth", gcmEntry) +
                rnkEntry("", "KeystoreAESCBC", rnkEncrypt(cbc, "AES/CBC/PKCS7Padding", "anna", "secret")),
        )
        val entries = source.entries().associateBy { it.service }
        assertEquals(setOf("rnk.$id.gcm", ""), entries.keys)
        assertEquals(
            LegacyRead.Found(ReactNativeKeychainSource.Credentials("ivan", "пароль 🔑")),
            source.read(entries.getValue("rnk.$id.gcm")),
        )
        assertEquals(
            LegacyRead.Found(ReactNativeKeychainSource.Credentials("anna", "secret")),
            source.read(entries.getValue("")),
        )
    }

    @Test
    fun rnkBeforeDataStore() {
        // rnk 8 and before: the same strings in SharedPreferences; the DataStore's win, as rnk 9 moves them there.
        val key = rnkAesKey("rnk.$id.old", KeyProperties.BLOCK_MODE_GCM, KeyProperties.ENCRYPTION_PADDING_NONE)
        val old = rnkEntry("rnk.$id.old", "KeystoreAESGCM_NoAuth", rnkEncrypt(key, "AES/GCM/NoPadding", "old", "one"))
        val newer = rnkEntry("rnk.$id.old", "KeystoreAESGCM_NoAuth", rnkEncrypt(key, "AES/GCM/NoPadding", "new", "two"))
        val legacyOnly =
            rnkEntry("rnk.$id.legacy", "KeystoreAESGCM_NoAuth", rnkEncrypt(key, "AES/GCM/NoPadding", "a", "b"))
        val source = rnk(dataStore = newer, sharedPreferences = old + legacyOnly)
        val entries = source.entries().associateBy { it.service }
        assertEquals(setOf("rnk.$id.old", "rnk.$id.legacy"), entries.keys)
        assertEquals(
            LegacyRead.Found(ReactNativeKeychainSource.Credentials("new", "two")),
            source.read(entries.getValue("rnk.$id.old")),
        )
        // The legacy entry's key is the service's alias, which it doesn't have here: gone.
        assertEquals(KeychainErrorCode.KEY_INVALIDATED, unreadable(source.read(entries.getValue("rnk.$id.legacy"))))
    }

    @Test
    fun rnkWithAuthentication() {
        assumeTrue("Needs a screen lock", device.isSecure)
        // RSA: written with the public key, read with the private one after a prompt.
        val rsa = rnkRsaKey("rnk.$id.rsa")
        val publicKey = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(rsa.encoded))
        val encrypt = { text: String ->
            Cipher.getInstance("RSA/ECB/PKCS1Padding").run {
                init(Cipher.ENCRYPT_MODE, publicKey)
                doFinal(text.toByteArray())
            }
        }
        // AES-GCM with authentication: writing needs the window open too, so the sample's bytes are any.
        rnkAesKey("rnk.$id.auth", KeyProperties.BLOCK_MODE_GCM, KeyProperties.ENCRYPTION_PADDING_NONE, true)
        val source = rnk(
            dataStore = rnkEntry("rnk.$id.rsa", "KeystoreRSAECB", encrypt("ivan") to encrypt("secret")) +
                rnkEntry("rnk.$id.auth", "KeystoreAESGCM", ByteArray(40) to ByteArray(40)),
        )
        val prompt =
            if (Build.VERSION.SDK_INT >= 30) AccessControl.BIOMETRY_ANY_OR_PASSCODE else AccessControl.BIOMETRY_ANY
        for (entry in source.entries()) {
            val read = source.read(entry)
            assertTrue(entry.service, read is LegacyRead.NeedsAuthentication)
            read as LegacyRead.NeedsAuthentication
            assertEquals(prompt, read.accessControl)
            // A window of 5 seconds, which the prompt opens: no cipher of its own.
            assertNull(read.cipher)
        }
    }

    @Test
    fun rnkEntriesThatCantBeRead() {
        val source = rnk(
            dataStore = rnkEntry("rnk.$id.gone", "KeystoreAESGCM_NoAuth", ByteArray(40) to ByteArray(40)) +
                rnkEntry("rnk.$id.conceal", "FacebookConceal", ByteArray(4) to ByteArray(4)) +
                mapOf("rnk.$id.half:u" to "dXNlcg==", "rnk.$id.half:c" to "KeystoreAESCBC"),
        )
        val entries = source.entries().associateBy { it.service }
        // An entry without its password isn't one.
        assertEquals(setOf("rnk.$id.gone", "rnk.$id.conceal"), entries.keys)
        assertEquals(KeychainErrorCode.KEY_INVALIDATED, unreadable(source.read(entries.getValue("rnk.$id.gone"))))
        assertEquals(KeychainErrorCode.UNSUPPORTED, unreadable(source.read(entries.getValue("rnk.$id.conceal"))))

        val key = rnkAesKey("rnk.$id.damaged", KeyProperties.BLOCK_MODE_GCM, KeyProperties.ENCRYPTION_PADDING_NONE)
        val (username, password) = rnkEncrypt(key, "AES/GCM/NoPadding", "u", "p")
        password[password.size - 1] = (password.last().toInt() xor 1).toByte()
        val damaged = rnk(dataStore = rnkEntry("rnk.$id.damaged", "KeystoreAESGCM_NoAuth", username to password))
        assertEquals(KeychainErrorCode.DATA_CORRUPTED, unreadable(damaged.read(damaged.entries().single())))
    }

    @Test
    fun rnkWithNothing() {
        val source = ReactNativeKeychainSource(File(directory, "none.preferences_pb"), null, keys)
        assertEquals(emptyList<ReactNativeKeychainSource.Entry>(), source.entries())
    }

    // expo-secure-store

    @Test
    fun expoWithoutAuthentication() {
        val service = "expo.$id"
        val key = expoKey("AES/GCM/NoPadding:$service:keystoreUnauthenticated", authentication = false)
        val legacyKey = expoKey("AES/GCM/NoPadding:$service", authentication = false)
        val other = expoKey("AES/GCM/NoPadding:other.$id:keystoreUnauthenticated", authentication = false)
        val source = expo(
            "$service-token" to expoEnvelope(key, "the token", service, requireAuthentication = false),
            // From older versions: under the key alone, without the keychain service or the suffix.
            "legacy" to expoEnvelope(legacyKey, "old value", keychainService = null, requireAuthentication = null),
            "other.$id-token" to expoEnvelope(other, "another service's", "other.$id", requireAuthentication = false),
            "not json" to "plain",
        )
        val entries = source.entries(service).associateBy { it.key }
        assertEquals(setOf("token", "legacy"), entries.keys)
        assertEquals(LegacyRead.Found("the token"), source.read(entries.getValue("token")))
        assertEquals(LegacyRead.Found("old value"), source.read(entries.getValue("legacy")))
        // The old items name no keychain service, so every service lists them, as expo reads them; the key of the
        // service they were written with decides.
        val others = source.entries("other.$id").associateBy { it.key }
        assertEquals(setOf("token", "legacy"), others.keys)
        assertEquals(LegacyRead.Found("another service's"), source.read(others.getValue("token")))
        assertEquals(KeychainErrorCode.KEY_INVALIDATED, unreadable(source.read(others.getValue("legacy"))))
    }

    @Test
    fun expoWithAuthentication() {
        assumeTrue(
            "Needs a fingerprint enrolled",
            device.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) ==
                BiometricManager.BIOMETRIC_SUCCESS,
        )
        val service = "expo.$id"
        // Writing needs the prompt too, so the sample's bytes are any; reading only needs the key.
        expoKey("AES/GCM/NoPadding:$service:keystoreAuthenticated", authentication = true)
        val envelope = JSONObject()
            .put("ct", Base64.encodeToString(ByteArray(24), Base64.NO_WRAP))
            .put("iv", Base64.encodeToString(ByteArray(12), Base64.NO_WRAP))
            .put("tlen", 128)
            .put("scheme", "aes")
            .put("usesKeystoreSuffix", true)
            .put("keystoreAlias", service)
            .put("requireAuthentication", true)
        val source = expo("$service-locked" to envelope.toString())
        val read = source.read(source.entries(service).single())
        assertTrue(read is LegacyRead.NeedsAuthentication)
        read as LegacyRead.NeedsAuthentication
        assertEquals(AccessControl.BIOMETRY_CURRENT_SET, read.accessControl)
        // Every read needs the prompt to unlock this very cipher.
        assertNotNull(read.cipher)
    }

    @Test
    fun expoItemsThatCantBeRead() {
        val service = "expo.$id"
        val key = expoKey("AES/GCM/NoPadding:$service:keystoreUnauthenticated", authentication = false)
        val damaged = JSONObject(expoEnvelope(key, "value", service, requireAuthentication = false)).apply {
            val ct = Base64.decode(getString("ct"), Base64.DEFAULT)
            ct[0] = (ct[0].toInt() xor 1).toByte()
            put("ct", Base64.encodeToString(ct, Base64.NO_WRAP))
        }
        val source = expo(
            "$service-damaged" to damaged.toString(),
            "$service-hybrid" to JSONObject().put("scheme", "hybrid").put("keystoreAlias", service).toString(),
            "$service-short" to JSONObject(expoEnvelope(key, "v", service, false)).put("tlen", 64).toString(),
            "gone.$id-item" to expoEnvelope(key, "v", "gone.$id", requireAuthentication = false),
        )
        val entries = source.entries(service).associateBy { it.key }
        assertEquals(KeychainErrorCode.DATA_CORRUPTED, unreadable(source.read(entries.getValue("damaged"))))
        assertEquals(KeychainErrorCode.UNSUPPORTED, unreadable(source.read(entries.getValue("hybrid"))))
        assertEquals(KeychainErrorCode.DATA_CORRUPTED, unreadable(source.read(entries.getValue("short"))))
        // Its service's key isn't there: an app reinstalled, a backup restored.
        assertEquals(KeychainErrorCode.KEY_INVALIDATED, unreadable(source.read(source.entries("gone.$id").single())))
    }
}
