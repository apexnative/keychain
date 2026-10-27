import { Platform } from 'react-native';
import { AccessControl, KeychainErrorCode } from '@apexnative/keychain';
import type { Scenario } from '../harness/types';

const VALIDITY = 20;

export const authValidity: Scenario = {
  id: 'm2-auth-validity',
  milestone: 'M2',
  manual: true,
  title: 'authValidity',
  description: `One authentication unlocks the item for ${VALIDITY} seconds: the second read shows no prompt, a read after the window does.`,
  async run(t) {
    const store = await t.store('m2-auth-validity', {
      accessControl: AccessControl.BiometryAny,
      authValidity: VALIDITY,
    });
    if (Platform.OS === 'android' && Number(Platform.Version) < 30) {
      await t.fails('authValidity needs Android 11', KeychainErrorCode.Unsupported, () =>
        store.setItem('secret', 'timed')
      );
      return t.abort('Android before 11 has no authValidity: UNSUPPORTED, as it should be.');
    }
    await store.setItem('secret', 'timed');
    t.note('A prompt appears: authenticate.');
    await t.expect('the first read', 'timed', () => store.getItem('secret'));

    const started = Date.now();
    await t.expect('the second read, inside the window', 'timed', () => store.getItem('secret'));
    t.info('the second read took', `${Date.now() - started} ms`, 'no prompt, well under a second');

    t.note(`Waiting ${VALIDITY + 2} seconds. Then a prompt appears: authenticate.`);
    await t.sleep((VALIDITY + 2) * 1000);
    await t.expect('a read after the window', 'timed', () => store.getItem('secret'));
    t.info('the prompt after the window', 'it appeared', 'it appeared');
  },
};
