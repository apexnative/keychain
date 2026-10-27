/**
 * Why a call failed: the error codes. The constants are the strings, so `KeychainErrorCode.KeyInvalidated` is
 * `'KEY_INVALIDATED'`; both forms are accepted wherever a code is.
 *
 * ```ts
 * if (isKeychainError(error, KeychainErrorCode.KeyInvalidated)) signInAgain();
 * ```
 */
export const KeychainErrorCode = {
  /**
   * The user canceled the prompt. On Android 16 a prompt that was open when the app went to the background ends the
   * same way: it can't be told from the user's cancel.
   */
  UserCanceled: 'USER_CANCELED',
  /** The user tapped the fallback button of the prompt (iOS). */
  UserFallback: 'USER_FALLBACK',
  /**
   * The system closed the prompt: the app went to the background, a call came. (Android 16 reports the background as
   * `USER_CANCELED`.)
   */
  SystemCanceled: 'SYSTEM_CANCELED',
  /** The biometry wasn't recognized (iOS). */
  AuthFailed: 'AUTH_FAILED',
  /** Too many attempts: the biometry is locked for a while. */
  Lockout: 'LOCKOUT',
  /** The biometry is locked until the user enters the passcode (Android). */
  LockoutPermanent: 'LOCKOUT_PERMANENT',
  /** No biometry is enrolled: the device can't do the access control. */
  BiometryNotEnrolled: 'BIOMETRY_NOT_ENROLLED',
  /** The device has no biometric sensor, or it is unavailable: it can't do the access control. */
  BiometryNotAvailable: 'BIOMETRY_NOT_AVAILABLE',
  /** The device has no passcode, PIN or pattern: it can't do the access control. */
  PasscodeNotSet: 'PASSCODE_NOT_SET',
  /** The enrolled biometry changed: the item was deleted, sign the user in again. */
  KeyInvalidated: 'KEY_INVALIDATED',
  /** The device is locked, or the app is in the background, and the item is `whenUnlocked`. */
  InteractionNotAllowed: 'INTERACTION_NOT_ALLOWED',
  /** A synchronous read of an item that needs a prompt. */
  AuthRequired: 'AUTH_REQUIRED',
  /** An `accessGroup` the app has no entitlement for (iOS). */
  MissingEntitlement: 'MISSING_ENTITLEMENT',
  /**
   * `NSFaceIDUsageDescription` is missing from Info.plist (iOS): a biometric access control can't be used, nor can
   * `canUseAccessControl` answer for it.
   */
  MissingUsageDescription: 'MISSING_USAGE_DESCRIPTION',
  /** `strongboxRequired` on a device without StrongBox (Android). */
  HardwareUnavailable: 'HARDWARE_UNAVAILABLE',
  /** No activity to show the prompt in (Android). */
  NoActivity: 'NO_ACTIVITY',
  /** The option isn't available on this OS or platform, or the native module isn't in the app. */
  Unsupported: 'UNSUPPORTED',
  /**
   * A key, a value or options that aren't valid: a string with U+0000 (React Native cuts it on the bridge;
   * `setBytes` takes any byte), or bytes read as text that aren't UTF-8.
   */
  InvalidArgument: 'INVALID_ARGUMENT',
  /** The stored value can't be decrypted, and not because the key was invalidated. */
  DataCorrupted: 'DATA_CORRUPTED',
  /** Anything else; `nativeCode` and `nativeDomain` say more. */
  Unknown: 'UNKNOWN',
} as const;

/**
 * Why a call failed.
 *
 * - `USER_CANCELED` — the user canceled the prompt (on Android 16 also: the app went to the background with the prompt
 *   open). `USER_FALLBACK` — the user tapped the fallback button (iOS, `biometryAny`).
 * - `SYSTEM_CANCELED` — the system closed the prompt: the app went to the background, a call came.
 * - `AUTH_FAILED` — the biometry wasn't recognized (iOS).
 * - `LOCKOUT` — too many attempts, biometry is locked for a while. `LOCKOUT_PERMANENT` — locked until the user
 *   enters the passcode (Android).
 * - `BIOMETRY_NOT_ENROLLED`, `BIOMETRY_NOT_AVAILABLE`, `PASSCODE_NOT_SET` — the device can't do the access control.
 * - `KEY_INVALIDATED` — the enrolled biometry changed: the item was deleted, sign the user in again.
 * - `INTERACTION_NOT_ALLOWED` — the device is locked, or the app is in the background, and the item is
 *   `whenUnlocked`.
 * - `AUTH_REQUIRED` — a synchronous read of an item that needs a prompt.
 * - `MISSING_ENTITLEMENT` — an `accessGroup` the app has no entitlement for (iOS).
 * - `MISSING_USAGE_DESCRIPTION` — `NSFaceIDUsageDescription` is missing from Info.plist (iOS); also the answer of
 *   `canUseAccessControl` for a biometric access control.
 * - `HARDWARE_UNAVAILABLE` — `strongboxRequired` on a device without StrongBox (Android).
 * - `NO_ACTIVITY` — no activity to show the prompt in (Android).
 * - `UNSUPPORTED` — the option isn't available on this OS or platform, or the native module isn't in the app.
 * - `INVALID_ARGUMENT` — a key, a value or options that aren't valid: a string with U+0000 (React Native cuts it on
 *   the bridge; `setBytes` takes any byte), or bytes read as text that aren't UTF-8.
 * - `DATA_CORRUPTED` — the stored value can't be decrypted, and not because the key was invalidated.
 * - `UNKNOWN` — anything else; `nativeCode` and `nativeDomain` say more.
 */
