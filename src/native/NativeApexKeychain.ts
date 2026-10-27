import { TurboModuleRegistry, type TurboModule } from 'react-native';

/*
 * The native contract of @apexnative/keychain: the TurboModule `ApexKeychain`, the only way from JavaScript to the
 * native side. iOS (`ANKKeychainModule`, ios/) and Android (`KeychainModule`, android/) implement this one spec and
 * behave the same.
 *
 * What JavaScript has done before a call (src/options.ts):
 * - Every key, value and option is checked, the forbidden combinations included. The options of the instance
 *   and of the call are merged, the defaults are filled in: every required field below is there. Native still rejects
 *   a value it doesn't know with INVALID_ARGUMENT instead of guessing.
 * - `service` is never empty: the default store gets the value of `getDefaultService()`.
 * - `authValidity` is 0 whenever `accessControl` is 'none'.
 *
 * Errors:
 * - An asynchronous method rejects with `code`, one of `ErrorCode`, and a message in English. A native error code or
 *   status goes in the rejection's user info as `nativeCode` (a number) and `nativeDomain` (a string): iOS
 *   `reject(code, message, NSError)` with both keys in the error's userInfo, Android
 *   `promise.reject(code, message, throwable, userInfo)`. JavaScript turns the rejection into a `KeychainError`.
 * - A synchronous method never throws: it returns `{ error }` (a `Failure`), which JavaScript throws as a
 *   `KeychainError`. An exception that crossed JSI would lose its code on both platforms.
 * - A missing item is no error: `getItem` and `getItemInfo` resolve null, `hasItem` false, `removeItem` resolves.
 *
 * Values cross as strings. `Encoding` says how: 'utf8' — the string is the text, stored as its UTF-8 bytes; 'base64'
 * — the string is the standard Base64 of the bytes (RFC 4648 §4, with padding, no line breaks: Android's
 * `Base64.NO_WRAP`). An item is bytes on both platforms and remembers which of the two it was written with. A string
 * item read as 'base64' gives its UTF-8 bytes; a bytes item read as 'utf8' gives the bytes decoded as UTF-8, or
 * rejects with INVALID_ARGUMENT when they aren't valid UTF-8. Empty values are valid.
 *
 * Threads: an asynchronous method does its I/O and crypto off the JavaScript and main threads. A
 * synchronous method runs on the JavaScript thread and never shows a prompt.
 */

/** When an item can be read: iOS `kSecAttrAccessible…`; Android emulates them. */
export type Accessible =
  | 'afterFirstUnlock'
  | 'afterFirstUnlockThisDeviceOnly'
  | 'whenUnlocked'
  | 'whenUnlockedThisDeviceOnly'
  | 'whenPasscodeSetThisDeviceOnly';

/** What unlocks an item: iOS `SecAccessControlCreateFlags`, Android `KeyGenParameterSpec`. */
export type AccessControl =
  | 'none'
  | 'biometryAny'
  | 'biometryCurrentSet'
  | 'biometryAnyOrPasscode'
  | 'biometryCurrentSetOrPasscode'
  | 'passcode';

/** (Android) Where the item's Keystore key lives; iOS ignores it. */
export type KeyStorage = 'tee' | 'strongbox' | 'strongboxRequired';

/** (Android) The hardware that holds a Keystore key. */
export type SecurityLevel = 'strongbox' | 'tee' | 'software';

/** How a value crosses as a string: the text itself, or the Base64 of the bytes. */
export type Encoding = 'utf8' | 'base64';

/** A biometric modality that can unlock a key (Class 3 on Android). */
export type BiometryType = 'faceID' | 'touchID' | 'opticID' | 'fingerprint' | 'face' | 'iris';

/** Why an access control can't be used on this device now. */
export type UnavailableReason = 'noHardware' | 'notEnrolled' | 'passcodeNotSet' | 'unsupportedOS';

/** The error codes; src/errors.ts has the same list, which a test keeps equal. */
export type ErrorCode =
  | 'USER_CANCELED'
  | 'USER_FALLBACK'
  | 'SYSTEM_CANCELED'
  | 'AUTH_FAILED'
  | 'LOCKOUT'
  | 'LOCKOUT_PERMANENT'
  | 'BIOMETRY_NOT_ENROLLED'
  | 'BIOMETRY_NOT_AVAILABLE'
  | 'PASSCODE_NOT_SET'
  | 'KEY_INVALIDATED'
  | 'INTERACTION_NOT_ALLOWED'
  | 'AUTH_REQUIRED'
  | 'MISSING_ENTITLEMENT'
  | 'MISSING_USAGE_DESCRIPTION'
  | 'HARDWARE_UNAVAILABLE'
  | 'NO_ACTIVITY'
  | 'UNSUPPORTED'
  | 'INVALID_ARGUMENT'
  | 'DATA_CORRUPTED'
  | 'UNKNOWN';

