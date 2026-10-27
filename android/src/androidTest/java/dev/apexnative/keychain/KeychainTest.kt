package dev.apexnative.keychain

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.random.Random

/** The storage on a device: what JavaScript sees through the module, without the module. */
@RunWith(AndroidJUnit4::class)
class KeychainTest : KeychainTestCase() {
    @Test
    fun text() {
        keychain.setItem(service, "token", "Привет, 🔑", Encoding.UTF8, options(label = "ivan@example.com"))
        assertEquals(
            Keychain.Item("Привет, 🔑", "ivan@example.com"),
            keychain.getItem(service, "token", Encoding.UTF8),
        )
        assertEquals(
            Base64.encode("Привет, 🔑".toByteArray(Charsets.UTF_8)),
            keychain.getItem(service, "token", Encoding.BASE64)?.value,
        )
        assertEquals("Привет, 🔑", keychain.getItem(service, "token", Encoding.UTF8)?.value)
    }

    @Test
    fun bytes() {
        val raw = Random(7).nextBytes(1024)
        keychain.setItem(service, "dbKey", Base64.encode(raw), Encoding.BASE64, options())
        val read = keychain.getItem(service, "dbKey", Encoding.BASE64)
        assertArrayEquals(raw, Base64.decode(read!!.value))
        assertNull(read.label)
        // Random bytes aren't UTF-8.
        assertCode(KeychainErrorCode.INVALID_ARGUMENT) {
            keychain.getItem(service, "dbKey", Encoding.UTF8)
        }
    }

    @Test
    fun bytesThatAreUtf8ReadAsText() {
        keychain.setItem(service, "k", Base64.encode("ok ✓".toByteArray(Charsets.UTF_8)), Encoding.BASE64, options())
        assertEquals("ok ✓", keychain.getItem(service, "k", Encoding.UTF8)?.value)
    }

    @Test
    fun emptyValues() {
        keychain.setItem(service, "text", "", Encoding.UTF8, options())
        keychain.setItem(service, "bytes", "", Encoding.BASE64, options())
        assertEquals("", keychain.getItem(service, "text", Encoding.UTF8)?.value)
        assertEquals("", keychain.getItem(service, "bytes", Encoding.BASE64)?.value)
        assertEquals("", keychain.getItem(service, "bytes", Encoding.UTF8)?.value)
    }

    @Test
    fun aMissingItemIsNoError() {
        assertNull(keychain.getItem(service, "nothing", Encoding.UTF8))
        assertNull(keychain.getItem(service, "nothing", Encoding.UTF8))
        assertFalse(keychain.hasItem(service, "nothing"))
        assertNull(keychain.getItemInfo(service, "nothing"))
        assertEquals(emptyList<String>(), keychain.getAllKeys(service))
        keychain.removeItem(service, "nothing")
        keychain.clear(service)
    }

    @Test
    fun aWriteReplacesTheWholeItem() {
        now = 1_000
        keychain.setItem(service, "token", "one", Encoding.UTF8, options(label = "first"))
        now = 2_000
        keychain.setItem(service, "token", "two", Encoding.UTF8, options(accessible = Accessible.WHEN_UNLOCKED))
        assertEquals(Keychain.Item("two", null), keychain.getItem(service, "token", Encoding.UTF8))
        val info = keychain.getItemInfo(service, "token")!!
        assertEquals(Accessible.WHEN_UNLOCKED, info.accessible)
        assertNull(info.label)
        assertEquals(1_000, info.createdAt)
        assertEquals(2_000, info.modifiedAt)
    }

    @Test
    fun anEmptyLabelIsALabel() {
        keychain.setItem(service, "empty", "v", Encoding.UTF8, options(label = ""))
        keychain.setItem(service, "none", "v", Encoding.UTF8, options())
        assertEquals("", keychain.getItem(service, "empty", Encoding.UTF8)?.label)
        assertEquals("", keychain.getItemInfo(service, "empty")?.label)
        assertNull(keychain.getItemInfo(service, "none")?.label)
        // From the file too.
        val again = newKeychain()
        assertEquals("", again.getItemInfo(service, "empty")?.label)
        assertNull(again.getItemInfo(service, "none")?.label)
    }

