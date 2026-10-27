// `migrate`: moving what react-native-keychain and expo-secure-store left into this package, over the in-memory module
// (which plants the old items) and, for the paths that fail, over a fake native module.
import { createMigrate } from '../migrate/createMigrate';
import { createApi } from '../api';
import type * as Native from '../native/NativeApexKeychain';
import { createKeychain, keychain, keychainMock, migrate, compat, KeychainError } from '../jest';

const DEFAULT_SERVICE = 'dev.apexnative.keychain.mock';
const { migrateFromReactNativeKeychain, migrateFromExpoSecureStore, migrateItem } = migrate;

beforeEach(() => keychainMock.reset());

const rnk = (service: string, username = 'ivan', password = 'secret', more = {}) =>
  keychainMock.addMigrationSource({
    library: 'reactNativeKeychain',
    service,
    username,
    password,
    ...more,
  });
const internet = (server: string, username = 'anna', password = 'pw', more = {}) =>
  keychainMock.addMigrationSource({
    library: 'reactNativeKeychain',
    server,
    username,
    password,
    ...more,
  });
const expo = (key: string, value: string, more = {}) =>
  keychainMock.addMigrationSource({ library: 'expoSecureStore', key, value, ...more });

async function codeOf(work: () => unknown): Promise<string> {
  try {
    await work();
  } catch (error) {
    expect(error).toBeInstanceOf(KeychainError);
    return (error as KeychainError).code;
  }
  throw new Error('Expected an error.');
}

