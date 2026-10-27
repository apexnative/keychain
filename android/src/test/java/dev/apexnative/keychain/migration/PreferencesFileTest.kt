package dev.apexnative.keychain.migration

import dev.apexnative.keychain.KeychainErrorCode
import dev.apexnative.keychain.assertCode
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.ByteArrayOutputStream

/**
 * The DataStore file, as `PreferencesSerializer` writes it: the protobuf `PreferenceMap`, built here by hand from
 * androidx.datastore.preferences' `preferences.proto`.
 */
class PreferencesFileTest {
    // Value: boolean = 1, float = 2, integer = 3, long = 4, string = 5, string_set = 6, double = 7, bytes = 8.
    private fun stringValue(text: String) = field(5, text.toByteArray())

    private fun entry(key: String, value: ByteArray) = field(1, field(1, key.toByteArray()) + field(2, value))

    private fun field(number: Int, payload: ByteArray) =
        varint((number shl 3 or 2).toLong()) + varint(payload.size.toLong()) + payload

    private fun varint(value: Long): ByteArray {
        val out = ByteArrayOutputStream()
        var rest = value
        while (rest >= 0x80) {
            out.write(((rest and 0x7F) or 0x80).toInt())
            rest = rest ushr 7
        }
        out.write(rest.toInt())
        return out.toByteArray()
    }

    @Test
    fun readsTheStrings() {
        val file = entry(":u", stringValue("dXNlcg==\n")) +
            entry("vault:c", stringValue("KeystoreAESGCM_NoAuth")) +
            entry("ключ 🔑", stringValue("значение"))
        assertEquals(
            mapOf(":u" to "dXNlcg==\n", "vault:c" to "KeystoreAESGCM_NoAuth", "ключ 🔑" to "значение"),
            PreferencesFile.strings(file),
        )
    }

    @Test
    fun skipsWhatIsntAString() {
        val boolean = varint(1 shl 3) + varint(1)
        val long = varint(4 shl 3) + varint(1_730_000_000_000)
        val double = varint((7 shl 3 or 1).toLong()) + ByteArray(8)
        val float = varint((2 shl 3 or 5).toLong()) + ByteArray(4)
        val stringSet = field(6, field(1, "a".toByteArray()))
        val file = entry("flag", boolean) + entry("time", long) + entry("ratio", double) + entry("scale", float) +
            entry("set", stringSet) + entry("name", stringValue("kept")) +
            // A field the map doesn't have, at the top level.
            field(9, "later".toByteArray())
        assertEquals(mapOf("name" to "kept"), PreferencesFile.strings(file))
    }

    @Test
    fun anEmptyFileIsAnEmptyMap() {
        assertEquals(emptyMap<String, String>(), PreferencesFile.strings(ByteArray(0)))
    }

    @Test
    fun aDamagedFileIsDataCorrupted() {
        val good = entry("vault:c", stringValue("KeystoreAESCBC"))
        assertCode(KeychainErrorCode.DATA_CORRUPTED) { PreferencesFile.strings(good.copyOf(good.size - 3)) }
        assertCode(KeychainErrorCode.DATA_CORRUPTED) { PreferencesFile.strings(byteArrayOf(0x0A, 0x7F)) }
        assertCode(KeychainErrorCode.DATA_CORRUPTED) { PreferencesFile.strings(byteArrayOf(0x0B)) }
    }

    @Test
    fun removesEntriesAndKeepsTheRestAsItWas() {
        val boolean = entry("flag", varint(1 shl 3) + varint(1))
        val kept = entry("other:u", stringValue("b3RoZXI="))
        val file = entry("vault:u", stringValue("dQ==")) + boolean + entry("vault:p", stringValue("cA==")) + kept +
            entry("vault:c", stringValue("KeystoreAESCBC")) + field(9, "later".toByteArray())
        val rest = PreferencesFile.without(file, setOf("vault:u", "vault:p", "vault:c"))
        // What the library doesn't read — a boolean, a field it doesn't know — stays, byte for byte.
        assertArrayEquals(boolean + kept + field(9, "later".toByteArray()), rest)
        assertEquals(mapOf("other:u" to "b3RoZXI="), PreferencesFile.strings(rest))
        assertArrayEquals(file, PreferencesFile.without(file, setOf("missing")))
    }

    @Test
    fun base64WithLineBreaks() {
        // `Base64.DEFAULT` breaks lines every 76 characters and ends with one.
        val bytes = ByteArray(100) { it.toByte() }
        val wrapped = java.util.Base64.getMimeEncoder(76, "\n".toByteArray()).encodeToString(bytes) + "\n"
        assertArrayEquals(bytes, decodeWrappedBase64(wrapped))
        assertArrayEquals(bytes, decodeWrappedBase64(wrapped.replace("\n", "\r\n")))
        assertNull(decodeWrappedBase64("not base64"))
    }
}
