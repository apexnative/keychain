import { AccessControl, KeychainErrorCode } from '@apexnative/keychain';
import type { Scenario } from '../harness/types';

export const lockout: Scenario = {
  id: 'm2-lockout',
  milestone: 'M2',
  manual: true,
  title: 'Lockout',
  description:
    'Too many failed attempts lock the biometry: the read fails with LOCKOUT (or LOCKOUT_PERMANENT on Android), and says so instead of hanging.',
  async run(t) {
    const store = await t.store('m2-lockout', { accessControl: AccessControl.BiometryAny });
    await store.setItem('secret', 'v');
    t.note(
      'A prompt appears: fail it until the biometry locks (iOS Simulator: Features › Face ID › Non-matching Face, five times; Android emulator: a wrong fingerprint, five times).'
    );
    let code = 'no error';
    try {
      await store.getItem('secret');
    } catch (error) {
      code = (error as { code?: string }).code ?? 'an error';
    }
    t.oneOf(
      'the read after repeated failures',
      [KeychainErrorCode.Lockout, KeychainErrorCode.LockoutPermanent],
      code
    );
    await t.expect('the item is still there', true, () => store.hasItem('secret'));
  },
};
