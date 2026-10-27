// The native module in memory, for Jest: it answers the contract of src/native/NativeApexKeychain.ts as iOS and
// Android do, with a simulated device. Items live in this object until `reset`.
import { decodeBase64, encodeBase64 } from '../base64';
import { isKeychainErrorCode, type KeychainErrorCode } from '../errors';
import type * as Native from '../native/NativeApexKeychain';
import { ACCESS_CONTROL, ACCESSIBLE, KEY_STORAGE } from '../options';
import type { BiometryType, HardwareSecurityLevel } from '../types';
import { decodeUtf8, encodeUtf8 } from './utf8';

/** The device the mock simulates. */
export type MockDevice = {
  /** The service of the default store. Defaults to `dev.apexnative.keychain.mock`. */
  defaultService: string;
  /** The biometric hardware. Defaults to `['faceID']`; empty means none. */
  biometryTypes: BiometryType[];
  /** Whether biometry is enrolled. Defaults to `true`. */
  biometryEnrolled: boolean;
  /** Whether the device has a passcode. Defaults to `true`. */
  passcodeSet: boolean;
  /**
   * (iOS) Whether the app has `NSFaceIDUsageDescription` in its Info.plist. Defaults to `true`. Without it, a device
   * with Face ID rejects every biometric access control, `canUseAccessControl` included, with
   * `MISSING_USAGE_DESCRIPTION`.
   */
  faceIDUsageDescription: boolean;
  /**
   * (Android) The API level of the device. Defaults to `null`, a device that isn't an Android one. Below 30 the access
   * controls with a passcode are `unsupportedOS` and a write with one, or with an `authValidity` above 0, rejects with
   * `UNSUPPORTED`.
   */
  androidApi: number | null;
  /**
   * What `getHardwareSecurityLevel` reports: the best hardware a new key can live in. Defaults to `null`, as on iOS,
   * where `keyStorage` means nothing. With a level the device is an Android one: `getItemInfo` reports where each
   * item's key lives (`tee` stays in the TEE even where there is StrongBox, `strongbox` falls back to the TEE) and
   * `strongboxRequired` rejects with `HARDWARE_UNAVAILABLE` unless the level is `strongbox`.
   */
  hardwareSecurityLevel: HardwareSecurityLevel | null;
};

/** What a prompt the mock "showed" had. */
export type MockPrompt = Native.Prompt & {
  /** The key of the item it was for. */
  key: string;
};

/**
 * An item of another library, as that library left it, for `migrate`: what `keychainMock.addMigrationSource` plants.
 * `requiresAuth` makes reading it show a prompt; `corrupted` makes reading it fail with `DATA_CORRUPTED`, as bytes that
 * aren't text do.
 */
export type MockMigrationItem = {
  requiresAuth?: boolean;
  corrupted?: boolean;
  accessGroup?: string;
} & (
  | {
      /** A generic password of react-native-keychain. */
      library: 'reactNativeKeychain';
      service: string;
      username: string;
      password: string;
    }
  | {
      /** Internet credentials of react-native-keychain. */
      library: 'reactNativeKeychain';
      server: string;
      username: string;
      password: string;
    }
  | {
      /** An item of expo-secure-store. */
      library: 'expoSecureStore';
      key: string;
      value: string;
      /** Its `keychainService`; default `app`. */
      keychainService?: string;
    }
);

/** A planted item as `keychainMock.migrationSources()` reports it: what is left of it. */
export type MockMigrationSource = {
  library: Native.MigrationLibrary;
  kind: Native.MigrationSource['kind'];
  /** The service or the server; for expo-secure-store the `keychainService`. */
  service: string;
  /** The user name; for expo-secure-store the key. */
  account: string;
  requiresAuth: boolean;
  /** An earlier run moved the item and kept it. */
  migrated: boolean;
};