describe('react-native-keychain', () => {
  it('moves the generic password of the default service, and keeps the old one marked', async () => {
    rnk(DEFAULT_SERVICE, 'ivan', 'secret');
    rnk('auth', 'other', 'x');
    await expect(migrateFromReactNativeKeychain()).resolves.toEqual({
      migrated: [DEFAULT_SERVICE],
      skipped: [],
      warnings: [],
    });
    await expect(keychain.getCredentials()).resolves.toEqual({
      username: 'ivan',
      password: 'secret',
    });
    await expect(keychain.getItemInfo('credentials')).resolves.toMatchObject({ label: 'ivan' });
    expect(keychainMock.migrationSources()).toEqual([
      expect.objectContaining({ service: DEFAULT_SERVICE, migrated: true }),
      expect.objectContaining({ service: 'auth', migrated: false }),
    ]);
  });

  it('moves a generic password into the store of its own service, and the internet credentials under their server', async () => {
    rnk('auth', 'ivan', 'p1');
    rnk('work', 'anna', 'p2');
    internet('api.example.com', 'petr', 'p3');
    const report = await migrateFromReactNativeKeychain({
      services: ['auth'],
      servers: ['api.example.com'],
    });
    expect(report.migrated.sort()).toEqual(['api.example.com', 'auth']);
    expect(report.skipped).toEqual([]);
    await expect(createKeychain({ service: 'auth' }).getCredentials()).resolves.toEqual({
      username: 'ivan',
      password: 'p1',
    });
    await expect(keychain.getCredentials({ server: 'api.example.com' })).resolves.toEqual({
      username: 'petr',
      password: 'p3',
    });
    // 'work' was not named: it is not looked at.
    await expect(createKeychain({ service: 'work' }).getAllKeys()).resolves.toEqual([]);
    expect(keychainMock.migrationSources().find((item) => item.service === 'work')).toMatchObject({
      migrated: false,
    });
    await expect(keychain.getAllKeys()).resolves.toEqual(['credentials:api.example.com']);
  });

  it('writes into the store `into` the internet credentials, and leaves the generic ones to their stores', async () => {
    rnk('auth', 'ivan', 'p1');
    internet('api.example.com', 'petr', 'p3');
    const vault = createKeychain({ service: 'vault', accessible: 'whenUnlockedThisDeviceOnly' });
    await migrateFromReactNativeKeychain({
      services: ['auth'],
      servers: ['api.example.com'],
      into: vault,
    });
    await expect(vault.getAllKeys()).resolves.toEqual(['credentials:api.example.com']);
    await expect(vault.getItemInfo('credentials:api.example.com')).resolves.toMatchObject({
      accessible: 'whenUnlockedThisDeviceOnly',
    });
    await expect(createKeychain({ service: 'auth' }).getCredentials()).resolves.toBeTruthy();
    await expect(keychain.getAllKeys()).resolves.toEqual([]);
  });

  it('removes the old items when asked, after the new ones are written', async () => {
    rnk('auth');
    internet('api.example.com');
    await migrateFromReactNativeKeychain({
      services: ['auth'],
      servers: ['api.example.com'],
      removeSource: true,
    });
    expect(keychainMock.migrationSources()).toEqual([]);
    await expect(createKeychain({ service: 'auth' }).hasItem('credentials')).resolves.toBe(true);
  });

  it('runs again without harm: what was moved and kept is skipped as existing', async () => {
    rnk('auth');
    await migrateFromReactNativeKeychain({ services: ['auth'] });
    await expect(migrateFromReactNativeKeychain({ services: ['auth'] })).resolves.toEqual({
      migrated: [],
      skipped: [{ key: 'auth', kind: 'genericPassword', reason: 'exists' }],
      warnings: [],
    });
    // Even when the new item was removed since: an item that was moved is not read again.
    await createKeychain({ service: 'auth' }).removeCredentials();
    const again = await migrateFromReactNativeKeychain({ services: ['auth'] });
    expect(again.migrated).toEqual([]);
    await expect(createKeychain({ service: 'auth' }).hasItem('credentials')).resolves.toBe(false);
  });

  it('removes, in a later run, the old items an earlier run kept, once the new ones are there', async () => {
    rnk('auth');
    rnk('work');
    await migrateFromReactNativeKeychain({ services: ['auth', 'work'] });
    await createKeychain({ service: 'work' }).removeCredentials();
    const report = await migrateFromReactNativeKeychain({
      services: ['auth', 'work'],
      removeSource: true,
    });
    expect(report.migrated).toEqual([]);
    expect(report.skipped.map((item) => item.reason)).toEqual(['exists', 'exists']);
    // 'auth' has its new item, so the old one goes; 'work' lost it, and its old item is the only one left.
    expect(keychainMock.migrationSources().map((item) => item.service)).toEqual(['work']);
  });

  it('never overwrites a key that is taken, and leaves the old item as it is', async () => {
    rnk('auth', 'old', 'old password');
    await createKeychain({ service: 'auth' }).setCredentials({ username: 'new', password: 'kept' });
    const report = await migrateFromReactNativeKeychain({ services: ['auth'], removeSource: true });
    expect(report).toEqual({
      migrated: [],
      skipped: [{ key: 'auth', kind: 'genericPassword', reason: 'exists' }],
      warnings: [],
    });
    await expect(createKeychain({ service: 'auth' }).getCredentials()).resolves.toEqual({
      username: 'new',
      password: 'kept',
    });
    expect(keychainMock.migrationSources()).toEqual([
      expect.objectContaining({ service: 'auth', migrated: false }),
    ]);
  });

  it('skips a protected item without a prompt, and moves it with one through migrateItem', async () => {
    rnk('auth', 'ivan', 'locked', { requiresAuth: true });
    rnk('open', 'anna', 'open');
    const report = await migrateFromReactNativeKeychain({ services: ['auth', 'open'] });
    expect(report.migrated).toEqual(['open']);
    expect(report.skipped).toEqual([
      { key: 'auth', kind: 'genericPassword', reason: 'requiresAuth' },
    ]);
    expect(keychainMock.prompts()).toEqual([]);
    await expect(createKeychain({ service: 'auth' }).hasItem('credentials')).resolves.toBe(false);

    // A protected item is written protected: asking to write it without says so before any prompt.
    expect(
      await codeOf(() => migrateItem({ library: 'reactNativeKeychain', service: 'auth' }))
    ).toBe('INVALID_ARGUMENT');
    expect(
      await codeOf(() =>
        migrateItem(
          { library: 'reactNativeKeychain', service: 'auth' },
          { setOptions: { accessControl: 'none' } }
        )
      )
    ).toBe('INVALID_ARGUMENT');
    expect(keychainMock.prompts()).toEqual([]);

    await expect(
      migrateItem(
        { library: 'reactNativeKeychain', service: 'auth' },
        {
          prompt: { title: 'Move the password', cancel: 'Not now' },
          setOptions: { accessControl: 'biometryAny' },
          removeSource: true,
        }
      )
    ).resolves.toEqual({ migrated: ['auth'], skipped: [], warnings: [] });
    expect(keychainMock.prompts()).toEqual([
      expect.objectContaining({ title: 'Move the password', cancel: 'Not now', key: 'ivan' }),
    ]);
    const store = createKeychain({ service: 'auth' });
    await expect(store.getItemInfo('credentials')).resolves.toMatchObject({
      accessControl: 'biometryAny',
      label: 'ivan',
    });
    expect(keychainMock.migrationSources().map((item) => item.service)).toEqual(['open']);
  });

  it('reports a canceled prompt as an error, and the item can be moved after it', async () => {
    rnk('auth', 'ivan', 'locked', { requiresAuth: true });
    keychainMock.failNextAuthentication('USER_CANCELED');
    const options = { setOptions: { accessControl: 'biometryAny' } } as const;
    const report = await migrateItem({ library: 'reactNativeKeychain', service: 'auth' }, options);
    expect(report.migrated).toEqual([]);
    expect(report.skipped).toEqual([
      expect.objectContaining({ key: 'auth', reason: 'error', error: expect.any(KeychainError) }),
    ]);
    expect(report.skipped[0]!.error).toMatchObject({ code: 'USER_CANCELED' });
    expect(keychainMock.migrationSources()[0]).toMatchObject({ migrated: false });
    await expect(
      migrateItem({ library: 'reactNativeKeychain', service: 'auth' }, options)
    ).resolves.toMatchObject({ migrated: ['auth'] });
  });

  it('reports an item whose bytes are no text as an error with its code', async () => {
    rnk('auth', 'ivan', 'x', { corrupted: true });
    const report = await migrateFromReactNativeKeychain({ services: ['auth'] });
    expect(report.skipped).toEqual([expect.objectContaining({ key: 'auth', reason: 'error' })]);
    expect(report.skipped[0]!.error).toMatchObject({ code: 'DATA_CORRUPTED' });
    await expect(createKeychain({ service: 'auth' }).hasItem('credentials')).resolves.toBe(false);
    expect(keychainMock.migrationSources()[0]).toMatchObject({ migrated: false });
  });

  it('finds a generic password, or internet credentials, one at a time', async () => {
    rnk(DEFAULT_SERVICE, 'ivan', 'p1');
    internet('api.example.com', 'anna', 'p2');
    await expect(migrateItem({ library: 'reactNativeKeychain' })).resolves.toMatchObject({
      migrated: [DEFAULT_SERVICE],
    });
    await expect(
      migrateItem({ library: 'reactNativeKeychain', server: 'api.example.com' })
    ).resolves.toMatchObject({ migrated: ['api.example.com'] });
    await expect(
      migrateItem({ library: 'reactNativeKeychain', server: 'nobody.example.com' })
    ).resolves.toEqual({
      migrated: [],
      skipped: [{ key: 'nobody.example.com', kind: 'internetPassword', reason: 'notFound' }],
      warnings: [],
    });
    await expect(
      migrateItem({ library: 'reactNativeKeychain', service: 'missing' })
    ).resolves.toMatchObject({ skipped: [{ key: 'missing', reason: 'notFound' }] });
  });

  it('makes what it moves known to the compatibility layer', async () => {
    rnk('auth', 'ivan', 'p1');
    rnk(DEFAULT_SERVICE, 'anna', 'p2');
    await migrateFromReactNativeKeychain({ services: ['auth', DEFAULT_SERVICE] });
    await expect(compat.getAllGenericPasswordServices()).resolves.toEqual([
      DEFAULT_SERVICE,
      'auth',
    ]);
    await expect(compat.getGenericPassword({ service: 'auth' })).resolves.toMatchObject({
      service: 'auth',
      username: 'ivan',
      password: 'p1',
    });
    await expect(compat.getGenericPassword()).resolves.toMatchObject({ username: 'anna' });
  });

  it('looks in the access group it is told, and writes the new item to the group of the old one', async () => {
    const fake = fakeNative();
    fake.getMigrationSources.mockResolvedValue([
      source({
        kind: 'genericPassword',
        service: 'auth',
        account: 'u',
        accessGroup: 'TEAM.shared',
      }),
    ]);
    fake.readMigrationSource.mockResolvedValue('p');
    const created: unknown[] = [];
    const api = createApi(() => fake);
    const spying = {
      keychain: api.keychain,
      createKeychain: (options?: Parameters<typeof api.createKeychain>[0]) => {
        created.push(options);
        return api.createKeychain(options);
      },
    };
    const { migrateFromReactNativeKeychain: run } = createMigrate(() => fake, spying);
    await run({ services: ['auth'], accessGroup: 'TEAM.shared' });
    expect(fake.getMigrationSources).toHaveBeenCalledWith({
      library: 'reactNativeKeychain',
      services: ['auth'],
      servers: [],
      accessGroup: 'TEAM.shared',
    });
    expect(created).toContainEqual({ service: 'auth', accessGroup: 'TEAM.shared' });
    expect(fake.setItem.mock.calls[0]![0]).toEqual({ service: 'auth', accessGroup: 'TEAM.shared' });
  });
});

