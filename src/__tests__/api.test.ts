// The wrapper over a fake native module: what the native side gets for each call, and how its answers and errors come
// back. The behavior of a whole store is behavior.test.ts, on the in-memory module.
import { Platform } from 'react-native';
import { createApi } from '../api';
import { KeychainError } from '../errors';
import type * as Native from '../native/NativeApexKeychain';

function fakeNative() {
  return {
    setItem: jest.fn<Promise<void>, Parameters<Native.Spec['setItem']>>(async () => {}),
    getItem: jest.fn<Promise<Native.Item | null>, Parameters<Native.Spec['getItem']>>(
      async () => null
    ),
    removeItem: jest.fn(async (_store: Native.Store, _key: string) => {}),
    hasItem: jest.fn(async () => false),
    getItemInfo: jest.fn<Promise<Native.ItemInfo | null>, [Native.Store, string]>(async () => null),
    getAllKeys: jest.fn(async (): Promise<ReadonlyArray<string>> => []),
    clear: jest.fn(async () => {}),
    getItemSync: jest.fn((): Native.SyncValueResult => ({})),
    setItemSync: jest.fn((..._: Parameters<Native.Spec['setItemSync']>): Native.SyncResult => ({})),
    hasItemSync: jest.fn((): Native.SyncBooleanResult => ({ value: false })),
    removeItemSync: jest.fn((): Native.SyncResult => ({})),
    getDefaultService: jest.fn(() => 'com.example.app'),
    getBiometryTypes: jest.fn(async (): Promise<ReadonlyArray<Native.BiometryType>> => []),
    canUseAccessControl: jest.fn(async (_: Native.AccessControl): Promise<Native.Availability> => ({
      available: true,
    })),
    isPasscodeSet: jest.fn(async () => true),
    getBiometryState: jest.fn(async (): Promise<string | null> => null),
    getHardwareSecurityLevel: jest.fn(async (): Promise<Native.SecurityLevel | null> => null),
    getMigrationSources: jest.fn(async (): Promise<ReadonlyArray<Native.MigrationSource>> => []),
    readMigrationSource: jest.fn(async (): Promise<string | null> => null),
    finishMigrationSource: jest.fn(async () => {}),
  } satisfies Native.Spec;
}

const DEFAULT_WRITE: Native.WriteOptions = {
  accessible: 'afterFirstUnlock',
  accessControl: 'none',
  authValidity: 0,
  synchronizable: false,
  keyStorage: 'tee',
};

function setup() {
  const native = fakeNative();
  const api = createApi(() => native);
  return { native, api };
}

afterEach(() => jest.restoreAllMocks());

const rejection = (code: string, message: string, userInfo: object | null = null) =>
  Object.assign(new Error(message), { code, userInfo });

/** The error a promise rejects with, or a function throws. */
async function errorOf(work: () => unknown): Promise<KeychainError> {
  try {
    await work();
  } catch (error) {
    expect(error).toBeInstanceOf(KeychainError);
    return error as KeychainError;
  }
  throw new Error('Expected an error.');
}

describe('the default store', () => {
  it('asks the native side for its service once, on first use', async () => {
    const { native, api } = setup();
    expect(native.getDefaultService).not.toHaveBeenCalled();
    expect(api.keychain.service).toBe('com.example.app');
    await api.keychain.setItem('a', '1');
    await api.keychain.getItem('a');
    expect(native.getDefaultService).toHaveBeenCalledTimes(1);
  });

  it('writes with the default options', async () => {
    const { native, api } = setup();
    await api.keychain.setItem('token', 'secret');
    expect(native.setItem).toHaveBeenCalledWith(
      { service: 'com.example.app' },
      'token',
      'secret',
      'utf8',
      DEFAULT_WRITE
    );
  });

  it('reads with the default prompt', async () => {
    const { native, api } = setup();
    native.getItem.mockResolvedValueOnce({ value: 'secret' });
    await expect(api.keychain.getItem('token')).resolves.toBe('secret');
    expect(native.getItem).toHaveBeenCalledWith({ service: 'com.example.app' }, 'token', 'utf8', {
      confirmationRequired: true,
    });
  });

  it('reads a missing item as null', async () => {
    const { api } = setup();
    await expect(api.keychain.getItem('missing')).resolves.toBeNull();
    await expect(api.keychain.getBytes('missing')).resolves.toBeNull();
    await expect(api.keychain.getCredentials()).resolves.toBeNull();
    expect(api.keychain.getItemSync('missing')).toBeNull();
  });

  it('keeps an empty value', async () => {
    const { native, api } = setup();
    native.getItem.mockResolvedValueOnce({ value: '' });
    await expect(api.keychain.getItem('empty')).resolves.toBe('');
  });
});