/** Controls of the mock, for tests: `keychainMock` of `@apexnative/keychain/jest`. */
export type KeychainMock = {
  /** Forgets every item, prompt and queued failure, and restores the default device. */
  reset(): void;
  /** Changes the simulated device; what isn't given stays. */
  setDevice(device: Partial<MockDevice>): void;
  /**
   * The next prompt fails with the code instead of succeeding, such as `USER_CANCELED` or `LOCKOUT`. Calls queue up.
   * `KEY_INVALIDATED` also deletes the item.
   */
  failNextAuthentication(code: KeychainErrorCode): void;
  /**
   * The enrolled biometry changes, as when a finger or a face is added: items written with `biometryCurrentSet` or
   * `biometryCurrentSetOrPasscode` throw `KEY_INVALIDATED` on their next read and are deleted.
   */
  changeBiometry(): void;
  /** The prompts shown since the last reset, oldest first. */
  prompts(): MockPrompt[];
  /**
   * Plants an item of react-native-keychain or expo-secure-store, for `migrate` to find. An item of the same library,
   * service and account replaces the one that is there.
   */
  addMigrationSource(item: MockMigrationItem): void;
  /** The planted items that are still there (`migrate` with `removeSource` removes them), with the mark of a move. */
  migrationSources(): MockMigrationSource[];
};

const DEFAULT_DEVICE: MockDevice = {
  defaultService: 'dev.apexnative.keychain.mock',
  biometryTypes: ['faceID'],
  biometryEnrolled: true,
  passcodeSet: true,
  faceIDUsageDescription: true,
  androidApi: null,
  hardwareSecurityLevel: null,
};

type PlantedItem = {
  library: Native.MigrationLibrary;
  source: Native.MigrationSource;
  value: string;
  corrupted: boolean;
};

type MemoryItem = {
  bytes: Uint8Array;
  label?: string;
  options: Native.WriteOptions;
  /** The biometry when the item was written, for the `biometryCurrentSet` variants. */
  biometryState: number;
  /** Where the item's key lives, on a device that has a hardware level. */
  securityLevel?: Native.SecurityLevel;
  createdAt: number;
  modifiedAt: number;
};

/** A rejection as the native side makes one: `code`, `message`, `userInfo`. */
function rejection(code: KeychainErrorCode, message: string) {
  return Object.assign(new Error(message), { code, userInfo: null });
}

function failure(code: KeychainErrorCode, message: string): Native.Failure {
  return { code, message };
}

/** An error the mock answers with: thrown inside, turned into a rejection or a `Failure` at the edge. */
class MockError {
  constructor(
    readonly code: KeychainErrorCode,
    readonly message: string
  ) {}
}

const ENCODING: readonly Native.Encoding[] = ['utf8', 'base64'];
/** The access controls that need an enrolled biometry: the passcode doesn't make up for it (`CurrentSet` is bound to it). */
const NEEDS_BIOMETRY: readonly Native.AccessControl[] = [
  'biometryAny',
  'biometryCurrentSet',
  'biometryCurrentSetOrPasscode',
];
/** The access controls that can fall back to the device passcode: Android 11+ only. */
const USES_PASSCODE: readonly Native.AccessControl[] = [
  'biometryAnyOrPasscode',
  'biometryCurrentSetOrPasscode',
  'passcode',
];
/** The access controls that can show Face ID or Touch ID. */
const USES_BIOMETRY: readonly Native.AccessControl[] = [...NEEDS_BIOMETRY, 'biometryAnyOrPasscode'];
const CURRENT_SET: readonly Native.AccessControl[] = [
  'biometryCurrentSet',
  'biometryCurrentSetOrPasscode',
];

export class MemoryKeychain implements Native.Spec {
  private stores = new Map<string, Map<string, MemoryItem>>();
  private device: MockDevice = { ...DEFAULT_DEVICE };
  private biometryGeneration = 1;
  private failures: KeychainErrorCode[] = [];
  private shownPrompts: MockPrompt[] = [];
  private clock = 0;
  private planted: PlantedItem[] = [];

