package dev.apexnative.keychain

import android.app.KeyguardManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.biometric.BiometricManager

/** What the storage asks the device; tests replace it to play a locked device or an older Android. */
internal interface Device {
    /** The API level the storage behaves for: `Build.VERSION.SDK_INT`, never more. */
    val sdk: Int

    /** Whether the device has a PIN, a pattern or a password. */
    val isSecure: Boolean

    /** Whether the device is locked now and needs its PIN, pattern or password to unlock. */
    val isLocked: Boolean

    /** Whether the Keystore has StrongBox (API 28+). */
    val hasStrongBox: Boolean

    /** The biometric modalities the device has a sensor for, whatever their class. */
    val biometricSensors: List<BiometryType>

    /** `BiometricManager.canAuthenticate`: a `BIOMETRIC_*` status of the authenticators. */
    fun canAuthenticate(authenticators: Int): Int
}

internal class SystemDevice(private val context: Context) : Device {
    private val keyguard: KeyguardManager
        get() = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager

    override val sdk: Int get() = Build.VERSION.SDK_INT

    override val isSecure: Boolean get() = keyguard.isDeviceSecure

    override val isLocked: Boolean get() = keyguard.isDeviceLocked

    override val hasStrongBox: Boolean by lazy {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
            context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)
    }

    override val biometricSensors: List<BiometryType> by lazy {
        val features = context.packageManager
        listOfNotNull(
            BiometryType.FINGERPRINT.takeIf { features.hasSystemFeature(PackageManager.FEATURE_FINGERPRINT) },
            BiometryType.FACE.takeIf {
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && features.hasSystemFeature(PackageManager.FEATURE_FACE)
            },
            BiometryType.IRIS.takeIf {
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && features.hasSystemFeature(PackageManager.FEATURE_IRIS)
            },
        )
    }

    override fun canAuthenticate(authenticators: Int): Int =
        BiometricManager.from(context).canAuthenticate(authenticators)
}