describe('a store of createKeychain', () => {
  it('passes its service and access group, and its options as defaults', async () => {
    const { native, api } = setup();
    const vault = api.createKeychain({
      service: 'vault',
      accessGroup: 'TEAM.shared',
      accessible: 'whenUnlockedThisDeviceOnly',
      accessControl: 'biometryAny',
      authValidity: 30,
      android: { keyStorage: 'strongbox' },
    });
    expect(vault.service).toBe('vault');
    await vault.setItem('dbKey', 'k');
    expect(native.getDefaultService).not.toHaveBeenCalled();
    expect(native.setItem).toHaveBeenCalledWith(
      { service: 'vault', accessGroup: 'TEAM.shared' },
      'dbKey',
      'k',
      'utf8',
      {
        accessible: 'whenUnlockedThisDeviceOnly',
        accessControl: 'biometryAny',
        authValidity: 30,
        synchronizable: false,
        keyStorage: 'strongbox',
      }
    );
  });

  it("lets a call's options override the store's", async () => {
    const { native, api } = setup();
    const vault = api.createKeychain({ accessControl: 'biometryAny', authValidity: 30 });
    await vault.setItem('a', '1', { accessControl: 'passcode' });
    expect(native.setItem.mock.calls[0]![4]).toEqual({
      ...DEFAULT_WRITE,
      accessControl: 'passcode',
      authValidity: 30,
    });
  });

  it('sends authValidity 0 without access control', async () => {
    const { native, api } = setup();
    const store = api.createKeychain({ authValidity: 60 });
    await store.setItem('a', '1');
    expect(native.setItem.mock.calls[0]![4].authValidity).toBe(0);
  });

  it("merges the prompt field by field, the call's over the store's", async () => {
    const { native, api } = setup();
    const vault = api.createKeychain({
      prompt: { title: 'Unlock', cancel: 'Cancel', confirmationRequired: false },
    });
    await vault.getItem('a', { prompt: { title: 'Unlock the vault', subtitle: 'Sub' } });
    expect(native.getItem.mock.calls[0]![3]).toEqual({
      title: 'Unlock the vault',
      subtitle: 'Sub',
      cancel: 'Cancel',
      confirmationRequired: false,
    });
  });

  it('does not touch the native side when made', () => {
    const { native, api } = setup();
    api.createKeychain({ service: 'vault' });
    expect(Object.values(native).every((method) => method.mock.calls.length === 0)).toBe(true);
  });
});

describe('bytes', () => {
  it('cross as Base64', async () => {
    const { native, api } = setup();
    await api.keychain.setBytes('key', Uint8Array.from([0, 1, 254, 255]));
    expect(native.setItem.mock.calls[0]!.slice(1, 4)).toEqual(['key', 'AAH+/w==', 'base64']);

    native.getItem.mockResolvedValueOnce({ value: 'AAH+/w==' });
    const bytes = await api.keychain.getBytes('key');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes!]).toEqual([0, 1, 254, 255]);
    expect(native.getItem.mock.calls[0]![2]).toBe('base64');
  });

  it('must be a Uint8Array', async () => {
    const { api } = setup();
    for (const value of ['text', [1, 2], new ArrayBuffer(2), null]) {
      const error = await errorOf(() =>
        api.keychain.setBytes('key', value as unknown as Uint8Array)
      );
      expect(error.code).toBe('INVALID_ARGUMENT');
    }
  });
});

