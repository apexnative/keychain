package dev.apexnative.keychain

import org.json.JSONException
import org.json.JSONObject
import java.security.MessageDigest

/** How an item's value is encrypted. */
internal enum class Scheme(override val jsName: String) : Named {
    /** AES-256-GCM with the profile's Keystore key: `accessControl: 'none'`. */
    AES_GCM("aes-gcm"),

    /** AES-256-GCM with the item's own key, wrapped by the profile's Keystore RSA key: with authentication (M2). */
    RSA_OAEP_AES_GCM("rsa-oaep+aes-gcm"),
}

/** An item as the store's file keeps it. Bytes are Base64, as in the file. */
internal data class StoredItem(
    val scheme: Scheme,
    /** The Keystore alias of the key the item is encrypted with. */
    val alias: String,
    val iv: String,
    /** The ciphertext and the GCM tag. */
    val ciphertext: String,
    /** The item's AES key, wrapped by RSA-OAEP: [Scheme.RSA_OAEP_AES_GCM] only. */
    val wrappedKey: String?,
    val kind: ValueKind,
    val accessControl: AccessControl,
    val accessible: Accessible,
    /** Where the item's key lives, measured when the item was written. */
    val securityLevel: SecurityLevel,
    val label: String?,
    /** Milliseconds since the Unix epoch. */
    val createdAt: Long,
    val modifiedAt: Long,
    /** Seconds one authentication unlocks the item's key for; 0 — every read. The file has it only when it isn't 0. */
    val authValidity: Int = 0,
)

/** The items of one service: a store's file, and its cache in memory. Never changed: a write makes a new one. */
internal data class StoreData(val service: String, val items: Map<String, StoredItem>) {
    fun with(key: String, item: StoredItem) = copy(items = LinkedHashMap(items).apply { put(key, item) })

    fun without(keys: Collection<String>) = copy(items = LinkedHashMap(items).apply { keys.forEach(::remove) })
}

/**
 * The store's file, format v1: JSON, `{ "v": 1, "service": …, "items": { <key>: <item> } }`. A reader
 * ignores fields it doesn't know, so a later version can add optional ones without a new format.
 */
internal object StoreFormat {
    const val VERSION = 1

    /** The file of a service: the SHA-256 of its name, so that any name makes a valid file name. */
    fun fileName(service: String) = sha256Hex(service) + ".json"

    fun encode(data: StoreData): ByteArray {
        val items = JSONObject()
        for ((key, item) in data.items) items.put(key, encodeItem(item))
        return JSONObject()
            .put("v", VERSION)
            .put("service", data.service)
            .put("items", items)
            .toString()
            .toByteArray(Charsets.UTF_8)
    }

    /** The store of [service] from its file; a file that isn't one is DATA_CORRUPTED. */
    fun decode(bytes: ByteArray, service: String): StoreData = try {
        val root = JSONObject(fromUtf8(bytes) ?: throw corrupted("it isn't UTF-8"))
        val version = root.opt("v")
        if (version != VERSION) throw corrupted("its version is $version, not $VERSION")
        val fileService = root.string("service")
        if (fileService != service) throw corrupted("it belongs to another service")
        val itemsObject = root.optJSONObject("items") ?: throw corrupted("it has no items")
        val items = LinkedHashMap<String, StoredItem>()
        for (key in itemsObject.keys()) {
            val item = itemsObject.optJSONObject(key) ?: throw corrupted("the item '$key' isn't an object")
            items[key] = decodeItem(item)
        }
        StoreData(service, items)
    } catch (e: JSONException) {
        throw corrupted(e.message ?: "it isn't JSON", e)
    }

    private fun encodeItem(item: StoredItem) = JSONObject()
        .put("scheme", item.scheme.jsName)
        .put("alias", item.alias)
        .put("iv", item.iv)
        .put("ct", item.ciphertext)
        .apply { item.wrappedKey?.let { put("wk", it) } }
        .put("enc", item.kind.jsName)
        .put("ac", item.accessControl.jsName)
        .put("acc", item.accessible.jsName)
        .put("sl", item.securityLevel.jsName)
        .apply { item.label?.let { put("label", it) } }
        .put("c", item.createdAt)
        .put("m", item.modifiedAt)
        .apply { if (item.authValidity != 0) put("av", item.authValidity) }

    private fun decodeItem(json: JSONObject): StoredItem {
        val scheme = json.enum<Scheme>("scheme")
        val wrappedKey = json.optionalBase64("wk")
        if ((scheme == Scheme.RSA_OAEP_AES_GCM) != (wrappedKey != null)) {
            throw corrupted("an item's 'wk' doesn't match its scheme")
        }
        return StoredItem(
            scheme = scheme,
            alias = json.string("alias"),
            iv = json.base64("iv"),
            ciphertext = json.base64("ct"),
            wrappedKey = wrappedKey,
            kind = json.enum("enc"),
            accessControl = json.enum("ac"),
            accessible = json.enum("acc"),
            securityLevel = json.enum("sl"),
            label = json.optionalString("label"),
            createdAt = json.long("c"),
            modifiedAt = json.long("m"),
            authValidity = json.optionalSeconds("av"),
        )
    }

    private fun JSONObject.optionalString(name: String): String? = when (val value = opt(name)) {
        null -> null
        is String -> value
        else -> throw corrupted("'$name' isn't a string")
    }

    private fun JSONObject.string(name: String): String = optionalString(name) ?: throw corrupted("'$name' is missing")

    private fun JSONObject.optionalBase64(name: String): String? =
        optionalString(name)?.also { if (Base64.decode(it) == null) throw corrupted("'$name' isn't Base64") }

    private fun JSONObject.base64(name: String): String = optionalBase64(name) ?: throw corrupted("'$name' is missing")

    private fun JSONObject.long(name: String): Long = when (val value = opt(name)) {
        is Int -> value.toLong()
        is Long -> value
        else -> throw corrupted("'$name' isn't a whole number")
    }

    private fun JSONObject.optionalSeconds(name: String): Int = when (val value = opt(name)) {
        null -> 0
        is Int -> value.takeIf { it >= 0 } ?: throw corrupted("'$name' is negative")
        else -> throw corrupted("'$name' isn't a whole number")
    }

    private inline fun <reified E> JSONObject.enum(name: String): E where E : Enum<E>, E : Named {
        val value = string(name)
        return enumValues<E>().firstOrNull { it.jsName == value } ?: throw corrupted("'$name' is '$value'")
    }

    private fun corrupted(why: String, cause: Throwable? = null) = KeychainException(
        KeychainErrorCode.DATA_CORRUPTED,
        "The store's file is damaged: $why.",
        nativeDomain = cause?.javaClass?.name,
        cause = cause,
    )
}

internal fun sha256Hex(text: String): String = MessageDigest.getInstance("SHA-256")
    .digest(text.toByteArray(Charsets.UTF_8))
    .joinToString("") { "%02x".format(it) }