describe('expo-secure-store', () => {
  it('moves the items of the default keychainService under their keys', async () => {
    expo('token', 'abc');
    expo('пароль', 'ключ 🔑');
    expo('elsewhere', 'x', { keychainService: 'other' });
    const report = await migrateFromExpoSecureStore();
    expect(report.migrated.sort()).toEqual(['token', 'пароль']);
    expect(report.skipped).toEqual([]);
    await expect(keychain.getItem('token')).resolves.toBe('abc');
    await expect(keychain.getItem('пароль')).resolves.toBe('ключ 🔑');
    await expect(keychain.hasItem('elsewhere')).resolves.toBe(false);
  });

  it('moves the items of the keychainServices it is told into the store `into`', async () => {
    expo('a', '1', { keychainService: 'one' });
    expo('b', '2', { keychainService: 'two' });
    expo('c', '3');
    const vault = createKeychain({ service: 'vault' });
    const report = await migrateFromExpoSecureStore({
      keychainService: ['one', 'two'],
      into: vault,
      removeSource: true,
    });
    expect(report.migrated.sort()).toEqual(['a', 'b']);
    await expect(vault.getAllKeys()).resolves.toEqual(['a', 'b']);
    expect(keychainMock.migrationSources().map((item) => item.account)).toEqual(['c']);
    await expect(
      migrateFromExpoSecureStore({ keychainService: 'one', into: vault })
    ).resolves.toEqual({
      migrated: [],
      skipped: [],
      warnings: [],
    });
  });

  it('never overwrites a key, skips the protected, and moves them one at a time', async () => {
    expo('taken', 'old');
    expo('locked', 'secret', { requiresAuth: true });
    expo('free', 'v');
    await keychain.setItem('taken', 'kept');
    const report = await migrateFromExpoSecureStore();
    expect(report.migrated).toEqual(['free']);
    expect(report.skipped).toEqual([
      { key: 'taken', kind: 'secureStore', reason: 'exists' },
      { key: 'locked', kind: 'secureStore', reason: 'requiresAuth' },
    ]);
    await expect(keychain.getItem('taken')).resolves.toBe('kept');

    await expect(
      migrateItem(
        { library: 'expoSecureStore', key: 'locked' },
        { setOptions: { accessControl: 'passcode' }, removeSource: true }
      )
    ).resolves.toMatchObject({ migrated: ['locked'] });
    expect(keychainMock.prompts()).toHaveLength(1);
    await expect(keychain.getItemInfo('locked')).resolves.toMatchObject({
      accessControl: 'passcode',
    });
    await expect(
      migrateItem({ library: 'expoSecureStore', key: 'missing' })
    ).resolves.toMatchObject({
      skipped: [{ key: 'missing', kind: 'secureStore', reason: 'notFound' }],
    });
    await expect(
      migrateItem({ library: 'expoSecureStore', key: 'x', keychainService: 'other' })
    ).resolves.toMatchObject({ skipped: [{ reason: 'notFound' }] });
  });

  it('reports an item that can not be written as an error, and does not touch the old one', async () => {
    expo('bad key', 'v');
    keychainMock.addMigrationSource({ library: 'expoSecureStore', key: 'a\0b', value: 'v' });
    const report = await migrateFromExpoSecureStore({ removeSource: true });
    expect(report.migrated).toEqual(['bad key']);
    expect(report.skipped).toEqual([expect.objectContaining({ key: 'a\0b', reason: 'error' })]);
    expect(report.skipped[0]!.error).toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(keychainMock.migrationSources().map((item) => item.account)).toEqual(['a\0b']);
  });
});