export type KeychainErrorCode = (typeof KeychainErrorCode)[keyof typeof KeychainErrorCode];

/** Every code a `KeychainError` can have, derived from `KeychainErrorCode`: the one list. */
export const KEYCHAIN_ERROR_CODES: readonly KeychainErrorCode[] = Object.values(KeychainErrorCode);

const CODES: ReadonlySet<string> = new Set(KEYCHAIN_ERROR_CODES);

/** Whether a string is a code of `KeychainErrorCode`. */
export function isKeychainErrorCode(code: unknown): code is KeychainErrorCode {
  return typeof code === 'string' && CODES.has(code);
}

/** The details of a `KeychainError` from the native side. */
export type KeychainErrorDetails = {
  /** The native code: an iOS `OSStatus` or `LAError`, an Android `BiometricPrompt` code. */
  nativeCode?: number;
  /** Where `nativeCode` comes from, such as `NSOSStatusErrorDomain`. */
  nativeDomain?: string;
  /** The error this one was made from. */
  cause?: unknown;
};

/** The error of every failed call of the package; `code` says why. */
export class KeychainError extends Error {
  /** Why the call failed. */
  readonly code: KeychainErrorCode;
  /** The native code: an iOS `OSStatus` or `LAError`, an Android `BiometricPrompt` code. */
  readonly nativeCode?: number;
  /** Where `nativeCode` comes from, such as `NSOSStatusErrorDomain`. */
  readonly nativeDomain?: string;

  constructor(code: KeychainErrorCode, message: string, details: KeychainErrorDetails = {}) {
    super(message);
    // `instanceof` holds however the class is compiled.
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'KeychainError';
    this.code = code;
    if (details.nativeCode !== undefined) this.nativeCode = details.nativeCode;
    if (details.nativeDomain !== undefined) this.nativeDomain = details.nativeDomain;
    if (details.cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        value: details.cause,
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }
  }
}

/** Whether a value is a `KeychainError`, optionally with the code. */
export function isKeychainError(error: unknown, code?: KeychainErrorCode): error is KeychainError {
  return error instanceof KeychainError && (code === undefined || error.code === code);
}

/** An `INVALID_ARGUMENT` error. */
export function invalidArgument(message: string): KeychainError {
  return new KeychainError('INVALID_ARGUMENT', message);
}

type NativeRejection = {
  code?: unknown;
  message?: unknown;
  userInfo?: unknown;
  nativeCode?: unknown;
  nativeDomain?: unknown;
};

const numberOrUndefined = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const stringOrUndefined = (value: unknown) =>
  typeof value === 'string' && value !== '' ? value : undefined;

/**
 * A `KeychainError` from what a native call threw: a promise's rejection (`code`, `message` and
 * `userInfo.nativeCode` / `userInfo.nativeDomain`) or a synchronous method's `Failure`. A code the package doesn't know
 * becomes `UNKNOWN`.
 */
export function toKeychainError(error: unknown): KeychainError {
  if (error instanceof KeychainError) return error;
  if (typeof error !== 'object' || error === null) {
    return new KeychainError('UNKNOWN', String(error), { cause: error });
  }
  const rejection = error as NativeRejection;
  const userInfo =
    typeof rejection.userInfo === 'object' && rejection.userInfo !== null
      ? (rejection.userInfo as NativeRejection)
      : {};
  const message =
    typeof rejection.message === 'string' && rejection.message !== ''
      ? rejection.message
      : 'The keychain call failed.';
  const code = isKeychainErrorCode(rejection.code) ? rejection.code : 'UNKNOWN';
  return new KeychainError(code, message, {
    nativeCode: numberOrUndefined(rejection.nativeCode ?? userInfo.nativeCode),
    nativeDomain: stringOrUndefined(rejection.nativeDomain ?? userInfo.nativeDomain),
    cause: error,
  });
}