  readonly controls: KeychainMock = {
    reset: () => {
      this.stores.clear();
      this.device = { ...DEFAULT_DEVICE };
      this.biometryGeneration = 1;
      this.failures = [];
      this.shownPrompts = [];
      this.planted = [];
    },
    setDevice: (device) => {
      this.device = { ...this.device, ...device };
    },
    failNextAuthentication: (code) => {
      if (!isKeychainErrorCode(code)) {
        throw new TypeError(`failNextAuthentication: '${String(code)}' is no KeychainErrorCode.`);
      }
      this.failures.push(code);
    },
    changeBiometry: () => {
      this.biometryGeneration++;
    },
    prompts: () => this.shownPrompts.map((prompt) => ({ ...prompt })),
    addMigrationSource: (item) => this.plant(item),
    migrationSources: () =>
      this.planted.map(({ library, source }) => ({
        library,
        kind: source.kind,
        service: source.service,
        account: source.account,
        requiresAuth: source.requiresAuth,
        migrated: source.migrated,
      })),
  };

  // Storage

  async setItem(
    store: Native.Store,
    key: string,
    value: string,
    encoding: Native.Encoding,
    options: Native.WriteOptions
  ): Promise<void> {
    this.asAsync(() => this.write(store, key, this.toBytes(value, encoding), options));
  }

  async getItem(
    store: Native.Store,
    key: string,
    encoding: Native.Encoding,
    prompt: Native.Prompt
  ): Promise<Native.Item | null> {
    return this.asAsync(() => {
      this.checkEnum(encoding, ENCODING, 'encoding');
      const item = this.items(store).get(key);
      if (!item) return null;
      if (item.options.accessControl !== 'none') this.authenticate(store, key, item, prompt);
      const result: Native.Item = { value: this.fromBytes(item.bytes, encoding) };
      if (item.label !== undefined) result.label = item.label;
      return result;
    });
  }

  async removeItem(store: Native.Store, key: string): Promise<void> {
    this.items(store).delete(key);
  }

  async hasItem(store: Native.Store, key: string): Promise<boolean> {
    return this.items(store).has(key);
  }

  async getItemInfo(store: Native.Store, key: string): Promise<Native.ItemInfo | null> {
    const item = this.items(store).get(key);
    if (!item) return null;
    const info: Native.ItemInfo = {
      key,
      accessible: item.options.accessible,
      accessControl: item.options.accessControl,
      synchronizable: item.options.synchronizable,
      createdAt: item.createdAt,
      modifiedAt: item.modifiedAt,
    };
    if (item.label !== undefined) info.label = item.label;
    if (item.securityLevel !== undefined) info.securityLevel = item.securityLevel;
    return info;
  }

  async getAllKeys(store: Native.Store): Promise<ReadonlyArray<string>> {
    return [...this.items(store).keys()];
  }

  async clear(store: Native.Store): Promise<void> {
    this.stores.delete(store.service);
  }

  // Storage, synchronous

  getItemSync(store: Native.Store, key: string): Native.SyncValueResult {
    return this.asSync<Native.SyncValueResult>(() => {
      const item = this.items(store).get(key);
      if (!item) return {};
      if (item.options.accessControl !== 'none') {
        throw new MockError(
          'AUTH_REQUIRED',
          `The item '${key}' needs authentication: read it with getItem.`
        );
      }
      return { value: this.fromBytes(item.bytes, 'utf8') };
    });
  }

  setItemSync(
    store: Native.Store,
    key: string,
    value: string,
    options: Native.WriteOptions
  ): Native.SyncResult {
    return this.asSync(() => {
      this.write(store, key, encodeUtf8(value), options);
      return {};
    });
  }

  hasItemSync(store: Native.Store, key: string): Native.SyncBooleanResult {
    return { value: this.items(store).has(key) };
  }

