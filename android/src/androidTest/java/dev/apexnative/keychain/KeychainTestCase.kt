package dev.apexnative.keychain

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Before
import java.io.File
import java.security.KeyStore
import java.util.UUID

/**
 * A storage of its own for each test: a directory, a service and, through the service, Keystore keys that the test
 * deletes after. [device] is the real one until a test changes it.
 */
abstract class KeychainTestCase {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    internal val directory = File(context.noBackupFilesDir, "apexnative-keychain-test-${UUID.randomUUID()}")
    internal val service = "test.${UUID.randomUUID()}"
    internal val device = TestDevice(SystemDevice(context))
    internal var now = 1_700_000_000_000
    internal lateinit var keychain: Keychain

    @Before
    fun makeKeychain() {
        keychain = newKeychain()
    }

    @After
    fun deleteEverything() {
        directory.setWritable(true)
        newKeychain().clear(service)
        directory.deleteRecursively()
    }

    /** Another storage on the same directory: what a new process sees. */
    internal fun newKeychain() = Keychain(directory, device, clock = { now })

    internal fun options(
        accessible: Accessible = Accessible.AFTER_FIRST_UNLOCK,
        keyStorage: KeyStorage = KeyStorage.TEE,
        label: String? = null,
        accessControl: AccessControl = AccessControl.NONE,
        authValidity: Int = 0,
    ) = WriteOptions(accessible, accessControl, authValidity, keyStorage, label)

    internal fun storeFile(service: String) = File(directory, StoreFormat.fileName(service))

    internal fun storedItems(service: String) = StoreFormat.decode(storeFile(service).readBytes(), service).items

    internal fun writeStore(service: String, items: Map<String, StoredItem>) =
        storeFile(service).writeBytes(StoreFormat.encode(StoreData(service, items)))

    internal fun keystoreAliases(service: String): List<String> =
        KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.aliases().toList()
            .filter { it.startsWith(KeyAliases.ofService(service)) }

    internal fun deleteKeystoreKey(alias: String) =
        KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(alias)
}

/**
 * The device with what a test wants changed: an older Android, a locked screen, StrongBox, biometry. The lock is the
 * real one's, live, until a test says otherwise.
 */
internal class TestDevice(private val real: Device) : Device {
    override var sdk = real.sdk
    override var isSecure = real.isSecure
    private var locked: Boolean? = null
    override var isLocked: Boolean
        get() = locked ?: real.isLocked
        set(value) {
            locked = value
        }
    override var hasStrongBox = real.hasStrongBox
    override var biometricSensors = real.biometricSensors

    /** A `BiometricManager` status every `canAuthenticate` answers; null — the real one's. */
    var authenticationStatus: Int? = null

    override fun canAuthenticate(authenticators: Int) = authenticationStatus ?: real.canAuthenticate(authenticators)
}

internal fun assertCode(code: KeychainErrorCode, block: () -> Unit): KeychainException {
    try {
        block()
    } catch (e: KeychainException) {
        assertEquals(e.message, code, e.code)
        return e
    }
    fail("Expected $code")
    throw AssertionError()
}
