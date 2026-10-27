// The compatibility layer: the functions of react-native-keychain 10 over this package's core, run over the in-memory
// module. What rnk answers, the layer answers; what the package can't do is UNSUPPORTED.
import { Platform } from 'react-native';
import { createCompat } from '../compat/createCompat';
import * as compatEnums from '../compat/enums';
import {
  createKeychain,
  getBiometryState,
  getBiometryTypes,
  getHardwareSecurityLevel,
  canUseAccessControl,
  isPasscodeSet,
  keychain,
  keychainMock,
  KeychainError,
} from '../jest';

const compat = createCompat({
  keychain,
  createKeychain,
  getBiometryTypes,
  canUseAccessControl,
  isPasscodeSet,
  getBiometryState,
  getHardwareSecurityLevel,
});
const {
  ACCESS_CONTROL,
  ACCESSIBLE,
  AUTHENTICATION_TYPE,
  BIOMETRY_TYPE,
  SECURITY_LEVEL,
  STORAGE_TYPE,
} = compatEnums;

beforeEach(() => keychainMock.reset());

async function codeOf(work: () => unknown): Promise<string> {
  try {
    await work();
  } catch (error) {
    expect(error).toBeInstanceOf(KeychainError);
    return (error as KeychainError).code;
  }
  throw new Error('Expected an error.');
}

describe('the constants', () => {
  it('have the names and the strings of react-native-keychain 10', () => {
    expect(ACCESSIBLE).toEqual({
      WHEN_UNLOCKED: 'AccessibleWhenUnlocked',
      AFTER_FIRST_UNLOCK: 'AccessibleAfterFirstUnlock',
      ALWAYS: 'AccessibleAlways',
      WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'AccessibleWhenPasscodeSetThisDeviceOnly',
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly',
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AccessibleAfterFirstUnlockThisDeviceOnly',
    });
    expect(ACCESS_CONTROL).toEqual({
      USER_PRESENCE: 'UserPresence',
      BIOMETRY_ANY: 'BiometryAny',
      BIOMETRY_CURRENT_SET: 'BiometryCurrentSet',
      DEVICE_PASSCODE: 'DevicePasscode',
      APPLICATION_PASSWORD: 'ApplicationPassword',
      BIOMETRY_ANY_OR_DEVICE_PASSCODE: 'BiometryAnyOrDevicePasscode',
      BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE: 'BiometryCurrentSetOrDevicePasscode',
    });
    expect(AUTHENTICATION_TYPE).toEqual({
      DEVICE_PASSCODE_OR_BIOMETRICS: 'AuthenticationWithBiometricsDevicePasscode',
      BIOMETRICS: 'AuthenticationWithBiometrics',
    });
    expect(BIOMETRY_TYPE).toEqual({
      TOUCH_ID: 'TouchID',
      FACE_ID: 'FaceID',
      OPTIC_ID: 'OpticID',
      FINGERPRINT: 'Fingerprint',
      FACE: 'Face',
      IRIS: 'Iris',
    });
    expect(SECURITY_LEVEL).toEqual({
      ANY: 'ANY',
      SECURE_SOFTWARE: 'SECURE_SOFTWARE',
      SECURE_HARDWARE: 'SECURE_HARDWARE',
    });
    expect(STORAGE_TYPE).toEqual({
      AES_CBC: 'KeystoreAESCBC',
      AES_GCM_NO_AUTH: 'KeystoreAESGCM_NoAuth',
      AES_GCM: 'KeystoreAESGCM',
      RSA: 'KeystoreRSAECB',
    });
  });
});

