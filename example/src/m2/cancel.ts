import { AccessControl, KeychainErrorCode } from '@apexnative/keychain';
import type { Scenario } from '../harness/types';

export const cancel: Scenario = {
  id: 'm2-cancel',
  milestone: 'M2',
  manual: true,
  title: 'Canceled prompt',
  description:
    'Canceling the prompt is USER_CANCELED. The item stays, and the next read, authenticated, gives its value.',
  async run(t) {
    const store = await t.store('m2-cancel', { accessControl: AccessControl.BiometryAny });
    await store.setItem('secret', 'still here');
    t.note('A prompt appears: CANCEL it.');
    await t.fails('a canceled read', KeychainErrorCode.UserCanceled, () => store.getItem('secret'));
    await t.expect('the item is still there', true, () => store.hasItem('secret'));
    t.note('A prompt appears again: authenticate this time.');
    await t.expect('the next read, authenticated', 'still here', () => store.getItem('secret'));
  },
};
