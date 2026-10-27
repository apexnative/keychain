import { Accessible, KeychainErrorCode } from '@apexnative/keychain';
import type { Scenario } from '../harness/types';
import { codeOf } from '../harness/values';

export const overwrite: Scenario = {
  id: 'overwrite',
  milestone: 'M1',
  title: 'Overwrite',
  description:
    'A write replaces the whole item: value, label and protection. The creation date stays, a failed write changes nothing.',
  async run(t) {
    const store = await t.store('overwrite');

    await store.setItem('item', 'one', { label: 'First' });
    const first = await store.getItemInfo('item');
    await t.sleep(25);
    await store.setItem('item', 'two');
    const second = await store.getItemInfo('item');

    await t.expect('the value is replaced', 'two', () => store.getItem('item'));
    t.equal('a write without a label drops the label', undefined, second?.label);
    t.equal(
      'createdAt stays',
      first ? first.createdAt : 'the info of the first write',
      second?.createdAt
    );
    t.equal(
      'modifiedAt moves forward',
      true,
      first !== null && second !== null && second.modifiedAt > first.modifiedAt
    );

    await t.expect('the label is replaced', 'Second', async () => {
      await store.setItem('item', 'three', { label: 'Second' });
      return (await store.getItemInfo('item'))?.label;
    });
    await t.expect('accessible is replaced', Accessible.WhenUnlockedThisDeviceOnly, async () => {
      await store.setItem('item', 'four', { accessible: Accessible.WhenUnlockedThisDeviceOnly });
      return (await store.getItemInfo('item'))?.accessible;
    });
    await t.expect('the value after replacing accessible', 'four', () => store.getItem('item'));
    await t.expect('one item after all the writes', ['item'], () => store.getAllKeys());

    // A write that fails changes nothing. A device without a passcode refuses this one.
    await store.setItem('safe', 'old', { label: 'Old' });
    try {
      await store.setItem('safe', 'new', {
        label: 'New',
        accessible: Accessible.WhenPasscodeSetThisDeviceOnly,
      });
      t.skip(
        'a failed write keeps the old item',
        'the device has a passcode: this write did not fail'
      );
    } catch (error) {
      t.equal('a write without a passcode fails', KeychainErrorCode.PasscodeNotSet, codeOf(error));
      await t.expect('the old value after the failed write', 'old', () => store.getItem('safe'));
      await t.expect('the old label after the failed write', 'Old', async () => {
        return (await store.getItemInfo('safe'))?.label;
      });
    }
  },
};
