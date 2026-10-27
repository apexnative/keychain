import { Platform } from 'react-native';
import {
  getBiometryState,
  getBiometryTypes,
  getHardwareSecurityLevel,
  HardwareSecurityLevel,
  isPasscodeSet,
} from '@apexnative/keychain';
import type { Scenario } from '../harness/types';
import { describeError } from '../harness/values';

export const device: Scenario = {
  id: 'm2-device',
  milestone: 'M2',
  title: 'Device capabilities',
  description:
    'getBiometryTypes, isPasscodeSet, getBiometryState and getHardwareSecurityLevel describe this device. None of them shows a prompt.',
  async run(t) {
    const show = async (name: string, hint: string, work: () => Promise<unknown>) => {
      try {
        t.info(name, await work(), hint);
      } catch (error) {
        t.record(name, hint, describeError(error), 'fail');
      }
    };
    await show('getBiometryTypes', 'what this device has', getBiometryTypes);
    await show('isPasscodeSet', 'whether a screen lock is set', isPasscodeSet);

    const state = await getBiometryState();
    t.info('getBiometryState', state, 'a token, or null without an enrolled biometry');
    await t.expect('getBiometryState is stable', state, () => getBiometryState());
    if ((await getBiometryTypes()).length === 0) {
      await t.expect('getBiometryState is null without a sensor', null, () => getBiometryState());
    }

    const level = await getHardwareSecurityLevel();
    if (Platform.OS === 'android') {
      t.oneOf('getHardwareSecurityLevel', Object.values(HardwareSecurityLevel), level);
    } else {
      t.equal('getHardwareSecurityLevel, null on iOS', null, level);
    }
  },
};
