package dev.apexnative.keychain.migration

import android.content.Context
import android.util.AtomicFile
import dev.apexnative.keychain.KeychainErrorCode
import dev.apexnative.keychain.KeychainException
import dev.apexnative.keychain.KeystoreKeys
import dev.apexnative.keychain.Named
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException

/**
 * Migration's native part: another library's items found without their values, read —
 * with a prompt for a protected one, which the module shows — and finished: deleted, or marked as moved. JavaScript
 * writes the values into a store and builds the report. Every method does its work on the calling thread.
 */
internal class Migration(
    private val reactNativeKeychain: ReactNativeKeychainSource,
    private val expoSecureStore: ExpoSecureStoreSource,
    private val markers: MigrationMarkers,
) {
    enum class Library(override val jsName: String) : Named {
        REACT_NATIVE_KEYCHAIN("reactNativeKeychain"),
        EXPO_SECURE_STORE("expoSecureStore"),
    }

    enum class Kind(override val jsName: String) : Named {
        GENERIC_PASSWORD("genericPassword"),
        INTERNET_PASSWORD("internetPassword"),
        SECURE_STORE("secureStore"),
    }

    /** `MigrationQuery`: services and servers by name; no services — the library's default on Android. */
    data class Query(val library: Library, val services: List<String>, val servers: List<String>)

    /** `MigrationSource`. */
    data class Source(
        val kind: Kind,
        val service: String,
        val account: String,
        val requiresAuth: Boolean,
        val migrated: Boolean,
    )

    /**
     * The items the query names, the moved ones included; no prompt, no value. react-native-keychain on Android keeps
     * the username encrypted as the password: an entry whose key needs authentication has no account until it's read.
     */
    fun sources(query: Query): List<Source> = when (query.library) {
        Library.REACT_NATIVE_KEYCHAIN -> {
            val entries = reactNativeKeychain.entries().associateBy { it.service }
            val services = query.services.ifEmpty { listOf(REACT_NATIVE_KEYCHAIN_DEFAULT) }
            val named =
                services.map { Kind.GENERIC_PASSWORD to it } + query.servers.map { Kind.INTERNET_PASSWORD to it }
            named.distinct().mapNotNull { (kind, service) ->
                val entry = entries[service] ?: return@mapNotNull null
                Source(
                    kind = kind,
                    service = service,
                    account = reactNativeKeychain.username(entry).orEmpty(),
                    requiresAuth = reactNativeKeychain.requiresAuthentication(entry),
                    migrated = markers.contains(marker(kind, service, "")),
                )
            }
        }
        Library.EXPO_SECURE_STORE -> query.services.ifEmpty { listOf(ExpoSecureStoreSource.DEFAULT_KEYCHAIN_SERVICE) }
            .distinct()
            .flatMap { service ->
                expoSecureStore.entries(service).map { entry ->
                    Source(
                        kind = Kind.SECURE_STORE,
                        service = service,
                        account = entry.key,
                        requiresAuth = expoSecureStore.requiresAuthentication(entry),
                        migrated = markers.contains(marker(Kind.SECURE_STORE, service, entry.key)),
                    )
                }
            }
    }

    /**
     * The source's value as text — react-native-keychain's password — or a prompt to show first. Found(null) when the
     * item is gone. Text with U+0000 is DATA_CORRUPTED: the bridge would cut it on its way back.
     */
    fun read(source: Source): LegacyRead<String?> {
        val read: LegacyRead<String> = when (source.kind) {
            Kind.GENERIC_PASSWORD, Kind.INTERNET_PASSWORD -> {
                val entry = reactNativeKeychain.entries().firstOrNull { it.service == source.service }
                    ?: return LegacyRead.Found(null)
                when (val credentials = reactNativeKeychain.read(entry)) {
                    is LegacyRead.Found -> LegacyRead.Found(credentials.value.password)
                    is LegacyRead.NeedsAuthentication -> LegacyRead.NeedsAuthentication(
                        credentials.accessControl,
                        credentials.cipher,
                    ) { credentials.finish(it).password }
                    is LegacyRead.Unreadable -> credentials
                }
            }
            Kind.SECURE_STORE -> {
                val entry = expoSecureStore.entry(source.service, source.account) ?: return LegacyRead.Found(null)
                expoSecureStore.read(entry)
            }
        }
        return when (read) {
            is LegacyRead.Found -> LegacyRead.Found(checked(read.value))
            is LegacyRead.NeedsAuthentication -> LegacyRead.NeedsAuthentication(read.accessControl, read.cipher) {
                checked(read.finish(it))
            }
            is LegacyRead.Unreadable -> read
        }
    }

    /**
     * After the value was written: deletes the source when [removeSource] — its data, every variant, and the Keystore
     * key no other item needs — else marks it as moved. No item is no error.
     */
    fun finish(source: Source, removeSource: Boolean) {
        val marker = marker(source.kind, source.service, if (source.kind == Kind.SECURE_STORE) source.account else "")
        if (!removeSource) return markers.add(marker)
        when (source.kind) {
            Kind.GENERIC_PASSWORD, Kind.INTERNET_PASSWORD ->
                reactNativeKeychain.entries().firstOrNull { it.service == source.service }
                    ?.let(reactNativeKeychain::remove)
            Kind.SECURE_STORE -> expoSecureStore.entry(source.service, source.account)?.let(expoSecureStore::remove)
        }
        markers.remove(marker)
    }

    private fun checked(value: String): String {
        if (value.indexOf('\u0000') >= 0) {
            throw KeychainException(KeychainErrorCode.DATA_CORRUPTED, "The value has U+0000, which the bridge cuts.")
        }
        return value
    }

    // react-native-keychain's entries are one per service, whatever the kind JavaScript asks for.
    private fun marker(kind: Kind, service: String, account: String): String {
        val library = if (kind == Kind.SECURE_STORE) Library.EXPO_SECURE_STORE else Library.REACT_NATIVE_KEYCHAIN
        return listOf(library.jsName, service, account).joinToString("\u0000")
    }

    companion object {
        /** react-native-keychain's default service on Android: ''. */
        const val REACT_NATIVE_KEYCHAIN_DEFAULT = ""

        fun of(context: Context, directory: File, keys: KeystoreKeys = KeystoreKeys()) = Migration(
            ReactNativeKeychainSource.of(context, keys),
            ExpoSecureStoreSource.of(context, keys),
            MigrationMarkers(File(directory, "migrated.json")),
        )
    }
}

