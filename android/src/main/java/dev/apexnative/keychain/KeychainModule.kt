package dev.apexnative.keychain

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import dev.apexnative.keychain.migration.LegacyRead
import dev.apexnative.keychain.migration.Migration
import java.io.File
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * The TurboModule `ApexKeychain` (src/native/NativeApexKeychain.ts). It reads the arguments, calls the storage
 * ([Keychain]) and turns its answers and errors into the contract's shapes. Every method runs on [KeychainExecutor],
 * in the order JavaScript called them; a synchronous one blocks the JavaScript thread until its turn is done.
 *
 * Reads of items with access control, and of other libraries' protected items, show their prompt through
 * [PromptQueue]. Migration's native part is [Migration].
 */
@ReactModule(name = NativeApexKeychainSpec.NAME)
class KeychainModule(reactContext: ReactApplicationContext) : NativeApexKeychainSpec(reactContext) {

    // Made on the first call: making the module does no work.
    private val keychain by lazy { Keychain.shared(reactApplicationContext) }
    private val migration by lazy {
        Migration.of(reactApplicationContext, File(reactApplicationContext.noBackupFilesDir, Keychain.DIRECTORY))
    }
    private val promptQueue = lazy { PromptQueue(reactApplicationContext) { keychain.forgetAuthentications() } }
    private val prompts by promptQueue

    // Storage

    override fun setItem(
        store: ReadableMap,
        key: String,
        value: String,
        encoding: String,
        options: ReadableMap,
        promise: Promise,
    ) = async(promise) {
        keychain.setItem(store.service(), key, value, encodingOf(encoding), WriteOptions.of(options))
        null
    }

    /**
     * Reads on the executor; an item with access control waits for its prompt in the queue, and its read ends on the
     * executor again. Reads without authentication never wait for a prompt.
     */
    override fun getItem(store: ReadableMap, key: String, encoding: String, prompt: ReadableMap, promise: Promise) {
        KeychainExecutor.execute {
            try {
                val service = store.service()
                val asked = encodingOf(encoding)
                val texts = PromptTexts.of(prompt)
                when (val read = keychain.read(service, key, asked)) {
                    is Keychain.Read.Value -> promise.resolve(itemMap(read.item))
                    is Keychain.Read.Authenticate -> prompts.enqueue(
                        PromptQueue.Request(
                            texts = texts,
                            read = read,
                            reread = { keychain.read(service, key, asked) },
                            rereadAtTurn = read.cipher == null,
                            resolve = { promise.resolve(itemMap(it)) },
                            reject = promise::rejectWith,
                        ),
                    )
                }
            } catch (e: Exception) {
                promise.rejectWith(e.toKeychainException())
            }
        }
    }

    override fun removeItem(store: ReadableMap, key: String, promise: Promise) = async(promise) {
        keychain.removeItem(store.service(), key)
        null
    }

    override fun hasItem(store: ReadableMap, key: String, promise: Promise) = async(promise) {
        keychain.hasItem(store.service(), key)
    }

    override fun getItemInfo(store: ReadableMap, key: String, promise: Promise) = async(promise) {
        keychain.getItemInfo(store.service(), key)?.let { info ->
            Arguments.createMap().apply {
                putString("key", info.key)
                info.label?.let { putString("label", it) }
                putString("accessible", info.accessible.jsName)
                putString("accessControl", info.accessControl.jsName)
                putBoolean("synchronizable", false)
                putDouble("createdAt", info.createdAt.toDouble())
                putDouble("modifiedAt", info.modifiedAt.toDouble())
                putString("securityLevel", info.securityLevel.jsName)
            }
        }
    }

    override fun getAllKeys(store: ReadableMap, promise: Promise) = async(promise) {
        Arguments.createArray().apply { keychain.getAllKeys(store.service()).forEach(::pushString) }
    }

    override fun clear(store: ReadableMap, promise: Promise) = async(promise) {
        keychain.clear(store.service())
        null
    }

    // Storage, synchronous

    override fun getItemSync(store: ReadableMap, key: String): WritableMap = sync {
        val item = keychain.getItem(store.service(), key, Encoding.UTF8)
        Arguments.createMap().apply { item?.let { putString("value", it.value) } }
    }

    override fun setItemSync(store: ReadableMap, key: String, value: String, options: ReadableMap): WritableMap =
        sync {
            keychain.setItem(store.service(), key, value, Encoding.UTF8, WriteOptions.of(options))
            Arguments.createMap()
        }

    override fun hasItemSync(store: ReadableMap, key: String): WritableMap = sync {
        Arguments.createMap().apply { putBoolean("value", keychain.hasItem(store.service(), key)) }
    }

    override fun removeItemSync(store: ReadableMap, key: String): WritableMap = sync {
        keychain.removeItem(store.service(), key)
        Arguments.createMap()
    }

    // The application id: the package name at runtime.
    override fun getDefaultService(): String = reactApplicationContext.packageName

    // The device

    override fun getBiometryTypes(promise: Promise) = async(promise) {
        Arguments.createArray().apply { keychain.capabilities.biometryTypes().forEach { pushString(it.jsName) } }
    }

