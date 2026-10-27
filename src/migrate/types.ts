import type { KeychainError } from '../errors';
import type { Keychain, Prompt, SetOptions } from '../types';

/** What a migrated item becomes in this package. */
export type MigrationKind =
  /** A generic password of react-native-keychain: the credentials of the store whose service is the password's. */
  | 'genericPassword'
  /** Internet credentials of react-native-keychain: the credentials with `server` the server. */
  | 'internetPassword'
  /** An item of expo-secure-store: the item with the same key. */
  | 'secureStore';

/**
 * Why an item wasn't moved:
 * - `requiresAuth` — the old item is protected and `migrateFrom…` never shows a prompt: `migrateItem` moves it, with one;
 * - `notFound` — the old item is gone, or has no value;
 * - `exists` — the key is taken in the new store (nothing is overwritten), or an earlier run moved the item and kept it;
 * - `error` — reading or writing failed; `error` says how.
 */
export type SkipReason = 'requiresAuth' | 'notFound' | 'exists' | 'error';

export type SkippedItem = {
  /** react-native-keychain: the service or the server; expo-secure-store: the key. */
  key: string;
  kind: MigrationKind;
  reason: SkipReason;
  /** What failed, for `error` (a canceled prompt of `migrateItem` is `USER_CANCELED`, for one). */
  error?: KeychainError;
};

export type MigrationReport = {
  /** The keys of the items that were written to the new store. */
  migrated: string[];
  skipped: SkippedItem[];
  /**
   * Items that were written, and whose old item couldn't be removed (or marked as moved): their data is safe in the new
   * store, the old item stays, and a new run skips it as `exists`.
   */
  warnings: Array<{ key: string; kind: MigrationKind; error: KeychainError }>;
};

type Common = {
  /**
   * The store that gets the internet credentials and the items of expo-secure-store, with the options it was made with.
   * Defaults to the default store. A generic password goes to the store of its own service, not to this one.
   */
  into?: Keychain;
  /**
   * Delete the old item after the new one is written. Default `false`: the old item is marked as moved and kept, and a
   * later run with `removeSource` deletes it, if the new item is still there. An old item whose key was taken is never
   * deleted.
   */
  removeSource?: boolean;
  /** iOS: the access group the old library wrote to, which the new items are written to as well. Default: every group. */
  accessGroup?: string;
};

/** What `migrateFromReactNativeKeychain` moves. */
export type MigrateFromReactNativeKeychainOptions = Common & {
  /** The services of the generic passwords. Default: the default service of the library (on iOS, the bundle id). */
  services?: readonly string[];
  /** The servers of the internet credentials. Default: none. */
  servers?: readonly string[];
};

/** What `migrateFromExpoSecureStore` moves. */
export type MigrateFromExpoSecureStoreOptions = Common & {
  /** The `keychainService` or `keychainService`s of expo-secure-store. Default: `app`, as in the library. */
  keychainService?: string | readonly string[];
};

/** One old item, for `migrateItem`. */
export type MigrationItem =
  | {
      library: 'reactNativeKeychain';
      /** A generic password of the service; without one, of the default service. */
      service?: string;
      server?: undefined;
    }
  | { library: 'reactNativeKeychain'; server: string; service?: undefined }
  | {
      library: 'expoSecureStore';
      /** The key of the item. */
      key: string;
      /** Its `keychainService`; default `app`. */
      keychainService?: string;
    };

export type MigrateItemOptions = Common & {
  /** The texts of the prompt that reading a protected item shows. */
  prompt?: Prompt;
  /**
   * How the new item is written: its `accessible`, `accessControl` and the like. An old item that was protected must be
   * written with an `accessControl` (the package never lowers the protection by itself); without one, `migrateItem`
   * rejects with `INVALID_ARGUMENT` before it shows anything.
   */
  setOptions?: Omit<SetOptions, 'label'>;
};
