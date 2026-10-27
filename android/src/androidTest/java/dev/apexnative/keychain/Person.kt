package dev.apexnative.keychain

import android.app.KeyguardManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import java.io.Closeable
import java.net.Socket
import java.util.regex.Pattern

/**
 * The device's setup, as scripts/test-android.sh describes it in the instrumentation's arguments: the screen lock's
 * PIN, the ids of the enrolled fingers, and the emulator's console (`port:token`), through which a test touches the
 * fingerprint sensor. A device the script didn't describe has none of them.
 */
internal object Setup {
    private val arguments = InstrumentationRegistry.getArguments()

    val pin: String? = arguments.getString("pin")?.takeIf { it.isNotEmpty() }

    /** The fingers `adb emu finger touch <id>` presents that the device recognizes. */
    val fingers: List<Int> = arguments.getString("fingers").orEmpty().split(',').mapNotNull { it.trim().toIntOrNull() }

    val console: String? = arguments.getString("console")?.takeIf { it.contains(':') }
}

/**
 * What a person does at the emulator, for the tests that need one: a finger on the sensor (through the emulator's
 * console), the prompt's buttons, the PIN, the home button, the screen locked and unlocked, a finger enrolled in
 * Settings. Each step waits for the screen it acts on, and fails when it doesn't come.
 */
internal object Person {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val keyguard = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    val ui: UiDevice = UiDevice.getInstance(instrumentation)

    /** A finger the device recognizes. */
    val finger: Int get() = Setup.fingers.first()

    /** A finger it doesn't. */
    val strangeFinger: Int get() = (90..99).first { it !in Setup.fingers }

    private val console by lazy {
        val (port, token) = Setup.console!!.split(':', limit = 2)
        Console(port.toInt(), token)
    }

    /** Skips the test unless the script described the emulator: a person can't be played without its console. */
    fun assumePresent() {
        assumeTrue(
            "Needs an emulator described by scripts/test-android.sh: its PIN, its fingers and its console.",
            Setup.pin != null && Setup.fingers.isNotEmpty() && Setup.console != null,
        )
    }

    /** Skips the test unless the device's PIN is known: the screen is locked and unlocked with it. */
    fun assumePin() = assumeTrue("Needs the device's PIN: run scripts/test-android.sh.", Setup.pin != null)

    /** A finger on the sensor, then off. */
    fun touch(finger: Int) {
        console.send("finger touch $finger")
        Thread.sleep(TOUCH_MILLIS)
        console.send("finger remove")
    }

    /** How many times the sensor recognized a finger, and didn't: the fingerprint service's counters. */
    fun recognitions() = counter("accept") + counter("acceptCrypto")

    fun rejections() = counter("reject") + counter("rejectCrypto")

    private fun counter(name: String) =
        Regex("\"$name\":(\\d+)").find(shell("dumpsys fingerprint"))?.groupValues?.get(1)?.toInt() ?: 0

    /** The prompt titled [title], once it shows. */
    fun prompt(title: String): UiObject2 = find(By.text(title), "a prompt titled '$title'")

    /** Whether a prompt titled [title] shows within [millis]. */
    fun sees(title: String, millis: Long = GLANCE_MILLIS) = ui.wait(Until.hasObject(By.text(title)), millis)

    /** Waits until no prompt titled [title] shows. */
    fun promptGone(title: String) {
        if (!ui.wait(Until.gone(By.text(title)), PATIENCE_MILLIS)) fail("The prompt '$title' is still showing")
    }

    fun tap(text: String) = find(By.text(text), "a button '$text'").click()

    /** The PIN, in the field that asks for it: the prompt's or Settings'. */
    fun enterPin() {
        find(PIN_FIELD, "a field for the PIN")
        typePin()
    }

    /** The home button, and the home screen in front. */
    fun pressHome() {
        ui.pressHome()
        waitUntil("the home screen shows") { ui.currentPackageName != context.packageName }
    }

    /** The screen off and locked, as the power button does. */
    fun lockScreen() {
        if (ui.isScreenOn) shell("input keyevent KEYCODE_POWER")
        waitUntil("the device locks") { keyguard.isDeviceLocked }
    }

    /** The screen on and unlocked with the PIN. */
    fun unlock() {
        ui.wakeUp()
        if (!keyguard.isKeyguardLocked) return
        // The bouncer, then the PIN; a second try if the first came before the bouncer did.
        for (attempt in 1..2) {
            // Android 8+; before, a swipe up.
            if (shell("wm dismiss-keyguard").isNotBlank()) {
                ui.swipe(ui.displayWidth / 2, ui.displayHeight * 4 / 5, ui.displayWidth / 2, ui.displayHeight / 5, 10)
            }
            Thread.sleep(BOUNCER_MILLIS)
            typePin()
            if (eventually { !keyguard.isKeyguardLocked }) return
        }
        fail("The screen didn't unlock with the PIN")
    }