    override fun canUseAccessControl(accessControl: String, promise: Promise) = async(promise) {
        val reason = keychain.capabilities.unavailable(enumOf("accessControl", accessControl))
        Arguments.createMap().apply {
            putBoolean("available", reason == null)
            reason?.let { putString("reason", it.jsName) }
        }
    }

    override fun isPasscodeSet(promise: Promise) = async(promise) { keychain.capabilities.isPasscodeSet }

    override fun getBiometryState(promise: Promise) = async(promise) { keychain.capabilities.biometryState() }

    override fun getHardwareSecurityLevel(promise: Promise) = async(promise) {
        keychain.capabilities.hardwareSecurityLevel().jsName
    }

    // Migration

    override fun getMigrationSources(query: ReadableMap, promise: Promise) = async(promise) {
        val parsed = Migration.Query(
            library = enumOf("library", query.requireString("library")),
            services = query.requireStrings("services"),
            servers = query.requireStrings("servers"),
        )
        Arguments.createArray().apply {
            for (source in migration.sources(parsed)) {
                pushMap(
                    Arguments.createMap().apply {
                        putString("kind", source.kind.jsName)
                        putString("service", source.service)
                        putString("account", source.account)
                        putBoolean("requiresAuth", source.requiresAuth)
                        putBoolean("migrated", source.migrated)
                    },
                )
            }
        }
    }

    /** As `getItem`: a protected source waits for its prompt in the same queue. */
    override fun readMigrationSource(source: ReadableMap, prompt: ReadableMap, promise: Promise) {
        KeychainExecutor.execute {
            try {
                val parsed = source.migrationSource()
                val texts = PromptTexts.of(prompt)
                when (val read = migration.read(parsed).toRead()) {
                    is Keychain.Read.Value -> promise.resolve(read.item?.value)
                    is Keychain.Read.Authenticate -> prompts.enqueue(
                        PromptQueue.Request(
                            texts = texts,
                            read = read,
                            reread = { migration.read(parsed).toRead() },
                            rereadAtTurn = read.cipher == null,
                            resolve = { promise.resolve(it?.value) },
                            reject = promise::rejectWith,
                        ),
                    )
                }
            } catch (e: Exception) {
                promise.rejectWith(e.toKeychainException())
            }
        }
    }

    override fun finishMigrationSource(source: ReadableMap, removeSource: Boolean, promise: Promise) = async(promise) {
        migration.finish(source.migrationSource(), removeSource)
        null
    }

    private fun ReadableMap.migrationSource() = Migration.Source(
        kind = enumOf("kind", requireString("kind")),
        service = requireString("service"),
        account = requireString("account"),
        requiresAuth = requireBoolean("requiresAuth"),
        migrated = requireBoolean("migrated"),
    )

    // A read of another library's item as a read of the store's, for the prompt queue.
    private fun LegacyRead<String?>.toRead(): Keychain.Read = when (this) {
        is LegacyRead.Found -> Keychain.Read.Value(value?.let { Keychain.Item(it, null) })
        is LegacyRead.NeedsAuthentication -> Keychain.Read.Authenticate(accessControl, cipher) { unlocked ->
            Keychain.Item(finish(unlocked) ?: throw KeychainException(KeychainErrorCode.UNKNOWN, "No value"), null)
        }
        is LegacyRead.Unreadable -> throw error
    }

    // The module ends with its React instance (a reload): the reads still waiting for a prompt end too.
    override fun invalidate() {
        if (promptQueue.isInitialized()) prompts.close()
        super.invalidate()
    }

    private fun itemMap(item: Keychain.Item?) = item?.let {
        Arguments.createMap().apply {
            putString("value", it.value)
            it.label?.let { label -> putString("label", label) }
        }
    }

    /**
     * Runs [work] on the executor and settles the promise with what it returns (null for a method without a value)
     * or with its error. The arguments are read there too: a bad one rejects with INVALID_ARGUMENT.
     */
    private fun async(promise: Promise, work: () -> Any?) {
        KeychainExecutor.execute {
            val result = try {
                work()
            } catch (e: Exception) {
                promise.rejectWith(e.toKeychainException())
                return@execute
            }
            promise.resolve(result)
        }
    }

    /**
     * Runs [work] on the executor, after the asynchronous calls JavaScript made before it, as iOS does, and waits: a
     * read sees a write that wasn't awaited. Gives its answer or, instead of throwing across JSI, the `Failure`.
     */
    private fun sync(work: () -> WritableMap): WritableMap = try {
        KeychainExecutor.submit(Callable { work() }).get()
    } catch (e: ExecutionException) {
        failure((e.cause ?: e).toKeychainException())
    } catch (e: Exception) {
        failure(e.toKeychainException())
    }

}

/**
 * The thread of the asynchronous methods' I/O and crypto, neither JavaScript's nor the main one. One
 * thread: the calls run in the order JavaScript made them, so a write followed by a read reads what was written. It
 * stops when idle. A prompt never holds it: a read waits for its prompt off it and comes back to finish.
 */
internal object KeychainExecutor : ThreadPoolExecutor(
    1,
    1,
    IDLE_SECONDS,
    TimeUnit.SECONDS,
    LinkedBlockingQueue(),
    { runnable -> Thread(runnable, "ApexKeychain").apply { isDaemon = true } },
) {
    init {
        allowCoreThreadTimeOut(true)
    }
}

private const val IDLE_SECONDS = 30L
