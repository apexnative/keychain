package dev.apexnative.keychain

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StoreFormatTest {
    private val item = StoredItem(
        scheme = Scheme.AES_GCM,
        alias = "apexnative.keychain/abc/def/0123abcd",
        iv = Base64.encode(ByteArray(12) { it.toByte() }),
        ciphertext = Base64.encode(ByteArray(20) { (it * 7).toByte() }),
        wrappedKey = null,
        kind = ValueKind.UTF8,
        accessControl = AccessControl.NONE,
        accessible = Accessible.AFTER_FIRST_UNLOCK,
        securityLevel = SecurityLevel.TEE,
        label = "Signed in as ivan@example.com",
        createdAt = 1_730_000_000_000,
        modifiedAt = 1_730_000_000_123,
    )

    @Test
    fun roundTrips() {
        val data = StoreData(
            "vault",
            mapOf(
                "token" to item,
                "ключ 🔑" to item.copy(kind = ValueKind.BYTES, label = null, securityLevel = SecurityLevel.STRONGBOX),
                "empty label" to item.copy(label = ""),
                "wrapped" to item.copy(
                    scheme = Scheme.RSA_OAEP_AES_GCM,
                    wrappedKey = Base64.encode(ByteArray(256)),
                    accessControl = AccessControl.BIOMETRY_CURRENT_SET,
                    accessible = Accessible.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
                ),
                "window" to item.copy(
                    scheme = Scheme.RSA_OAEP_AES_GCM,
                    wrappedKey = Base64.encode(ByteArray(256)),
                    accessControl = AccessControl.PASSCODE,
                    authValidity = 300,
                ),
            ),
        )
        assertEquals(data, StoreFormat.decode(StoreFormat.encode(data), "vault"))
    }

    @Test
    fun writesTheFieldsOfFormatV1() {
        val json = JSONObject(String(StoreFormat.encode(StoreData("vault", mapOf("token" to item))), Charsets.UTF_8))
        assertEquals(1, json.getInt("v"))
        assertEquals("vault", json.getString("service"))
        val stored = json.getJSONObject("items").getJSONObject("token")
        assertEquals(
            setOf("scheme", "alias", "iv", "ct", "enc", "ac", "acc", "sl", "label", "c", "m"),
            stored.keys().asSequence().toSet(),
        )
        assertEquals("aes-gcm", stored.getString("scheme"))
        assertEquals("utf8", stored.getString("enc"))
        assertEquals("none", stored.getString("ac"))
        assertEquals("afterFirstUnlock", stored.getString("acc"))
        assertEquals(1_730_000_000_000, stored.getLong("c"))
        assertFalse(stored.has("wk"))
        // No window, no field.
        assertFalse(stored.has("av"))
        val window = StoreData("vault", mapOf("token" to item.copy(authValidity = 30)))
        val withWindow = JSONObject(String(StoreFormat.encode(window), Charsets.UTF_8))
        assertEquals(30, withWindow.getJSONObject("items").getJSONObject("token").getInt("av"))
    }

    @Test
    fun ignoresFieldsItDoesntKnow() {
        val json = JSONObject(String(StoreFormat.encode(StoreData("vault", mapOf("token" to item))), Charsets.UTF_8))
        json.put("later", true)
        json.getJSONObject("items").getJSONObject("token").put("later", 30)
        val decoded = StoreFormat.decode(json.toString().toByteArray(), "vault")
        assertEquals(item, decoded.items["token"])
    }

    @Test
    fun anEmptyStore() {
        val data = StoreData("vault", emptyMap())
        assertEquals(data, StoreFormat.decode(StoreFormat.encode(data), "vault"))
    }

    @Test
    fun aDamagedFileIsDataCorrupted() {
        val good = JSONObject(String(StoreFormat.encode(StoreData("vault", mapOf("token" to item))), Charsets.UTF_8))
        fun withItem(change: JSONObject.() -> Unit) = JSONObject(good.toString()).apply {
            getJSONObject("items").getJSONObject("token").change()
        }
        val damaged = listOf(
            "" to "",
            "not JSON" to "{",
            "an array" to "[]",
            "another version" to JSONObject(good.toString()).put("v", 2).toString(),
            "no version" to JSONObject(good.toString()).apply { remove("v") }.toString(),
            "another service" to JSONObject(good.toString()).put("service", "other").toString(),
            "no items" to JSONObject(good.toString()).apply { remove("items") }.toString(),
            "an item that isn't an object" to JSONObject(good.toString()).put("items", JSONObject().put("a", 1))
                .toString(),
            "an unknown scheme" to withItem { put("scheme", "rot13") }.toString(),
            "an unknown access control" to withItem { put("ac", "faceOnly") }.toString(),
            "no alias" to withItem { remove("alias") }.toString(),
            "an IV that isn't Base64" to withItem { put("iv", "not base64") }.toString(),
            "a ciphertext that isn't a string" to withItem { put("ct", 5) }.toString(),
            "a time that isn't a number" to withItem { put("c", "yesterday") }.toString(),
            "a negative window" to withItem { put("av", -1) }.toString(),
            "a window that isn't whole" to withItem { put("av", 1.5) }.toString(),
            "a wrapped key without its scheme" to withItem { put("wk", "AAAA") }.toString(),
            "a hybrid scheme without a wrapped key" to withItem { put("scheme", "rsa-oaep+aes-gcm") }.toString(),
        )
        for ((why, text) in damaged) {
            try {
                StoreFormat.decode(text.toByteArray(), "vault")
            } catch (e: KeychainException) {
                assertEquals(why, KeychainErrorCode.DATA_CORRUPTED, e.code)
                continue
            }
            throw AssertionError("$why: decoded")
        }
        assertCode(KeychainErrorCode.DATA_CORRUPTED) { StoreFormat.decode(byteArrayOf(0xFF.toByte()), "vault") }
    }

    @Test
    fun theFileIsNamedByTheServicesHash() {
        assertEquals(
            "e6f0a1fbb43c89196dcfcbef85908f19ab4c5f7cc4f4c452284697757683d7ef.json",
            StoreFormat.fileName("vault"),
        )
        assertTrue(StoreFormat.fileName("a/../b ✓ ".repeat(40)).matches(Regex("[0-9a-f]{64}\\.json")))
    }
}