    /**
     * Enrolls another finger in Settings, as a person does: the PIN, the consent, the finger on the sensor until it's
     * added. Returns the name Settings gives it.
     */
    fun enrollFinger(id: Int): String {
        val before = fingerNames()
        settings(ENROLL)
        val deadline = SystemClock.uptimeMillis() + ENROLL_MILLIS
        while (SystemClock.uptimeMillis() < deadline) {
            when {
                ui.hasObject(ADDED) -> {
                    find(By.text(Pattern.compile("done", Pattern.CASE_INSENSITIVE)), "Done").click()
                    break
                }
                ui.hasObject(TOUCH_THE_SENSOR) -> touch(id)
                ui.hasObject(NEXT) -> ui.findObject(NEXT).click()
            }
            Thread.sleep(STEP_MILLIS)
        }
        val added = fingerNames() - before.toSet()
        if (added.size != 1) fail("Settings enrolled ${added.size} fingers: $added")
        return added.single()
    }

    /** Deletes the finger [name] in Settings. */
    fun deleteFinger(name: String) {
        settings(FINGERPRINTS)
        find(By.desc("Delete $name"), "the button that deletes '$name'").click()
        // 'Delete'; 'Yes, remove' on older Androids.
        val confirm = Pattern.compile("delete|remove|yes, remove", Pattern.CASE_INSENSITIVE)
        find(By.text(confirm).clazz("android.widget.Button"), "the button that confirms it").click()
        if (!ui.wait(Until.gone(By.desc("Delete $name")), PATIENCE_MILLIS)) fail("'$name' wasn't deleted")
        ui.pressBack()
    }

    /** The enrolled fingers' names in Settings. */
    fun fingerNames(): List<String> {
        settings(FINGERPRINTS)
        find(By.desc(DELETE), "the list of fingerprints")
        val names = ui.findObjects(By.desc(DELETE)).map { it.contentDescription.removePrefix("Delete ") }
        ui.pressBack()
        return names
    }

    // A screen of Settings, which asks for the PIN first.
    private fun settings(action: String) {
        val intent = Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        try {
            context.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            assumeTrue("Settings has no '$action' on this Android", false)
        }
        find(PIN_FIELD, "Settings asking for the PIN")
        typePin()
        if (!ui.wait(Until.gone(PIN_FIELD), PATIENCE_MILLIS)) fail("Settings didn't take the PIN")
    }

    private fun typePin() {
        shell("input text ${Setup.pin}")
        ui.pressEnter()
    }

    private fun find(selector: BySelector, what: String): UiObject2 =
        ui.wait(Until.findObject(selector), PATIENCE_MILLIS) ?: run {
            fail("No $what on the screen")
            throw AssertionError()
        }

    fun shell(command: String): String = ui.executeShellCommand(command)

    private fun eventually(condition: () -> Boolean): Boolean {
        val deadline = SystemClock.uptimeMillis() + PATIENCE_MILLIS
        while (SystemClock.uptimeMillis() < deadline) {
            if (condition()) return true
            Thread.sleep(POLL_MILLIS)
        }
        return condition()
    }

    fun waitUntil(what: String, condition: () -> Boolean) {
        if (!eventually(condition)) fail("Waited in vain until $what")
    }

    const val PATIENCE_MILLIS = 15_000L
    private const val GLANCE_MILLIS = 3_000L
    private const val TOUCH_MILLIS = 300L
    private const val BOUNCER_MILLIS = 1_000L
    private const val STEP_MILLIS = 700L
    private const val POLL_MILLIS = 100L
    private const val ENROLL_MILLIS = 60_000L

    private const val ENROLL = "android.settings.FINGERPRINT_ENROLL"
    private const val FINGERPRINTS = "android.settings.FINGERPRINT_SETTINGS"
    private val DELETE = Pattern.compile("Delete .+")
    private val PIN_FIELD = By.clazz("android.widget.EditText")
    private val ADDED = By.text(Pattern.compile("Fingerprint added", Pattern.CASE_INSENSITIVE))
    private val TOUCH_THE_SENSOR =
        By.text(Pattern.compile(".*(touch the sensor|touch again).*", Pattern.CASE_INSENSITIVE))
    private val NEXT = By.clazz("android.widget.Button")
        .text(Pattern.compile("more|i agree|agree|next|start", Pattern.CASE_INSENSITIVE))
}

/**
 * The emulator's console, reached from inside the emulator, where the host's 127.0.0.1 is 10.0.2.2: `finger touch`
 * as `adb emu` sends it. Each command answers OK, or KO and why.
 */
private class Console(port: Int, token: String) : Closeable {
    private val socket = Socket("10.0.2.2", port).apply { soTimeout = TIMEOUT_MILLIS }
    private val reader = socket.getInputStream().bufferedReader()
    private val writer = socket.getOutputStream().bufferedWriter()

    init {
        answer()
        send("auth $token")
    }

    fun send(command: String) {
        writer.write(command + "\n")
        writer.flush()
        answer()
    }

    private fun answer() {
        while (true) {
            val line = reader.readLine() ?: throw AssertionError("The emulator's console closed")
            if (line == "OK") return
            if (line.startsWith("KO")) throw AssertionError("The emulator's console: $line")
        }
    }

    override fun close() = socket.close()

    private companion object {
        const val TIMEOUT_MILLIS = 10_000
    }
}
