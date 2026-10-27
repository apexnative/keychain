// The entry points: the package without its native module, and the mock as a drop-in for the package.

describe('the package', () => {
  it('imports without the native module and says what to do on the first call', async () => {
    jest.doMock('../native/NativeApexKeychain', () => ({ __esModule: true, default: null }));
    const { keychain, createKeychain, isPasscodeSet, KeychainError } =
      require('../index') as typeof import('../index');
    const store = createKeychain({ service: 'vault' });
    expect(store.service).toBe('vault');

    const error = await keychain.getItem('a').catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(KeychainError);
    expect(error).toMatchObject({ code: 'UNSUPPORTED' });
    expect((error as Error).message).toContain('Expo Go');
    expect(() => keychain.service).toThrow('development build');
    expect(() => store.getItemSync('a')).toThrow(KeychainError);
    await expect(isPasscodeSet()).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });

  it('calls the TurboModule when it is there', async () => {
    const getDefaultService = jest.fn(() => 'com.example.app');
    const setItem = jest.fn(async () => {});
    jest.doMock('../native/NativeApexKeychain', () => ({
      __esModule: true,
      default: { getDefaultService, setItem },
    }));
    const { keychain } = require('../index') as typeof import('../index');
    await keychain.setItem('a', 'v');
    expect(setItem).toHaveBeenCalledWith({ service: 'com.example.app' }, 'a', 'v', 'utf8', {
      accessible: 'afterFirstUnlock',
      accessControl: 'none',
      authValidity: 0,
      synchronizable: false,
      keyStorage: 'tee',
    });
  });

  it('throws UNSUPPORTED on the web', () => {
    const { nativeModule } =
      require('../native/module.web') as typeof import('../native/module.web');
    expect(() => nativeModule()).toThrow(expect.objectContaining({ code: 'UNSUPPORTED' }));
  });
});

describe('the mock', () => {
  it('exports everything the package exports', () => {
    jest.doMock('../native/NativeApexKeychain', () => ({ __esModule: true, default: null }));
    const pkg = require('../index') as Record<string, unknown>;
    const mock = require('../jest') as Record<string, unknown>;
    for (const name of Object.keys(pkg)) {
      expect([name, typeof mock[name]]).toEqual([name, typeof pkg[name]]);
    }
    expect(Object.keys(mock).sort()).toEqual(
      [...Object.keys(pkg), 'keychainMock', 'migrate', 'compat'].sort()
    );
  });
});
