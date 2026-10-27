// The values of the string options, as constants: `AccessControl.BiometryCurrentSet` is `'biometryCurrentSet'`. Each is
// a plain object with the name of its union type (a TypeScript `enum` would reject the string literals the package
// has always taken, and a `const enum` doesn't survive Babel): both forms type-check, and a typo in a constant's name
// is an error at compile time, not a misspelt option at run time.
//
// The strings are the contract's (src/native/NativeApexKeychain.ts); a test keeps them equal.

/**
 * When an item can be read.
 *
 * ```ts
 * await keychain.setItem('token', token, { accessible: Accessible.WhenUnlockedThisDeviceOnly });
 * ```
 */
export const Accessible = {
  /**
   * From the first unlock after a restart until the next restart, in the background too. The default.
   */
  AfterFirstUnlock: 'afterFirstUnlock',
  /** `AfterFirstUnlock`, and the item stays out of iCloud and of encrypted iOS backups restored to another device. */
  AfterFirstUnlockThisDeviceOnly: 'afterFirstUnlockThisDeviceOnly',
  /** Only while the device is unlocked. */
  WhenUnlocked: 'whenUnlocked',
  /** `WhenUnlocked`, and the item stays out of iCloud and of encrypted iOS backups restored to another device. */
  WhenUnlockedThisDeviceOnly: 'whenUnlockedThisDeviceOnly',
  /**
   * Only while the device is unlocked and has a passcode; removing the passcode makes the item unreadable. Always this
   * device only. Writing fails with `PASSCODE_NOT_SET` on a device without a passcode.
   */
  WhenPasscodeSetThisDeviceOnly: 'whenPasscodeSetThisDeviceOnly',
} as const;

/**
 * When an item can be read.
 *
 * - `afterFirstUnlock` (the default): from the first unlock after a restart until the next restart, in the background
 *   too.
 * - `whenUnlocked`: only while the device is unlocked.
 * - `whenPasscodeSetThisDeviceOnly`: only while the device is unlocked and has a passcode; removing the passcode
 *   makes the item unreadable.
 *
 * The `…ThisDeviceOnly` variants keep the item out of iCloud and of encrypted iOS backups restored to another device.
 * On Android every item is this-device-only: Keystore keys never leave the device.
 *
 * The constants of the same name, `Accessible.WhenUnlocked` and the like, are these strings.
 */
export type Accessible = (typeof Accessible)[keyof typeof Accessible];

/**
 * What unlocks an item.
 *
 * ```ts
 * const vault = createKeychain({ service: 'vault', accessControl: AccessControl.BiometryCurrentSet });
 * ```
 */
export const AccessControl = {
  /** No authentication. The default. */
  None: 'none',
  /**
   * Any enrolled biometry, now or added later. Writing needs one: without it the write fails with
   * `BIOMETRY_NOT_ENROLLED` (`BIOMETRY_NOT_AVAILABLE` without a sensor), on both platforms.
   */
  BiometryAny: 'biometryAny',
  /**
   * The biometry enrolled when the item was written. Enrolling or removing a finger or a face invalidates the item:
   * reading it throws `KEY_INVALIDATED`. Not allowed with `authValidity` above 0. Writing needs an enrolled biometry:
   * without one the write fails with `BIOMETRY_NOT_ENROLLED` (`BIOMETRY_NOT_AVAILABLE` without a sensor), on both
   * platforms.
   */
  BiometryCurrentSet: 'biometryCurrentSet',
  /** `BiometryAny`, with the device passcode as a fallback (Android 11+: `UNSUPPORTED` before). */
  BiometryAnyOrPasscode: 'biometryAnyOrPasscode',
  /**
   * `BiometryCurrentSet`, with the device passcode as a fallback (Android 11+: `UNSUPPORTED` before). Not allowed with
   * `authValidity` above 0. Like `BiometryCurrentSet` it needs an enrolled biometry to be written: the passcode does
   * not make up for its absence (`BIOMETRY_NOT_ENROLLED`).
   */
  BiometryCurrentSetOrPasscode: 'biometryCurrentSetOrPasscode',
  /** The device passcode, PIN or pattern (Android 11+: `UNSUPPORTED` before). */
  Passcode: 'passcode',
} as const;