class KeyAliasesTest {
    private val profile = KeyProfile(Scheme.AES_GCM, AccessControl.NONE, 0, KeyHardware.TEE, false)

    // The ids name the keys already on devices: changing how they're made would orphan them.
    @Test
    fun profileIdsAreStable() {
        assertEquals("00cbe8e9cb2fe648", profile.id)
        val strongBox = profile.copy(hardware = KeyHardware.STRONGBOX, unlockedDeviceRequired = true)
        assertEquals("a9cd46054f5b11b6", strongBox.id)
    }

    @Test
    fun everyParameterMakesAnotherProfile() {
        val profiles = listOf(
            profile,
            profile.copy(scheme = Scheme.RSA_OAEP_AES_GCM),
            profile.copy(accessControl = AccessControl.BIOMETRY_ANY),
            profile.copy(authValidity = 30),
            profile.copy(hardware = KeyHardware.STRONGBOX),
            profile.copy(unlockedDeviceRequired = true),
        )
        assertEquals(profiles.size, profiles.map { it.id }.toSet().size)
    }

    @Test
    fun aliasesNameTheServiceAndTheProfile() {
        val alias = KeyAliases.new("vault", profile, "0123abcd")
        val serviceHash = "e6f0a1fbb43c89196dcfcbef85908f19ab4c5f7cc4f4c452284697757683d7ef"
        assertEquals("apexnative.keychain/$serviceHash/00cbe8e9cb2fe648/0123abcd", alias)
        assertTrue(alias.startsWith(KeyAliases.ofService("vault")))
        assertEquals(profile.id, KeyAliases.profileId("vault", alias))
        assertEquals(null, KeyAliases.profileId("other", alias))
        assertEquals(null, KeyAliases.profileId("vault", KeyAliases.ofService("vault") + "only-a-profile"))
        assertEquals(null, KeyAliases.profileId("vault", "someone.else/key"))
    }
}