describe('generic passwords', () => {
  it('are written, read, found and reset, as rnk answers', async () => {
    await expect(compat.getGenericPassword()).resolves.toBe(false);
    await expect(compat.hasGenericPassword()).resolves.toBe(false);
    await expect(compat.setGenericPassword('ivan', 'secret')).resolves.toEqual({
      service: 'dev.apexnative.keychain.mock',
      storage: 'keychain',
    });
    await expect(compat.getGenericPassword()).resolves.toEqual({
      service: 'dev.apexnative.keychain.mock',
      username: 'ivan',
      password: 'secret',
      storage: 'keychain',
    });
    await expect(compat.hasGenericPassword()).resolves.toBe(true);
    await expect(compat.resetGenericPassword()).resolves.toBe(true);
    await expect(compat.getGenericPassword()).resolves.toBe(false);
    await expect(compat.resetGenericPassword()).resolves.toBe(true);
  });

  it('are the credentials of the store of their service: the default service is the default store', async () => {
    await compat.setGenericPassword('ivan', 'p1');
    await compat.setGenericPassword('anna', 'p2', { service: 'work' });
    await expect(keychain.getCredentials()).resolves.toEqual({ username: 'ivan', password: 'p1' });
    const work = createKeychain({ service: 'work' });
    await expect(work.getCredentials()).resolves.toEqual({ username: 'anna', password: 'p2' });
    await expect(work.getItemInfo('credentials')).resolves.toMatchObject({ label: 'anna' });
    await expect(work.getAllKeys()).resolves.toEqual(['credentials']);
    // Nothing of it is in the default store but the app's own.
    await expect(keychain.getAllKeys()).resolves.toEqual(['credentials']);
    await expect(compat.getGenericPassword({ service: 'work' })).resolves.toMatchObject({
      service: 'work',
      username: 'anna',
    });
    // Naming the default service is not naming another one.
    await expect(
      compat.getGenericPassword({ service: 'dev.apexnative.keychain.mock' })
    ).resolves.toMatchObject({ username: 'ivan' });

    await compat.resetGenericPassword({ service: 'work' });
    await expect(compat.hasGenericPassword({ service: 'work' })).resolves.toBe(false);
    await expect(compat.hasGenericPassword()).resolves.toBe(true);
  });

  it('are listed by service: the default one, and those written through the layer that still have one', async () => {
    await expect(compat.getAllGenericPasswordServices()).resolves.toEqual([]);
    await compat.setGenericPassword('a', '1');
    await compat.setGenericPassword('b', '2', { service: 'work' });
    await compat.setGenericPassword('c', '3', { service: 'auth' });
    await compat.setInternetCredentials('api.example.com', 'd', '4');
    await keychain.setItem('unrelated', 'x');
    await expect(compat.getAllGenericPasswordServices()).resolves.toEqual([
      'dev.apexnative.keychain.mock',
      'auth',
      'work',
    ]);
    await expect(compat.getAllGenericPasswordServices({ skipUIAuth: true })).resolves.toHaveLength(
      3
    );
    await compat.resetGenericPassword({ service: 'auth' });
    // A service whose credentials were removed some other way is not listed, though the list still names it.
    await createKeychain({ service: 'work' }).removeCredentials();
    await expect(compat.getAllGenericPasswordServices()).resolves.toEqual([
      'dev.apexnative.keychain.mock',
    ]);
    await compat.resetGenericPassword();
    await expect(compat.getAllGenericPasswordServices()).resolves.toEqual([]);
  });

  it('keep the list of services apart from the default store, and write many at once', async () => {
    await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((service) => compat.setGenericPassword('u', 'p', { service }))
    );
    await expect(compat.getAllGenericPasswordServices()).resolves.toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
    await expect(keychain.getAllKeys()).resolves.toEqual([]);
  });

  it('take the options of rnk: accessible, accessControl, cloudSync', async () => {
    await compat.setGenericPassword('u', 'p', {
      service: 'a',
      accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      accessControl: ACCESS_CONTROL.BIOMETRY_CURRENT_SET,
    });
    await expect(
      createKeychain({ service: 'a' }).getItemInfo('credentials')
    ).resolves.toMatchObject({
      accessible: 'whenUnlockedThisDeviceOnly',
      accessControl: 'biometryCurrentSet',
    });
    await compat.setGenericPassword('u', 'p', {
      service: 'b',
      accessControl: ACCESS_CONTROL.USER_PRESENCE,
    });
    await compat.setGenericPassword('u', 'p', {
      service: 'c',
      accessControl: ACCESS_CONTROL.DEVICE_PASSCODE,
    });
    await compat.setGenericPassword('u', 'p', { service: 'd', cloudSync: true });
    const info = async (name: string) =>
      (await createKeychain({ service: name }).getItemInfo('credentials'))!;
    expect((await info('b')).accessControl).toBe('biometryAnyOrPasscode');
    expect((await info('c')).accessControl).toBe('passcode');
    expect((await info('d')).synchronizable).toBe(true);
    await compat.setGenericPassword('u', 'p', {
      service: 'e',
      accessControl: ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
    });
    await compat.setGenericPassword('u', 'p', {
      service: 'f',
      accessControl: ACCESS_CONTROL.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE,
    });
    expect((await info('e')).accessControl).toBe('biometryAnyOrPasscode');
    expect((await info('f')).accessControl).toBe('biometryCurrentSetOrPasscode');
    // The prompt is not part of a write.
    expect(keychainMock.prompts()).toEqual([]);
  });

  it('show the prompt of rnk, its default texts included', async () => {
    await compat.setGenericPassword('u', 'p', { accessControl: ACCESS_CONTROL.BIOMETRY_ANY });
    await compat.getGenericPassword();
    await compat.getGenericPassword({ authenticationPrompt: 'Sign in' });
    await compat.getGenericPassword({
      authenticationPrompt: {
        title: 'Unlock',
        subtitle: 'Sub',
        description: 'Desc',
        cancel: 'Back',
      },
    });
    expect(
      keychainMock.prompts().map(({ key: _, confirmationRequired: __, ...texts }) => texts)
    ).toEqual([
      { title: 'Authenticate to retrieve secret', cancel: 'Cancel' },
      { title: 'Sign in', cancel: 'Cancel' },
      { title: 'Unlock', subtitle: 'Sub', description: 'Desc', cancel: 'Back' },
    ]);
  });

  it('fail as the prompt fails, with the code of the core', async () => {
    await compat.setGenericPassword('u', 'p', { accessControl: ACCESS_CONTROL.BIOMETRY_ANY });
    keychainMock.failNextAuthentication('USER_CANCELED');
    expect(await codeOf(() => compat.getGenericPassword())).toBe('USER_CANCELED');
    keychainMock.setDevice({ biometryEnrolled: false });
    expect(
      await codeOf(() =>
        compat.setGenericPassword('u', 'p', { accessControl: ACCESS_CONTROL.BIOMETRY_ANY })
      )
    ).toBe('BIOMETRY_NOT_ENROLLED');
  });

  it('check what they are given, with the checks of the core', async () => {
    expect(await codeOf(() => compat.setGenericPassword('', 'p'))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(() => compat.setGenericPassword('u', 'a\0b'))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(() => compat.setGenericPassword('u', 'p', { service: '' }))).toBe(
      'INVALID_ARGUMENT'
    );
    expect(
      await codeOf(() => compat.setGenericPassword('u', 'p', { accessible: 'x' as never }))
    ).toBe('INVALID_ARGUMENT');
    expect(await codeOf(() => compat.setGenericPassword('u', 'p', 'options' as never))).toBe(
      'INVALID_ARGUMENT'
    );
  });

  it('ignore the options rnk ignores', async () => {
    await compat.setGenericPassword('u', 'p', {
      showModal: true,
      kLocalizedFallbackTitle: 'x',
    } as never);
    await expect(compat.getGenericPassword()).resolves.toMatchObject({ username: 'u' });
  });
});