  removeItemSync(store: Native.Store, key: string): Native.SyncResult {
    this.items(store).delete(key);
    return {};
  }

  getDefaultService(): string {
    return this.device.defaultService;
  }

  // The device

  async getBiometryTypes(): Promise<ReadonlyArray<Native.BiometryType>> {
    return [...this.device.biometryTypes];
  }

  async canUseAccessControl(accessControl: Native.AccessControl): Promise<Native.Availability> {
    return this.asAsync(() => {
      this.checkUsageDescription(accessControl);
      const reason = this.unavailableReason(accessControl);
      return reason ? { available: false, reason } : { available: true };
    });
  }

  async isPasscodeSet(): Promise<boolean> {
    return this.device.passcodeSet;
  }

  async getBiometryState(): Promise<string | null> {
    const { biometryTypes, biometryEnrolled } = this.device;
    return biometryTypes.length > 0 && biometryEnrolled
      ? `mock-biometry-${this.biometryGeneration}`
      : null;
  }

  async getHardwareSecurityLevel(): Promise<Native.SecurityLevel | null> {
    return this.device.hardwareSecurityLevel;
  }

  // Migration: the items that `keychainMock.addMigrationSource` planted, found by library, service and server as the
  // native side finds them; `migrate` moves them.

  async getMigrationSources(
    query: Native.MigrationQuery
  ): Promise<ReadonlyArray<Native.MigrationSource>> {
    const { library, services, servers, accessGroup } = query;
    if (library !== 'reactNativeKeychain' && library !== 'expoSecureStore') {
      throw rejection('INVALID_ARGUMENT', `Unknown library '${String(library)}'.`);
    }
    // No services named: the default of the library, which on iOS is the bundle id for react-native-keychain.
    const named =
      services.length > 0
        ? services
        : [library === 'expoSecureStore' ? 'app' : this.device.defaultService];
    return this.planted
      .filter((planted) => planted.library === library)
      .filter(({ source }) => {
        if (accessGroup !== undefined && source.accessGroup !== accessGroup) return false;
        return source.kind === 'internetPassword'
          ? servers.includes(source.service)
          : named.includes(source.service);
      })
      .map(({ source }) => ({ ...source }));
  }

  async readMigrationSource(
    source: Native.MigrationSource,
    prompt: Native.Prompt
  ): Promise<string | null> {
    return this.asAsync(() => {
      const planted = this.findPlanted(source);
      if (!planted) return null;
      if (planted.source.requiresAuth) this.authenticateSource(planted.source, prompt);
      if (planted.corrupted) {
        throw new MockError('DATA_CORRUPTED', "The item's bytes aren't text.");
      }
      return planted.value;
    });
  }

  async finishMigrationSource(
    source: Native.MigrationSource,
    removeSource: boolean
  ): Promise<void> {
    const planted = this.findPlanted(source);
    if (!planted) return;
    if (removeSource) this.planted = this.planted.filter((item) => item !== planted);
    else planted.source.migrated = true;
  }

  // Inside

  private items(store: Native.Store): Map<string, MemoryItem> {
    let items = this.stores.get(store.service);
    if (!items) {
      items = new Map();
      this.stores.set(store.service, items);
    }
    return items;
  }

  /** Runs the work of an asynchronous method: a MockError becomes a rejection as the native side's. */
  private asAsync<T>(work: () => T): T {
    try {
      return work();
    } catch (error) {
      if (error instanceof MockError) throw rejection(error.code, error.message);
      throw error;
    }
  }

  /** Runs the work of a synchronous method: a MockError becomes its `error`. */
  private asSync<T extends { error?: Native.Failure }>(work: () => T): T {
    try {
      return work();
    } catch (error) {
      if (error instanceof MockError) return { error: failure(error.code, error.message) } as T;
      throw error;
    }
  }