describe('the options', () => {
  it.each([
    [
      'an option it does not know',
      () => migrateFromReactNativeKeychain({ servises: ['a'] } as never),
    ],
    [
      'services that are no names',
      () => migrateFromReactNativeKeychain({ services: [1] } as never),
    ],
    ['an empty service', () => migrateFromReactNativeKeychain({ services: [''] })],
    [
      'a keychainService that is a number',
      () => migrateFromExpoSecureStore({ keychainService: 1 } as never),
    ],
    ['an into that is no store', () => migrateFromExpoSecureStore({ into: {} as never })],
    [
      'a removeSource that is not a boolean',
      () => migrateFromExpoSecureStore({ removeSource: 'yes' as never }),
    ],
    ['options that are no object', () => migrateFromExpoSecureStore('app' as never)],
    ['an item of an unknown library', () => migrateItem({ library: 'other' } as never)],
    [
      'an item of expo-secure-store without a key',
      () => migrateItem({ library: 'expoSecureStore' } as never),
    ],
    [
      'an item with a service and a server',
      () => migrateItem({ library: 'reactNativeKeychain', service: 'a', server: 'b' } as never),
    ],
    [
      'a prompt with an unknown field',
      () =>
        migrateItem({ library: 'expoSecureStore', key: 'k' }, { prompt: { titel: 'x' } } as never),
    ],
    [
      'setOptions with an unknown option',
      () =>
        migrateItem({ library: 'expoSecureStore', key: 'k' }, {
          setOptions: { accesControl: 'passcode' },
        } as never),
    ],
  ])('reject %s with INVALID_ARGUMENT', async (_, work) => {
    expect(await codeOf(work)).toBe('INVALID_ARGUMENT');
  });
});