/**
 * Where items live. iOS: `kSecAttrService` = `service`, and `kSecAttrAccessGroup` = `accessGroup` when it is there.
 * Android: one file per service; `accessGroup` is ignored.
 */
export type Store = {
  service: string;
  accessGroup?: string;
};

/**
 * How an item is written, complete: the defaults are filled in. A write replaces the whole item — value, label and
 * protection — atomically: when it fails, the old item stays. Writing never shows a prompt.
 */
export type WriteOptions = {
  accessible: Accessible;
  accessControl: AccessControl;
  /** Seconds one authentication unlocks the item for; 0 — every access. An integer, 0 with 'none'. */
  authValidity: number;
  /** iOS: iCloud Keychain. Android ignores it and reports false. */
  synchronizable: boolean;
  keyStorage: KeyStorage;
  /** A label that isn't secret, read without a prompt (`getItemInfo`). Absent: the item has no label. */
  label?: string;
};

/**
 * The texts of the prompt a protected read shows. A text that is absent takes the platform's default; a read of an
 * item without access control ignores the prompt.
 */
export type Prompt = {
  /** iOS: `LAContext.localizedReason`; Android: the title. */
  title?: string;
  /** Android only. */
  subtitle?: string;
  /** Android only. */
  description?: string;
  /** iOS: `localizedCancelTitle`; Android: the negative button (only without a passcode fallback). */
  cancel?: string;
  /** iOS: `localizedFallbackTitle`; '' hides the button. Android ignores it. */
  fallback?: string;
  /** Android: `setConfirmationRequired`; iOS ignores it. JavaScript's default is true. */
  confirmationRequired: boolean;
};

/** An item that was read: its value in the encoding asked for, and its label. */
export type Item = {
  value: string;
  label?: string;
};

/** What `getItemInfo` reports about an item, without a prompt. */
export type ItemInfo = {
  key: string;
  label?: string;
  accessible: Accessible;
  accessControl: AccessControl;
  /** Always false on Android. */
  synchronizable: boolean;
  /** Milliseconds since the Unix epoch. */
  createdAt: number;
  /** Milliseconds since the Unix epoch. */
  modifiedAt: number;
  /** Android only: where the item's key lives. */
  securityLevel?: SecurityLevel;
};

/** Whether an access control can protect an item on this device now; `reason` is there when it can't. */
export type Availability = {
  available: boolean;
  reason?: UnavailableReason;
};

/** The error a synchronous method returns instead of throwing. */
export type Failure = {
  code: ErrorCode;
  message: string;
  nativeCode?: number;
  nativeDomain?: string;
};

/** The answer of a synchronous method without a value. */
export type SyncResult = {
  error?: Failure;
};

/** The answer of `getItemSync`: `value` is absent when there is no item. */
export type SyncValueResult = {
  value?: string;
  error?: Failure;
};

/** The answer of `hasItemSync`: `value` is there unless `error` is. */
export type SyncBooleanResult = {
  value?: boolean;
  error?: Failure;
};

/** A library whose items `migrate` moves into a store. */
export type MigrationLibrary = 'reactNativeKeychain' | 'expoSecureStore';

/**
 * Where `getMigrationSources` looks: only where the query names — on iOS an item of
 * react-native-keychain can't be told from another SDK's.
 */
export type MigrationQuery = {
  library: MigrationLibrary;
  /**
   * react-native-keychain: the services of generic passwords; expo-secure-store: the `keychainService`s. Empty: the
   * library's default on the platform (react-native-keychain on iOS: the bundle identifier; expo-secure-store: 'app').
   */
  services: ReadonlyArray<string>;
  /** react-native-keychain: the servers of internet passwords. expo-secure-store ignores it. */
  servers: ReadonlyArray<string>;
  /** iOS: the access group the library wrote to; absent — every group of the app. Android ignores it. */
  accessGroup?: string;
};

/**
 * An item of another library, found without its value. JavaScript reads `kind`, `service` and `account`, and passes
 * the object back unchanged.
 */
