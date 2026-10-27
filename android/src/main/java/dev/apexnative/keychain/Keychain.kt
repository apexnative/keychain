package dev.apexnative.keychain

import android.content.Context
import android.os.Build
import android.security.keystore.UserNotAuthenticatedException
import android.util.Log
import java.io.File
import java.security.Key
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec

/**
 * The storage: a file per service in `noBackupFilesDir/apexnative-keychain/`, values encrypted with
 * AES-256-GCM. An item without access control is encrypted by its profile's AES key in AndroidKeyStore; an item with
 * access control by a key of its own, which the profile's RSA key in AndroidKeyStore wraps, so that writing needs only
 * the public key and shows no prompt. Thread-safe, though the module calls it from its executor only. Every method
 * does its work on the calling thread and shows nothing: a read that
 * needs the user comes back as [Read.Authenticate], for the module to show the prompt.
 */
internal class Keychain(
    private val directory: File,
    private val device: Device,
    private val keys: KeystoreKeys = KeystoreKeys(),
    private val clock: () -> Long = System::currentTimeMillis,
    /** The windows of `authValidity` the library keeps itself, on top of the Keystore's. */
    val windows: AuthWindows = AuthWindows(),
) {
    /** An item that was read: its value in the encoding asked for, and its label. */
    data class Item(val value: String, val label: String?)

    /** What `getItemInfo` reports. */
    data class Info(
        val key: String,
        val label: String?,
        val accessible: Accessible,
        val accessControl: AccessControl,
        val createdAt: Long,
        val modifiedAt: Long,
        val securityLevel: SecurityLevel,
    )

    /** What a read comes to: the item, or a prompt to show first. */
    sealed interface Read {
        /** The item, or null when there is none. */
        data class Value(val item: Item?) : Read

        /**
         * The item needs the user. [cipher] is what the prompt unlocks (its `CryptoObject`): for a key used with
         * authentication every time. Null for a key with a time window, which any authentication of its kinds opens:
         * the read is then tried again. [finish] reads the item, on the executor, with what the prompt unlocked.
         */
        class Authenticate(val accessControl: AccessControl, val cipher: Cipher?, val finish: (Cipher?) -> Item) : Read
    }

    /** The app went to the background: the next read of an item with a window shows its prompt again. */
    fun forgetAuthentications() = windows.closeAll()

    /** What the device can do, which the storage asks too before it writes an item with access control. */
    val capabilities = Capabilities(device, keys)

    private val stores = ConcurrentHashMap<String, ServiceStore>()
    private val random by lazy { SecureRandom() }

    // StrongBox refused a key once ('strongbox' fell back to the TEE): later writes don't ask it again.
    @Volatile
    private var strongBoxRefused = false

    fun setItem(service: String, key: String, value: String, encoding: Encoding, options: WriteOptions): Unit = guard {
        checkName("service", service)
        checkName("key", key)
        val (plaintext, kind) = valueBytes(value, encoding)
        if (options.accessControl == AccessControl.NONE) {
            if (options.authValidity != 0) throw invalidArgument("authValidity must be 0 with accessControl 'none'.")
        } else {
            checkProtection(options)
        }
        if (options.accessible == Accessible.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY && !device.isSecure) {
            throw KeychainException(
                KeychainErrorCode.PASSCODE_NOT_SET,
                "The device has no screen lock, which 'whenPasscodeSetThisDeviceOnly' needs.",
            )
        }
        checkUnlocked(options.accessible)
        val store = store(service)
        store.update { data ->
            val sealed = seal(store, key, plaintext, options)
            val now = clock()
            data.with(
                key,
                StoredItem(
                    scheme = sealed.scheme,
                    alias = sealed.alias,
                    iv = Base64.encode(sealed.iv),
                    ciphertext = Base64.encode(sealed.ciphertext),
                    wrappedKey = sealed.wrappedKey?.let(Base64::encode),
                    kind = kind,
                    accessControl = options.accessControl,
                    accessible = options.accessible,
                    securityLevel = sealed.securityLevel,
                    label = options.label,
                    // A write replaces the item, but it's the same item: it keeps the time it was made.
                    createdAt = data.items[key]?.createdAt ?: now,
                    modifiedAt = now,
                    authValidity = options.authValidity,
                ),
            )
        }
    }

    /** Reads the item: its value, null, or the prompt it needs first. */
    fun read(service: String, key: String, encoding: Encoding): Read = guard {
        checkName("service", service)
        checkName("key", key)
        readItem(store(service), key, encoding, interactive = true, retry = true)
    }

    /** The synchronous read, which can't show a prompt: an item with access control is AUTH_REQUIRED. */
    fun getItem(service: String, key: String, encoding: Encoding): Item? = guard {
        checkName("service", service)
        checkName("key", key)
        // Without a prompt every read is a value.
        (readItem(store(service), key, encoding, interactive = false, retry = true) as Read.Value).item
    }

    fun hasItem(service: String, key: String): Boolean = guard {
        checkName("service", service)
        checkName("key", key)
        key in items(store(service))
    }

    fun getItemInfo(service: String, key: String): Info? = guard {
        checkName("service", service)
        checkName("key", key)
        val item = items(store(service))[key] ?: return@guard null
        Info(
            key = key,
            label = item.label,
            accessible = item.accessible,
            accessControl = item.accessControl,
            createdAt = item.createdAt,
            modifiedAt = item.modifiedAt,
            securityLevel = item.securityLevel,
        )
    }

    fun getAllKeys(service: String): List<String> = guard {
        checkName("service", service)
        items(store(service)).keys.toList()
    }

    fun removeItem(service: String, key: String): Unit = guard {
        checkName("service", service)
        checkName("key", key)
        store(service).update { data -> if (key in data.items) data.without(listOf(key)) else null }
    }

    /** Deletes the service's file and every Keystore key of the service, the ones no item uses included. */
    fun clear(service: String): Unit = guard {
        checkName("service", service)
        store(service).clear {
            for (alias in keys.aliases(KeyAliases.ofService(service))) keys.delete(alias)
        }
    }

    // Every error leaves as a KeychainException with its code.
    private inline fun <T> guard(work: () -> T): T = try {
        work()
    } catch (e: Exception) {
        throw e.toKeychainException()
    }

    private fun store(service: String) = stores.getOrPut(service) { ServiceStore(service, directory) }

    /**
     * The store's items. The items 'whenPasscodeSetThisDeviceOnly' go once the device has no screen lock, as iOS
     * deletes them when the passcode is removed: the first access after deletes them.
     */
    private fun items(store: ServiceStore): Map<String, StoredItem> {
        val items = store.snapshot().items
        if (items.values.none(::needsPasscode) || device.isSecure) return items
        Log.w(TAG, "[ApexKeychain] No screen lock: the store's 'whenPasscodeSetThisDeviceOnly' items are deleted.")
        return store.update { data ->
            val gone = data.items.filterValues(::needsPasscode).keys
            if (gone.isEmpty()) null else data.without(gone)
        }.items
    }

    private fun needsPasscode(item: StoredItem) = item.accessible == Accessible.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY

    /**
     * Whether an item with access control can be written now: never with weaker protection than asked.
     */
    private fun checkProtection(options: WriteOptions) {
        val accessControl = options.accessControl
        if (accessControl.currentSet && options.authValidity > 0) {
            throw invalidArgument(
                "'${accessControl.jsName}' can't have an authValidity: the Keystore invalidates only keys that need " +
                    "authentication every time.",
            )
        }
        capabilities.unavailable(accessControl)?.let { throw unavailableError(accessControl, it) }
        // Before Android 11 a key with a time window takes any unlock of the screen, the passcode included.
        if (options.authValidity > 0 && device.sdk < Build.VERSION_CODES.R) {
            throw KeychainException(
                KeychainErrorCode.UNSUPPORTED,
                "authValidity needs Android 11: before, the passcode would unlock the item too.",
            )
        }
    }

    private fun unavailableError(accessControl: AccessControl, reason: UnavailableReason): KeychainException {
        val (code, why) = when (reason) {
            UnavailableReason.UNSUPPORTED_OS -> KeychainErrorCode.UNSUPPORTED to "it needs Android 11"
            UnavailableReason.PASSCODE_NOT_SET -> KeychainErrorCode.PASSCODE_NOT_SET to "the device has no screen lock"
            UnavailableReason.NOT_ENROLLED -> KeychainErrorCode.BIOMETRY_NOT_ENROLLED to "no strong biometry enrolled"
            UnavailableReason.NO_HARDWARE -> KeychainErrorCode.BIOMETRY_NOT_AVAILABLE to "strong biometry isn't there"
        }
        return KeychainException(code, "accessControl '${accessControl.jsName}' can't be used: $why.")
    }

    private fun readItem(
        store: ServiceStore,
        key: String,
        encoding: Encoding,
        interactive: Boolean,
        retry: Boolean,
    ): Read {
        val item = items(store)[key] ?: return Read.Value(null)
        if (item.accessControl != AccessControl.NONE && !interactive) {
            throw KeychainException(
                KeychainErrorCode.AUTH_REQUIRED,
                "The item needs authentication, and a synchronous read can't show the prompt.",
            )
        }
        checkUnlocked(item.accessible)
        val sealed = SealedItem.of(item)
        return try {
            when (item.scheme) {
                Scheme.AES_GCM -> Read.Value(decrypt(store.service, key, item, sealed, encoding))
                Scheme.RSA_OAEP_AES_GCM -> authenticate(store, key, item, sealed, encoding)
            }
        } catch (e: KeyGone) {
            // The item can never be read again, so it goes, unless a write or a clear changed it
            // meanwhile: then it's read again.
            val removed = removeIfCurrent(store, key, item)
            if (!removed && retry) return readItem(store, key, encoding, interactive, retry = false)
            throw keyInvalidated(e.cause)
        }
    }

    private fun decrypt(service: String, key: String, item: StoredItem, sealed: SealedItem, encoding: Encoding): Item {
        val plaintext = try {
            val secretKey = keys.secretKey(item.alias) ?: throw KeyGone(null)
            AesGcm.open(secretKey, AesGcm.aad(service, key), sealed.iv, sealed.ciphertext)
        } catch (e: Exception) {
            throw if (e !is KeyGone && e.isInvalidation()) KeyGone(e) else e
        }
        return Item(valueString(plaintext, item.kind, encoding), item.label)
    }

    /**
     * The read of an item with access control: the cipher on the private key, made without a prompt, and the prompt
     * to unlock it. A key with a time window that's open reads at once.
     */
    private fun authenticate(
        store: ServiceStore,
        key: String,
        item: StoredItem,
        sealed: SealedItem,
        encoding: Encoding,
    ): Read {
        val unwrapper = try {
            RsaOaep.unwrapper(keys.privateKey(item.alias) ?: throw KeyGone(null))
        } catch (e: UserNotAuthenticatedException) {
            // A time window that's closed.
            null
        } catch (e: Exception) {
            throw if (e !is KeyGone && e.isInvalidation()) KeyGone(e) else e
        }
        fun open(cipher: Cipher): Item {
            val itemKey = cipher.doFinal(sealed.wrappedKey)
            val plaintext = try {
                val aad = AesGcm.aad(store.service, key)
                AesGcm.open(SecretKeySpec(itemKey, "AES"), aad, sealed.iv, sealed.ciphertext)
            } finally {
                // `SecretKeySpec` keeps a copy, which the garbage collector takes; this one goes now.
                itemKey.fill(0)
            }
            return Item(valueString(plaintext, item.kind, encoding), item.label)
        }
        if (item.authValidity == 0) {
            val cipher = unwrapper ?: throw IllegalStateException("A key used with every authentication has a window")
            return Read.Authenticate(item.accessControl, cipher) { unlocked ->
                afterPrompt(store, key, item) { open(unlocked ?: cipher) }
            }
        }
        // Both windows open: no prompt. The Keystore's alone isn't enough: unlocking the screen opens it too.
        if (unwrapper != null && windows.isOpen(store.service, item.accessControl, item.authValidity)) {
            try {
                return Read.Value(open(unwrapper))
            } catch (e: Exception) {
                // The Keystore's window closed in between.
                if (!e.needsAuthentication()) throw e
            }
        }
        return Read.Authenticate(item.accessControl, null) {
            afterPrompt(store, key, item) {
                open(RsaOaep.unwrapper(keys.privateKey(item.alias) ?: throw KeyGone(null))).also {
                    windows.open(store.service, item.accessControl)
                }
            }
        }
    }

    /**
     * The end of a read after its prompt, on the executor: the errors as [read]'s. A write, a remove or a clear while
     * the prompt was showing changed the item: the read starts over, and finds the new item or none. The old item's
     * key may well open the old value still — an operation the Keystore began survives its key's deletion.
     */
    private fun afterPrompt(store: ServiceStore, key: String, item: StoredItem, open: () -> Item): Item = guard {
        val opened = try {
            open()
        } catch (e: Exception) {
            when {
                e is KeyGone || e.isInvalidation() -> {
                    if (!removeIfCurrent(store, key, item)) throw PromptAgainException(e)
                    throw keyInvalidated(if (e is KeyGone) e.cause else e)
                }
                // Android 15+, after a lockout: the PIN that recovers biometry is bound to the read's operation, and
                // the finger that follows doesn't unlock it. The prompt queue shows the prompt once more, with a new
                // operation.
                e.needsAuthentication() -> throw PromptAgainException(e)
                else -> throw e
            }
        }
        if (items(store)[key] != item) throw PromptAgainException(IllegalStateException("The item changed meanwhile"))
        opened
    }

    private fun keyInvalidated(cause: Throwable?) = KeychainException(
        KeychainErrorCode.KEY_INVALIDATED,
        "The item's Keystore key is gone or invalidated: the item was deleted.",
        nativeDomain = cause?.javaClass?.name,
        cause = cause,
    )

    // Whether the item was still the store's and is deleted now.
    private fun removeIfCurrent(store: ServiceStore, key: String, item: StoredItem): Boolean {
        var removed = false
        store.update { data ->
            if (data.items[key] != item) return@update null
            removed = true
            data.without(listOf(key))
        }
        return removed
    }

    /** Encrypts a value for its profile. Under the store's lock. */
    private fun seal(store: ServiceStore, key: String, plaintext: ByteArray, options: WriteOptions): Sealed {
        val aad = AesGcm.aad(store.service, key)
        if (options.accessControl != AccessControl.NONE) return sealWrapped(store, aad, plaintext, options)
        var writeKey = writeKey(store, options)
        val sealed = try {
            AesGcm.seal(writeKey.key as SecretKey, aad, plaintext)
        } catch (e: Exception) {
            // A dead key is replaced by a new generation: the items it encrypted read KEY_INVALIDATED.
            if (!e.isInvalidation()) throw e
            Log.w(TAG, "[ApexKeychain] A Keystore key was invalidated: its items can't be read any more.", e)
            retire(store, writeKey)
            writeKey = writeKey(store, options)
            AesGcm.seal(writeKey.key as SecretKey, aad, plaintext)
        }
        return Sealed(Scheme.AES_GCM, writeKey.alias, level(writeKey), sealed.iv, sealed.ciphertext, null)
    }

    /**
     * Encrypts a value with a key of its own, and wraps that key with the profile's RSA public key: no prompt. The
     * item's key lives only here and goes when done.
     */
    private fun sealWrapped(store: ServiceStore, aad: ByteArray, plaintext: ByteArray, options: WriteOptions): Sealed {
        val writeKey = writeKey(store, options)
        val publicKey = keys.publicKey(writeKey.alias) ?: throw IllegalStateException("The key has no public key")
        val itemKey = ByteArray(ITEM_KEY_BYTES).also(random::nextBytes)
        try {
            val iv = ByteArray(AesGcm.IV_BYTES).also(random::nextBytes)
            val sealed = AesGcm.seal(SecretKeySpec(itemKey, "AES"), aad, plaintext, iv)
            val wrapped = RsaOaep.wrap(publicKey, itemKey)
            return Sealed(Scheme.RSA_OAEP_AES_GCM, writeKey.alias, level(writeKey), iv, sealed.ciphertext, wrapped)
        } finally {
            itemKey.fill(0)
        }
    }

    private fun level(writeKey: WriteKey) =
        keys.securityLevel(writeKey.alias, writeKey.key, writeKey.profile.hardware, device.sdk)

    private fun retire(store: ServiceStore, writeKey: WriteKey) {
        keys.delete(writeKey.alias)
        store.keyAliases?.remove(writeKey.profile.id)
    }

    /**
     * The key to write with, for `keyStorage`: 'tee' — the TEE; 'strongboxRequired' — StrongBox or
     * HARDWARE_UNAVAILABLE; 'strongbox' — StrongBox when it takes the key, else the TEE.
     */
    private fun writeKey(store: ServiceStore, options: WriteOptions): WriteKey {
        val scheme = if (options.accessControl == AccessControl.NONE) Scheme.AES_GCM else Scheme.RSA_OAEP_AES_GCM
        val unlockedDevice = options.accessible.needsUnlockedDevice && device.sdk >= Build.VERSION_CODES.P
        fun profile(hardware: KeyHardware) =
            KeyProfile(scheme, options.accessControl, options.authValidity, hardware, unlockedDevice)
        val strongBox = device.sdk >= Build.VERSION_CODES.P && device.hasStrongBox
        return when (options.keyStorage) {
            KeyStorage.TEE -> profileKey(store, profile(KeyHardware.TEE))
            KeyStorage.STRONGBOX_REQUIRED -> {
                if (!strongBox) throw noStrongBox(null)
                try {
                    profileKey(store, profile(KeyHardware.STRONGBOX))
                } catch (e: Exception) {
                    if (e.causes().any(::isStrongBoxUnavailable)) throw noStrongBox(e) else throw e
                }
            }
            KeyStorage.STRONGBOX -> {
                if (strongBox && !strongBoxRefused) {
                    try {
                        return profileKey(store, profile(KeyHardware.STRONGBOX))
                    } catch (e: Exception) {
                        if (e.causes().none(::isStrongBoxUnavailable)) throw e
                        Log.w(TAG, "[ApexKeychain] StrongBox refused a key: 'strongbox' falls back to the TEE.", e)
                        strongBoxRefused = true
                    }
                }
                profileKey(store, profile(KeyHardware.TEE))
            }
        }
    }

    /**
     * The service's key of the profile, made when there is none or it's dead. Under the store's lock. A private key is
     * tried before it's used: `Cipher.init` needs no prompt and throws for a dead key, and writing with one would make
     * an item no one can read.
     */
    private fun profileKey(store: ServiceStore, profile: KeyProfile): WriteKey {
        val aliases = store.keyAliases ?: serviceAliases(store.service).also { store.keyAliases = it }
        aliases[profile.id]?.let { alias ->
            val existing = try {
                when (profile.scheme) {
                    Scheme.AES_GCM -> keys.secretKey(alias)
                    Scheme.RSA_OAEP_AES_GCM -> keys.privateKey(alias)?.also(::tryPrivateKey)
                }
            } catch (e: Exception) {
                if (!e.isInvalidation()) throw e
                Log.w(TAG, "[ApexKeychain] A Keystore key was invalidated: its items can't be read any more.", e)
                keys.delete(alias)
                null
            }
            if (existing != null) return WriteKey(alias, existing, profile)
            // Deleted behind the library's back, or dead.
            aliases.remove(profile.id)
        }
        val alias = KeyAliases.new(store.service, profile, generation())
        val key: Key = try {
            when (profile.scheme) {
                Scheme.AES_GCM -> keys.generateAes(alias, profile)
                Scheme.RSA_OAEP_AES_GCM -> keys.generateRsa(alias, profile)
            }
        } catch (e: Exception) {
            // The biometry or the screen lock went between the check and the key.
            capabilities.unavailable(profile.accessControl)?.let { throw unavailableError(profile.accessControl, it) }
            throw e
        }
        aliases[profile.id] = alias
        return WriteKey(alias, key, profile)
    }

    private fun tryPrivateKey(privateKey: java.security.PrivateKey) {
        try {
            RsaOaep.unwrapper(privateKey)
        } catch (e: UserNotAuthenticatedException) {
            // A time window that's closed: the key is alive.
        }
    }

    // The aliases of the service's keys by profile id. A profile has one key; should there be more, the last name wins.
    private fun serviceAliases(service: String): MutableMap<String, String> {
        val aliases = HashMap<String, String>()
        for (alias in keys.aliases(KeyAliases.ofService(service)).sorted()) {
            KeyAliases.profileId(service, alias)?.let { aliases[it] = alias }
        }
        return aliases
    }

    private fun generation(): String = ByteArray(GENERATION_BYTES).also(random::nextBytes).joinToString("") {
        "%02x".format(it)
    }

    private fun checkUnlocked(accessible: Accessible) {
        // The library checks itself, before any key is touched. From API 28 the Keystore refuses the key too
        // (`setUnlockedDeviceRequired`), but each Android says so its own way — a `UserNotAuthenticatedException`,
        // which an item with access control would take for a closed time window, or on Android 15+ a plain
        // `InvalidKeyException`; before API 28 there's no such key.
        if (accessible.needsUnlockedDevice && device.isLocked) {
            throw KeychainException(
                KeychainErrorCode.INTERACTION_NOT_ALLOWED,
                "The device is locked, and the item is '${accessible.jsName}'.",
            )
        }
    }

    private fun noStrongBox(cause: Throwable?) = KeychainException(
        KeychainErrorCode.HARDWARE_UNAVAILABLE,
        "The device has no StrongBox for the key, which 'strongboxRequired' needs.",
        nativeDomain = cause?.javaClass?.name,
        cause = cause,
    )

    /** The bytes of a stored item, checked: a damaged item is DATA_CORRUPTED before any key is touched. */
    private class SealedItem(val iv: ByteArray, val ciphertext: ByteArray, val wrappedKey: ByteArray) {
        companion object {
            fun of(item: StoredItem): SealedItem {
                val iv = Base64.decode(item.iv)
                val ciphertext = Base64.decode(item.ciphertext)
                val wrappedKey = item.wrappedKey?.let(Base64::decode) ?: ByteArray(0)
                // The scheme matches the access control: the file can't make an item weaker than it was written.
                val schemeFits = (item.scheme == Scheme.AES_GCM) == (item.accessControl == AccessControl.NONE)
                if (!schemeFits || iv?.size != AesGcm.IV_BYTES || ciphertext == null ||
                    ciphertext.size < AesGcm.TAG_BYTES
                ) {
                    throw KeychainException(KeychainErrorCode.DATA_CORRUPTED, "The item can't be decrypted: damaged.")
                }
                return SealedItem(iv, ciphertext, wrappedKey)
            }
        }
    }

    private class WriteKey(val alias: String, val key: Key, val profile: KeyProfile)

    private class Sealed(
        val scheme: Scheme,
        val alias: String,
        val securityLevel: SecurityLevel,
        val iv: ByteArray,
        val ciphertext: ByteArray,
        val wrappedKey: ByteArray?,
    )

    /** The key an item was encrypted with is gone or dead: the item can never be read again. */
    private class KeyGone(cause: Throwable?) : Exception(cause)

    companion object {
        private const val TAG = "ApexKeychain"
        /** The stores' directory in `noBackupFilesDir`; migration's markers are there too. */
        const val DIRECTORY = "apexnative-keychain"
        private const val MAX_NAME_LENGTH = 256
        private const val GENERATION_BYTES = 4
        private const val ITEM_KEY_BYTES = 32

        @Volatile
        private var shared: Keychain? = null

        /** The process's storage: one for every instance of the module, so that they share its caches and locks. */
        fun shared(context: Context): Keychain = shared ?: synchronized(this) {
            shared ?: Keychain(
                File(context.applicationContext.noBackupFilesDir, DIRECTORY),
                SystemDevice(context.applicationContext),
            ).also { shared = it }
        }

        /**
         * A key or a service: JavaScript has checked it (src/options.ts); native checks again what the file and the
         * AAD rely on — no U+0000, which separates the AAD's parts, and a UTF-8 form.
         */
        fun checkName(what: String, name: String) {
            if (name.isEmpty() || name.indexOf('\u0000') >= 0 ||
                name.codePointCount(0, name.length) > MAX_NAME_LENGTH || utf8(name) == null
            ) {
                throw invalidArgument(
                    "Invalid $what: expected a non-empty string of up to $MAX_NAME_LENGTH characters without U+0000.",
                )
            }
        }
    }
}
