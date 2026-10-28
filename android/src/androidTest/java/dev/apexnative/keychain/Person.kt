package dev.apexnative.keychain

import android.app.KeyguardManager
import android.app.admin.DevicePolicyManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.Direction
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import java.io.ByteArrayOutputStream
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

    /**
     * How many times the sensor recognized a finger, and didn't: the fingerprint service's counters, which it keeps
     * from Android 8 ([counts]).
     */
    fun recognitions() = counter("accept") + counter("acceptCrypto")

    fun rejections() = counter("reject") + counter("rejectCrypto")

    val counts: Boolean get() = shell("dumpsys fingerprint").contains("\"accept\"")

    private fun counter(name: String) =
        Regex("\"$name\":(\\d+)").find(shell("dumpsys fingerprint"))?.groupValues?.get(1)?.toInt() ?: 0

    /** The prompt titled [title], once it shows. */
    fun prompt(title: String): UiObject2 = find(text(title), "a prompt titled '$title'")

    /** Whether a prompt titled [title] shows within [millis]. */
    fun sees(title: String, millis: Long = GLANCE_MILLIS) = ui.wait(Until.hasObject(text(title)), millis)

    /** Waits until no prompt titled [title] shows. */
    fun promptGone(title: String) {
        if (!ui.wait(Until.gone(text(title)), PATIENCE_MILLIS)) fail("The prompt '$title' is still showing")
    }

    fun tap(text: String) = find(text(text), "a button '$text'").click()

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

    /**
     * A PIN for the screen lock, on a device that has none: `locksettings` from Android 8, before it Settings, as a
     * person sets it.
     */
    fun setPin() {
        if (keyguard.isDeviceSecure) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            shell("locksettings set-pin ${Setup.pin}")
        } else {
            context.startActivity(
                Intent(DevicePolicyManager.ACTION_SET_NEW_PASSWORD).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            find(By.text("PIN"), "the PIN among the screen locks").click()
            // The PIN, and the PIN again.
            repeat(2) {
                find(PIN_FIELD, "a field for the PIN")
                typePin()
                Thread.sleep(STEP_MILLIS)
            }
            find(By.text(Pattern.compile("done", Pattern.CASE_INSENSITIVE)), "Done").click()
        }
        waitUntil("the device has the PIN") { keyguard.isDeviceSecure }
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
            // The keyguard goes first; the device counts as unlocked a moment later.
            if (eventually { !keyguard.isKeyguardLocked && !keyguard.isDeviceLocked }) return
        }
        fail("The screen didn't unlock with the PIN")
    }

    /**
     * Enrolls fingers in Settings, as a person does: the PIN, the consent, each finger on the sensor until it's added,
     * Add another for the next. Returns the names Settings gives them. All in one visit: leaving Settings revokes the
     * challenge the next enrollment would be given, and the sensor then ignores the finger (Android 11).
     */
    fun enrollFingers(ids: List<Int>): List<String> {
        // With no finger yet, the enrollment itself: the list would hand it over and close.
        val first = shell("dumpsys fingerprint").contains("\"count\":0")
        val before = if (first) {
            settings(ENROLL)
            emptyList()
        } else {
            settings(FINGERPRINTS)
            fingerNames().also { find(ADD, "the button that adds a fingerprint").click() }
        }
        var pinTyped = false
        ids.forEachIndexed { index, id ->
            val deadline = SystemClock.uptimeMillis() + ENROLL_MILLIS
            while (!ui.hasObject(ADDED)) {
                if (SystemClock.uptimeMillis() > deadline) fail("Settings didn't add the finger: ${screen()}")
                when {
                    !pinTyped && ui.hasObject(PIN_FIELD) -> {
                        typePin()
                        pinTyped = true
                    }
                    ui.hasObject(TOUCH_THE_SENSOR) -> touch(id)
                    ui.hasObject(NEXT) -> ui.findObject(NEXT).click()
                }
                Thread.sleep(STEP_MILLIS)
            }
            val next = if (index < ids.lastIndex) "add another" else "done"
            find(By.text(Pattern.compile(next, Pattern.CASE_INSENSITIVE)), "'$next'").click()
            if (!ui.wait(Until.gone(ADDED), PATIENCE_MILLIS)) fail("Settings stays on the finger added")
        }
        // The list, for the names: after the first fingers Settings leaves, and it's opened again.
        if (!ui.wait(Until.hasObject(FINGER), GLANCE_MILLIS)) settings(FINGERPRINTS)
        waitUntil("the list shows the new fingers") { fingerNames().size == before.size + ids.size }
        val added = fingerNames() - before.toSet()
        ui.pressBack()
        if (added.size != ids.size) fail("Settings enrolled ${added.size} fingers: $added")
        return added
    }

    /** Deletes the finger [name] in Settings: its row's delete button, or on Android 7 the row's own dialog. */
    fun deleteFinger(name: String) {
        settings(FINGERPRINTS)
        val finger = find(By.res("android", "title").text(name), "'$name' among the fingerprints")
        (ui.findObjects(DELETE_BUTTON).firstOrNull { nameOfRow(it) == name } ?: finger).click()
        // 'Delete', or 'Yes, remove', once or twice.
        val confirm = By.clazz("android.widget.Button")
            .text(Pattern.compile("delete|remove|yes, remove", Pattern.CASE_INSENSITIVE))
        find(confirm, "the button that deletes it").click()
        val gone = By.res("android", "title").text(name)
        if (!ui.wait(Until.gone(gone), GLANCE_MILLIS)) ui.findObject(confirm)?.click()
        if (!ui.wait(Until.gone(gone), PATIENCE_MILLIS)) fail("'$name' wasn't deleted: ${screen()}")
        ui.pressBack()
    }

    // The enrolled fingers in Settings' list, which names them 'Finger 1', 'Finger 2', ….
    private fun fingerNames(): List<String> = ui.findObjects(FINGER).map { it.text }

    // The name in the row of a delete button: the nearest title above it.
    private fun nameOfRow(button: UiObject2): String? {
        var row = button.parent
        while (row != null && !row.hasObject(By.res("android", "title"))) row = row.parent
        return row?.findObject(By.res("android", "title"))?.text
    }

    // A screen of Settings, which asks for the PIN first.
    private fun settings(action: String) {
        if (!start(action)) {
            // Before Android 10 the list has no action of its own, and before Android 9 the enrollment neither:
            // Security, then Fingerprint.
            assumeTrue("Settings has no '$action' nor security settings here", start(Settings.ACTION_SECURITY_SETTINGS))
            val entry = By.text(Pattern.compile("fingerprint", Pattern.CASE_INSENSITIVE))
            val list = ui.wait(Until.findObject(By.scrollable(true)), PATIENCE_MILLIS)
            val found = ui.findObject(entry) ?: list?.scrollUntil(Direction.DOWN, Until.findObject(entry))
            (found ?: find(entry, "Fingerprint in the security settings")).click()
        }
        // The PIN, when Settings asks for it: not right after it was set.
        waitUntil("Settings") { ui.hasObject(PIN_FIELD) || ui.hasObject(ADD) || ui.hasObject(NEXT) }
        if (!ui.hasObject(PIN_FIELD) && !ui.wait(Until.hasObject(PIN_FIELD), GLANCE_MILLIS)) return
        typePin()
        if (!ui.wait(Until.gone(PIN_FIELD), PATIENCE_MILLIS)) fail("Settings didn't take the PIN")
    }

    // A text as it shows: buttons are in capitals before Android 12.
    private fun text(text: String) = By.text(Pattern.compile(Pattern.quote(text), Pattern.CASE_INSENSITIVE))

    private fun start(action: String): Boolean = try {
        context.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        true
    } catch (e: ActivityNotFoundException) {
        false
    }

    private fun typePin() {
        shell("input text ${Setup.pin}")
        ui.pressEnter()
    }

    private fun find(selector: BySelector, what: String): UiObject2 =
        ui.wait(Until.findObject(selector), PATIENCE_MILLIS) ?: run {
            fail("No $what on the screen: ${screen()}")
            throw AssertionError()
        }

    /** What the screen says: its texts and descriptions, for a failure's message. */
    fun screen(): String {
        val hierarchy = ByteArrayOutputStream().also { ui.dumpWindowHierarchy(it) }.toString()
        return Regex("""(?:text|content-desc)="([^"]+)"""").findAll(hierarchy).map { it.groupValues[1] }.toList()
            .joinToString(" | ")
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

    private const val FINGERPRINTS = "android.settings.FINGERPRINT_SETTINGS"
    private const val ENROLL = "android.settings.FINGERPRINT_ENROLL"
    private val PIN_FIELD = By.clazz("android.widget.EditText")
    private val DELETE_BUTTON = By.res("com.android.settings", "delete_button")
    private val FINGER = By.res("android", "title").text(Pattern.compile("Finger \\d+"))
    private val ADD = By.text(Pattern.compile("add fingerprint|add", Pattern.CASE_INSENSITIVE))
    private val ADDED = By.text(Pattern.compile(".*fingerprint added.*", Pattern.CASE_INSENSITIVE))
    private val TOUCH_THE_SENSOR =
        By.text(Pattern.compile(".*(touch the sensor|touch again|put your finger|lift).*", Pattern.CASE_INSENSITIVE))
    // A button, or before Android 8 an item of a list.
    private val NEXT = By.pkg("com.android.settings")
        .text(Pattern.compile("more|i agree|agree|next|start|continue", Pattern.CASE_INSENSITIVE))
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
