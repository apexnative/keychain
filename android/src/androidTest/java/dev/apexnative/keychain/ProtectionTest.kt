package dev.apexnative.keychain

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeFalse
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** The options that protect an item, and what happens when its data or its key is damaged. */
@RunWith(AndroidJUnit4::class)
class ProtectionTest : KeychainTestCase() {
    @Test
    fun whenPasscodeSetNeedsAScreenLock() {
        device.isSecure = false
        assertCode(KeychainErrorCode.PASSCODE_NOT_SET) {
            keychain.setItem(service, "k", "v", Encoding.UTF8, options(Accessible.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY))
        }
        assertFalse(keychain.hasItem(service, "k"))
    }

    @Test
    fun whenPasscodeSetItemsGoWithTheScreenLock() {
        device.isSecure = true
        keychain.setItem(service, "locked", "v", Encoding.UTF8, options(Accessible.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY))
        keychain.setItem(service, "plain", "v", Encoding.UTF8, options())
        assertTrue(keychain.hasItem(service, "locked"))

        device.isSecure = false
        assertFalse(keychain.hasItem(service, "locked"))
        assertEquals(listOf("plain"), keychain.getAllKeys(service))
        assertEquals(setOf("plain"), storedItems(service).keys)
    }

    /** The library's own check of the lock, on every Android: here the device only says it's locked. */
    @Test
    fun theLibraryChecksTheLockItself() {
        keychain.setItem(service, "token", "v", Encoding.UTF8, options(Accessible.WHEN_UNLOCKED))
        keychain.setItem(service, "always", "v", Encoding.UTF8, options())

        device.isLocked = true
        assertCode(KeychainErrorCode.INTERACTION_NOT_ALLOWED) {
            keychain.getItem(service, "token", Encoding.UTF8)
        }
        assertCode(KeychainErrorCode.INTERACTION_NOT_ALLOWED) {
            keychain.setItem(service, "token", "w", Encoding.UTF8, options(Accessible.WHEN_UNLOCKED_THIS_DEVICE_ONLY))
        }
        // An item that works after the first unlock works while locked; metadata never needs the device unlocked.
        assertEquals("v", keychain.getItem(service, "always", Encoding.UTF8)?.value)
        assertTrue(keychain.hasItem(service, "token"))

        device.isLocked = false
        assertEquals("v", keychain.getItem(service, "token", Encoding.UTF8)?.value)
    }

    /**
     * The real lock screen, locked with the power button: the items that work only while the device is unlocked
     * can't be read or written, INTERACTION_NOT_ALLOWED, those with access control too; the others can, and the
     * metadata of all. Unlocked with the PIN, they read again.
     */
    @Test
    fun aLockedDeviceRefusesWhenUnlockedItems() {
        Person.assumePin()
        val whenUnlocked = Accessible.entries.filter { it.needsUnlockedDevice }.map { it.jsName }
        for (accessible in Accessible.entries) {
            keychain.setItem(service, accessible.jsName, "v", Encoding.UTF8, options(accessible))
        }
        val protected = if (device.sdk >= 30) listOf("passcode", "window") else emptyList()
        if (device.sdk >= 30) {
            val passcode = options(Accessible.WHEN_UNLOCKED, accessControl = AccessControl.PASSCODE)
            keychain.setItem(service, "passcode", "v", Encoding.UTF8, passcode)
            keychain.setItem(service, "window", "v", Encoding.UTF8, passcode.copy(authValidity = 300))
        }
        Person.lockScreen()
        try {
            for (key in whenUnlocked + protected) {
                assertCode(KeychainErrorCode.INTERACTION_NOT_ALLOWED) { keychain.read(service, key, Encoding.UTF8) }
            }
            assertCode(KeychainErrorCode.INTERACTION_NOT_ALLOWED) {
                keychain.setItem(service, "new", "v", Encoding.UTF8, options(Accessible.WHEN_UNLOCKED))
            }
            assertEquals("v", keychain.getItem(service, "afterFirstUnlock", Encoding.UTF8)?.value)
            assertEquals("v", keychain.getItem(service, "afterFirstUnlockThisDeviceOnly", Encoding.UTF8)?.value)
            keychain.setItem(service, "afterFirstUnlock", "w", Encoding.UTF8, options())
            assertEquals(Accessible.WHEN_UNLOCKED, keychain.getItemInfo(service, "whenUnlocked")?.accessible)
            assertEquals(Accessible.entries.size + protected.size, keychain.getAllKeys(service).size)
        } finally {
            Person.unlock()
        }
        for (key in whenUnlocked) assertEquals("v", keychain.getItem(service, key, Encoding.UTF8)?.value)
        for (key in protected) assertTrue(keychain.read(service, key, Encoding.UTF8) is Keychain.Read.Authenticate)
    }