describe('keys and values', () => {
  it.each([
    ['empty', ''],
    ['not a string', 42],
    ['undefined', undefined],
    ['257 characters', 'k'.repeat(257)],
    ['U+0000', 'a\0b'],
    ['a lone surrogate', 'a\ud800'],
  ])('rejects a key that is %s', async (_, key) => {
    const { native, api } = setup();
    const error = await errorOf(() => api.keychain.setItem(key as string, 'v'));
    expect(error.code).toBe('INVALID_ARGUMENT');
    expect(native.setItem).not.toHaveBeenCalled();
    expect(() => api.keychain.getItemSync(key as string)).toThrow(KeychainError);
  });

  it('takes any Unicode up to 256 characters', async () => {
    const { native, api } = setup();
    const key = '🔑'.repeat(256); // 512 UTF-16 units, 256 characters
    await api.keychain.setItem(key, 'v');
    await api.keychain.setItem('ключ доступа', 'v');
    expect(native.setItem).toHaveBeenCalledTimes(2);
  });

  it('rejects a value that is not a well-formed string', async () => {
    const { api } = setup();
    for (const value of [42, null, 'a\udc00b']) {
      const error = await errorOf(() => api.keychain.setItem('key', value as string));
      expect(error.code).toBe('INVALID_ARGUMENT');
    }
  });

  it('rejects U+0000 in every string that is stored, and takes it in bytes', async () => {
    const { native, api } = setup();
    const nul = 'a\0b';
    const cases: Array<() => unknown> = [
      () => api.keychain.setItem('key', nul),
      () => api.keychain.setItemSync('key', nul),
      () => api.keychain.setCredentials({ username: nul, password: 'p' }),
      () => api.keychain.setCredentials({ username: 'u', password: nul }),
    ];
    for (const work of cases) {
      const error = await errorOf(work);
      expect(error.code).toBe('INVALID_ARGUMENT');
      expect(error.message).toContain('U+0000');
    }
    expect((await errorOf(cases[0]!)).message).toContain('setBytes');
    expect(native.setItem).not.toHaveBeenCalled();
    expect(native.setItemSync).not.toHaveBeenCalled();

    await api.keychain.setBytes('key', Uint8Array.from([0x61, 0, 0x62]));
    expect(native.setItem.mock.calls[0]!.slice(1, 4)).toEqual(['key', 'YQBi', 'base64']);
  });

  it('checks the service', () => {
    const { api } = setup();
    expect(() => api.createKeychain({ service: '' })).toThrow(KeychainError);
    expect(() => api.createKeychain({ accessGroup: '' })).toThrow(KeychainError);
  });
});

describe('options', () => {
  it.each([
    [{ accesControl: 'biometryAny' }, "unknown option 'accesControl'"],
    [{ accessible: 'always' }, 'Invalid accessible'],
    [{ accessControl: 'faceID' }, 'Invalid accessControl'],
    [{ authValidity: -1 }, 'Invalid authValidity'],
    [{ authValidity: 1.5 }, 'Invalid authValidity'],
    [{ authValidity: '10' }, 'Invalid authValidity'],
    [{ synchronizable: 'yes' }, 'Invalid synchronizable'],
    [{ android: { keyStorage: 'hsm' } }, 'Invalid android.keyStorage'],
    [{ android: { strongbox: true } }, "unknown option 'strongbox'"],
    [{ label: 'x' }, "unknown option 'label'"],
    ['fast', 'expected an object'],
  ])('rejects %p', async (options, message) => {
    const { native, api } = setup();
    const error = await errorOf(() => api.keychain.setItem('key', 'v', options as never));
    expect(error.code).toBe('INVALID_ARGUMENT');
    expect(error.message).toContain(message);
    expect(native.setItem).not.toHaveBeenCalled();
  });

  it.each([
    [{ accessControl: 'biometryCurrentSet', authValidity: 10 }, 'authValidity'],
    [{ accessControl: 'biometryCurrentSetOrPasscode', authValidity: 1 }, 'authValidity'],
    [{ synchronizable: true, accessible: 'afterFirstUnlockThisDeviceOnly' }, 'ThisDeviceOnly'],
    [{ synchronizable: true, accessControl: 'passcode' }, 'access control'],
  ])('rejects the combination %p, in a store and in a call', async (options, message) => {
    const { api } = setup();
    expect(() => api.createKeychain(options as never)).toThrow(message);
    const error = await errorOf(() => api.keychain.setItem('key', 'v', options as never));
    expect(error.code).toBe('INVALID_ARGUMENT');
    expect(() => api.keychain.setItemSync('key', 'v', options as never)).toThrow(KeychainError);
  });

  it("rejects a combination made of the store's options and the call's", async () => {
    const { api } = setup();
    const store = api.createKeychain({ authValidity: 30, accessControl: 'biometryAny' });
    const error = await errorOf(() =>
      store.setItem('key', 'v', { accessControl: 'biometryCurrentSet' })
    );
    expect(error.code).toBe('INVALID_ARGUMENT');
  });

  it('takes the allowed combinations', async () => {
    const { native, api } = setup();
    await api.keychain.setItem('a', 'v', { accessControl: 'biometryCurrentSet', authValidity: 0 });
    await api.keychain.setItem('b', 'v', { synchronizable: true, accessible: 'whenUnlocked' });
    await api.keychain.setItem('c', 'v', { accessControl: 'biometryAny', authValidity: 300 });
    expect(native.setItem).toHaveBeenCalledTimes(3);
  });

  it('rejects unknown read options and prompt fields', async () => {
    const { api } = setup();
    expect((await errorOf(() => api.keychain.getItem('a', { promt: {} } as never))).code).toBe(
      'INVALID_ARGUMENT'
    );
    expect(
      (await errorOf(() => api.keychain.getItem('a', { prompt: { titel: 'x' } } as never))).code
    ).toBe('INVALID_ARGUMENT');
  });

  it('warns once in development that synchronizable is iOS only, on Android', async () => {
    const { native, api } = setup();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.replaceProperty(Platform, 'OS', 'android');
    await api.keychain.setItem('a', 'v', { synchronizable: true });
    await api.keychain.setItem('b', 'v', { synchronizable: true });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('[ApexKeychain] synchronizable is iOS only');
    expect(native.setItem.mock.calls[0]![4].synchronizable).toBe(true);
  });
});

