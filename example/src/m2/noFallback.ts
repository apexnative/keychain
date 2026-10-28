import { Platform } from 'react-native';
import { AccessControl, KeychainErrorCode } from '@apexnative/keychain';
import type { Scenario } from '../harness/types';

export const noFallback: Scenario = {
  id: 'm2-no-fallback',
  milestone: 'M2',
  manual: true,
  realDevice: true,
  title: 'No fallback button (iOS)',
  description:
    'Final check on a real iPhone: after a failed face the prompt offers Try Again and Cancel, and no fallback button. When the Keychain shows the prompt a tap on that button comes back as a failed scan, so the package hides it. Cancel is USER_CANCELED, and the item stays.',
  async run(t) {
    if (Platform.OS !== 'ios') {
      return t.abort('The fallback button is an iOS one.');
    }
    const store = await t.store('m2-no-fallback', { accessControl: AccessControl.BiometryAny });
    await store.setItem('secret', 'behind the lock');

    t.note('A prompt appears: let the face fail twice, then tap Cancel.');
    await t.fails('a read canceled after failed scans', KeychainErrorCode.UserCanceled, () =>
      store.getItem('secret')
    );
    await t.expect('the item is still there', true, () => store.hasItem('secret'));
    t.info('the buttons after a failed face', 'only Try Face ID Again and Cancel', 'what you saw');
  },
};