    /**
     * From API 28 the Keystore itself refuses the key of a `whenUnlocked` item while the device is locked: here the
     * library's own check is fooled — the device says it's unlocked — and the read still ends INTERACTION_NOT_ALLOWED,
     * with the Keystore's exception.
     */
    @Test
    fun fromApi28TheKeystoreRefusesTooWhileLocked() {
        Person.assumePin()
        assumeTrue("setUnlockedDeviceRequired is Android 9's", device.sdk >= 28)
        keychain.setItem(service, "token", "v", Encoding.UTF8, options(Accessible.WHEN_UNLOCKED))
        Person.lockScreen()
        try {
            device.isLocked = false
            val error = assertCode(KeychainErrorCode.INTERACTION_NOT_ALLOWED) {
                keychain.getItem(service, "token", Encoding.UTF8)
            }
            val keystore = setOf(
                "android.security.keystore.UserNotAuthenticatedException",
                // Android 15+: LOCKED, in a plain `InvalidKeyException`.
                "android.security.KeyStoreException",
            )
            assertTrue(error.nativeDomain, error.nativeDomain in keystore)
        } finally {
            Person.unlock()
        }
        assertEquals("v", keychain.getItem(service, "token", Encoding.UTF8)?.value)
    }

    @Test
    fun strongBoxRequiredWithoutStrongBoxIsHardwareUnavailable() {
        device.hasStrongBox = false
        assertCode(KeychainErrorCode.HARDWARE_UNAVAILABLE) {
            keychain.setItem(service, "k", "v", Encoding.UTF8, options(keyStorage = KeyStorage.STRONGBOX_REQUIRED))
        }
        device.sdk = 27
        device.hasStrongBox = true
        assertCode(KeychainErrorCode.HARDWARE_UNAVAILABLE) {
            keychain.setItem(service, "k", "v", Encoding.UTF8, options(keyStorage = KeyStorage.STRONGBOX_REQUIRED))
        }
        assertEquals(emptyList<String>(), keystoreAliases(service))
    }

    @Test
    fun strongBoxWithoutStrongBoxFallsBackToTheTee() {
        device.hasStrongBox = false
        keychain.setItem(service, "tee", "v", Encoding.UTF8, options())
        keychain.setItem(service, "strongbox", "v", Encoding.UTF8, options(keyStorage = KeyStorage.STRONGBOX))
        val items = storedItems(service)
        assertEquals(items.getValue("tee").alias, items.getValue("strongbox").alias)
        assertNotEquals(SecurityLevel.STRONGBOX, keychain.getItemInfo(service, "strongbox")?.securityLevel)
    }

    @Test
    fun strongBoxWhereThereIsOne() {
        assumeTrue("The device has no StrongBox", device.hasStrongBox)
        keychain.setItem(service, "required", "v", Encoding.UTF8, options(keyStorage = KeyStorage.STRONGBOX_REQUIRED))
        keychain.setItem(service, "tried", "v", Encoding.UTF8, options(keyStorage = KeyStorage.STRONGBOX))
        keychain.setItem(service, "tee", "v", Encoding.UTF8, options())
        assertEquals(SecurityLevel.STRONGBOX, keychain.getItemInfo(service, "required")?.securityLevel)
        assertEquals(SecurityLevel.STRONGBOX, keychain.getItemInfo(service, "tried")?.securityLevel)
        assertEquals(SecurityLevel.TEE, keychain.getItemInfo(service, "tee")?.securityLevel)
        assertEquals("v", keychain.getItem(service, "required", Encoding.UTF8)?.value)
        assertEquals(2, keystoreAliases(service).size)
    }

    @Test
    fun theSecurityLevelBeforeApi31IsTheSame() {
        assumeTrue("Android 12 says the security level itself", device.sdk >= 31)
        keychain.setItem(service, "new", "v", Encoding.UTF8, options())
        // Another service: a key of its own, measured the old way.
        val old = "$service.old"
        device.sdk = 30
        try {
            keychain.setItem(old, "old", "v", Encoding.UTF8, options())
            val attested = Attestation.securityLevel()
            assertEquals(attested, keychain.getItemInfo(service, "new")?.securityLevel)
            assertEquals(attested, keychain.getItemInfo(old, "old")?.securityLevel)
        } finally {
            keychain.clear(old)
        }
    }

    @Test
    fun aDamagedCiphertextIsDataCorrupted() {
        keychain.setItem(service, "token", "secret", Encoding.UTF8, options())
        val item = storedItems(service).getValue("token")
        val damaged = Base64.decode(item.ciphertext)!!.also { it[0] = (it[0].toInt() xor 1).toByte() }
        writeStore(service, mapOf("token" to item.copy(ciphertext = Base64.encode(damaged))))
        val again = newKeychain()
        assertCode(KeychainErrorCode.DATA_CORRUPTED) { again.getItem(service, "token", Encoding.UTF8) }
        // Not deleted: corruption isn't invalidation.
        assertTrue(again.hasItem(service, "token"))
    }