describe('errors of the native side', () => {
  it('reject as KeychainError with the code and the native details', async () => {
    const { native, api } = setup();
    native.getItem.mockRejectedValueOnce(
      rejection('USER_CANCELED', 'Canceled.', { nativeCode: -2, nativeDomain: 'LAErrorDomain' })
    );
    const error = await errorOf(() => api.keychain.getItem('a'));
    expect([error.code, error.message, error.nativeCode, error.nativeDomain]).toEqual([
      'USER_CANCELED',
      'Canceled.',
      -2,
      'LAErrorDomain',
    ]);
  });

  it('of a synchronous method are thrown as KeychainError', () => {
    const { native, api } = setup();
    native.getItemSync.mockReturnValueOnce({
      error: { code: 'AUTH_REQUIRED', message: 'Needs a prompt.' },
    });
    expect(() => api.keychain.getItemSync('a')).toThrow(
      expect.objectContaining({ code: 'AUTH_REQUIRED', message: 'Needs a prompt.' })
    );
    native.removeItemSync.mockImplementationOnce(() => {
      throw new Error('Exception in HostFunction');
    });
    expect(() => api.keychain.removeItemSync('a')).toThrow(
      expect.objectContaining({ code: 'UNKNOWN' })
    );
  });

  it('of a missing module say what to do', async () => {
    const api = createApi(() => {
      throw new KeychainError('UNSUPPORTED', 'No module.');
    });
    expect((await errorOf(() => api.keychain.getItem('a'))).code).toBe('UNSUPPORTED');
    expect(() => api.keychain.service).toThrow('No module.');
    expect(() => api.keychain.hasItemSync('a')).toThrow('No module.');
    expect((await errorOf(() => api.isPasscodeSet())).code).toBe('UNSUPPORTED');
  });
});

describe('answers of the native side', () => {
  it('resolve a method without a value to undefined, whatever the native side resolves', async () => {
    const { native, api } = setup();
    // Android's TurboModule resolves a Promise<void> to null.
    const none = null as never;
    native.setItem.mockResolvedValue(none);
    native.removeItem.mockResolvedValue(none);
    native.clear.mockResolvedValue(none);
    await expect(api.keychain.setItem('a', 'v')).resolves.toBeUndefined();
    await expect(api.keychain.setBytes('a', Uint8Array.of(1))).resolves.toBeUndefined();
    await expect(api.keychain.removeItem('a')).resolves.toBeUndefined();
    await expect(api.keychain.clear()).resolves.toBeUndefined();
    await expect(
      api.keychain.setCredentials({ username: 'u', password: 'p' })
    ).resolves.toBeUndefined();
    await expect(api.keychain.removeCredentials()).resolves.toBeUndefined();
    expect(api.keychain.setItemSync('a', 'v')).toBeUndefined();
    expect(api.keychain.removeItemSync('a')).toBeUndefined();
  });

  it('turn an absent answer into null where there is no value', async () => {
    const { native, api } = setup();
    native.getBiometryState.mockResolvedValueOnce(undefined as never);
    native.getHardwareSecurityLevel.mockResolvedValueOnce(undefined as never);
    native.getItem.mockResolvedValueOnce(undefined as never);
    await expect(api.getBiometryState()).resolves.toBeNull();
    await expect(api.getHardwareSecurityLevel()).resolves.toBeNull();
    await expect(api.keychain.getItem('a')).resolves.toBeNull();
  });

  it('answer the sync methods', () => {
    const { native, api } = setup();
    native.getItemSync.mockReturnValueOnce({ value: 'v' });
    native.hasItemSync.mockReturnValueOnce({ value: true });
    expect(api.keychain.getItemSync('a')).toBe('v');
    expect(api.keychain.hasItemSync('a')).toBe(true);
    api.keychain.setItemSync('a', 'v');
    expect(native.setItemSync).toHaveBeenCalledWith(
      { service: 'com.example.app' },
      'a',
      'v',
      DEFAULT_WRITE
    );
  });
});

