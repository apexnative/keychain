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
    await t.expect(
      'keyStorage tee',
      [HardwareSecurityLevel.Tee, HardwareSecurityLevel.Software].includes(level as never)
        ? level
        : HardwareSecurityLevel.Tee,
      async () => {
        await store.setItem('tee', 'v', { android: { keyStorage: KeyStorage.Tee } });
        return (await store.getItemInfo('tee'))?.android?.securityLevel;
      }
    );
    await t.expect(
      'keyStorage strongbox: StrongBox if there is one, else the TEE',
      hasStrongBox ? HardwareSecurityLevel.Strongbox : level,
      async () => {
        await store.setItem('sb', 'v', { android: { keyStorage: KeyStorage.Strongbox } });
        return (await store.getItemInfo('sb'))?.android?.securityLevel;
      }
    );
    if (hasStrongBox) {
      await t.expect('keyStorage strongboxRequired', HardwareSecurityLevel.Strongbox, async () => {
        await store.setItem('sbr', 'v', { android: { keyStorage: KeyStorage.StrongboxRequired } });
        return (await store.getItemInfo('sbr'))?.android?.securityLevel;
      });
    } else {
      await t.fails(
        'keyStorage strongboxRequired without StrongBox',
        KeychainErrorCode.HardwareUnavailable,
        () => store.setItem('sbr', 'v', { android: { keyStorage: KeyStorage.StrongboxRequired } })
      );
    }
  },
};
