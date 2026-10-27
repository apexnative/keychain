import { KeychainErrorCode } from '@apexnative/keychain';
import * as Keychain from '@apexnative/keychain/compat';
import { SERVICE_PREFIX } from '../harness/runner';
import type { Scenario } from '../harness/types';
import { codeOf } from '../harness/values';

const SERVICE = `${SERVICE_PREFIX}compat-auth`;
const DEVICE_CANNOT: string[] = [
  KeychainErrorCode.BiometryNotEnrolled,
  KeychainErrorCode.BiometryNotAvailable,
  KeychainErrorCode.PasscodeNotSet,
];

export const compatAuth: Scenario = {
  id: 'compat-auth',
  milestone: 'M4',
  manual: true,
  title: 'compat: a protected password',
  description:
    'setGenericPassword with ACCESS_CONTROL.BIOMETRY_ANY shows no prompt; getGenericPassword shows one with the texts of authenticationPrompt, and answers false when there is nothing.',
  async run(t) {
    t.cleanup(() => Keychain.resetGenericPassword({ service: SERVICE }));
    try {
      await Keychain.setGenericPassword('ivan', 'behind the lock', {
        service: SERVICE,
        accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY,
      });
    } catch (error) {
      if (DEVICE_CANNOT.includes(codeOf(error) ?? '')) {
        return t.abort('This device can protect no item: enroll a biometry first.');
      }
      throw error;
    }
    t.note('A prompt appears: authenticate. Its title is "Unlock compat".');
    await t.expect(
      'getGenericPassword after authenticating',
      { username: 'ivan', password: 'behind the lock' },
      async () => {
        const found = await Keychain.getGenericPassword({
          service: SERVICE,
          authenticationPrompt: { title: 'Unlock compat', cancel: 'Not now' },
        });
        return found && { username: found.username, password: found.password };
      }
    );
    await t.expect('hasGenericPassword shows no prompt', true, () =>
      Keychain.hasGenericPassword({ service: SERVICE })
    );
    t.note('A prompt appears: CANCEL it.');
    await t.fails('a canceled read', KeychainErrorCode.UserCanceled, () =>
      Keychain.getGenericPassword({ service: SERVICE })
    );
  },
};