export type MigrationSource = {
  /**
   * What the item becomes: 'genericPassword' — the credentials of the store whose service is `service`;
   * 'internetPassword' — the credentials with `server` = `service`; 'secureStore' — the item with the key `account`.
   */
  kind: 'genericPassword' | 'internetPassword' | 'secureStore';
  /**
   * react-native-keychain: the service or the server; expo-secure-store: the `keychainService`. One source per key:
   * of the variants expo-secure-store may have (`:no-auth`, `:auth`, without a suffix), the one its `getItemAsync` reads.
   * react-native-keychain keeps one item per service or server: several sources of one `kind` and `service` are
   * another SDK's items beside it, which iOS can't tell apart, and none of them is moved.
   */
  service: string;
  /** react-native-keychain: the username; expo-secure-store: the key. */
  account: string;
  /** iOS: the item's access group. */
  accessGroup?: string;
  /** Reading the value shows a prompt. */
  requiresAuth: boolean;
  /** An earlier run moved the item and kept it (`removeSource` false): it isn't read again. */
  migrated: boolean;
};

export interface Spec extends TurboModule {
  // Storage. Every method works within one store; `key` is a non-empty string of up to 256 characters.

  /** Writes an item, replacing the one with the key. Resolves once the item is written. */
  setItem(
    store: Store,
    key: string,
    value: string,
    encoding: Encoding,
    options: WriteOptions
  ): Promise<void>;
  /**
   * Reads an item, showing the prompt when its access control asks for one. Null when there is no item. An item
   * whose biometry changed rejects with KEY_INVALIDATED and is deleted.
   */
  getItem(store: Store, key: string, encoding: Encoding, prompt: Prompt): Promise<Item | null>;
  /** Deletes an item; no item is no error. Never shows a prompt. */
  removeItem(store: Store, key: string): Promise<void>;
  /** Whether there is an item with the key. Never shows a prompt. */
  hasItem(store: Store, key: string): Promise<boolean>;
  /** The attributes of an item, or null. Never shows a prompt. */
  getItemInfo(store: Store, key: string): Promise<ItemInfo | null>;
  /** The keys of every item of the store, in any order. Never shows a prompt. */
  getAllKeys(store: Store): Promise<ReadonlyArray<string>>;
  /** Deletes every item of the store and, on Android, its Keystore keys. Never shows a prompt. */
  clear(store: Store): Promise<void>;

  // Storage, synchronous: on the JavaScript thread, never with a prompt. A read of an item with access control
  // returns AUTH_REQUIRED.

  /** `getItem` as text, synchronously. */
  getItemSync(store: Store, key: string): SyncValueResult;
  /** `setItem` of text, synchronously. */
  setItemSync(store: Store, key: string, value: string, options: WriteOptions): SyncResult;
  /** `hasItem`, synchronously. */
  hasItemSync(store: Store, key: string): SyncBooleanResult;
  /** `removeItem`, synchronously. */
  removeItemSync(store: Store, key: string): SyncResult;

  /** The service of the default store: the bundle identifier on iOS, the application id on Android. */
  getDefaultService(): string;

  // The device. None of these touches the Keychain or the Keystore's items or shows a prompt.

  /** The biometric modalities that can unlock a key: enrolled or not, Class 3 only on Android. */
  getBiometryTypes(): Promise<ReadonlyArray<BiometryType>>;
  /** Whether an item can be written with the access control on this device now. */
  canUseAccessControl(accessControl: AccessControl): Promise<Availability>;
  /** Whether the device has a passcode, PIN or pattern. */
  isPasscodeSet(): Promise<boolean>;
  /** An opaque token that changes when the set of enrolled biometrics changes; null without biometry. */
  getBiometryState(): Promise<string | null>;
  /** (Android) The best hardware a new key can live in; null on iOS. */
  getHardwareSecurityLevel(): Promise<SecurityLevel | null>;

  // Migration: another library's items. JavaScript writes a value to a store with the ordinary
  // methods, and only after the write resolved finishes the source; it builds the report. None of these touches the
  // package's own items.

  /** The items the query names, those an earlier run moved included. Never shows a prompt; no value crosses. */
  getMigrationSources(query: MigrationQuery): Promise<ReadonlyArray<MigrationSource>>;
  /**
   * The value of a source as text, with the prompt when the item needs one, as `getItem`. Null when the item is gone.
   * DATA_CORRUPTED when its bytes aren't UTF-8 or have U+0000, which the bridge would cut.
   */
  readMigrationSource(source: MigrationSource, prompt: Prompt): Promise<string | null>;
  /**
   * After the value was written to the store: deletes the source when `removeSource` (every variant of an
   * expo-secure-store key), else marks it `migrated`. No item is no error. Never shows a prompt.
   */
  finishMigrationSource(source: MigrationSource, removeSource: boolean): Promise<void>;
}

// `get`, not `getEnforcing`: without the module (Expo Go, an app not rebuilt) src/native/module.ts throws a
// KeychainError that says what to do.
export default TurboModuleRegistry.get<Spec>('ApexKeychain');