function source(partial: Partial<Native.MigrationSource>): Native.MigrationSource {
  return {
    kind: 'genericPassword',
    service: 's',
    account: 'a',
    requiresAuth: false,
    migrated: false,
    ...partial,
  };
}

function fakeNative() {
  return {
    setItem: jest.fn(async (..._: Parameters<Native.Spec['setItem']>) => {}),
    getItem: jest.fn(async (): Promise<Native.Item | null> => null),
    removeItem: jest.fn(async () => {}),
    hasItem: jest.fn(async () => false),
    getItemInfo: jest.fn(async () => null),
    getAllKeys: jest.fn(async (): Promise<ReadonlyArray<string>> => []),
    clear: jest.fn(async () => {}),
    getItemSync: jest.fn((): Native.SyncValueResult => ({})),
    setItemSync: jest.fn((): Native.SyncResult => ({})),
    hasItemSync: jest.fn((): Native.SyncBooleanResult => ({ value: false })),
    removeItemSync: jest.fn((): Native.SyncResult => ({})),
    getDefaultService: jest.fn(() => 'com.example.app'),
    getBiometryTypes: jest.fn(async () => []),
    canUseAccessControl: jest.fn(async () => ({ available: true })),
    isPasscodeSet: jest.fn(async () => true),
    getBiometryState: jest.fn(async () => null),
    getHardwareSecurityLevel: jest.fn(async () => null),
    getMigrationSources: jest.fn(async (): Promise<ReadonlyArray<Native.MigrationSource>> => []),
    readMigrationSource: jest.fn(async (): Promise<string | null> => null),
    finishMigrationSource: jest.fn(async () => {}),
  } as unknown as jest.Mocked<Native.Spec>;
}