describe('credentials', () => {
  it('are an item with the user name as its label', async () => {
    const { native, api } = setup();
    await api.keychain.setCredentials({ username: 'ivan@example.com', password: 'p' });
    await api.keychain.setCredentials(
      { username: 'ivan', password: 'q' },
      { server: 'api.example.com', accessControl: 'biometryAny' }
    );
    expect(native.setItem.mock.calls[0]!.slice(1)).toEqual([
      'credentials',
      'p',
      'utf8',
      { ...DEFAULT_WRITE, label: 'ivan@example.com' },
    ]);
    expect(native.setItem.mock.calls[1]!.slice(1)).toEqual([
      'credentials:api.example.com',
      'q',
      'utf8',
      { ...DEFAULT_WRITE, accessControl: 'biometryAny', label: 'ivan' },
    ]);
  });

  it('are read with their label', async () => {
    const { native, api } = setup();
    native.getItem.mockResolvedValueOnce({ value: 'p', label: 'ivan' });
    await expect(api.keychain.getCredentials({ server: 's' })).resolves.toEqual({
      username: 'ivan',
      password: 'p',
    });
    expect(native.getItem.mock.calls[0]![1]).toBe('credentials:s');
  });

  it('are not an item without a label', async () => {
    const { native, api } = setup();
    native.getItem.mockResolvedValueOnce({ value: 'p' });
    expect((await errorOf(() => api.keychain.getCredentials())).code).toBe('INVALID_ARGUMENT');
  });

  it('check their input', async () => {
    const { api } = setup();
    const cases: Array<() => Promise<unknown>> = [
      () => api.keychain.setCredentials({ username: '', password: 'p' }),
      () => api.keychain.setCredentials({ username: 'u', password: 1 as never }),
      () => api.keychain.setCredentials({ username: 'u', password: 'p' }, { label: 'x' } as never),
      () => api.keychain.setCredentials({ username: 'u', password: 'p' }, { server: '' }),
      () => api.keychain.getCredentials({ server: 'x'.repeat(250) }),
      () => api.keychain.removeCredentials({ servr: 'x' } as never),
    ];
    for (const work of cases) expect((await errorOf(work)).code).toBe('INVALID_ARGUMENT');
  });

  it('are removed by their key', async () => {
    const { native, api } = setup();
    await api.keychain.removeCredentials();
    await api.keychain.removeCredentials({ server: 's' });
    expect(native.removeItem.mock.calls.map((call) => call[1])).toEqual([
      'credentials',
      'credentials:s',
    ]);
  });
});

describe('the device', () => {
  it('checks the access control and maps the answer', async () => {
    const { native, api } = setup();
    native.canUseAccessControl.mockResolvedValueOnce({ available: false, reason: 'notEnrolled' });
    await expect(api.canUseAccessControl('biometryAny')).resolves.toEqual({
      available: false,
      reason: 'notEnrolled',
    });
    await expect(api.canUseAccessControl('passcode')).resolves.toEqual({ available: true });
    expect((await errorOf(() => api.canUseAccessControl('face' as never))).code).toBe(
      'INVALID_ARGUMENT'
    );
  });

  it('passes the other answers on', async () => {
    const { native, api } = setup();
    native.getBiometryTypes.mockResolvedValueOnce(['fingerprint', 'face']);
    native.getHardwareSecurityLevel.mockResolvedValueOnce('tee');
    native.getBiometryState.mockResolvedValueOnce('state');
    await expect(api.getBiometryTypes()).resolves.toEqual(['fingerprint', 'face']);
    await expect(api.getHardwareSecurityLevel()).resolves.toBe('tee');
    await expect(api.getBiometryState()).resolves.toBe('state');
    await expect(api.isPasscodeSet()).resolves.toBe(true);
  });
});
