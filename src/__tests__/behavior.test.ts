// The behavior of the API end to end, on the in-memory module of `@apexnative/keychain/jest`: what an app sees. The
// same expectations hold on iOS and Android (the example app's scenarios check them there).
import {
  canUseAccessControl,
  createKeychain,
  getBiometryState,
  getBiometryTypes,
  getHardwareSecurityLevel,
  isPasscodeSet,
  keychain,
  keychainMock,
  KeychainError,
} from '../jest';

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

describe('a store', () => {
  it('writes, reads, finds and removes strings', async () => {
    expect(keychain.service).toBe('dev.apexnative.keychain.mock');
    await keychain.setItem('token', 'secret');
    await expect(keychain.getItem('token')).resolves.toBe('secret');
    await expect(keychain.hasItem('token')).resolves.toBe(true);
    await keychain.setItem('token', 'new');
    await expect(keychain.getItem('token')).resolves.toBe('new');
    await keychain.removeItem('token');
    await expect(keychain.getItem('token')).resolves.toBeNull();
    await expect(keychain.hasItem('token')).resolves.toBe(false);
    await keychain.removeItem('token');
  });

  it('keeps any Unicode text and the empty string', async () => {
    for (const value of ['', 'пароль', '🔐 é end', 'x'.repeat(10000)]) {
      await keychain.setItem('value', value);
      await expect(keychain.getItem('value')).resolves.toBe(value);
    }
  });

  it('refuses U+0000 in a string, which React Native would cut, and keeps it in bytes', async () => {
    await keychain.setItem('value', 'before');
    expect(await codeOf(() => keychain.setItem('value', 'a\u0000b'))).toBe('INVALID_ARGUMENT');
    expect(() => keychain.setItemSync('value', 'a\u0000b')).toThrow(KeychainError);
    await expect(keychain.getItem('value')).resolves.toBe('before');

    const bytes = Uint8Array.from([0x61, 0, 0x62, 0]);
    await keychain.setBytes('zeros', bytes);
    await expect(keychain.getBytes('zeros')).resolves.toEqual(bytes);
  });

  it('resolves a method without a value to undefined', async () => {
    await expect(keychain.setItem('a', 'v')).resolves.toBeUndefined();
    await expect(keychain.setBytes('b', Uint8Array.of(1))).resolves.toBeUndefined();
    await expect(keychain.removeItem('a')).resolves.toBeUndefined();
    await expect(keychain.clear()).resolves.toBeUndefined();
    await expect(
      keychain.setCredentials({ username: 'u', password: 'p' })
    ).resolves.toBeUndefined();
    await expect(keychain.removeCredentials()).resolves.toBeUndefined();
  });

  it('keeps bytes, and reads them as text when they are UTF-8', async () => {
    const bytes = Uint8Array.from([0, 128, 255, 10]);
    await keychain.setBytes('key', bytes);
    await expect(keychain.getBytes('key')).resolves.toEqual(bytes);
    expect(await codeOf(() => keychain.getItem('key'))).toBe('INVALID_ARGUMENT');

    await keychain.setBytes('text', Uint8Array.from([0xd0, 0xb4, 0x61]));
    await expect(keychain.getItem('text')).resolves.toBe('дa');
    await keychain.setItem('string', 'д');
    await expect(keychain.getBytes('string')).resolves.toEqual(Uint8Array.from([0xd0, 0xb4]));
  });

  it('keeps stores apart and clears one', async () => {
    const other = createKeychain({ service: 'other' });
    await keychain.setItem('b', '1');
    await keychain.setItem('a', '2');
    await other.setItem('c', '3');
    await expect(keychain.hasItem('a')).resolves.toBe(true);
    await expect(keychain.hasItem('c')).resolves.toBe(false);
    await expect(other.hasItem('c')).resolves.toBe(true);
    await keychain.clear();
    await expect(keychain.hasItem('a')).resolves.toBe(false);
    await expect(keychain.hasItem('b')).resolves.toBe(false);
    await expect(other.getItem('c')).resolves.toBe('3');
  });

  it('works synchronously', () => {
    keychain.setItemSync('a', 'v');
    expect(keychain.getItemSync('a')).toBe('v');
    expect(keychain.hasItemSync('a')).toBe(true);
    keychain.removeItemSync('a');
    expect(keychain.getItemSync('a')).toBeNull();
    expect(keychain.hasItemSync('a')).toBe(false);
  });
});

