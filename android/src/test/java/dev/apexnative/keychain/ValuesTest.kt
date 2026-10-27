package dev.apexnative.keychain

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Test
import kotlin.random.Random

class Base64Test {
    @Test
    fun encodesAsJavaDoes() {
        val random = Random(42)
        for (size in 0..64) {
            val bytes = random.nextBytes(size)
            val expected = java.util.Base64.getEncoder().encodeToString(bytes)
            assertEquals(expected, Base64.encode(bytes))
            assertArrayEquals(bytes, Base64.decode(expected))
        }
    }

    @Test
    fun knownValues() {
        assertEquals("", Base64.encode(ByteArray(0)))
        assertEquals("Zg==", Base64.encode("f".toByteArray()))
        assertEquals("Zm8=", Base64.encode("fo".toByteArray()))
        assertEquals("Zm9v", Base64.encode("foo".toByteArray()))
        assertEquals("/+8=", Base64.encode(byteArrayOf(0xFF.toByte(), 0xEF.toByte())))
        assertArrayEquals(ByteArray(0), Base64.decode(""))
    }

    @Test
    fun rejectsAnythingButCanonicalPaddedBase64() {
        for (text in listOf(
            "Zg", // no padding
            "Zm8", // no padding
            "Z", // a length no Base64 has
            "=", "==", "===", "====",
            "Z===", // too much padding
            "Zg=g", // padding inside
            "Zm9v\n", // a line break
            "Zm 9", // a space
            "Zm9-", // URL-safe alphabet
            "Zm9_",
            "Zh==", // bits after the last byte that aren't zero
            "Zm9=",
            "Zé==",
        )) {
            assertNull("'$text'", Base64.decode(text))
        }
    }
}

class ValuesTest {
    @Test
    fun textIsStoredAsUtf8() {
        val (bytes, kind) = valueBytes("Привет, 🔑", Encoding.UTF8)
        assertEquals(ValueKind.UTF8, kind)
        assertArrayEquals("Привет, 🔑".toByteArray(Charsets.UTF_8), bytes)
        assertEquals("Привет, 🔑", valueString(bytes, kind, Encoding.UTF8))
    }

    @Test
    fun bytesAreStoredAsBytes() {
        val raw = byteArrayOf(0, 1, 0x7F, 0x80.toByte(), 0xFF.toByte())
        val (bytes, kind) = valueBytes(Base64.encode(raw), Encoding.BASE64)
        assertEquals(ValueKind.BYTES, kind)
        assertArrayEquals(raw, bytes)
        assertEquals(Base64.encode(raw), valueString(bytes, kind, Encoding.BASE64))
    }

    @Test
    fun emptyValuesAreValid() {
        assertEquals("", valueString(valueBytes("", Encoding.UTF8).first, ValueKind.UTF8, Encoding.UTF8))
        assertEquals("", valueString(valueBytes("", Encoding.BASE64).first, ValueKind.BYTES, Encoding.BASE64))
    }

    @Test
    fun textReadAsBase64GivesItsUtf8() {
        val (bytes, kind) = valueBytes("ключ", Encoding.UTF8)
        assertEquals(Base64.encode("ключ".toByteArray(Charsets.UTF_8)), valueString(bytes, kind, Encoding.BASE64))
    }

    @Test
    fun bytesReadAsTextAreDecodedWhenValid() {
        val (bytes, kind) = valueBytes(Base64.encode("ok ✓".toByteArray(Charsets.UTF_8)), Encoding.BASE64)
        assertEquals("ok ✓", valueString(bytes, kind, Encoding.UTF8))
    }

    @Test
    fun bytesThatArentUtf8ReadAsTextAreInvalidArgument() {
        for (raw in listOf(
            byteArrayOf(0xFF.toByte()),
            byteArrayOf(0xC3.toByte()), // a sequence cut short
            byteArrayOf(0xC0.toByte(), 0x80.toByte()), // an overlong form
            byteArrayOf(0xED.toByte(), 0xA0.toByte(), 0x80.toByte()), // a surrogate
        )) {
            assertCode(KeychainErrorCode.INVALID_ARGUMENT) { valueString(raw, ValueKind.BYTES, Encoding.UTF8) }
        }
    }

    @Test
    fun textThatIsntUtf8IsDataCorrupted() {
        assertCode(KeychainErrorCode.DATA_CORRUPTED) {
            valueString(byteArrayOf(0xFF.toByte()), ValueKind.UTF8, Encoding.UTF8)
        }
    }

    @Test
    fun aLoneSurrogateIsInvalidArgument() {
        assertCode(KeychainErrorCode.INVALID_ARGUMENT) { valueBytes("a\uD800b", Encoding.UTF8) }
        assertCode(KeychainErrorCode.INVALID_ARGUMENT) { valueBytes("\uDC00", Encoding.UTF8) }
        assertNull(utf8("\uD83D"))
    }

    @Test
    fun valueThatIsntBase64IsInvalidArgument() {
        assertCode(KeychainErrorCode.INVALID_ARGUMENT) { valueBytes("not base64", Encoding.BASE64) }
    }
}

internal fun assertCode(code: KeychainErrorCode, block: () -> Unit) {
    try {
        block()
    } catch (e: KeychainException) {
        assertEquals(e.message, code, e.code)
        return
    }
    fail("Expected $code")
}
