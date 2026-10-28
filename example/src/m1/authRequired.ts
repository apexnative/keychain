import { Platform } from 'react-native';
import { AccessControl, KeychainErrorCode } from '@apexnative/keychain';
import type { Scenario } from '../harness/types';
import { codeOf, describeError } from '../harness/values';

const CANDIDATES: AccessControl[] = [
  AccessControl.BiometryAny,
  AccessControl.BiometryAnyOrPasscode,
  AccessControl.Passcode,
];

// The device can't protect an item this way: that is a reason to skip, not a failure.
const DEVICE_CANNOT: string[] = [
  KeychainErrorCode.BiometryNotEnrolled,
  KeychainErrorCode.BiometryNotAvailable,
  KeychainErrorCode.PasscodeNotSet,
];

export const authRequired: Scenario = {
  id: 'auth-required',
  milestone: 'M1',
  title: 'AUTH_REQUIRED',
  description:
    'A synchronous read of an item with access control throws AUTH_REQUIRED and shows no prompt. hasItem and removeItem work on it without one. Needs Face ID or a fingerprint enrolled, or a passcode.',
  async run(t) {
    const store = await t.store('auth-required');
    await store.setItem('open', 'no access control');

    let accessControl: AccessControl | undefined;
    const refused: string[] = [];
    let unexpected: unknown;
    for (const candidate of CANDIDATES) {
      try {
        await store.setItem('locked', 'protected value', {
          accessControl: candidate,
        });
        accessControl = candidate;
        break;
      } catch (error) {
        const code = codeOf(error);
        const oldAndroid = Platform.OS === 'android' && Number(Platform.Version) < 30;
        if (
          DEVICE_CANNOT.includes(code ?? '') ||
          (code === KeychainErrorCode.Unsupported &&
            oldAndroid &&
            candidate !== AccessControl.BiometryAny)
        ) {
          refused.push(`${candidate}: ${code}`);
        } else {
          unexpected ??= error;
          refused.push(`${candidate}: ${describeError(error)}`);
        }
      }
    }
    if (unexpected !== undefined) throw unexpected;
    if (!accessControl) {
      t.note(refused.join('; '));
      return t.abort(
        'This device can protect no item: enroll Face ID (iOS Simulator: Features › Face ID › Enrolled), a fingerprint, or set a passcode.'
      );
    }
    t.note(`Protected with '${accessControl}'.`);

    await t.fails('getItemSync of the protected item', KeychainErrorCode.AuthRequired, () =>
      store.getItemSync('locked')
    );
    await t.expect('getItemSync of an open item still works', 'no access control', () =>
      store.getItemSync('open')
    );
    await t.expect('hasItemSync, no prompt', true, () => store.hasItemSync('locked'));
    await t.expect('hasItem, no prompt', true, () => store.hasItem('locked'));
    await t.expect('removeItemSync, no prompt', false, () => {
      store.removeItemSync('locked');
      return store.hasItemSync('locked');
    });
  },
};