    @Test
    fun aCiphertextBelongsToItsKey() {
        keychain.setItem(service, "a", "secret a", Encoding.UTF8, options())
        keychain.setItem(service, "b", "secret b", Encoding.UTF8, options())
        val items = storedItems(service)
        // The same Keystore key, but the AAD names the item: b's ciphertext doesn't decrypt as a.
        writeStore(service, mapOf("a" to items.getValue("b"), "b" to items.getValue("b")))
        val again = newKeychain()
        assertCode(KeychainErrorCode.DATA_CORRUPTED) { again.getItem(service, "a", Encoding.UTF8) }
        assertEquals("secret b", again.getItem(service, "b", Encoding.UTF8)?.value)
    }

    @Test
    fun aCiphertextBelongsToItsService() {
        val other = "$service.other"
        keychain.setItem(service, "token", "secret", Encoding.UTF8, options())
        try {
            // The file of another service with this service's item, its key alias included.
            File(directory, StoreFormat.fileName(other))
                .writeBytes(StoreFormat.encode(StoreData(other, storedItems(service))))
            assertCode(KeychainErrorCode.DATA_CORRUPTED) {
                newKeychain().getItem(other, "token", Encoding.UTF8)
            }
        } finally {
            keychain.clear(other)
        }
    }

    /** The key gone, as when the app's data is restored without its keys. */
    @Test
    fun anItemWhoseKeyIsGoneIsInvalidatedAndDeleted() {
        keychain.setItem(service, "token", "secret", Encoding.UTF8, options())
        keychain.setItem(service, "other", "secret", Encoding.UTF8, options())
        val alias = storedItems(service).getValue("token").alias
        deleteKeystoreKey(alias)

        assertCode(KeychainErrorCode.KEY_INVALIDATED) { keychain.getItem(service, "token", Encoding.UTF8) }
        assertFalse(keychain.hasItem(service, "token"))
        assertEquals(setOf("other"), storedItems(service).keys)

        // A new key, of a new generation, for the next write.
        keychain.setItem(service, "token", "again", Encoding.UTF8, options())
        assertEquals("again", keychain.getItem(service, "token", Encoding.UTF8)?.value)
        val newAlias = storedItems(service).getValue("token").alias
        assertNotEquals(alias, newAlias)
        assertEquals(listOf(newAlias), keystoreAliases(service))
        assertCode(KeychainErrorCode.KEY_INVALIDATED) { keychain.getItem(service, "other", Encoding.UTF8) }
    }

    @Test
    fun aDamagedFileIsDataCorruptedUntilCleared() {
        keychain.setItem(service, "token", "secret", Encoding.UTF8, options())
        storeFile(service).writeText("{ not json")
        val again = newKeychain()
        assertCode(KeychainErrorCode.DATA_CORRUPTED) { again.getItem(service, "token", Encoding.UTF8) }
        assertCode(KeychainErrorCode.DATA_CORRUPTED) { again.hasItem(service, "token") }
        assertCode(KeychainErrorCode.DATA_CORRUPTED) { again.getAllKeys(service) }
        assertCode(KeychainErrorCode.DATA_CORRUPTED) { again.setItem(service, "token", "v", Encoding.UTF8, options()) }

        again.clear(service)
        assertEquals(emptyList<String>(), again.getAllKeys(service))
        again.setItem(service, "token", "fresh", Encoding.UTF8, options())
        assertEquals("fresh", again.getItem(service, "token", Encoding.UTF8)?.value)
    }

    @Test
    fun theFileHoldsNoValue() {
        keychain.setItem(service, "token", "a very visible secret", Encoding.UTF8, options(label = "a visible label"))
        val text = storeFile(service).readText()
        assertFalse(text.contains("a very visible secret"))
        assertTrue(text.contains("a visible label"))
        val noBackup = InstrumentationRegistry.getInstrumentation().targetContext.noBackupFilesDir
        assertTrue(storeFile(service).path.startsWith(noBackup.path))
    }

    @Test
    fun aFailedWriteLeavesTheOldItem() {
        // Android 11+ `AtomicFile` writes a new file next to the old one, which a read-only directory refuses; before,
        // it writes over the old file.
        assumeTrue("AtomicFile writes a new file from Android 11", device.sdk >= 30)
        assumeFalse("root writes to a read-only directory", android.os.Process.myUid() == 0)
        keychain.setItem(service, "token", "old", Encoding.UTF8, options())
        assertTrue(directory.setWritable(false))
        try {
            assertCode(KeychainErrorCode.UNKNOWN) {
                keychain.setItem(service, "token", "new", Encoding.UTF8, options())
            }
            assertEquals("old", keychain.getItem(service, "token", Encoding.UTF8)?.value)
        } finally {
            directory.setWritable(true)
        }
        assertEquals("old", newKeychain().getItem(service, "token", Encoding.UTF8)?.value)
    }
}