/**
 * The sources an earlier run moved and kept (`removeSource` false), so that a run again doesn't bring back an item the
 * app has deleted since. A file next to the stores, in `noBackupFilesDir`, as they are: `{ "v": 1, "migrated": […] }`.
 */
internal class MigrationMarkers(file: File) {
    private val file = AtomicFile(file)

    @Synchronized
    fun contains(marker: String) = marker in read()

    @Synchronized
    fun add(marker: String) {
        val markers = read()
        if (markers.add(marker)) write(markers)
    }

    @Synchronized
    fun remove(marker: String) {
        val markers = read()
        if (markers.remove(marker)) write(markers)
    }

    private fun read(): MutableSet<String> {
        val text = try {
            String(file.readFully(), Charsets.UTF_8)
        } catch (e: FileNotFoundException) {
            return LinkedHashSet()
        }
        return try {
            val array = JSONObject(text).getJSONArray("migrated")
            (0 until array.length()).mapTo(LinkedHashSet()) { array.getString(it) }
        } catch (e: JSONException) {
            throw KeychainException(KeychainErrorCode.DATA_CORRUPTED, "The migration's markers are damaged.", cause = e)
        }
    }

    private fun write(markers: Set<String>) {
        val bytes = JSONObject().put("v", 1).put("migrated", JSONArray(markers.toList())).toString()
            .toByteArray(Charsets.UTF_8)
        file.baseFile.parentFile?.mkdirs()
        val stream = file.startWrite()
        try {
            stream.write(bytes)
            file.finishWrite(stream)
        } catch (e: IOException) {
            file.failWrite(stream)
            throw e
        }
    }
}
