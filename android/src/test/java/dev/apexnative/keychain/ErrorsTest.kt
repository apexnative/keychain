package dev.apexnative.keychain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import java.io.IOException
import java.security.ProviderException
import javax.crypto.AEADBadTagException

class ErrorsTest {
    @Test
    fun aKeychainExceptionStaysAsItIs() {
        val error = KeychainException(KeychainErrorCode.AUTH_REQUIRED, "needs a prompt")
        assertSame(error, error.toKeychainException())
        assertSame(error, RuntimeException(error).toKeychainException())
    }

    @Test
    fun aBadTagIsDataCorruptedEvenWrapped() {
        val error = ProviderException(AEADBadTagException("mac check failed")).toKeychainException()
        assertEquals(KeychainErrorCode.DATA_CORRUPTED, error.code)
        assertEquals("javax.crypto.AEADBadTagException", error.nativeDomain)
    }

    @Test
    fun anythingElseIsUnknownWithItsClass() {
        val error = IOException("disk full").toKeychainException()
        assertEquals(KeychainErrorCode.UNKNOWN, error.code)
        assertEquals("IOException: disk full", error.message)
        assertEquals("java.io.IOException", error.nativeDomain)
        assertNull(error.nativeCode)
    }
}
