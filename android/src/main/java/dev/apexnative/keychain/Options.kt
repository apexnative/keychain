package dev.apexnative.keychain

import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType

/** An option's value with its name in src/native/NativeApexKeychain.ts, which the file stores too. */
internal interface Named {
    val jsName: String
}

/** The value of an enum by its name; a name native doesn't know is INVALID_ARGUMENT, never a guess. */
internal inline fun <reified E> enumOf(what: String, name: String): E where E : Enum<E>, E : Named =
    enumValues<E>().firstOrNull { it.jsName == name } ?: throw invalidArgument("Invalid $what: '$name'.")

/** When an item can be read. */
internal enum class Accessible(override val jsName: String) : Named {
    AFTER_FIRST_UNLOCK("afterFirstUnlock"),
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY("afterFirstUnlockThisDeviceOnly"),
    WHEN_UNLOCKED("whenUnlocked"),
    WHEN_UNLOCKED_THIS_DEVICE_ONLY("whenUnlockedThisDeviceOnly"),
    WHEN_PASSCODE_SET_THIS_DEVICE_ONLY("whenPasscodeSetThisDeviceOnly");

    /** Whether the item works only while the device is unlocked: iOS's `WhenPasscodeSet` is `WhenUnlocked` too. */
    val needsUnlockedDevice: Boolean get() = this != AFTER_FIRST_UNLOCK && this != AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
}

/** What unlocks an item. */
internal enum class AccessControl(override val jsName: String) : Named {
    NONE("none"),
    BIOMETRY_ANY("biometryAny"),
    BIOMETRY_CURRENT_SET("biometryCurrentSet"),
    BIOMETRY_ANY_OR_PASSCODE("biometryAnyOrPasscode"),
    BIOMETRY_CURRENT_SET_OR_PASSCODE("biometryCurrentSetOrPasscode"),
    PASSCODE("passcode");

    /** Whether biometry unlocks the item. */
    val allowsBiometry: Boolean get() = this != NONE && this != PASSCODE

    /** Whether the device's passcode unlocks the item; Android 11+ only. */
    val allowsPasscode: Boolean
        get() = this == BIOMETRY_ANY_OR_PASSCODE || this == BIOMETRY_CURRENT_SET_OR_PASSCODE || this == PASSCODE

    /** Whether a change of the enrolled biometrics invalidates the item. */
    val currentSet: Boolean get() = this == BIOMETRY_CURRENT_SET || this == BIOMETRY_CURRENT_SET_OR_PASSCODE
}

/** Where an item's Keystore key should live, as asked. */
internal enum class KeyStorage(override val jsName: String) : Named {
    TEE("tee"),
    STRONGBOX("strongbox"),
    STRONGBOX_REQUIRED("strongboxRequired"),
}

/** The hardware that holds a Keystore key, as `getItemInfo` reports it. */
internal enum class SecurityLevel(override val jsName: String) : Named {
    STRONGBOX("strongbox"),
    TEE("tee"),
    SOFTWARE("software"),
}

/** A biometric modality that can unlock a key; Android's three of the contract's `BiometryType`. */
internal enum class BiometryType(override val jsName: String) : Named {
    FINGERPRINT("fingerprint"),
    FACE("face"),
    IRIS("iris"),
}

/**
 * Why an access control can't protect an item now (`UnavailableReason`). A lockout isn't one: writing still works, and
 * `BiometricManager` reports a locked-out sensor as available; the read's prompt ends with LOCKOUT.
 */
internal enum class UnavailableReason(override val jsName: String) : Named {
    NO_HARDWARE("noHardware"),
    NOT_ENROLLED("notEnrolled"),
    PASSCODE_NOT_SET("passcodeNotSet"),
    UNSUPPORTED_OS("unsupportedOS"),
}

/** How a value crosses as a string: the text itself, or the Base64 of the bytes. */
internal enum class Encoding(override val jsName: String) : Named {
    UTF8("utf8"),
    BASE64("base64"),
}

/** How an item is written (`WriteOptions`), complete: JavaScript filled in the defaults. */
internal data class WriteOptions(
    val accessible: Accessible,
    val accessControl: AccessControl,
    /** Seconds; 0 with [AccessControl.NONE]. */
    val authValidity: Int,
    val keyStorage: KeyStorage,
    val label: String?,
) {
    companion object {
        /** `synchronizable` is iOS's: Android ignores it. */
        fun of(options: ReadableMap) = WriteOptions(
            accessible = enumOf("accessible", options.requireString("accessible")),
            accessControl = enumOf("accessControl", options.requireString("accessControl")),
            authValidity = options.requireWholeNumber("authValidity"),
            keyStorage = enumOf("keyStorage", options.requireString("keyStorage")),
            label = options.optionalString("label"),
        )
    }
}

/** The texts of a protected read's prompt (`Prompt`); a text that is absent takes the default. */
internal data class PromptTexts(
    val title: String?,
    val subtitle: String?,
    val description: String?,
    /** The negative button, only without a passcode fallback. */
    val cancel: String?,
    val confirmationRequired: Boolean,
) {
    companion object {
        fun of(prompt: ReadableMap) = PromptTexts(
            title = prompt.optionalString("title"),
            subtitle = prompt.optionalString("subtitle"),
            description = prompt.optionalString("description"),
            cancel = prompt.optionalString("cancel"),
            confirmationRequired = prompt.requireBoolean("confirmationRequired"),
        )
    }
}

/** The service of a `Store`; `accessGroup` is iOS's. */
internal fun ReadableMap.service(): String = requireString("service")

internal fun encodingOf(name: String): Encoding = enumOf("encoding", name)

internal fun ReadableMap.requireString(name: String): String = optionalString(name)
    ?: throw invalidArgument("Invalid options: '$name' should be a string.")

private fun ReadableMap.optionalString(name: String): String? = when {
    !hasKey(name) || getType(name) == ReadableType.Null -> null
    getType(name) == ReadableType.String -> getString(name)
    else -> throw invalidArgument("Invalid options: '$name' should be a string.")
}

internal fun ReadableMap.requireBoolean(name: String): Boolean =
    if (hasKey(name) && getType(name) == ReadableType.Boolean) {
        getBoolean(name)
    } else {
        throw invalidArgument("Invalid options: '$name' should be a boolean.")
    }

/** An array of strings, as `ReadonlyArray<string>` crosses. */
internal fun ReadableMap.requireStrings(name: String): List<String> {
    val array = if (hasKey(name) && getType(name) == ReadableType.Array) getArray(name) else null
    array ?: throw invalidArgument("Invalid options: '$name' should be an array of strings.")
    return (0 until array.size()).map { index ->
        if (array.getType(index) != ReadableType.String) {
            throw invalidArgument("Invalid options: '$name' should be an array of strings.")
        }
        array.getString(index) ?: ""
    }
}

private fun ReadableMap.requireWholeNumber(name: String): Int {
    val number = if (hasKey(name) && getType(name) == ReadableType.Number) getDouble(name) else Double.NaN
    if (number.isNaN() || number < 0 || number > Int.MAX_VALUE || number != Math.floor(number)) {
        throw invalidArgument("Invalid options: '$name' should be a whole number of seconds.")
    }
    return number.toInt()
}

internal fun invalidArgument(message: String) = KeychainException(KeychainErrorCode.INVALID_ARGUMENT, message)
