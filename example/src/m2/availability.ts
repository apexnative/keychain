import { Platform } from 'react-native';
import {
  AccessControl,
  canUseAccessControl,
  getBiometryState,
  getBiometryTypes,
  isPasscodeSet,
  KeychainErrorCode,
  type AccessControlAvailability,
} from '@apexnative/keychain';
import type { Scenario } from '../harness/types';
import { codeOf } from '../harness/values';

// The access controls that are bound to an enrolled biometry: the passcode doesn't make up for its absence.
const NEEDS_BIOMETRY: AccessControl[] = [
  AccessControl.BiometryAny,
  AccessControl.BiometryCurrentSet,
  AccessControl.BiometryCurrentSetOrPasscode,
];
const USES_PASSCODE: AccessControl[] = [
  AccessControl.BiometryAnyOrPasscode,
  AccessControl.BiometryCurrentSetOrPasscode,
  AccessControl.Passcode,
];

const WRITE_ERROR = {
  noHardware: KeychainErrorCode.BiometryNotAvailable,
  notEnrolled: KeychainErrorCode.BiometryNotEnrolled,
  passcodeNotSet: KeychainErrorCode.PasscodeNotSet,
  unsupportedOS: KeychainErrorCode.Unsupported,
} as const;

export const availability: Scenario = {
  id: 'm2-availability',
  milestone: 'M2',
  title: 'What the device can protect',
  description:
    'canUseAccessControl says, for each access control, whether this device can do it; a write of what it can not do fails with the matching code and stores nothing, one it can do succeeds without a prompt.',
  async run(t) {
    const store = await t.store('m2-availability');
    const types = await getBiometryTypes();
    const enrolled = (await getBiometryState()) !== null;
    const passcode = await isPasscodeSet();
    const oldAndroid = Platform.OS === 'android' && Number(Platform.Version) < 30;
    t.note(
      `Device: biometry ${types.join(', ') || 'none'}${enrolled ? ' (enrolled)' : ' (not enrolled)'}, passcode ${
        passcode ? 'set' : 'not set'
      }${oldAndroid ? ', Android before 11' : ''}.`
    );

    const reasonFor = (accessControl: AccessControl) => {
      // The order of the reasons: the OS, the sensor, the passcode, the enrollment.
      if (accessControl === AccessControl.None) return undefined;
      if (USES_PASSCODE.includes(accessControl) && oldAndroid) return 'unsupportedOS' as const;
      const needsBiometry = NEEDS_BIOMETRY.includes(accessControl);
      if (needsBiometry && types.length === 0) return 'noHardware' as const;
      if (!passcode) return 'passcodeNotSet' as const;
      if (needsBiometry && !enrolled) return 'notEnrolled' as const;
      return undefined;
    };

    const written: string[] = [];
    for (const accessControl of Object.values(AccessControl)) {
      const reason = reasonFor(accessControl);
      const answer: AccessControlAvailability = reason
        ? { available: false, reason }
        : { available: true };
      await t.expect(`canUseAccessControl('${accessControl}')`, answer, () =>
        canUseAccessControl(accessControl)
      );

      const key = `item-${accessControl}`;
      await t.expect(
        `a write with '${accessControl}'`,
        reason ? WRITE_ERROR[reason] : 'written',
        async () => {
          try {
            await store.setItem(key, 'v', { accessControl });
          } catch (error) {
            return codeOf(error);
          }
          written.push(key);
          return (await store.getItemInfo(key))?.accessControl === accessControl
            ? 'written'
            : 'written, with another access control';
        }
      );
    }
    await t.expect('only what could be written is stored', written.sort(), () =>
      store.getAllKeys()
    );
  },
};
