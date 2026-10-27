package dev.apexnative.keychain

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Not a test: what `scripts/test-android.sh --emulator` does to the emulator it made before the suite runs — the PIN,
 * then the fingers, enrolled in Settings as [Person] does. The script runs it alone (`-e setUp true`) and leaves it out
 * of the suite; anywhere else it's skipped, so that it never enrolls a finger on a device of someone's.
 */
@RunWith(AndroidJUnit4::class)
class EmulatorSetup {
    @Test
    fun setUp() {
        val asked = InstrumentationRegistry.getArguments().getString("setUp") == "true"
        assumeTrue("Only for scripts/test-android.sh --emulator", asked)
        Person.assumePresent()
        Person.unlock()
        Person.setPin()
        Person.enrollFingers(Setup.fingers)
    }
}
