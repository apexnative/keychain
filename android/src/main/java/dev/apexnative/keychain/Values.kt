package dev.apexnative.keychain

import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

/*
 * Values cross as strings (src/native/NativeApexKeychain.ts): 'utf8' — the text, stored as its UTF-8 bytes; 'base64'
 * — standard Base64 of the bytes. An item remembers which of the two it was written with ([ValueKind]).
 */

/** What an item's bytes are: the UTF-8 of a string, or bytes. */
internal enum class ValueKind(override val jsName: String) : Named {
    UTF8("utf8"),
    BYTES("bytes"),
}

/** The bytes of a value from JavaScript, and what they are. */
internal fun valueBytes(value: String, encoding: Encoding): Pair<ByteArray, ValueKind> = when (encoding) {
    Encoding.UTF8 -> (utf8(value) ?: throw invalidArgument("The value has a lone surrogate: it has no UTF-8 form.")) to
        ValueKind.UTF8
    Encoding.BASE64 -> (Base64.decode(value) ?: throw invalidArgument("The value isn't standard Base64.")) to
        ValueKind.BYTES
}

/**
 * An item's bytes as a string in the encoding asked for. Bytes read as text must be valid UTF-8; a string item read as
 * Base64 gives its UTF-8 bytes.
 */
internal fun valueString(bytes: ByteArray, kind: ValueKind, encoding: Encoding): String = when (encoding) {
    Encoding.BASE64 -> Base64.encode(bytes)
    Encoding.UTF8 -> fromUtf8(bytes) ?: throw when (kind) {
        ValueKind.BYTES -> invalidArgument("The item holds bytes that aren't valid UTF-8: read them as bytes.")
        ValueKind.UTF8 -> KeychainException(KeychainErrorCode.DATA_CORRUPTED, "The item's text isn't valid UTF-8.")
    }
}

/** The UTF-8 of a string, or null when it has a lone surrogate (Kotlin's own encoder would write '?' for it). */
internal fun utf8(text: String): ByteArray? = try {
    val buffer = Charsets.UTF_8.newEncoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .encode(CharBuffer.wrap(text))
    ByteArray(buffer.remaining()).also { buffer.get(it) }
} catch (e: CharacterCodingException) {
    null
}

/** The string of UTF-8 bytes, or null when they aren't valid UTF-8. */
internal fun fromUtf8(bytes: ByteArray): String? = try {
    Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(bytes))
        .toString()
} catch (e: CharacterCodingException) {
    null
}

/**
 * Standard Base64 (RFC 4648 §4) with padding and without line breaks: how bytes cross to JavaScript and how the file
 * keeps them. Decoding is strict, unlike `android.util.Base64`, which also isn't there in JVM tests: anything but
 * canonical padded Base64 is null.
 */
internal object Base64 {
    private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

    // The value of each character by its code, -1 for a character outside the alphabet.
    private val VALUES = IntArray(128) { -1 }.also { values ->
        ALPHABET.forEachIndexed { index, char -> values[char.code] = index }
    }

    fun encode(bytes: ByteArray): String {
        val result = StringBuilder((bytes.size + 2) / 3 * 4)
        var index = 0
        while (index + 2 < bytes.size) {
            val chunk = (byte(bytes, index) shl 16) or (byte(bytes, index + 1) shl 8) or byte(bytes, index + 2)
            result.append(ALPHABET[(chunk shr 18) and 63])
                .append(ALPHABET[(chunk shr 12) and 63])
                .append(ALPHABET[(chunk shr 6) and 63])
                .append(ALPHABET[chunk and 63])
            index += 3
        }
        when (bytes.size - index) {
            1 -> {
                val chunk = byte(bytes, index) shl 16
                result.append(ALPHABET[(chunk shr 18) and 63]).append(ALPHABET[(chunk shr 12) and 63]).append("==")
            }
            2 -> {
                val chunk = (byte(bytes, index) shl 16) or (byte(bytes, index + 1) shl 8)
                result.append(ALPHABET[(chunk shr 18) and 63])
                    .append(ALPHABET[(chunk shr 12) and 63])
                    .append(ALPHABET[(chunk shr 6) and 63])
                    .append('=')
            }
        }
        return result.toString()
    }

    /** The bytes of canonical padded Base64, or null for anything else. */
    fun decode(text: String): ByteArray? {
        if (text.length % 4 != 0) return null
        val padding = when {
            text.endsWith("==") -> 2
            text.endsWith("=") -> 1
            else -> 0
        }
        val end = text.length - padding
        val bytes = ByteArray(text.length / 4 * 3 - padding)
        var byteIndex = 0
        var buffer = 0
        var bits = 0
        for (index in 0 until end) {
            val code = text[index].code
            val value = if (code < VALUES.size) VALUES[code] else -1
            if (value < 0) return null
            buffer = ((buffer shl 6) or value) and 0xFFFF
            bits += 6
            if (bits >= 8) {
                bits -= 8
                bytes[byteIndex++] = (buffer shr bits).toByte()
            }
        }
        // The bits the padding leaves over are zero in canonical Base64.
        if (buffer and ((1 shl bits) - 1) != 0) return null
        return bytes
    }

    private fun byte(bytes: ByteArray, index: Int) = bytes[index].toInt() and 0xFF
}
