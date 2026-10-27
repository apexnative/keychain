package dev.apexnative.keychain

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import java.security.Key
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.PublicKey
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource

/** The hardware a Keystore key is made in. */
internal enum class KeyHardware(override val jsName: String) : Named {
    TEE("tee"),
    STRONGBOX("strongbox"),
}

/**
 * What a Keystore key is made with. Items with the same profile share a key, items with different ones don't:
 * the profile's id is a part of the key's alias. [hardware] is where the key really is: 'strongbox'
 * that fell back to the TEE writes with the TEE's profile.
 */
internal data class KeyProfile(
    val scheme: Scheme,
    val accessControl: AccessControl,
    val authValidity: Int,
    val hardware: KeyHardware,
    /** `setUnlockedDeviceRequired`, API 28+. */
    val unlockedDeviceRequired: Boolean,
) {
    /** A hash of the parameters, short: an alias stays well within the Keystore's limits. */
    val id: String
        get() = sha256Hex(
            listOf("v1", scheme.jsName, accessControl.jsName, authValidity, hardware.jsName, unlockedDeviceRequired)
                .joinToString(";"),
        ).take(16)
}

/**
 * The names of the library's Keystore keys: `apexnative.keychain/<sha256(service)>/<profile>/<generation>`. The
 * service is hashed, as in the file's name, so that any name fits the Keystore's limits on Android 7–11. A dead key is
 * replaced by a new generation, never under its own alias: the items of the old key then find no key and read
 * KEY_INVALIDATED instead of DATA_CORRUPTED.
 */
internal object KeyAliases {
    private const val PREFIX = "apexnative.keychain/"

    /** What every alias of the service starts with. */
    fun ofService(service: String) = PREFIX + sha256Hex(service) + "/"

    /** The canary of `getBiometryState`: no service's, so that `clear` leaves it. */
    const val BIOMETRY_STATE = PREFIX + "biometry-state/"

    /** The throwaway key `getHardwareSecurityLevel` measures. */
    const val PROBE = PREFIX + "probe/"

    fun new(service: String, profile: KeyProfile, generation: String) =
        ofService(service) + profile.id + "/" + generation

    /** The profile id of an alias of the service, or null when the alias isn't one. */
    fun profileId(service: String, alias: String): String? {
        val prefix = ofService(service)
        if (!alias.startsWith(prefix)) return null
        val rest = alias.substring(prefix.length).split('/')
        return if (rest.size == 2 && rest.all { it.isNotEmpty() }) rest[0] else null
    }
}

/** The library's keys in AndroidKeyStore. */
internal class KeystoreKeys {
    private val keyStore: KeyStore by lazy { KeyStore.getInstance(PROVIDER).apply { load(null) } }

    // The security level of each key, by alias: measured once.
    private val levels = ConcurrentHashMap<String, SecurityLevel>()

    fun aliases(prefix: String): List<String> = keyStore.aliases().toList().filter { it.startsWith(prefix) }

    /** The AES key of the alias, or null when there is none. */
    fun secretKey(alias: String): SecretKey? = keyStore.getKey(alias, null) as? SecretKey

    /** The RSA private key of the alias, or null when there is none. */
    fun privateKey(alias: String): PrivateKey? = keyStore.getKey(alias, null) as? PrivateKey

    /**
     * The RSA public key of the alias, as a key of the platform's own provider: encrypting with it touches neither the
     * Keystore nor its restrictions, and needs no authentication.
     */
    fun publicKey(alias: String): PublicKey? = keyStore.getCertificate(alias)?.publicKey?.let { key ->
        KeyFactory.getInstance(key.algorithm).generatePublic(X509EncodedKeySpec(key.encoded))
    }

