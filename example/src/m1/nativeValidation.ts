import { KeychainErrorCode } from '@apexnative/keychain';
import { TurboModuleRegistry } from 'react-native';
import type { Spec } from '@apexnative/keychain/native/NativeApexKeychain';
import { SERVICE_PREFIX } from '../harness/runner';
import type { Scenario } from '../harness/types';

const STORE = { service: `${SERVICE_PREFIX}native-validation` };
const OPTIONS = {
  accessible: 'afterFirstUnlock',
  accessControl: 'none',
  authValidity: 0,
  synchronizable: false,
  keyStorage: 'tee',
} as const;
const PROMPT = { confirmationRequired: true };

export const nativeValidation: Scenario = {
  id: 'native-validation',
  milestone: 'M1',
  title: 'The native side rejects what it does not know',
  description:
    'Calls the native module directly, past the checks of the JavaScript wrapper: a value it does not know is INVALID_ARGUMENT, not a guess. Nothing is stored.',
  async run(t) {
    const native = TurboModuleRegistry.get<Spec>('ApexKeychain');
    if (!native) return t.abort("The native module 'ApexKeychain' isn't in this app.");
    const bad = KeychainErrorCode.InvalidArgument;
    t.cleanup(() => native.clear(STORE));
    await native.clear(STORE).catch(() => undefined);

    await t.fails('an unknown accessible', bad, () =>
      native.setItem(STORE, 'k', 'v', 'utf8', { ...OPTIONS, accessible: 'always' as never })
    );
    await t.fails('an unknown accessControl', bad, () =>
      native.setItem(STORE, 'k', 'v', 'utf8', { ...OPTIONS, accessControl: 'faceID' as never })
    );
    await t.fails('an unknown keyStorage', bad, () =>
      native.setItem(STORE, 'k', 'v', 'utf8', { ...OPTIONS, keyStorage: 'hsm' as never })
    );
    await t.fails('an unknown encoding on a write', bad, () =>
      native.setItem(STORE, 'k', 'v', 'hex' as never, OPTIONS)
    );
    await t.fails('an unknown encoding on a read', bad, async () => {
      await native.setItem(STORE, 'k', 'v', 'utf8', OPTIONS);
      return native.getItem(STORE, 'k', 'hex' as never, PROMPT);
    });
    await t.fails('Base64 that is not Base64', bad, () =>
      native.setItem(STORE, 'b', '***not base64***', 'base64', OPTIONS)
    );

    await t.expect('only the item written on purpose is there', [true, false], async () => [
      await native.hasItem(STORE, 'k'),
      await native.hasItem(STORE, 'b'),
    ]);
    await t.expect(
      'and it was not changed',
      'v',
      async () => (await native.getItem(STORE, 'k', 'utf8', PROMPT))?.value
    );
  },
};