  /** The native side doesn't guess: a value of an enum it doesn't know is INVALID_ARGUMENT (JavaScript has checked it). */
  private checkEnum(value: string, values: readonly string[], what: string): void {
    if (!values.includes(value)) {
      throw new MockError('INVALID_ARGUMENT', `Unknown ${what} '${value}'.`);
    }
  }

  private toBytes(value: string, encoding: Native.Encoding): Uint8Array {
    this.checkEnum(encoding, ENCODING, 'encoding');
    if (encoding === 'utf8') return encodeUtf8(value);
    try {
      return decodeBase64(value);
    } catch {
      throw new MockError('INVALID_ARGUMENT', "The value isn't Base64.");
    }
  }

  private fromBytes(bytes: Uint8Array, encoding: Native.Encoding): string {
    this.checkEnum(encoding, ENCODING, 'encoding');
    if (encoding === 'base64') return encodeBase64(bytes);
    const text = decodeUtf8(bytes);
    if (text === null) {
      throw new MockError(
        'INVALID_ARGUMENT',
        "The item holds bytes that aren't UTF-8 text: read it with getBytes."
      );
    }
    return text;
  }

  /** Why the device can't do the access control, in a fixed order: what the OS can't do, then the sensor, the passcode, the enrollment. */
  private unavailableReason(
    accessControl: Native.AccessControl
  ): Native.UnavailableReason | undefined {
    const { biometryTypes, biometryEnrolled, passcodeSet, androidApi } = this.device;
    if (accessControl === 'none') return undefined;
    if (USES_PASSCODE.includes(accessControl) && androidApi !== null && androidApi < 30) {
      return 'unsupportedOS';
    }
    const needsBiometry = NEEDS_BIOMETRY.includes(accessControl);
    if (needsBiometry && biometryTypes.length === 0) return 'noHardware';
    if (!passcodeSet) return 'passcodeNotSet';
    if (needsBiometry && !biometryEnrolled) return 'notEnrolled';
    return undefined;
  }

  /** iOS asks for `NSFaceIDUsageDescription` before it evaluates a biometric access control on a Face ID device. */
  private checkUsageDescription(accessControl: Native.AccessControl): void {
    const { faceIDUsageDescription, biometryTypes } = this.device;
    if (
      !faceIDUsageDescription &&
      USES_BIOMETRY.includes(accessControl) &&
      biometryTypes.includes('faceID')
    ) {
      throw new MockError(
        'MISSING_USAGE_DESCRIPTION',
        'NSFaceIDUsageDescription is missing from Info.plist.'
      );
    }
  }

  private write(
    store: Native.Store,
    key: string,
    bytes: Uint8Array,
    options: Native.WriteOptions
  ): void {
    this.checkEnum(options.accessible, ACCESSIBLE, 'accessible');
    this.checkEnum(options.accessControl, ACCESS_CONTROL, 'accessControl');
    this.checkEnum(options.keyStorage, KEY_STORAGE, 'keyStorage');
    this.checkUsageDescription(options.accessControl);
    const reason = this.unavailableReason(options.accessControl);
    if (reason === 'unsupportedOS') {
      throw new MockError('UNSUPPORTED', 'The passcode access controls need Android 11.');
    }
    const { androidApi } = this.device;
    if (
      options.authValidity > 0 &&
      options.accessControl !== 'none' &&
      androidApi !== null &&
      androidApi < 30
    ) {
      throw new MockError('UNSUPPORTED', 'authValidity needs Android 11.');
    }
    if (reason === 'noHardware') {
      throw new MockError('BIOMETRY_NOT_AVAILABLE', 'The device has no biometric hardware.');
    }
    if (reason === 'notEnrolled') {
      throw new MockError('BIOMETRY_NOT_ENROLLED', 'No biometry is enrolled on the device.');
    }
    if (
      reason === 'passcodeNotSet' ||
      (options.accessible === 'whenPasscodeSetThisDeviceOnly' && !this.device.passcodeSet)
    ) {
      throw new MockError('PASSCODE_NOT_SET', 'The device has no passcode.');
    }
    const securityLevel = this.keyLevel(options.keyStorage);
    const items = this.items(store);
    const now = this.now();
    const old = items.get(key);
    const item: MemoryItem = {
      bytes: Uint8Array.from(bytes),
      options: { ...options },
      biometryState: this.biometryGeneration,
      createdAt: old?.createdAt ?? now,
      modifiedAt: now,
    };
    if (securityLevel !== undefined) item.securityLevel = securityLevel;
    if (options.label !== undefined) item.label = options.label;
    items.set(key, item);
  }