/**
 * What unlocks an item. Anything but `none` locks the value to a key the system releases only after the user
 * authenticates; reading shows the system prompt, writing never does.
 *
 * - `none` (the default): no authentication.
 * - `biometryAny`: any enrolled biometry, now or added later.
 * - `biometryCurrentSet`: the biometry enrolled when the item was written. Enrolling or removing a finger or a face
 *   invalidates the item: reading it throws `KEY_INVALIDATED`.
 * - `biometryAnyOrPasscode`, `biometryCurrentSetOrPasscode`: the same, with the device passcode as a fallback
 *   (Android 11+).
 * - `passcode`: the device passcode, PIN or pattern (Android 11+).
 *
 * Writing an item whose access control the device can't do fails, and the protection is never lowered instead:
 * `BIOMETRY_NOT_ENROLLED` (also for `biometryCurrentSet` and `biometryCurrentSetOrPasscode` without a biometry, the
 * passcode doesn't make up for it), `BIOMETRY_NOT_AVAILABLE`, `PASSCODE_NOT_SET`, `UNSUPPORTED` (the passcode variants
 * before Android 11); on iOS, a biometric access control without `NSFaceIDUsageDescription` is
 * `MISSING_USAGE_DESCRIPTION`. `canUseAccessControl` tells beforehand.
 *
 * The constants of the same name, `AccessControl.BiometryAny` and the like, are these strings.
 */
export type AccessControl = (typeof AccessControl)[keyof typeof AccessControl];

/**
 * Where an Android Keystore key lives (`android.keyStorage`). iOS ignores it.
 *
 * ```ts
 * await keychain.setItem('key', value, { android: { keyStorage: KeyStorage.Strongbox } });
 * ```
 */
export const KeyStorage = {
  /** The Trusted Execution Environment. The default. */
  Tee: 'tee',
  /** StrongBox when the device has one, else the TEE. */
  Strongbox: 'strongbox',
  /** StrongBox, or the error `HARDWARE_UNAVAILABLE` on a device without it. */
  StrongboxRequired: 'strongboxRequired',
} as const;

/**
 * Where an Android Keystore key lives: `tee` (the default) — the Trusted Execution Environment; `strongbox` —
 * StrongBox when the device has one, else the TEE; `strongboxRequired` — StrongBox or the error
 * `HARDWARE_UNAVAILABLE`. iOS ignores it.
 */
export type KeyStorage = (typeof KeyStorage)[keyof typeof KeyStorage];

/**
 * A biometric modality that can unlock a key, as `getBiometryTypes` reports it.
 *
 * ```ts
 * const hasFace = (await getBiometryTypes()).includes(BiometryType.FaceID);
 * ```
 */
export const BiometryType = {
  /** iOS: Face ID. */
  FaceID: 'faceID',
  /** iOS: Touch ID. */
  TouchID: 'touchID',
  /** iOS: Optic ID (Apple Vision Pro). */
  OpticID: 'opticID',
  /** Android: a fingerprint sensor (Class 3). */
  Fingerprint: 'fingerprint',
  /** Android: face recognition (Class 3). */
  Face: 'face',
  /** Android: iris recognition (Class 3). */
  Iris: 'iris',
} as const;

/**
 * A biometric modality that can unlock a key: `faceID`, `touchID`, `opticID` on iOS; `fingerprint`, `face`, `iris`
 * on Android (Class 3 only).
 */
export type BiometryType = (typeof BiometryType)[keyof typeof BiometryType];

/**
 * The hardware that keeps Keystore keys on Android, as `getHardwareSecurityLevel` and `getItemInfo` report it.
 *
 * ```ts
 * if ((await getHardwareSecurityLevel()) === HardwareSecurityLevel.Strongbox) { … }
 * ```
 */
export const HardwareSecurityLevel = {
  /** A StrongBox secure element. */
  Strongbox: 'strongbox',
  /** The Trusted Execution Environment. */
  Tee: 'tee',
  /** Software only: an emulator, or a device without secure hardware. */
  Software: 'software',
} as const;

/** The hardware that keeps Keystore keys on Android: `strongbox`, `tee` or `software`. */
export type HardwareSecurityLevel =
  (typeof HardwareSecurityLevel)[keyof typeof HardwareSecurityLevel];
