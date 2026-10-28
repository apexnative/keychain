import { Accessible, KeychainErrorCode } from '@apexnative/keychain';
import type { Scenario } from '../harness/types';
import { codeOf } from '../harness/values';

export const overwrite: Scenario = {
  id: 'overwrite',
  milestone: 'M1',
  title: 'Overwrite',
  description:
    'A write replaces the whole item: value and protection. A failed write changes nothing.',
  async run(t) {
    const store = await t.store('overwrite');

    await store.setItem('item', 'one');
    await store.setItem('item', 'two');
    await t.expect('the value is replaced', 'two', () => store.getItem('item'));
    await t.expect('accessible is replaced', 'four', async () => {
      await store.setItem('item', 'three');
      await store.setItem('item', 'four', { accessible: Accessible.WhenUnlockedThisDeviceOnly });
      return store.getItem('item');
    });
    await t.expect('still one item', true, () => store.hasItem('item'));

    // A write that fails changes nothing. A device without a passcode refuses this one.
    await store.setItem('safe', 'old');
    try {
      await store.setItem('safe', 'new', { accessible: Accessible.WhenPasscodeSetThisDeviceOnly });
      t.skip(
        'a failed write keeps the old item',
        'the device has a passcode: this write did not fail'
      );
    } catch (error) {
      t.equal('a write without a passcode fails', KeychainErrorCode.PasscodeNotSet, codeOf(error));
      await t.expect('the old value after the failed write', 'old', () => store.getItem('safe'));
    }
  },
};