  private plant(item: MockMigrationItem): void {
    const protectedItem = item.requiresAuth === true;
    let planted: PlantedItem;
    if (item.library === 'expoSecureStore') {
      planted = {
        library: item.library,
        source: {
          kind: 'secureStore',
          service: item.keychainService ?? 'app',
          account: item.key,
          requiresAuth: protectedItem,
          migrated: false,
        },
        value: item.value,
        corrupted: item.corrupted === true,
      };
    } else {
      const server = 'server' in item ? item.server : undefined;
      planted = {
        library: item.library,
        source: {
          kind: server === undefined ? 'genericPassword' : 'internetPassword',
          service: server ?? (item as { service: string }).service,
          account: item.username,
          requiresAuth: protectedItem,
          migrated: false,
        },
        value: item.password,
        corrupted: item.corrupted === true,
      };
    }
    if (item.accessGroup !== undefined) planted.source.accessGroup = item.accessGroup;
    this.planted = this.planted.filter((other) => !this.sameSource(other.source, planted.source));
    this.planted.push(planted);
  }

  private sameSource(a: Native.MigrationSource, b: Native.MigrationSource): boolean {
    return a.kind === b.kind && a.service === b.service && a.account === b.account;
  }

  private findPlanted(source: Native.MigrationSource): PlantedItem | undefined {
    return this.planted.find((planted) => this.sameSource(planted.source, source));
  }

  /** The prompt of a protected old item: it succeeds, unless a failure is queued. */
  private authenticateSource(source: Native.MigrationSource, prompt: Native.Prompt): void {
    this.shownPrompts.push({ ...prompt, key: source.account });
    const code = this.failures.shift();
    if (code !== undefined) throw new MockError(code, `The authentication failed: ${code}.`);
  }

  /** Where a new key lives for the `keyStorage`; undefined on a device without a hardware level (iOS). */
  private keyLevel(keyStorage: Native.KeyStorage): Native.SecurityLevel | undefined {
    const best = this.device.hardwareSecurityLevel;
    if (best === null) return undefined;
    if (keyStorage === 'strongboxRequired' && best !== 'strongbox') {
      throw new MockError('HARDWARE_UNAVAILABLE', 'The device has no StrongBox.');
    }
    return keyStorage === 'tee' && best === 'strongbox' ? 'tee' : best;
  }

  /** The prompt of a protected read: it succeeds, unless the biometry changed or a failure is queued. */
  private authenticate(
    store: Native.Store,
    key: string,
    item: MemoryItem,
    prompt: Native.Prompt
  ): void {
    if (
      CURRENT_SET.includes(item.options.accessControl) &&
      item.biometryState !== this.biometryGeneration
    ) {
      this.items(store).delete(key);
      throw new MockError(
        'KEY_INVALIDATED',
        `The enrolled biometry changed: the item '${key}' was deleted.`
      );
    }
    this.shownPrompts.push({ ...prompt, key });
    const code = this.failures.shift();
    if (code === undefined) return;
    if (code === 'KEY_INVALIDATED') this.items(store).delete(key);
    throw new MockError(code, `The authentication failed: ${code}.`);
  }

  /** Milliseconds since the epoch, strictly increasing, so that a rewrite always has a later `modifiedAt`. */
  private now(): number {
    this.clock = Math.max(Date.now(), this.clock + 1);
    return this.clock;
  }
}