describe('what goes wrong with the native side', () => {
  const setup = () => {
    const fake = fakeNative();
    const api = createApi(() => fake);
    return { fake, ...createMigrate(() => fake, api) };
  };

  it('skips an item that is gone as not found, and finishes nothing', async () => {
    const { fake, migrateFromExpoSecureStore: run } = setup();
    fake.getMigrationSources.mockResolvedValue([source({ kind: 'secureStore', account: 'k' })]);
    fake.readMigrationSource.mockResolvedValue(null);
    await expect(run()).resolves.toEqual({
      migrated: [],
      skipped: [{ key: 'k', kind: 'secureStore', reason: 'notFound' }],
      warnings: [],
    });
    expect(fake.setItem).not.toHaveBeenCalled();
    expect(fake.finishMigrationSource).not.toHaveBeenCalled();
  });

  it('finishes the old item only after the new one is written, and not when the write fails', async () => {
    const { fake, migrateFromExpoSecureStore: run } = setup();
    const order: string[] = [];
    fake.getMigrationSources.mockResolvedValue([
      source({ kind: 'secureStore', account: 'ok' }),
      source({ kind: 'secureStore', account: 'bad' }),
    ]);
    fake.readMigrationSource.mockResolvedValue('v');
    fake.setItem.mockImplementation(async (_store, key) => {
      order.push(`write ${key}`);
      if (key === 'bad') {
        throw Object.assign(new Error('disk full'), { code: 'UNKNOWN' });
      }
    });
    fake.finishMigrationSource.mockImplementation(async (item) => {
      order.push(`finish ${item.account}`);
    });
    const report = await run({ removeSource: true });
    expect(report.migrated).toEqual(['ok']);
    expect(report.skipped).toEqual([expect.objectContaining({ key: 'bad', reason: 'error' })]);
    expect(report.skipped[0]!.error).toMatchObject({ code: 'UNKNOWN', message: 'disk full' });
    expect(order).toEqual(['write ok', 'finish ok', 'write bad']);
    expect(fake.finishMigrationSource).toHaveBeenCalledWith(
      expect.objectContaining({ account: 'ok' }),
      true
    );
  });

  it('counts an item as moved when only its old item can not be finished, and says so', async () => {
    const { fake, migrateFromExpoSecureStore: run } = setup();
    fake.getMigrationSources.mockResolvedValue([source({ kind: 'secureStore', account: 'k' })]);
    fake.readMigrationSource.mockResolvedValue('v');
    fake.finishMigrationSource.mockRejectedValue(
      Object.assign(new Error('locked'), { code: 'INTERACTION_NOT_ALLOWED' })
    );
    const report = await run({ removeSource: true });
    expect(report.migrated).toEqual(['k']);
    expect(report.skipped).toEqual([]);
    expect(report.warnings).toEqual([expect.objectContaining({ key: 'k', kind: 'secureStore' })]);
    expect(report.warnings[0]!.error).toMatchObject({ code: 'INTERACTION_NOT_ALLOWED' });
  });

  it('rejects, with the code, when the native side can not look for old items', async () => {
    const { fake, migrateFromReactNativeKeychain: run } = setup();
    fake.getMigrationSources.mockRejectedValue(
      Object.assign(new Error("isn't implemented"), { code: 'UNSUPPORTED' })
    );
    expect(await codeOf(() => run())).toBe('UNSUPPORTED');
    expect(await codeOf(() => migrateItemOf(fake))).toBe('UNSUPPORTED');
  });

  it('passes the prompt the caller made up, and a default one for the rest', async () => {
    const { fake, migrateItem: run } = setup();
    fake.getMigrationSources.mockResolvedValue([
      source({ kind: 'secureStore', account: 'k', requiresAuth: true }),
    ]);
    fake.readMigrationSource.mockResolvedValue('v');
    await run(
      { library: 'expoSecureStore', key: 'k' },
      { prompt: { title: 'Move it' }, setOptions: { accessControl: 'biometryAny' } }
    );
    expect(fake.readMigrationSource).toHaveBeenCalledWith(
      expect.objectContaining({ account: 'k' }),
      { title: 'Move it', confirmationRequired: true }
    );
    expect(fake.setItem.mock.calls[0]![4]).toMatchObject({ accessControl: 'biometryAny' });
  });
});

