import {
  createKeychain,
  getBiometryState,
  AccessControl,
  Accessible,
  KeychainErrorCode,
} from '@apexnative/keychain';
import { SERVICE_PREFIX } from '../harness/runner';
import type { Scenario } from '../harness/types';

export const invalidation: Scenario = {
  id: 'm2-invalidation',
  milestone: 'M2',
  manual: true,
  realDevice: true,
  title: 'New biometry: KEY_INVALIDATED',
  description:
    'Real device only: it passes on no simulator or emulator. Run it twice. First it writes an item locked to the current biometry; then you enroll another finger or face; the second run finds the item invalid and deleted.',
  async run(t) {
    // Not `t.store`: the second run must find what the first left.
    const store = createKeychain({
      service: `${SERVICE_PREFIX}m2-invalidation`,
      accessControl: AccessControl.BiometryCurrentSet,
      accessible: Accessible.WhenUnlockedThisDeviceOnly,
    });
    t.note('Real device only: a simulator or an emulator is not a reason to expect a pass.');
    const saved = await store.getItem('state');

    if (saved === null) {
      await store.setItem('locked', 'tied to the current biometry');
      await store.setItem('state', (await getBiometryState()) ?? 'none', {
        accessControl: AccessControl.None,
      });
      t.note(
        'Written. Now enroll another finger or face in the Settings of the device, then run this scenario again.'
      );
      return t.abort('First run: nothing is checked yet.');
    }

    t.cleanup(() => store.clear());
    await t.fails('a read after the biometry changed', KeychainErrorCode.KeyInvalidated, () =>
      store.getItem('locked')
    );
    await t.expect('the item is deleted', false, () => store.hasItem('locked'));
    await t.expect(
      'getBiometryState changed',
      true,
      async () => (await getBiometryState()) !== saved
    );
    await t.expect('a new write works', true, async () => {
      await store.setItem('locked', 'fresh');
      return store.hasItem('locked');
    });
  },
};
