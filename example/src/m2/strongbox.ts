import { Platform } from 'react-native';
import {
  getHardwareSecurityLevel,
  HardwareSecurityLevel,
  KeyStorage,
  KeychainErrorCode,
} from '@apexnative/keychain';
import type { Scenario } from '../harness/types';

export const strongbox: Scenario = {
  id: 'm2-strongbox',
  milestone: 'M2',
  title: 'Key storage (StrongBox)',
  description:
    'Android: keyStorage puts the key in the TEE or StrongBox, and strongboxRequired fails with HARDWARE_UNAVAILABLE without StrongBox. iOS ignores the option.',
  async run(t) {
    const store = await t.store('m2-strongbox');
    const level = await getHardwareSecurityLevel();

    if (Platform.OS !== 'android') {
      await t.expect('keyStorage is ignored on iOS', 'v', async () => {
        await store.setItem('k', 'v', { android: { keyStorage: KeyStorage.StrongboxRequired } });
        return store.getItem('k');
      });
      return;
    }

    const hasStrongBox = level === HardwareSecurityLevel.Strongbox;
    t.info('getHardwareSecurityLevel', level, 'the best hardware for a new key');
    // Where the key lives isn't readable without authentication on a real device: the outcome of the write is what
    // is checked, and that the item is there and reads back.
    const write = async (key: string, keyStorage: KeyStorage) => {
      await store.setItem(key, 'v', { android: { keyStorage } });
      return (await store.hasItem(key)) ? store.getItem(key) : 'no item';
    };
    await t.expect('keyStorage tee', 'v', () => write('tee', KeyStorage.Tee));
    await t.expect('keyStorage strongbox: StrongBox if there is one, else the TEE', 'v', () =>
      write('sb', KeyStorage.Strongbox)
    );
    if (hasStrongBox) {
      await t.expect('keyStorage strongboxRequired', 'v', () =>
        write('sbr', KeyStorage.StrongboxRequired)
      );
    } else {
      await t.fails(
        'keyStorage strongboxRequired without StrongBox',
        KeychainErrorCode.HardwareUnavailable,
        () => store.setItem('sbr', 'v', { android: { keyStorage: KeyStorage.StrongboxRequired } })
      );
    }
  },
};
