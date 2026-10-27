// The whole public API over a native module. src/index.ts binds it to the TurboModule, src/jest/index.ts to the
// in-memory one, so the mock checks and merges options exactly as the package does.
import { decodeBase64, encodeBase64 } from './base64';
import { credentialsKey } from './credentials';
import { invalidArgument, toKeychainError } from './errors';
import type * as Native from './native/NativeApexKeychain';
import {
  checkAccessControl,
  checkBytes,
  checkKey,
  checkName,
  checkObject,
  checkText,
  parseGetOptions,
  parseKeychainOptions,
  parseSetOptions,
  resolvePrompt,
  resolveWrite,
} from './options';
import type {
  AccessControl,
  AccessControlAvailability,
  BiometryType,
  Credentials,
  HardwareSecurityLevel,
  ItemInfo,
  Keychain,
  KeychainOptions,
} from './types';

/** Everything src/index.ts exports that calls the native side. */
export type Api = {
  keychain: Keychain;
  createKeychain(options?: KeychainOptions): Keychain;
  getBiometryTypes(): Promise<BiometryType[]>;
  canUseAccessControl(accessControl: AccessControl): Promise<AccessControlAvailability>;
  isPasscodeSet(): Promise<boolean>;
  getBiometryState(): Promise<string | null>;
  getHardwareSecurityLevel(): Promise<HardwareSecurityLevel | null>;
};

/**
 * Runs an asynchronous call: whatever it throws or rejects with becomes a KeychainError. A method without a value
 * must resolve to `undefined` whatever the native side resolves to (Android's TurboModule gives `null`), so its work
 * is an async function that returns nothing.
 */
async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toKeychainError(error);
  }
}

/** Runs a synchronous native call: its `error`, or whatever it throws, becomes a KeychainError. */
function runSync<T extends { error?: Native.Failure }>(work: () => T): T {
  let result: T;
  try {
    result = work();
  } catch (error) {
    throw toKeychainError(error);
  }
  if (result.error) throw toKeychainError(result.error);
  return result;
}

function checkCredentials(credentials: unknown): Credentials {
  if (typeof credentials !== 'object' || credentials === null) {
    throw invalidArgument('Invalid credentials: expected { username, password }.');
  }
  const { username, password } = credentials as Record<string, unknown>;
  if (username === '') throw invalidArgument('Invalid username: expected a non-empty string.');
  return { username: checkText(username, 'username'), password: checkText(password, 'password') };
}

function toItemInfo(info: Native.ItemInfo): ItemInfo {
  const result: ItemInfo = {
    key: info.key,
    accessible: info.accessible,
    accessControl: info.accessControl,
    synchronizable: info.synchronizable,
    createdAt: info.createdAt,
    modifiedAt: info.modifiedAt,
  };
  if (info.label != null) result.label = info.label;
  if (info.securityLevel != null) result.android = { securityLevel: info.securityLevel };
  return result;
}