function migrateItemOf(fake: jest.Mocked<Native.Spec>) {
  return createMigrate(
    () => fake,
    createApi(() => fake)
  ).migrateItem({
    library: 'expoSecureStore',
    key: 'k',
  });
}

describe('the mock', () => {
  it('plants an item once, forgets the items on reset, and keeps every kind apart', async () => {
    rnk('auth', 'a', '1');
    rnk('auth', 'a', '2');
    expect(keychainMock.migrationSources()).toHaveLength(1);
    await migrateFromReactNativeKeychain({ services: ['auth'] });
    await expect(createKeychain({ service: 'auth' }).getCredentials()).resolves.toEqual({
      username: 'a',
      password: '2',
    });

    // The Keychain keeps an item per account: two accounts of one service are two items, as in the real thing.
    rnk('work', 'a', '1');
    rnk('work', 'b', '2');
    internet('api', 'u', 'p');
    expo('k', 'v');
    expect(
      keychainMock.migrationSources().map((item) => [item.kind, item.service, item.account])
    ).toEqual([
      ['genericPassword', 'auth', 'a'],
      ['genericPassword', 'work', 'a'],
      ['genericPassword', 'work', 'b'],
      ['internetPassword', 'api', 'u'],
      ['secureStore', 'app', 'k'],
    ]);
    keychainMock.reset();
    expect(keychainMock.migrationSources()).toEqual([]);
  });

  it('finds the items of an access group, and only those, when one is named', async () => {
    rnk('one', 'a', '1', { accessGroup: 'TEAM.one' });
    rnk('two', 'b', '2', { accessGroup: 'TEAM.two' });
    rnk('none', 'c', '3');
    const { migrated } = await migrateFromReactNativeKeychain({
      services: ['one', 'two', 'none'],
      accessGroup: 'TEAM.two',
    });
    expect(migrated).toEqual(['two']);
    const all = await migrateFromReactNativeKeychain({ services: ['one', 'two', 'none'] });
    expect(all.migrated.sort()).toEqual(['none', 'one']);
    expect(all.skipped).toEqual([{ key: 'two', kind: 'genericPassword', reason: 'exists' }]);
  });
});

describe('the compatibility layer over the same memory', () => {
  it('reads what was moved, as react-native-keychain did', async () => {
    rnk('auth', 'ivan', 'p1');
    internet('api.example.com', 'anna', 'p2');
    await migrateFromReactNativeKeychain({ services: ['auth'], servers: ['api.example.com'] });
    await expect(compat.getGenericPassword({ service: 'auth' })).resolves.toMatchObject({
      username: 'ivan',
      password: 'p1',
    });
    await expect(compat.getInternetCredentials('api.example.com')).resolves.toMatchObject({
      server: 'api.example.com',
      username: 'anna',
      password: 'p2',
    });
  });
});