describe('access control', () => {
  const vault = () =>
    createKeychain({
      service: 'vault',
      accessControl: 'biometryCurrentSet',
      prompt: { title: 'Unlock the vault' },
    });

  it('writes without a prompt and reads with one', async () => {
    const store = vault();
    await store.setItem('dbKey', 'k');
    expect(keychainMock.prompts()).toEqual([]);
    await expect(store.getItem('dbKey', { prompt: { cancel: 'Not now' } })).resolves.toBe('k');
    expect(keychainMock.prompts()).toEqual([
      { key: 'dbKey', title: 'Unlock the vault', cancel: 'Not now', confirmationRequired: true },
    ]);
  });

  it('never prompts for has', async () => {
    const store = vault();
    await store.setItem('dbKey', 'k');
    await store.hasItem('dbKey');
    expect(store.hasItemSync('dbKey')).toBe(true);
    expect(keychainMock.prompts()).toEqual([]);
  });

  it('throws AUTH_REQUIRED on a synchronous read', async () => {
    const store = vault();
    await store.setItem('dbKey', 'k');
    expect(() => store.getItemSync('dbKey')).toThrow(
      expect.objectContaining({ code: 'AUTH_REQUIRED' })
    );
  });

  it('fails as the prompt fails', async () => {
    const store = vault();
    await store.setItem('dbKey', 'k');
    keychainMock.failNextAuthentication('USER_CANCELED');
    keychainMock.failNextAuthentication('LOCKOUT');
    expect(await codeOf(() => store.getItem('dbKey'))).toBe('USER_CANCELED');
    expect(await codeOf(() => store.getItem('dbKey'))).toBe('LOCKOUT');
    await expect(store.getItem('dbKey')).resolves.toBe('k');
  });

  it('invalidates biometryCurrentSet items when the biometry changes', async () => {
    const store = vault();
    const any = createKeychain({ service: 'any', accessControl: 'biometryAny' });
    await store.setItem('dbKey', 'k');
    await any.setItem('token', 't');
    const state = await getBiometryState();
    keychainMock.changeBiometry();
    expect(await getBiometryState()).not.toBe(state);
    expect(await codeOf(() => store.getItem('dbKey'))).toBe('KEY_INVALIDATED');
    await expect(store.hasItem('dbKey')).resolves.toBe(false);
    await expect(any.getItem('token')).resolves.toBe('t');
  });

  it('refuses to write what the device can not protect, instead of writing it unprotected', async () => {
    keychainMock.setDevice({ biometryEnrolled: false });
    expect(await codeOf(() => vault().setItem('a', 'v'))).toBe('BIOMETRY_NOT_ENROLLED');
    await expect(vault().hasItem('a')).resolves.toBe(false);
    keychainMock.setDevice({ biometryTypes: [] });
    expect(await codeOf(() => vault().setItem('a', 'v'))).toBe('BIOMETRY_NOT_AVAILABLE');
    keychainMock.setDevice({ passcodeSet: false });
    expect(await codeOf(() => keychain.setItem('a', 'v', { accessControl: 'passcode' }))).toBe(
      'PASSCODE_NOT_SET'
    );
    expect(
      await codeOf(() =>
        keychain.setItem('a', 'v', { accessible: 'whenPasscodeSetThisDeviceOnly' })
      )
    ).toBe('PASSCODE_NOT_SET');
  });

  it('needs an enrolled biometry for biometryCurrentSet, with the passcode as a fallback too', async () => {
    keychainMock.setDevice({ biometryEnrolled: false });
    for (const accessControl of ['biometryCurrentSet', 'biometryCurrentSetOrPasscode'] as const) {
      await expect(canUseAccessControl(accessControl)).resolves.toEqual({
        available: false,
        reason: 'notEnrolled',
      });
      expect(await codeOf(() => keychain.setItem('a', 'v', { accessControl }))).toBe(
        'BIOMETRY_NOT_ENROLLED'
      );
    }
    await expect(keychain.hasItem('a')).resolves.toBe(false);
    // The passcode is enough where the access control isn't tied to the enrolled set.
    for (const accessControl of ['biometryAnyOrPasscode', 'passcode'] as const) {
      await expect(canUseAccessControl(accessControl)).resolves.toEqual({ available: true });
      await keychain.setItem('b', 'v', { accessControl });
    }

    keychainMock.setDevice({ biometryTypes: [] });
    await expect(canUseAccessControl('biometryCurrentSetOrPasscode')).resolves.toEqual({
      available: false,
      reason: 'noHardware',
    });
    expect(
      await codeOf(() => keychain.setItem('a', 'v', { accessControl: 'biometryCurrentSet' }))
    ).toBe('BIOMETRY_NOT_AVAILABLE');
  });

  it('asks for NSFaceIDUsageDescription before a biometric access control on a Face ID device', async () => {
    keychainMock.setDevice({ faceIDUsageDescription: false });
    for (const accessControl of [
      'biometryAny',
      'biometryCurrentSet',
      'biometryAnyOrPasscode',
      'biometryCurrentSetOrPasscode',
    ] as const) {
      expect(await codeOf(() => canUseAccessControl(accessControl))).toBe(
        'MISSING_USAGE_DESCRIPTION'
      );
      expect(await codeOf(() => keychain.setItem('a', 'v', { accessControl }))).toBe(
        'MISSING_USAGE_DESCRIPTION'
      );
    }
    await expect(keychain.hasItem('a')).resolves.toBe(false);
    // What shows no Face ID needs no description.
    await expect(canUseAccessControl('none')).resolves.toEqual({ available: true });
    await expect(canUseAccessControl('passcode')).resolves.toEqual({ available: true });
    await keychain.setItem('b', 'v', { accessControl: 'passcode' });
    // A device without Face ID doesn't ask.
    keychainMock.setDevice({ biometryTypes: ['touchID'] });
    await expect(canUseAccessControl('biometryAny')).resolves.toEqual({ available: true });
    // The description is back after a reset.
    keychainMock.reset();
    await expect(canUseAccessControl('biometryAny')).resolves.toEqual({ available: true });
  });

  it('gives the first reason of unsupportedOS, noHardware, passcodeNotSet, notEnrolled', async () => {
    const reason = async (accessControl: Parameters<typeof canUseAccessControl>[0]) => {
      const answer = await canUseAccessControl(accessControl);
      return answer.available ? 'available' : answer.reason;
    };
    keychainMock.setDevice({
      androidApi: 29,
      biometryTypes: [],
      biometryEnrolled: false,
      passcodeSet: false,
    });
    expect(await reason('biometryCurrentSetOrPasscode')).toBe('unsupportedOS');
    expect(await reason('passcode')).toBe('unsupportedOS');
    expect(await reason('biometryAny')).toBe('noHardware');
    keychainMock.setDevice({ androidApi: 30 });
    expect(await reason('biometryCurrentSetOrPasscode')).toBe('noHardware');
    expect(await reason('passcode')).toBe('passcodeNotSet');
    expect(await reason('biometryAnyOrPasscode')).toBe('passcodeNotSet');
    keychainMock.setDevice({ biometryTypes: ['fingerprint'] });
    expect(await reason('biometryAny')).toBe('passcodeNotSet');
    keychainMock.setDevice({ passcodeSet: true });
    expect(await reason('biometryAny')).toBe('notEnrolled');
    expect(await reason('biometryCurrentSetOrPasscode')).toBe('notEnrolled');
    expect(await reason('passcode')).toBe('available');
  });

  it('refuses the passcode variants and authValidity before Android 11', async () => {
    keychainMock.setDevice({ androidApi: 29 });
    for (const options of [
      { accessControl: 'passcode' },
      { accessControl: 'biometryAnyOrPasscode' },
      { accessControl: 'biometryAny', authValidity: 30 },
    ] as const) {
      expect(await codeOf(() => keychain.setItem('a', 'v', options))).toBe('UNSUPPORTED');
    }
    await expect(keychain.hasItem('a')).resolves.toBe(false);
    await keychain.setItem('b', 'v', { accessControl: 'biometryAny' });
    keychainMock.setDevice({ androidApi: 30 });
    await keychain.setItem('a', 'v', { accessControl: 'passcode' });
    await keychain.setItem('c', 'v', { accessControl: 'biometryAny', authValidity: 30 });
  });

  it('keeps a lockout out of the reasons: the access control stays available', async () => {
    await keychain.setItem('a', 'v', { accessControl: 'biometryAny' });
    keychainMock.failNextAuthentication('LOCKOUT');
    expect(await codeOf(() => keychain.getItem('a'))).toBe('LOCKOUT');
    await expect(canUseAccessControl('biometryAny')).resolves.toEqual({ available: true });
  });

  it('checks the forbidden combinations of options', async () => {
    expect(() => createKeychain({ accessControl: 'biometryCurrentSet', authValidity: 5 })).toThrow(
      KeychainError
    );
    expect(
      await codeOf(() =>
        keychain.setItem('a', 'v', { synchronizable: true, accessControl: 'passcode' })
      )
    ).toBe('INVALID_ARGUMENT');
  });
});