    fun generateAes(alias: String, profile: KeyProfile): SecretKey {
        val builder = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(AES_KEY_BITS)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            if (profile.unlockedDeviceRequired) builder.setUnlockedDeviceRequired(true)
            if (profile.hardware == KeyHardware.STRONGBOX) builder.setIsStrongBoxBacked(true)
        }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
        generator.init(builder.build())
        return generator.generateKey()
    }

    /**
     * The RSA key pair of a profile with authentication: the private key needs the user, every time
     * or for `authValidity` seconds; the public one never does, so writing shows no prompt.
     */
    fun generateRsa(alias: String, profile: KeyProfile): PrivateKey {
        val accessControl = profile.accessControl
        val builder = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(RSA_KEY_BITS)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(accessControl.currentSet)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            builder.setUserAuthenticationParameters(profile.authValidity, keyAuthenticators(accessControl))
        } else {
            // Before Android 11 only biometry, every time: the passcode and time windows are refused before here.
            @Suppress("DEPRECATION")
            builder.setUserAuthenticationValidityDurationSeconds(-1)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            if (profile.unlockedDeviceRequired) builder.setUnlockedDeviceRequired(true)
            if (profile.hardware == KeyHardware.STRONGBOX) builder.setIsStrongBoxBacked(true)
        }
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, PROVIDER)
        generator.initialize(builder.build())
        return generator.generateKeyPair().private
    }

    /** The canary of `getBiometryState`: an AES key that a change of the enrolled biometrics invalidates. */
    fun generateCanary(alias: String) {
        val builder = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT)
            .setKeySize(AES_KEY_BITS)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
        generator.init(builder.build())
        generator.generateKey()
    }

    /** A plain AES key in the TEE, to see where keys live. */
    fun generateProbe(alias: String): SecretKey = generateAes(
        alias,
        KeyProfile(Scheme.AES_GCM, AccessControl.NONE, 0, KeyHardware.TEE, unlockedDeviceRequired = false),
    )

    fun delete(alias: String) {
        keyStore.deleteEntry(alias)
        levels.remove(alias)
    }

    /**
     * Where the key lives. Android 12+ says it; before, the Keystore says only whether it's in secure hardware, and
     * StrongBox is known from the profile: a StrongBox profile's key is always in StrongBox.
     */
    fun securityLevel(alias: String, key: Key, hardware: KeyHardware, sdk: Int): SecurityLevel =
        levels.getOrPut(alias) {
            val info = if (key is SecretKey) {
                SecretKeyFactory.getInstance(key.algorithm, PROVIDER).getKeySpec(key, KeyInfo::class.java) as KeyInfo
            } else {
                KeyFactory.getInstance(key.algorithm, PROVIDER).getKeySpec(key, KeyInfo::class.java)
            }
            if (sdk >= Build.VERSION_CODES.S) {
                when (info.securityLevel) {
                    KeyProperties.SECURITY_LEVEL_STRONGBOX -> SecurityLevel.STRONGBOX
                    KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT, KeyProperties.SECURITY_LEVEL_UNKNOWN_SECURE ->
                        SecurityLevel.TEE
                    else -> SecurityLevel.SOFTWARE
                }
            } else {
                @Suppress("DEPRECATION")
                val secure = info.isInsideSecureHardware
                when {
                    !secure -> SecurityLevel.SOFTWARE
                    hardware == KeyHardware.STRONGBOX -> SecurityLevel.STRONGBOX
                    else -> SecurityLevel.TEE
                }
            }
        }

    private companion object {
        const val PROVIDER = "AndroidKeyStore"
        const val AES_KEY_BITS = 256
        const val RSA_KEY_BITS = 2048

        // What authenticates a key's use: `KeyProperties.AUTH_*`, API 30.
        fun keyAuthenticators(accessControl: AccessControl): Int =
            (if (accessControl.allowsBiometry) KeyProperties.AUTH_BIOMETRIC_STRONG else 0) or
                (if (accessControl.allowsPasscode) KeyProperties.AUTH_DEVICE_CREDENTIAL else 0)
    }
}

/** AES-256-GCM with a 128-bit tag; the Keystore makes the IV. */
internal object AesGcm {
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val TAG_BITS = 128

    /** The size of an IV the Keystore makes and accepts. */
    const val IV_BYTES = 12

    /** The tag at the end of a ciphertext. */
    const val TAG_BYTES = TAG_BITS / 8

    class Sealed(val iv: ByteArray, val ciphertext: ByteArray)

    /** `v1 \0 service \0 key`: binds a ciphertext to its place, so that another key's ciphertext doesn't decrypt. */
    fun aad(service: String, key: String): ByteArray = "v1\u0000$service\u0000$key".toByteArray(Charsets.UTF_8)

    /** Encrypts; [iv] is for a key of the app's own, since the Keystore makes the IV of its keys itself. */
    fun seal(key: SecretKey, aad: ByteArray, plaintext: ByteArray, iv: ByteArray? = null): Sealed {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        if (iv == null) {
            cipher.init(Cipher.ENCRYPT_MODE, key)
        } else {
            cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
        }
        cipher.updateAAD(aad)
        val ciphertext = cipher.doFinal(plaintext)
        return Sealed(cipher.iv, ciphertext)
    }

    fun open(key: SecretKey, aad: ByteArray, iv: ByteArray, ciphertext: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
        cipher.updateAAD(aad)
        return cipher.doFinal(ciphertext)
    }
}

/**
 * RSA-OAEP with SHA-256 and MGF1 with SHA-1, which wraps an item's own AES key. SHA-1 for MGF1 is what
 * AndroidKeyStore does on every version, so the platform's provider, which wraps, is told so too.
 */
internal object RsaOaep {
    private const val TRANSFORMATION = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding"
    private val PARAMETERS = OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT)

    fun wrap(publicKey: PublicKey, key: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, publicKey, PARAMETERS)
        return cipher.doFinal(key)
    }

    /**
     * A cipher that unwraps with the private key: what the prompt's `CryptoObject` unlocks. Making it needs no prompt;
     * it throws `KeyPermanentlyInvalidatedException` for a dead key and, for a key with a time window that's closed,
     * `UserNotAuthenticatedException`.
     */
    fun unwrapper(privateKey: PrivateKey): Cipher {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, privateKey, PARAMETERS)
        return cipher
    }
}
