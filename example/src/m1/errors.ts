import {
  createKeychain,
  isKeychainError,
  KeychainError,
  AccessControl,
  Accessible,
  KeychainErrorCode,
} from '@apexnative/keychain';
import type { Scenario } from '../harness/types';

export const errors: Scenario = {
  id: 'errors',
  milestone: 'M1',
  title: 'INVALID_ARGUMENT',
  description:
    'A key, a value or an option that is not valid is an INVALID_ARGUMENT error before anything is stored: nothing reaches the keychain, a misspelt option protects nothing by accident.',
  async run(t) {
    const store = await t.store('errors');
    const bad = KeychainErrorCode.InvalidArgument;

    await t.fails('an empty key', bad, () => store.setItem('', 'v'));
    await t.fails('an empty key, synchronously', bad, () => store.getItemSync(''));
    await t.fails('a key of 257 characters', bad, () => store.setItem('k'.repeat(257), 'v'));
    await t.fails('a key of 257 emoji', bad, () => store.getItem('🔑'.repeat(257)));
    await t.fails('a key with U+0000', bad, () => store.setItem('a\u0000b', 'v'));
    await t.fails('a value with U+0000', bad, () => store.setItem('k', 'a\u0000b'));
    await t.fails('a value with U+0000, synchronously', bad, () =>
      store.setItemSync('k', 'a\u0000')
    );
    await t.fails('a label with U+0000', bad, () => store.setItem('k', 'v', { label: '\u0000' }));
    await t.fails('a user name with U+0000', bad, () =>
      store.setCredentials({ username: 'a\u0000b', password: 'p' })
    );
    await t.fails('a password with U+0000', bad, () =>
      store.setCredentials({ username: 'u', password: 'a\u0000b' })
    );
    await t.fails('a key with a lone surrogate', bad, () => store.hasItem('a\ud800'));
    await t.fails('a key that is a number', bad, () => store.removeItem(42 as never));
    await t.fails('a value that is a number', bad, () => store.setItem('k', 42 as never));
    await t.fails('a value with a lone surrogate', bad, () => store.setItem('k', 'a\udc00b'));
    await t.fails('bytes that are a string', bad, () => store.setBytes('k', 'text' as never));
    await t.fails('bytes that are an array', bad, () => store.setBytes('k', [1, 2] as never));

    await t.fails('a misspelt option', bad, () =>
      store.setItem('k', 'v', { accesControl: 'biometryAny' } as never)
    );
    await t.fails('an unknown accessible', bad, () =>
      store.setItem('k', 'v', { accessible: 'always' } as never)
    );
    await t.fails('a negative authValidity', bad, () =>
      store.setItem('k', 'v', { authValidity: -1 })
    );
    await t.fails('biometryCurrentSet with authValidity', bad, () =>
      store.setItem('k', 'v', { accessControl: AccessControl.BiometryCurrentSet, authValidity: 30 })
    );
    await t.fails('synchronizable with a ThisDeviceOnly accessible', bad, () =>
      store.setItem('k', 'v', {
        synchronizable: true,
        accessible: Accessible.WhenUnlockedThisDeviceOnly,
      })
    );
    await t.fails('synchronizable with an access control', bad, () =>
      store.setItem('k', 'v', { synchronizable: true, accessControl: AccessControl.BiometryAny })
    );
    await t.fails('an unknown prompt field', bad, () =>
      store.getItem('k', { prompt: { titel: 'x' } } as never)
    );
    await t.fails('a credentials user name that is empty', bad, () =>
      store.setCredentials({ username: '', password: 'p' })
    );
    await t.fails('a credentials server that is empty', bad, () =>
      store.getCredentials({ server: '' })
    );
    await t.fails('a label for credentials', bad, () =>
      store.setCredentials({ username: 'u', password: 'p' }, { label: 'x' } as never)
    );
    await t.fails('createKeychain with an empty service', bad, () =>
      createKeychain({ service: '' })
    );
    await t.fails('createKeychain with a combination that is not allowed', bad, () =>
      createKeychain({ accessControl: AccessControl.BiometryCurrentSetOrPasscode, authValidity: 5 })
    );

    await t.expect('nothing was stored', [], () => store.getAllKeys());

    let error: unknown;
    try {
      await store.setItem('', 'v');
    } catch (reason) {
      error = reason;
    }
    t.equal('the error is a KeychainError', true, error instanceof KeychainError);
    t.equal(
      'and isKeychainError agrees',
      true,
      isKeychainError(error, KeychainErrorCode.InvalidArgument)
    );
    t.equal('named KeychainError', 'KeychainError', (error as Error | undefined)?.name);
  },
};
