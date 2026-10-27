package dev.apexnative.keychain.migration

import android.security.keystore.KeyProperties
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.apexnative.keychain.KeychainErrorCode
import dev.apexnative.keychain.migration.Migration.Kind
import dev.apexnative.keychain.migration.Migration.Library
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Migration's native part on samples: the sources a query finds, their values, the markers, the deletion. */
@RunWith(AndroidJUnit4::class)
class MigrationTest : LegacySampleTestCase() {
    private val markers = MigrationMarkers(File(directory, "migrated.json"))

    private fun migration(rnk: ReactNativeKeychainSource, expo: ExpoSecureStoreSource = expo()) =
        Migration(rnk, expo, markers)

    private fun gcmKey(alias: String, authentication: Boolean = false) =
        rnkAesKey(alias, KeyProperties.BLOCK_MODE_GCM, KeyProperties.ENCRYPTION_PADDING_NONE, authentication)

    private fun cbcKey(alias: String) =
        rnkAesKey(alias, KeyProperties.BLOCK_MODE_CBC, KeyProperties.ENCRYPTION_PADDING_PKCS7)

    private fun gcm(key: javax.crypto.SecretKey, username: String, password: String) =
        rnkEncrypt(key, "AES/GCM/NoPadding", username, password)

    private fun rnkQuery(services: List<String> = emptyList(), servers: List<String> = emptyList()) =
        Migration.Query(Library.REACT_NATIVE_KEYCHAIN, services, servers)

    private fun expoQuery(vararg services: String) =
        Migration.Query(Library.EXPO_SECURE_STORE, services.toList(), emptyList())

    private fun source(kind: Kind, service: String, account: String, requiresAuth: Boolean = false) =
        Migration.Source(kind, service, account, requiresAuth, migrated = false)

    @Test
    fun reactNativeKeychainSources() {
        val default = gcmKey("KeystoreAESGCM_NoAuth")
        val named = cbcKey("rnk.$id.vault")
        val server = gcmKey("rnk.$id.example.com")
        val vault = rnkEncrypt(named, "AES/CBC/PKCS7Padding", "ivan", "x")
        val migration = migration(
            rnk(
                dataStore = rnkEntry("", "KeystoreAESGCM_NoAuth", gcm(default, "me", "pw")) +
                    rnkEntry("rnk.$id.vault", "KeystoreAESCBC", vault) +
                    rnkEntry("rnk.$id.example.com", "KeystoreAESGCM_NoAuth", gcm(server, "s", "y")),
            ),
        )
        // No services: rnk's default on Android, ''.
        assertEquals(listOf(source(Kind.GENERIC_PASSWORD, "", "me")), migration.sources(rnkQuery()))
        // The others by name; one that isn't there isn't a source.
        val sources = migration.sources(rnkQuery(listOf("rnk.$id.vault", "missing"), listOf("rnk.$id.example.com")))
        assertEquals(
            listOf(
                source(Kind.GENERIC_PASSWORD, "rnk.$id.vault", "ivan"),
                source(Kind.INTERNET_PASSWORD, "rnk.$id.example.com", "s"),
            ),
            sources,
        )
        assertEquals(LegacyRead.Found("x"), migration.read(sources[0]))
        assertEquals(LegacyRead.Found("y"), migration.read(sources[1]))
    }

    @Test
    fun reactNativeKeychainWithAuthentication() {
        assumeTrue("Needs a screen lock", device.isSecure)
        gcmKey("rnk.$id.locked", authentication = true)
        val locked = rnkEntry("rnk.$id.locked", "KeystoreAESGCM", ByteArray(40) to ByteArray(40))
        val migration = migration(rnk(dataStore = locked))
        val found = migration.sources(rnkQuery(listOf("rnk.$id.locked"))).single()
        // The username is encrypted as the password: no account until it's read.
        assertEquals(source(Kind.GENERIC_PASSWORD, "rnk.$id.locked", "", requiresAuth = true), found)
        assertTrue(migration.read(found) is LegacyRead.NeedsAuthentication)
    }