describe('what the package does not do', () => {
  it.each([
    [
      'the storage option',
      () => compat.setGenericPassword('u', 'p', { storage: STORAGE_TYPE.AES_GCM }),
    ],
    [
      'ACCESSIBLE.ALWAYS',
      () => compat.setGenericPassword('u', 'p', { accessible: ACCESSIBLE.ALWAYS }),
    ],
    [
      'ACCESS_CONTROL.APPLICATION_PASSWORD',
      () =>
        compat.setGenericPassword('u', 'p', { accessControl: ACCESS_CONTROL.APPLICATION_PASSWORD }),
    ],
    [
      'ACCESS_CONTROL.APPLICATION_PASSWORD on a read',
      () => compat.getGenericPassword({ accessControl: ACCESS_CONTROL.APPLICATION_PASSWORD }),
    ],
    ['requestSharedWebCredentials', () => compat.requestSharedWebCredentials()],
    ['setSharedWebCredentials', () => compat.setSharedWebCredentials('example.com', 'u', 'p')],
  ])('is UNSUPPORTED, saying what: %s', async (what, work) => {
    const error = await work().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(KeychainError);
    expect(error).toMatchObject({ code: 'UNSUPPORTED' });
    expect((error as Error).message).toContain('@apexnative/keychain/compat');
    await expect(keychain.getAllKeys()).resolves.toEqual([]);
    expect(what).toBeTruthy();
  });
});

