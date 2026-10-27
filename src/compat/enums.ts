// The constants of react-native-keychain 10, with its names and its strings, so that `Keychain.ACCESS_CONTROL.BIOMETRY_ANY`
// and `import { ACCESSIBLE } from 'react-native-keychain'` keep working. They are plain objects with a type of the same name
// (rnk has TypeScript enums). Some of them name what this package doesn't do (`ACCESSIBLE.ALWAYS`,
// `ACCESS_CONTROL.APPLICATION_PASSWORD`, every `STORAGE_TYPE`): passing one is an `UNSUPPORTED` error.

/** When an item can be read: the `accessible` option of `setGenericPassword` and the like. */
export const ACCESSIBLE = {
  /** `whenUnlocked`. */
  WHEN_UNLOCKED: 'AccessibleWhenUnlocked',
  /** `afterFirstUnlock`, the default. */
  AFTER_FIRST_UNLOCK: 'AccessibleAfterFirstUnlock',
  /** Deprecated by iOS, and not supported here: `UNSUPPORTED`. Use `AFTER_FIRST_UNLOCK`. */
  ALWAYS: 'AccessibleAlways',
  /** `whenPasscodeSetThisDeviceOnly`. */
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'AccessibleWhenPasscodeSetThisDeviceOnly',
  /** `whenUnlockedThisDeviceOnly`. */
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly',
  /** `afterFirstUnlockThisDeviceOnly`. */
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AccessibleAfterFirstUnlockThisDeviceOnly',
} as const;
export type ACCESSIBLE = (typeof ACCESSIBLE)[keyof typeof ACCESSIBLE];

/** What unlocks an item: the `accessControl` option. */
export const ACCESS_CONTROL = {
  /** `biometryAnyOrPasscode`: a biometry, or the device passcode. */
  USER_PRESENCE: 'UserPresence',
  /** `biometryAny`. */
  BIOMETRY_ANY: 'BiometryAny',
  /** `biometryCurrentSet`. */
  BIOMETRY_CURRENT_SET: 'BiometryCurrentSet',
  /** `passcode`. */
  DEVICE_PASSCODE: 'DevicePasscode',
  /** Not supported here: `UNSUPPORTED`. */
  APPLICATION_PASSWORD: 'ApplicationPassword',
  /** `biometryAnyOrPasscode`. */
  BIOMETRY_ANY_OR_DEVICE_PASSCODE: 'BiometryAnyOrDevicePasscode',
  /** `biometryCurrentSetOrPasscode`. */
  BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE: 'BiometryCurrentSetOrDevicePasscode',
} as const;
export type ACCESS_CONTROL = (typeof ACCESS_CONTROL)[keyof typeof ACCESS_CONTROL];

/** What `canImplyAuthentication` asks about. */
export const AUTHENTICATION_TYPE = {
  /** A biometry or the device passcode. The default. */
  DEVICE_PASSCODE_OR_BIOMETRICS: 'AuthenticationWithBiometricsDevicePasscode',
  /** An enrolled biometry. */
  BIOMETRICS: 'AuthenticationWithBiometrics',
} as const;
export type AUTHENTICATION_TYPE = (typeof AUTHENTICATION_TYPE)[keyof typeof AUTHENTICATION_TYPE];

/** (Android) How well a key is kept: the `securityLevel` option, and what `getSecurityLevel` answers. */
export const SECURITY_LEVEL = {
  /** No requirement. */
  ANY: 'ANY',
  /** The key is in software only. */
  SECURE_SOFTWARE: 'SECURE_SOFTWARE',
  /** The key is in secure hardware, the TEE or StrongBox. As an option it fails with `HARDWARE_UNAVAILABLE` on a device without it. */
  SECURE_HARDWARE: 'SECURE_HARDWARE',
} as const;
export type SECURITY_LEVEL = (typeof SECURITY_LEVEL)[keyof typeof SECURITY_LEVEL];

/** The biometry of the device, as `getSupportedBiometryType` answers. */
export const BIOMETRY_TYPE = {
  /** iOS. */
  TOUCH_ID: 'TouchID',
  /** iOS. */
  FACE_ID: 'FaceID',
  /** iOS (visionOS). */
  OPTIC_ID: 'OpticID',
  /** Android. */
  FINGERPRINT: 'Fingerprint',
  /** Android. */
  FACE: 'Face',
  /** Android. */
  IRIS: 'Iris',
} as const;
export type BIOMETRY_TYPE = (typeof BIOMETRY_TYPE)[keyof typeof BIOMETRY_TYPE];

/**
 * (Android) The cipher of the `storage` option, and what a result names as `storage`. The package chooses its cipher
 * (AES-GCM in the Keystore) and takes no choice: passing `storage` is an `UNSUPPORTED` error.
 */
export const STORAGE_TYPE = {
  AES_CBC: 'KeystoreAESCBC',
  AES_GCM_NO_AUTH: 'KeystoreAESGCM_NoAuth',
  AES_GCM: 'KeystoreAESGCM',
  RSA: 'KeystoreRSAECB',
} as const;
export type STORAGE_TYPE = (typeof STORAGE_TYPE)[keyof typeof STORAGE_TYPE];