    @Test
    fun itemInfo() {
        now = 1_730_000_000_000
        keychain.setItem(service, "token", "secret", Encoding.UTF8, options(label = "ivan"))
        val info = keychain.getItemInfo(service, "token")!!
        assertEquals("token", info.key)
        assertEquals("ivan", info.label)
        assertEquals(Accessible.AFTER_FIRST_UNLOCK, info.accessible)
        assertEquals(AccessControl.NONE, info.accessControl)
        assertEquals(1_730_000_000_000, info.createdAt)
        assertEquals(1_730_000_000_000, info.modifiedAt)
        // Where the Keystore attests a key of the TEE's profile lives: software on an emulator, the TEE on a phone.
        assertEquals(Attestation.securityLevel(), info.securityLevel)
    }

    @Test
    fun keysRemoveAndClear() {
        for (key in listOf("a", "b", "c")) keychain.setItem(service, key, key, Encoding.UTF8, options())
        keychain.setItem("$service.other", "a", "other", Encoding.UTF8, options())
        assertEquals(setOf("a", "b", "c"), keychain.getAllKeys(service).toSet())

        keychain.removeItem(service, "b")
        assertFalse(keychain.hasItem(service, "b"))
        assertEquals(setOf("a", "c"), keychain.getAllKeys(service).toSet())

        assertTrue(keystoreAliases(service).isNotEmpty())
        keychain.clear(service)
        assertEquals(emptyList<String>(), keychain.getAllKeys(service))
        assertFalse(storeFile(service).exists())
        assertEquals(emptyList<String>(), keystoreAliases(service))
        // Another service keeps its items and its keys.
        assertEquals("other", keychain.getItem("$service.other", "a", Encoding.UTF8)?.value)
        assertTrue(keystoreAliases("$service.other").isNotEmpty())
        keychain.clear("$service.other")
    }

    @Test
    fun theStoreIsReadAgainFromItsFile() {
        keychain.setItem(service, "token", "secret", Encoding.UTF8, options(label = "label"))
        val again = newKeychain()
        assertEquals(Keychain.Item("secret", "label"), again.getItem(service, "token", Encoding.UTF8))
        // And writes through the same key.
        again.setItem(service, "other", "value", Encoding.UTF8, options())
        assertEquals(1, keystoreAliases(service).size)
    }

    @Test
    fun theLastItemTakesTheFileWithIt() {
        keychain.setItem(service, "token", "secret", Encoding.UTF8, options())
        assertTrue(storeFile(service).exists())
        keychain.removeItem(service, "token")
        assertFalse(storeFile(service).exists())
    }

    @Test
    fun itemsWithTheSameProfileShareAKey() {
        keychain.setItem(service, "a", "1", Encoding.UTF8, options())
        keychain.setItem(service, "b", "2", Encoding.UTF8, options(label = "labels don't matter"))
        val thisDeviceOnly = options(accessible = Accessible.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY)
        keychain.setItem(service, "c", "3", Encoding.UTF8, thisDeviceOnly)
        assertEquals(1, keystoreAliases(service).size)
        keychain.setItem(service, "d", "4", Encoding.UTF8, options(accessible = Accessible.WHEN_UNLOCKED))
        // `setUnlockedDeviceRequired` is another profile, from API 28.
        assertEquals(if (device.sdk >= 28) 2 else 1, keystoreAliases(service).size)
        val items = storedItems(service)
        assertEquals(items.getValue("a").alias, items.getValue("c").alias)
        if (device.sdk >= 28) assertNotEquals(items.getValue("a").alias, items.getValue("d").alias)
    }

