import { createApi } from './api';
import { nativeModule } from './native/module';
import type {
  AccessControl,
  AccessControlAvailability,
  BiometryType,
  HardwareSecurityLevel,
  Keychain,
  KeychainOptions,
} from './types';

const api = createApi(nativeModule);

/**
 * The default store: its service is the bundle identifier on iOS and the application id on Android, its options the
 * defaults (`afterFirstUnlock`, no access control).
 *
 * ```ts
 * await keychain.setItem('accessToken', token);
 * const token = await keychain.getItem('accessToken'); // string | null
 * ```
 */
export const keychain: Keychain = api.keychain;

/**
 * A store with options of its own: its service, and the defaults of its calls. Throws `INVALID_ARGUMENT` on options
 * that aren't valid; it doesn't touch the keychain.
 *
 * ```ts
 * const vault = createKeychain({
 *   service: 'vault',
 *   accessible: 'whenUnlockedThisDeviceOnly',
 *   accessControl: 'biometryCurrentSet',
 *   prompt: { title: 'Unlock the vault' },
 * });
 * ```
 */
export function createKeychain(options?: KeychainOptions): Keychain {
  return api.createKeychain(options);
}

/**
 * The biometric modalities of the device that can unlock a key, enrolled or not; empty without biometric hardware.
 * Android may have several and doesn't say which one its prompt will use. Never shows a prompt.
 */
export function getBiometryTypes(): Promise<BiometryType[]> {
  return api.getBiometryTypes();
}

/**
 * Whether an item can be written with the access control on this device now, and why not when it can't. Never shows
 * a prompt.
 *
 * `biometryCurrentSet` and `biometryCurrentSetOrPasscode` need an enrolled biometry (`notEnrolled` without one, the
 * passcode doesn't make up for it). When several reasons are true the answer is the first of `unsupportedOS`,
 * `noHardware`, `passcodeNotSet`, `notEnrolled`. A temporary lockout of the biometry doesn't make an access control unavailable: it
 * answers `available`, and a read shows the lockout as `LOCKOUT`.
 *
 * On iOS a biometric access control rejects with `MISSING_USAGE_DESCRIPTION` when the app has no
 * `NSFaceIDUsageDescription` in its Info.plist (a device with Face ID): the question can't be answered, and writing
 * would fail the same way.
 */
export function canUseAccessControl(
  accessControl: AccessControl
): Promise<AccessControlAvailability> {
  return api.canUseAccessControl(accessControl);
}

/** Whether the device has a passcode, PIN or pattern. */
export function isPasscodeSet(): Promise<boolean> {
  return api.isPasscodeSet();
}

/**
 * An opaque token that changes when the enrolled biometry changes, or `null` without biometry. Store it to notice a
 * new finger or face before a read throws `KEY_INVALIDATED`.
 */
export function getBiometryState(): Promise<string | null> {
  return api.getBiometryState();
}

/** Where new Keystore keys live on Android: `strongbox`, `tee` or `software`. Always `null` on iOS. */
export function getHardwareSecurityLevel(): Promise<HardwareSecurityLevel | null> {
  return api.getHardwareSecurityLevel();
}

export {
  Accessible,
  AccessControl,
  BiometryType,
  HardwareSecurityLevel,
  KeyStorage,
} from './constants';
export { KeychainError, KeychainErrorCode, isKeychainError } from './errors';
export type { KeychainErrorDetails } from './errors';
export type {
  AccessControlAvailability,
  AndroidOptions,
  Credentials,
  CredentialsOptions,
  GetOptions,
  ItemInfo,
  Keychain,
  KeychainOptions,
  Prompt,
  SetOptions,
} from './types';
