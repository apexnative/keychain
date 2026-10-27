package dev.apexnative.keychain

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.junit.Assume.assumeTrue
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.cert.X509Certificate
import java.security.spec.ECGenParameterSpec

/**
 * Where the Keystore says a new key lives: its attestation, the KeyDescription in the key's certificate — what the
 * tests compare the library's security levels with, since it comes from the Keystore itself and not from the
 * `KeyInfo` the library reads.
 */
internal object Attestation {
    /** The level of a key made in the TEE or, with [strongBox], in StrongBox. Skips where keys aren't attested. */
    fun securityLevel(strongBox: Boolean = false): SecurityLevel {
        val alias = "apexnative.keychain.test/attestation"
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setAttestationChallenge("apexnative".toByteArray())
        if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) spec.setIsStrongBoxBacked(true)
        try {
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").run {
                initialize(spec.build())
                generateKeyPair()
            }
            val certificate = keyStore.getCertificateChain(alias)?.firstOrNull() as? X509Certificate
            val description = certificate?.getExtensionValue(KEY_DESCRIPTION)
            assumeTrue("The Keystore doesn't attest its keys here", description != null)
            return when (val level = attestationSecurityLevel(description!!)) {
                0 -> SecurityLevel.SOFTWARE
                1 -> SecurityLevel.TEE
                2 -> SecurityLevel.STRONGBOX
                else -> throw AssertionError("An unknown attestation security level: $level")
            }
        } finally {
            keyStore.deleteEntry(alias)
        }
    }

    /**
     * The extension's value is an OCTET STRING of the DER KeyDescription, a SEQUENCE that starts with
     * `attestationVersion INTEGER, attestationSecurityLevel ENUMERATED`.
     */
    private fun attestationSecurityLevel(extension: ByteArray): Int {
        var at = 0
        fun header(tag: Int): Int {
            check(extension[at++].toInt() and 0xff == tag) { "Not the KeyDescription's DER" }
            var length = extension[at++].toInt() and 0xff
            if (length >= 0x80) {
                val bytes = length and 0x7f
                length = 0
                repeat(bytes) { length = (length shl 8) or (extension[at++].toInt() and 0xff) }
            }
            return length
        }
        header(OCTET_STRING)
        header(SEQUENCE)
        val version = header(INTEGER)
        at += version
        check(header(ENUMERATED) == 1) { "Not the KeyDescription's DER" }
        return extension[at].toInt()
    }

    private const val KEY_DESCRIPTION = "1.3.6.1.4.1.11129.2.1.17"
    private const val OCTET_STRING = 0x04
    private const val SEQUENCE = 0x30
    private const val INTEGER = 0x02
    private const val ENUMERATED = 0x0a
}