    @Test
    fun markedThenRemoved() {
        val moved = rnkEntry("rnk.$id.moved", "KeystoreAESGCM_NoAuth", gcm(gcmKey("rnk.$id.moved"), "a", "b"))
        val kept = rnkEntry("rnk.$id.kept", "KeystoreAESGCM_NoAuth", gcm(gcmKey("rnk.$id.kept"), "c", "d"))
        // The entry is in both places, as after rnk 9 moved it and an old version wrote it again.
        val migration = migration(rnk(dataStore = moved + kept, sharedPreferences = moved))
        val file = rnkFile!!
        val query = rnkQuery(listOf("rnk.$id.moved"))
        val source = migration.sources(query).single()

        // Kept: marked, the next run sees it as moved; the source is all there.
        migration.finish(source, removeSource = false)
        assertEquals(true, migration.sources(query).single().migrated)
        assertEquals(LegacyRead.Found("b"), migration.read(source))

        // Removed: the entry, its key and the marker go; the other entry stays, readable by DataStore itself.
        migration.finish(source, removeSource = true)
        assertEquals(emptyList<Migration.Source>(), migration.sources(query))
        assertEquals(LegacyRead.Found(null), migration.read(source))
        assertFalse(keyStore.containsAlias("rnk.$id.moved"))
        assertTrue(keyStore.containsAlias("rnk.$id.kept"))
        assertEquals(kept, readWithDataStore(file))
        assertFalse(markers.contains("reactNativeKeychain\u0000rnk.$id.moved\u0000"))
        // No item is no error.
        migration.finish(source, removeSource = true)
    }

    @Test
    fun expoSources() {
        val key = expoKey("AES/GCM/NoPadding:key_v1:keystoreUnauthenticated", authentication = false)
        val named = expoKey("AES/GCM/NoPadding:expo.$id:keystoreUnauthenticated", authentication = false)
        val legacy = expoKey("AES/GCM/NoPadding:key_v1", authentication = false)
        val expo = expo(
            "key_v1-token" to expoEnvelope(key, "default's", "key_v1", requireAuthentication = false),
            // The same key from an older version: expo reads `<service>-<key>` first, so one source.
            "token" to expoEnvelope(legacy, "old", keychainService = null, requireAuthentication = null),
            "old only" to expoEnvelope(legacy, "old only", keychainService = null, requireAuthentication = null),
            "expo.$id-named" to expoEnvelope(named, "named's", "expo.$id", requireAuthentication = false),
        )
        val migration = migration(rnk(emptyMap()), expo)
        // No services: expo's default on Android, 'key_v1'.
        val defaults = migration.sources(expoQuery())
        assertEquals(
            listOf(source(Kind.SECURE_STORE, "key_v1", "token"), source(Kind.SECURE_STORE, "key_v1", "old only")),
            defaults,
        )
        assertEquals(LegacyRead.Found("default's"), migration.read(defaults[0]))
        assertEquals(LegacyRead.Found("old only"), migration.read(defaults[1]))
        // Servers are rnk's: expo ignores them.
        val namedSource = migration.sources(Migration.Query(Library.EXPO_SECURE_STORE, listOf("expo.$id"), listOf("x")))
            .single { it.account == "named" }
        assertEquals(LegacyRead.Found("named's"), migration.read(namedSource))
    }

    @Test
    fun expoRemovesEveryVariantAndTheLastKey() {
        val service = "expo.$id"
        val key = expoKey("AES/GCM/NoPadding:$service:keystoreUnauthenticated", authentication = false)
        val legacy = expoKey("AES/GCM/NoPadding:$service", authentication = false)
        val expo = expo(
            "$service-first" to expoEnvelope(key, "1", service, requireAuthentication = false),
            "$service-second" to expoEnvelope(key, "2", service, requireAuthentication = false),
            "first" to expoEnvelope(legacy, "old 1", keychainService = null, requireAuthentication = null),
        )
        val migration = migration(rnk(emptyMap()), expo)
        val query = expoQuery(service)
        val sources = migration.sources(query).associateBy { it.account }
        assertEquals(setOf("first", "second"), sources.keys)

        // Both variants of 'first' go; the key stays for 'second'.
        migration.finish(sources.getValue("first"), removeSource = true)
        assertEquals(listOf("second"), migration.sources(query).map { it.account })
        assertTrue(keyStore.containsAlias("AES/GCM/NoPadding:$service:keystoreUnauthenticated"))
        // The old variant's key has no item left.
        assertFalse(keyStore.containsAlias("AES/GCM/NoPadding:$service"))

        migration.finish(sources.getValue("second"), removeSource = true)
        assertEquals(emptyList<Migration.Source>(), migration.sources(query))
        assertFalse(keyStore.containsAlias("AES/GCM/NoPadding:$service:keystoreUnauthenticated"))
    }

    @Test
    fun aValueWithNulIsDataCorrupted() {
        val service = "expo.$id"
        val key = expoKey("AES/GCM/NoPadding:$service:keystoreUnauthenticated", authentication = false)
        val expo = expo("$service-nul" to expoEnvelope(key, "a\u0000b", service, requireAuthentication = false))
        val migration = migration(rnk(emptyMap()), expo)
        val source = migration.sources(expoQuery(service)).single()
        try {
            migration.read(source)
            throw AssertionError("read")
        } catch (e: dev.apexnative.keychain.KeychainException) {
            assertEquals(KeychainErrorCode.DATA_CORRUPTED, e.code)
        }
        assertNull(unreadable(LegacyRead.Found("fine")))
    }
}
