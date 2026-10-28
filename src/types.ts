import type {
  Accessible,
  AccessControl,
  BiometryType,
  HardwareSecurityLevel,
  KeyStorage,
} from './constants';

// The value constants (`AccessControl.None` and the like) are in src/constants.ts, with the types of the same names.
export type { Accessible, AccessControl, BiometryType, HardwareSecurityLevel, KeyStorage };

/** The texts of the system prompt that a read of a protected item shows. */
export type Prompt = {
  /** The reason or title. iOS: `LAContext.localizedReason`; Android: the title. */
  title?: string;
  /** Android only. */
  subtitle?: string;
  /** Android only. */
  description?: string;
  /** The cancel button. iOS: `localizedCancelTitle`; Android: the negative button, when there is no passcode fallback. */
  cancel?: string;
  /** Android only: whether a face match needs a tap to confirm. Defaults to `true`. */
  confirmationRequired?: boolean;
};

/** Options for Android only. */
export type AndroidOptions = {
  /**
   * Where the Keystore key lives: `tee` (the default) — the Trusted Execution Environment; `strongbox` — StrongBox
   * when the device has one, else the TEE; `strongboxRequired` — StrongBox or the error `HARDWARE_UNAVAILABLE`.
   */
  keyStorage?: KeyStorage;
};

/** The options of a store, from `createKeychain`. They are the defaults of its calls; a call's options override them. */
export type KeychainOptions = {
  /** The name of the store. Defaults to the bundle identifier on iOS and the application id on Android. */
  service?: string;
  /** When the store's items can be read. Defaults to `afterFirstUnlock`. */
  accessible?: Accessible;
  /** What unlocks the store's items. Defaults to `none`. */
  accessControl?: AccessControl;
  /**
   * Seconds one authentication unlocks protected items for; `0` (the default) asks on every read. Not allowed with
   * `biometryCurrentSet` or `biometryCurrentSetOrPasscode`. Android before 11 has no window: `UNSUPPORTED`.
   *
   * The window never carries over what the app can't vouch for: the first read after the app is opened always shows
   * the prompt, and the window is reset when the app goes to the background.
   */
  authValidity?: number;
  /**
   * iOS: keep the items in iCloud Keychain. Not allowed with a `…ThisDeviceOnly` `accessible` or with an
   * `accessControl` other than `none`. Android ignores it, with a warning in development.
   */
  synchronizable?: boolean;
  /** iOS: the keychain access group shared with other apps of the team. Android ignores it. */
  accessGroup?: string;
  /** The texts of the prompt of protected reads. */
  prompt?: Prompt;
  /** Options for Android only. */
  android?: AndroidOptions;
};

/** The options of a write; they override the store's. */
export type SetOptions = Pick<
  KeychainOptions,
  'accessible' | 'accessControl' | 'authValidity' | 'synchronizable' | 'android'
>;

/** The options of a read; they override the store's. */
export type GetOptions = {
  /** The texts of the prompt, field by field over the store's. */
  prompt?: Prompt;
};

/**
 * A user name and a password, stored as one item. Neither can contain U+0000 (`INVALID_ARGUMENT`: React Native cuts a
 * string there on the bridge); the user name can't be empty.
 */
export type Credentials = {
  username: string;
  password: string;
};

/** Which credentials: the app's own, or those of a server. */
export type CredentialsOptions = {
  /** The server the credentials are for. Without one, the app's own credentials. */
  server?: string;
};

/**
 * A store of secrets: the items of one service. Keys are non-empty strings of up to 256 characters without U+0000;
 * values are strings or bytes. A string, whether a value, a user name or a password, can't contain U+0000
 * either: React Native cuts a string there on the bridge, so it is `INVALID_ARGUMENT` instead of a shorter secret.
 * `setBytes` and `getBytes` take any byte, zero included. A missing item reads as `null`; errors are `KeychainError`s.
 */
export interface Keychain {
  /** The name of the store. */
  readonly service: string;

  /**
   * Writes a string, which can't contain U+0000 (`INVALID_ARGUMENT`: use `setBytes`). Never shows a prompt.
   *
   * The package sees only its own items. On iOS an item of another library with the same service and key (react-native-keychain,
   * Expo SecureStore) is not overwritten: the write fails with `INVALID_ARGUMENT`, use another key or migrate it first.
   * An access control the device can't do fails the write (`BIOMETRY_NOT_ENROLLED`, `PASSCODE_NOT_SET`, …) instead of
   * lowering the protection.
   */
  setItem(key: string, value: string, options?: SetOptions): Promise<void>;
  /**
   * Reads a string, or `null`. Shows the prompt when the item has access control. An item written with `setBytes`
   * that isn't UTF-8 text is `INVALID_ARGUMENT`: read it with `getBytes`.
   */
  getItem(key: string, options?: GetOptions): Promise<string | null>;
  /** Writes bytes, any bytes: zeros included. Never shows a prompt. */
  setBytes(key: string, value: Uint8Array, options?: SetOptions): Promise<void>;
  /** Reads bytes, or `null`. Shows the prompt when the item has access control. */
  getBytes(key: string, options?: GetOptions): Promise<Uint8Array | null>;
  /** Deletes an item. A missing item is no error. */
  removeItem(key: string): Promise<void>;

  /** Whether there is an item with the key. Never shows a prompt. */
  hasItem(key: string): Promise<boolean>;
  /** Deletes every item of the store and, on Android, its Keystore keys. Never shows a prompt. */
  clear(): Promise<void>;

  /**
   * Reads a string synchronously, on the JavaScript thread. An item with access control throws `AUTH_REQUIRED`: a
   * synchronous call never shows a prompt.
   */
  getItemSync(key: string): string | null;
  /**
   * Writes a string synchronously, on the JavaScript thread. The string can't contain U+0000 (`INVALID_ARGUMENT`).
   */
  setItemSync(key: string, value: string, options?: SetOptions): void;
  /** Whether there is an item with the key, synchronously. */
  hasItemSync(key: string): boolean;
  /** Deletes an item synchronously. */
  removeItemSync(key: string): void;

  /**
   * Writes a user name and a password as one item, with the key `credentials` (or `credentials:<server>`). Neither
   * string can contain U+0000 (`INVALID_ARGUMENT`).
   */
  setCredentials(
    credentials: Credentials,
    options?: SetOptions & CredentialsOptions
  ): Promise<void>;
  /** Reads the credentials, or `null`. Shows the prompt when the item has access control. */
  getCredentials(options?: GetOptions & CredentialsOptions): Promise<Credentials | null>;
  /** Deletes the credentials. Missing credentials are no error. */
  removeCredentials(options?: CredentialsOptions): Promise<void>;
}

/**
 * Whether an access control can protect an item on this device now, and why not when it can't: `unsupportedOS` (the
 * passcode variants before Android 11), `noHardware` (no biometric sensor), `passcodeNotSet`, `notEnrolled` (no
 * biometry enrolled). When several are true, the first of these is the reason, in this order. A lockout is not a
 * reason: it is temporary, and the access control stays available.
 */
export type AccessControlAvailability =
  | { available: true }
  | {
      available: false;
      reason: 'noHardware' | 'notEnrolled' | 'passcodeNotSet' | 'unsupportedOS';
    };