    @Test
    fun namesAreAnyUnicode() {
        val key = "ключ / 🔑 \"quoted\" \\ ${"x".repeat(200)}"
        val unicodeService = "$service.сервис 🔑"
        keychain.setItem(unicodeService, key, "value", Encoding.UTF8, options())
        assertEquals("value", keychain.getItem(unicodeService, key, Encoding.UTF8)?.value)
        assertEquals(listOf(key), keychain.getAllKeys(unicodeService))
        // 256 characters, outside the BMP: 512 UTF-16 units.
        val longest = "🔑".repeat(256)
        keychain.setItem(unicodeService, longest, "value", Encoding.UTF8, options())
        assertTrue(keychain.hasItem(unicodeService, longest))
        keychain.clear(unicodeService)
    }

    @Test
    fun invalidNames() {
        for (key in listOf("", "a\u0000b", "x".repeat(257), "a\uD800")) {
            assertCode(KeychainErrorCode.INVALID_ARGUMENT) {
                keychain.setItem(service, key, "v", Encoding.UTF8, options())
            }
            assertCode(KeychainErrorCode.INVALID_ARGUMENT) { keychain.getItem(service, key, Encoding.UTF8) }
            assertCode(KeychainErrorCode.INVALID_ARGUMENT) { keychain.hasItem(key, "key") }
        }
    }

    @Test
    fun authValidityNeedsAccessControl() {
        assertCode(KeychainErrorCode.INVALID_ARGUMENT) {
            keychain.setItem(service, "k", "v", Encoding.UTF8, options().copy(authValidity = 30))
        }
        assertFalse(keychain.hasItem(service, "k"))
    }

    @Test
    fun theFileCantMakeAnItemWeaker() {
        keychain.setItem(service, "token", "secret", Encoding.UTF8, options())
        val item = storedItems(service).getValue("token")
        // An item without a prompt that says it has one, and the other way round: the scheme gives it away.
        writeStore(service, mapOf("token" to item.copy(accessControl = AccessControl.BIOMETRY_ANY)))
        assertCode(KeychainErrorCode.AUTH_REQUIRED) { newKeychain().getItem(service, "token", Encoding.UTF8) }
        assertCode(KeychainErrorCode.DATA_CORRUPTED) { newKeychain().read(service, "token", Encoding.UTF8) }
        writeStore(
            service,
            mapOf("token" to item.copy(scheme = Scheme.RSA_OAEP_AES_GCM, wrappedKey = Base64.encode(ByteArray(256)))),
        )
        assertCode(KeychainErrorCode.DATA_CORRUPTED) { newKeychain().getItem(service, "token", Encoding.UTF8) }
        // Neither is deleted: neither is invalidated.
        assertTrue(newKeychain().hasItem(service, "token"))
    }

    @Test
    fun concurrentWritesAndReads() {
        val threads = 8
        val writes = 25
        val pool = Executors.newFixedThreadPool(threads)
        val done = CountDownLatch(threads)
        val failures = mutableListOf<Throwable>()
        repeat(threads) { thread ->
            pool.execute {
                try {
                    repeat(writes) { index ->
                        keychain.setItem(service, "t$thread-$index", "v$index", Encoding.UTF8, options())
                        assertEquals("v$index", keychain.getItem(service, "t$thread-$index", Encoding.UTF8)?.value)
                        keychain.getAllKeys(service)
                    }
                } catch (e: Throwable) {
                    synchronized(failures) { failures += e }
                } finally {
                    done.countDown()
                }
            }
        }
        assertTrue(done.await(2, TimeUnit.MINUTES))
        pool.shutdown()
        assertEquals(emptyList<Throwable>(), failures)
        assertEquals(threads * writes, keychain.getAllKeys(service).size)
        assertEquals(threads * writes, newKeychain().getAllKeys(service).size)
        assertEquals(1, keystoreAliases(service).size)
    }
}
