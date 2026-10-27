package dev.apexnative.keychain

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthWindowsTest {
    private var now = 1_000_000L
    private val windows = AuthWindows { now }

    @Test
    fun aWindowIsClosedUntilAPromptOpensIt() {
        assertFalse(windows.isOpen("vault", AccessControl.PASSCODE, 30))
        windows.open("vault", AccessControl.PASSCODE)
        assertTrue(windows.isOpen("vault", AccessControl.PASSCODE, 30))
    }

    @Test
    fun aWindowIsAServicesAndAnAccessControls() {
        windows.open("vault", AccessControl.PASSCODE)
        // Every item of the service with the access control shares it, whatever else it has.
        assertTrue(windows.isOpen("vault", AccessControl.PASSCODE, 300))
        assertFalse(windows.isOpen("vault", AccessControl.BIOMETRY_ANY, 30))
        assertFalse(windows.isOpen("other", AccessControl.PASSCODE, 30))
    }

    @Test
    fun aWindowLastsItsSeconds() {
        windows.open("vault", AccessControl.BIOMETRY_ANY)
        now += 29_999
        assertTrue(windows.isOpen("vault", AccessControl.BIOMETRY_ANY, 30))
        now += 1
        assertFalse(windows.isOpen("vault", AccessControl.BIOMETRY_ANY, 30))
        // A longer window of an item with the same access control: what the item asks for counts.
        assertTrue(windows.isOpen("vault", AccessControl.BIOMETRY_ANY, 60))
    }

    @Test
    fun theBackgroundClosesEveryWindow() {
        windows.open("vault", AccessControl.PASSCODE)
        windows.open("other", AccessControl.BIOMETRY_ANY)
        windows.closeAll()
        assertFalse(windows.isOpen("vault", AccessControl.PASSCODE, 30))
        assertFalse(windows.isOpen("other", AccessControl.BIOMETRY_ANY, 30))
    }
}
