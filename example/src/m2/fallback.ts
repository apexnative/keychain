import { Platform } from 'react-native';
import { AccessControl, KeychainErrorCode } from '@apexnative/keychain';
import type { Scenario } from '../harness/types';

export const fallback: Scenario = {
  id: 'm2-fallback',
  milestone: 'M2',
  manual: true,
  realDevice: true,
  title: 'Fallback button (iOS)',
  description:
    'Final check on a real iPhone: the iOS Simulator shows no fallback button. With biometryAny the prompt shows a button with a text of your own after a failed face: tapping it is USER_FALLBACK, and an empty text hides it. Not for biometryAnyOrPasscode (iOS offers the passcode itself, no USER_FALLBACK) and not for Android, which has no such button.',
  async run(t) {
    if (Platform.OS !== 'ios') {
      return t.abort('USER_FALLBACK and the fallback button exist only on iOS.');
    }
    // Not `biometryAnyOrPasscode`: there iOS offers the passcode itself, and the button is never USER_FALLBACK.
    const store = await t.store('m2-fallback', { accessControl: AccessControl.BiometryAny });
    await store.setItem('secret', 'behind the lock');

    t.note(
      'A prompt appears: let the face fail, and TAP the button "Other way" that shows. (The Simulator shows none: run this on a real iPhone.)'
    );
    await t.fails('a tapped fallback button', KeychainErrorCode.UserFallback, () =>
      store.getItem('secret', { prompt: { fallback: 'Other way' } })
    );
    await t.expect('the item is still there', true, () => store.hasItem('secret'));
    t.note('A prompt appears without a fallback button: authenticate.');
    await t.expect('an empty fallback text hides the button', 'behind the lock', () =>
      store.getItem('secret', { prompt: { fallback: '' } })
    );
  },
};