describe('internet credentials', () => {
  it('are written, read, found and reset by server', async () => {
    await expect(compat.getInternetCredentials('api.example.com')).resolves.toBe(false);
    await expect(compat.hasInternetCredentials('api.example.com')).resolves.toBe(false);
    await expect(
      compat.setInternetCredentials('api.example.com', 'ivan', 'secret')
    ).resolves.toEqual({ service: 'api.example.com', storage: 'keychain' });
    await expect(compat.getInternetCredentials('api.example.com')).resolves.toEqual({
      server: 'api.example.com',
      service: 'api.example.com',
      username: 'ivan',
      password: 'secret',
      storage: 'keychain',
    });
    await expect(compat.hasInternetCredentials('api.example.com')).resolves.toBe(true);
    await expect(compat.hasInternetCredentials({ server: 'api.example.com' })).resolves.toBe(true);
    await expect(compat.hasInternetCredentials({ server: 'other.example.com' })).resolves.toBe(
      false
    );
    await expect(keychain.getCredentials({ server: 'api.example.com' })).resolves.toEqual({
      username: 'ivan',
      password: 'secret',
    });

    await expect(
      compat.resetInternetCredentials({ server: 'api.example.com' })
    ).resolves.toBeUndefined();
    await expect(compat.getInternetCredentials('api.example.com')).resolves.toBe(false);
    await compat.setInternetCredentials('api.example.com', 'ivan', 'secret');
    await expect(compat.resetInternetCredentials('api.example.com')).resolves.toBeUndefined();
    await expect(compat.hasInternetCredentials('api.example.com')).resolves.toBe(false);
  });

  it('need a server', async () => {
    expect(await codeOf(() => compat.setInternetCredentials('', 'u', 'p'))).toBe(
      'INVALID_ARGUMENT'
    );
    expect(await codeOf(() => compat.hasInternetCredentials({}))).toBe('INVALID_ARGUMENT');
    expect(await codeOf(() => compat.resetInternetCredentials({}))).toBe('INVALID_ARGUMENT');
  });
});

