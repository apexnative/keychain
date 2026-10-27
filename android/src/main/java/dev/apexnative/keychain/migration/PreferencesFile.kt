package dev.apexnative.keychain.migration

import dev.apexnative.keychain.KeychainErrorCode
import dev.apexnative.keychain.KeychainException

/**
 * The string preferences of a Jetpack DataStore file (`<name>.preferences_pb`), read without DataStore: the library
 * doesn't depend on it. The file is the protobuf `PreferenceMap` of androidx.datastore.preferences:
 * `map<string, Value> preferences = 1`, where `Value` is a oneof whose `string` is field 5. Values of other kinds are
 * skipped.
 */
internal object PreferencesFile {
    private const val WIRE_VARINT = 0
    private const val WIRE_FIXED64 = 1
    private const val WIRE_LENGTH = 2
    private const val WIRE_FIXED32 = 5

    private const val MAP_ENTRY = 1
    private const val ENTRY_KEY = 1
    private const val ENTRY_VALUE = 2
    private const val VALUE_STRING = 5

    /** The string preferences by name; a file that isn't a `PreferenceMap` is DATA_CORRUPTED. */
    fun strings(bytes: ByteArray): Map<String, String> {
        val result = LinkedHashMap<String, String>()
        val map = Reader(bytes, 0, bytes.size)
        while (map.hasMore()) {
            val (field, wire) = map.tag()
            if (field != MAP_ENTRY || wire != WIRE_LENGTH) {
                map.skip(wire)
                continue
            }
            val entry = map.message()
            var key: String? = null
            var value: String? = null
            while (entry.hasMore()) {
                val (entryField, entryWire) = entry.tag()
                when {
                    entryField == ENTRY_KEY && entryWire == WIRE_LENGTH -> key = entry.string()
                    entryField == ENTRY_VALUE && entryWire == WIRE_LENGTH -> value = stringValue(entry.message())
                    else -> entry.skip(entryWire)
                }
            }
            if (key != null && value != null) result[key] = value
        }
        return result
    }

    /**
     * The file without the preferences [names]: every other field as it was, byte for byte, so that what the library
     * doesn't read survives.
     */
    fun without(bytes: ByteArray, names: Set<String>): ByteArray {
        val result = java.io.ByteArrayOutputStream(bytes.size)
        val map = Reader(bytes, 0, bytes.size)
        while (map.hasMore()) {
            val start = map.position
            val (field, wire) = map.tag()
            val removed = if (field == MAP_ENTRY && wire == WIRE_LENGTH) {
                entryKey(map.message()) in names
            } else {
                map.skip(wire)
                false
            }
            if (!removed) result.write(bytes, start, map.position - start)
        }
        return result.toByteArray()
    }

    private fun entryKey(entry: Reader): String? {
        var key: String? = null
        while (entry.hasMore()) {
            val (field, wire) = entry.tag()
            if (field == ENTRY_KEY && wire == WIRE_LENGTH) key = entry.string() else entry.skip(wire)
        }
        return key
    }

    // The `string` of a `Value`, or null for a value of another kind.
    private fun stringValue(value: Reader): String? {
        var result: String? = null
        while (value.hasMore()) {
            val (field, wire) = value.tag()
            if (field == VALUE_STRING && wire == WIRE_LENGTH) result = value.string() else value.skip(wire)
        }
        return result
    }

    private class Reader(private val bytes: ByteArray, var position: Int, private val end: Int) {
        fun hasMore() = position < end

        fun tag(): Pair<Int, Int> {
            val tag = varint()
            return (tag ushr 3).toInt() to (tag and 7).toInt()
        }

        fun message(): Reader {
            val length = length()
            return Reader(bytes, position, position + length).also { position += length }
        }

        fun string(): String {
            val length = length()
            return String(bytes, position, length, Charsets.UTF_8).also { position += length }
        }

        fun skip(wire: Int) {
            when (wire) {
                WIRE_VARINT -> varint()
                WIRE_FIXED64 -> advance(8)
                WIRE_LENGTH -> advance(length())
                WIRE_FIXED32 -> advance(4)
                else -> throw damaged("a field of wire type $wire")
            }
        }

        private fun length(): Int {
            val length = varint()
            if (length < 0 || length > end - position) throw damaged("a length past the end")
            return length.toInt()
        }

        private fun advance(count: Int) {
            if (count > end - position) throw damaged("a field past the end")
            position += count
        }

        private fun varint(): Long {
            var result = 0L
            var shift = 0
            while (shift < 64) {
                if (position >= end) throw damaged("a number past the end")
                val byte = bytes[position++].toInt()
                result = result or ((byte and 0x7F).toLong() shl shift)
                if (byte and 0x80 == 0) return result
                shift += 7
            }
            throw damaged("a number too long")
        }

        private fun damaged(what: String) =
            KeychainException(KeychainErrorCode.DATA_CORRUPTED, "The DataStore file is damaged: $what.")
    }
}