describe('credentials', () => {
  it('are read with the user name and the password in one prompt', async () => {
    const store = createKeychain({ accessControl: 'biometryAny' });
    await store.setCredentials({ username: 'ivan@example.com', password: 'p' });
    await expect(store.hasItem('credentials')).resolves.toBe(true);
    expect(keychainMock.prompts()).toEqual([]);
    await expect(store.getCredentials()).resolves.toEqual({
      username: 'ivan@example.com',
      password: 'p',
    });
    expect(keychainMock.prompts()).toHaveLength(1);
  });

  it('are kept per server', async () => {
    await keychain.setCredentials({ username: 'a', password: '1' });
    await keychain.setCredentials({ username: 'b', password: '2' }, { server: 'example.com' });
    await expect(keychain.hasItem('credentials')).resolves.toBe(true);
    await expect(keychain.hasItem('credentials:example.com')).resolves.toBe(true);
    await keychain.removeCredentials({ server: 'example.com' });
    await expect(keychain.getCredentials({ server: 'example.com' })).resolves.toBeNull();
    await expect(keychain.getCredentials()).resolves.toEqual({ username: 'a', password: '1' });
  });
});

describe('the device', () => {
  it('reports the simulated device', async () => {
    await expect(getBiometryTypes()).resolves.toEqual(['faceID']);
    await expect(isPasscodeSet()).resolves.toBe(true);
    await expect(getHardwareSecurityLevel()).resolves.toBeNull();
    await expect(canUseAccessControl('biometryCurrentSet')).resolves.toEqual({ available: true });

    keychainMock.setDevice({
      biometryTypes: ['fingerprint'],
      biometryEnrolled: false,
      hardwareSecurityLevel: 'strongbox',
    });
    await expect(canUseAccessControl('biometryAny')).resolves.toEqual({
      available: false,
      reason: 'notEnrolled',
    });
    await expect(canUseAccessControl('biometryAnyOrPasscode')).resolves.toEqual({
      available: true,
    });
    await expect(getBiometryState()).resolves.toBeNull();
    await expect(getHardwareSecurityLevel()).resolves.toBe('strongbox');

    keychainMock.setDevice({ passcodeSet: false });
    await expect(canUseAccessControl('passcode')).resolves.toEqual({
      available: false,
      reason: 'passcodeNotSet',
    });
  });

  it('rejects strongboxRequired on a device without StrongBox, and writes otherwise', async () => {
    const write = (keyStorage: 'tee' | 'strongbox' | 'strongboxRequired') =>
      keychain.setItem('a', 'v', { android: { keyStorage } });
    keychainMock.setDevice({ hardwareSecurityLevel: 'strongbox' });
    for (const keyStorage of ['tee', 'strongbox', 'strongboxRequired'] as const) {
      await expect(write(keyStorage)).resolves.toBeUndefined();
    }
    keychainMock.setDevice({ hardwareSecurityLevel: 'tee' });
    await expect(write('strongbox')).resolves.toBeUndefined();
    expect(await codeOf(() => write('strongboxRequired'))).toBe('HARDWARE_UNAVAILABLE');
    await expect(keychain.getItem('a')).resolves.toBe('v');
  });

  it('is reset', async () => {
    keychainMock.setDevice({ defaultService: 'com.example' });
    await keychain.setItem('a', 'v');
    keychainMock.reset();
    await expect(keychain.hasItem('a')).resolves.toBe(false);
    await expect(getBiometryTypes()).resolves.toEqual(['faceID']);
  });

  it('rejects a failure that is no code', () => {
    expect(() => keychainMock.failNextAuthentication('NOPE' as never)).toThrow(TypeError);
  });
});