describe('the device', () => {
  it('answers getSupportedBiometryType as rnk does: what is enrolled, or null', async () => {
    await expect(compat.getSupportedBiometryType()).resolves.toBe(BIOMETRY_TYPE.FACE_ID);
    keychainMock.setDevice({ biometryTypes: ['touchID'] });
    await expect(compat.getSupportedBiometryType()).resolves.toBe('TouchID');
    keychainMock.setDevice({ biometryTypes: ['fingerprint', 'face'] });
    await expect(compat.getSupportedBiometryType()).resolves.toBe('Fingerprint');
    keychainMock.setDevice({ biometryEnrolled: false });
    await expect(compat.getSupportedBiometryType()).resolves.toBeNull();
    keychainMock.setDevice({ biometryTypes: [], biometryEnrolled: true });
    await expect(compat.getSupportedBiometryType()).resolves.toBeNull();
  });

  it('answers canImplyAuthentication and isPasscodeAuthAvailable', async () => {
    await expect(compat.canImplyAuthentication()).resolves.toBe(true);
    await expect(
      compat.canImplyAuthentication({ authenticationType: AUTHENTICATION_TYPE.BIOMETRICS })
    ).resolves.toBe(true);
    keychainMock.setDevice({ biometryEnrolled: false });
    await expect(compat.canImplyAuthentication()).resolves.toBe(true);
    await expect(
      compat.canImplyAuthentication({ authenticationType: AUTHENTICATION_TYPE.BIOMETRICS })
    ).resolves.toBe(false);
    await expect(compat.isPasscodeAuthAvailable()).resolves.toBe(true);
    keychainMock.setDevice({ passcodeSet: false });
    await expect(compat.canImplyAuthentication()).resolves.toBe(false);
    await expect(compat.isPasscodeAuthAvailable()).resolves.toBe(false);
  });

  it('answers getSecurityLevel with the names of rnk, null on iOS', async () => {
    await expect(compat.getSecurityLevel()).resolves.toBeNull();
    keychainMock.setDevice({ hardwareSecurityLevel: 'strongbox' });
    await expect(compat.getSecurityLevel()).resolves.toBe(SECURITY_LEVEL.SECURE_HARDWARE);
    keychainMock.setDevice({ hardwareSecurityLevel: 'tee' });
    await expect(
      compat.getSecurityLevel({ accessControl: ACCESS_CONTROL.BIOMETRY_ANY })
    ).resolves.toBe('SECURE_HARDWARE');
    keychainMock.setDevice({ hardwareSecurityLevel: 'software' });
    await expect(compat.getSecurityLevel()).resolves.toBe(SECURITY_LEVEL.SECURE_SOFTWARE);
  });

  it('names the storage of Android, and refuses SECURE_HARDWARE where there is none', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    keychainMock.setDevice({ hardwareSecurityLevel: 'software' });
    await expect(compat.setGenericPassword('u', 'p')).resolves.toMatchObject({
      storage: STORAGE_TYPE.AES_GCM,
    });
    await expect(compat.getGenericPassword()).resolves.toMatchObject({ storage: 'KeystoreAESGCM' });
    await expect(
      compat.setGenericPassword('u', 'p', { securityLevel: SECURITY_LEVEL.SECURE_SOFTWARE })
    ).resolves.toBeTruthy();
    expect(
      await codeOf(() =>
        compat.setGenericPassword('u', 'p', { securityLevel: SECURITY_LEVEL.SECURE_HARDWARE })
      )
    ).toBe('HARDWARE_UNAVAILABLE');
    keychainMock.setDevice({ hardwareSecurityLevel: 'tee' });
    await expect(
      compat.setGenericPassword('u', 'p', { securityLevel: SECURITY_LEVEL.SECURE_HARDWARE })
    ).resolves.toBeTruthy();
  });
});

describe('the entry point', () => {
  it('exports the functions and the constants of rnk, by name and as the default', () => {
    jest.doMock('../native/NativeApexKeychain', () => ({ __esModule: true, default: null }));
    const entry = require('../compat') as typeof import('../compat') & {
      default: Record<string, unknown>;
    };
    for (const name of [
      'setGenericPassword',
      'getGenericPassword',
      'hasGenericPassword',
      'resetGenericPassword',
      'getAllGenericPasswordServices',
      'setInternetCredentials',
      'getInternetCredentials',
      'hasInternetCredentials',
      'resetInternetCredentials',
      'requestSharedWebCredentials',
      'setSharedWebCredentials',
      'getSupportedBiometryType',
      'canImplyAuthentication',
      'getSecurityLevel',
      'isPasscodeAuthAvailable',
    ] as const) {
      expect([name, typeof entry[name]]).toEqual([name, 'function']);
      expect(entry.default[name]).toBe(entry[name]);
    }
    for (const name of [
      'ACCESSIBLE',
      'ACCESS_CONTROL',
      'AUTHENTICATION_TYPE',
      'BIOMETRY_TYPE',
      'SECURITY_LEVEL',
      'STORAGE_TYPE',
    ] as const) {
      expect(entry[name]).toEqual(compatEnums[name]);
      expect(entry.default[name]).toBe(entry[name]);
    }
  });

  it('says what to do when the native module is not in the app', async () => {
    jest.doMock('../native/NativeApexKeychain', () => ({ __esModule: true, default: null }));
    const entry = require('../compat') as typeof import('../compat');
    await expect(entry.getGenericPassword()).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(entry.getSupportedBiometryType()).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });
});