/** The API over the native module that `native` returns (or throws without). */
export function createApi(native: () => Native.Spec): Api {
  let defaultService: string | undefined;
  const getDefaultService = () =>
    (defaultService ??= checkName(native().getDefaultService(), 'default service'));

  function createKeychain(keychainOptions?: KeychainOptions): Keychain {
    const options = parseKeychainOptions(keychainOptions);
    const service = () => options.service ?? getDefaultService();
    const store = (): Native.Store =>
      options.accessGroup === undefined
        ? { service: service() }
        : { service: service(), accessGroup: options.accessGroup };

    async function read(key: string, encoding: Native.Encoding, getOptions: unknown) {
      const parsed = parseGetOptions(getOptions);
      const prompt = resolvePrompt(options.prompt, parsed.prompt);
      return native().getItem(store(), key, encoding, prompt);
    }

    return {
      get service() {
        return service();
      },

      setItem: (key, value, setOptions) =>
        run(async () => {
          const checkedKey = checkKey(key);
          const text = checkText(value, 'value');
          const write = resolveWrite(options, parseSetOptions(setOptions));
          await native().setItem(store(), checkedKey, text, 'utf8', write);
        }),
      getItem: (key, getOptions) =>
        run(async () => {
          const item = await read(checkKey(key), 'utf8', getOptions);
          return item ? item.value : null;
        }),
      setBytes: (key, value, setOptions) =>
        run(async () => {
          const checkedKey = checkKey(key);
          const base64 = encodeBase64(checkBytes(value));
          const write = resolveWrite(options, parseSetOptions(setOptions));
          await native().setItem(store(), checkedKey, base64, 'base64', write);
        }),
      getBytes: (key, getOptions) =>
        run(async () => {
          const item = await read(checkKey(key), 'base64', getOptions);
          return item ? decodeBase64(item.value) : null;
        }),
      removeItem: (key) =>
        run(async () => {
          const checkedKey = checkKey(key);
          await native().removeItem(store(), checkedKey);
        }),

      hasItem: (key) =>
        run(async () => {
          const checkedKey = checkKey(key);
          return native().hasItem(store(), checkedKey);
        }),
      getItemInfo: (key) =>
        run(async () => {
          const checkedKey = checkKey(key);
          const info = await native().getItemInfo(store(), checkedKey);
          return info ? toItemInfo(info) : null;
        }),
      getAllKeys: () => run(async () => [...(await native().getAllKeys(store()))].sort()),
      clear: () =>
        run(async () => {
          await native().clear(store());
        }),

      getItemSync: (key) => {
        const checkedKey = checkKey(key);
        return runSync(() => native().getItemSync(store(), checkedKey)).value ?? null;
      },
      setItemSync: (key, value, setOptions) => {
        const checkedKey = checkKey(key);
        const text = checkText(value, 'value');
        const write = resolveWrite(options, parseSetOptions(setOptions));
        runSync(() => native().setItemSync(store(), checkedKey, text, write));
      },
      hasItemSync: (key) => {
        const checkedKey = checkKey(key);
        return runSync(() => native().hasItemSync(store(), checkedKey)).value ?? false;
      },
      removeItemSync: (key) => {
        const checkedKey = checkKey(key);
        runSync(() => native().removeItemSync(store(), checkedKey));
      },

      setCredentials: (credentials, setOptions) =>
        run(async () => {
          const { username, password } = checkCredentials(credentials);
          const parsed = parseSetOptions(setOptions, ['server']);
          if (parsed.label !== undefined) {
            throw invalidArgument('setCredentials takes no label: the label holds the user name.');
          }
          const key = credentialsKey(parsed.server);
          const write = resolveWrite(options, { ...parsed, label: username });
          await native().setItem(store(), key, password, 'utf8', write);
        }),
      getCredentials: (getOptions) =>
        run(async () => {
          const parsed = parseGetOptions(getOptions, ['server']);
          const key = credentialsKey(parsed.server);
          const prompt = resolvePrompt(options.prompt, parsed.prompt);
          const item = await native().getItem(store(), key, 'utf8', prompt);
          if (!item) return null;
          if (item.label == null) {
            throw invalidArgument(
              `The item '${key}' holds no user name: it wasn't written by setCredentials.`
            );
          }
          return { username: item.label, password: item.value };
        }),
      removeCredentials: (credentialsOptions) =>
        run(async () => {
          const parsed = checkObject(credentialsOptions, 'options', ['server']) ?? {};
          const key = credentialsKey(parsed.server);
          await native().removeItem(store(), key);
        }),
    };
  }

  return {
    keychain: createKeychain(),
    createKeychain,
    getBiometryTypes: () => run(async () => [...(await native().getBiometryTypes())]),
    canUseAccessControl: (accessControl) =>
      run(async () => {
        const result = await native().canUseAccessControl(checkAccessControl(accessControl));
        return result.available
          ? { available: true }
          : { available: false, reason: result.reason ?? 'unsupportedOS' };
      }),
    isPasscodeSet: () => run(() => native().isPasscodeSet()),
    getBiometryState: () => run(async () => (await native().getBiometryState()) ?? null),
    getHardwareSecurityLevel: () =>
      run(async () => (await native().getHardwareSecurityLevel()) ?? null),
  };
}
