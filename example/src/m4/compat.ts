import { Platform } from 'react-native';
import {
  createKeychain,
  getBiometryState,
  getBiometryTypes,
  isPasscodeSet,
  keychain,
  KeychainErrorCode,
} from '@apexnative/keychain';
import * as Keychain from '@apexnative/keychain/compat';
import type { Scenario } from '../harness/types';
import { SERVICE_PREFIX } from '../harness/runner';

const SERVICE = `${SERVICE_PREFIX}compat`;
const SERVER = 'compat.example.com';

export const compat: Scenario = {
  id: 'compat',
  milestone: 'M4',
  title: 'react-native-keychain API (compat)',
  description:
    'The functions of react-native-keychain 10 over this package: generic passwords and internet credentials, the device queries, the constants. What rnk has and the package has not is UNSUPPORTED.',
  async run(t) {
    const storage = Platform.OS === 'ios' ? 'keychain' : Keychain.STORAGE_TYPE.AES_GCM;
    t.cleanup(() => Keychain.resetGenericPassword({ service: SERVICE }));
    t.cleanup(() => Keychain.resetGenericPassword());
    t.cleanup(() => Keychain.resetInternetCredentials({ server: SERVER }));
    await Keychain.resetGenericPassword({ service: SERVICE }).catch(() => undefined);
    await Keychain.resetGenericPassword().catch(() => undefined);
    await Keychain.resetInternetCredentials({ server: SERVER }).catch(() => undefined);

    await t.expect('a missing generic password reads false', false, () =>
      Keychain.getGenericPassword({ service: SERVICE })
    );
    await t.expect('hasGenericPassword of a missing one', false, () =>
      Keychain.hasGenericPassword({ service: SERVICE })
    );
    await t.expect(
      'setGenericPassword answers service and storage',
      { service: SERVICE, storage },
      () => Keychain.setGenericPassword('ivan@example.com', 's3cret', { service: SERVICE })
    );
    await t.expect(
      'getGenericPassword answers the credentials',
      { service: SERVICE, username: 'ivan@example.com', password: 's3cret', storage },
      () => Keychain.getGenericPassword({ service: SERVICE })
    );
    await t.expect('hasGenericPassword', true, () =>
      Keychain.hasGenericPassword({ service: SERVICE })
    );
    const store = createKeychain({ service: SERVICE });
    await t.expect(
      'they are the credentials of the store of the service',
      { username: 'ivan@example.com', password: 's3cret' },
      () => store.getCredentials()
    );
    await t.expect('an overwrite', 'new', async () => {
      await Keychain.setGenericPassword('ivan@example.com', 'new', { service: SERVICE });
      const found = await Keychain.getGenericPassword({ service: SERVICE });
      return found && found.password;
    });

    await t.expect(
      "the default service is the app's own credentials",
      { username: 'app', password: 'own' },
      async () => {
        await Keychain.setGenericPassword('app', 'own');
        return keychain.getCredentials();
      }
    );
    await t.expect('and is named by the app id', keychain.service, async () => {
      const found = await Keychain.getGenericPassword();
      return found && found.service;
    });
    await t.expect(
      'getAllGenericPasswordServices lists both',
      [SERVICE, keychain.service].sort(),
      async () =>
        (await Keychain.getAllGenericPasswordServices())
          .filter((service) => service === SERVICE || service === keychain.service)
          .sort()
    );

    await t.expect('internet credentials are set', { service: SERVER, storage }, () =>
      Keychain.setInternetCredentials(SERVER, 'anna', 'pw')
    );
    await t.expect(
      'and read, with the server',
      { server: SERVER, service: SERVER, username: 'anna', password: 'pw', storage },
      () => Keychain.getInternetCredentials(SERVER)
    );
    await t.expect(
      'hasInternetCredentials by a string and by options',
      [true, true, false],
      async () => [
        await Keychain.hasInternetCredentials(SERVER),
        await Keychain.hasInternetCredentials({ server: SERVER }),
        await Keychain.hasInternetCredentials({ server: 'nobody.example.com' }),
      ]
    );
    await t.expect('resetInternetCredentials resolves with nothing', undefined, () =>
      Keychain.resetInternetCredentials({ server: SERVER })
    );
    await t.expect('and the credentials are gone', false, () =>
      Keychain.getInternetCredentials(SERVER)
    );

    await t.expect('resetGenericPassword answers true', true, () =>
      Keychain.resetGenericPassword({ service: SERVICE })
    );
    await t.expect('and the password is gone', false, () =>
      Keychain.getGenericPassword({ service: SERVICE })
    );
    await t.expect('accessible has the meaning of the core', 'p', async () => {
      await Keychain.setGenericPassword('u', 'p', {
        service: SERVICE,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      return (await store.getCredentials())?.password;
    });

    await t.fails('the storage option', KeychainErrorCode.Unsupported, () =>
      Keychain.setGenericPassword('u', 'p', {
        service: SERVICE,
        storage: Keychain.STORAGE_TYPE.AES_GCM,
      })
    );
    await t.fails('ACCESSIBLE.ALWAYS', KeychainErrorCode.Unsupported, () =>
      Keychain.setGenericPassword('u', 'p', {
        service: SERVICE,
        accessible: Keychain.ACCESSIBLE.ALWAYS,
      })
    );
    await t.fails('ACCESS_CONTROL.APPLICATION_PASSWORD', KeychainErrorCode.Unsupported, () =>
      Keychain.setGenericPassword('u', 'p', {
        service: SERVICE,
        accessControl: Keychain.ACCESS_CONTROL.APPLICATION_PASSWORD,
      })
    );
    await t.fails('requestSharedWebCredentials', KeychainErrorCode.Unsupported, () =>
      Keychain.requestSharedWebCredentials()
    );
    await t.fails('setSharedWebCredentials', KeychainErrorCode.Unsupported, () =>
      Keychain.setSharedWebCredentials(SERVER, 'u', 'p')
    );
    await t.fails('an empty user name', KeychainErrorCode.InvalidArgument, () =>
      Keychain.setGenericPassword('', 'p', { service: SERVICE })
    );

    // The device, against what the core says.
    const [types, state, passcode] = [
      await getBiometryTypes(),
      await getBiometryState(),
      await isPasscodeSet(),
    ];
    const first = types[0];
    await t.expect(
      'getSupportedBiometryType is the biometry that is enrolled, or null',
      state !== null && first !== undefined
        ? (
            {
              faceID: 'FaceID',
              touchID: 'TouchID',
              opticID: 'OpticID',
              fingerprint: 'Fingerprint',
              face: 'Face',
              iris: 'Iris',
            } as const
          )[first]
        : null,
      () => Keychain.getSupportedBiometryType()
    );
    await t.expect('canImplyAuthentication', state !== null || passcode, () =>
      Keychain.canImplyAuthentication()
    );
    await t.expect('canImplyAuthentication with BIOMETRICS', state !== null, () =>
      Keychain.canImplyAuthentication({
        authenticationType: Keychain.AUTHENTICATION_TYPE.BIOMETRICS,
      })
    );
    await t.expect('isPasscodeAuthAvailable', passcode, () => Keychain.isPasscodeAuthAvailable());
    const level = await Keychain.getSecurityLevel();
    if (Platform.OS === 'android') {
      t.oneOf(
        'getSecurityLevel',
        [Keychain.SECURITY_LEVEL.SECURE_HARDWARE, Keychain.SECURITY_LEVEL.SECURE_SOFTWARE],
        level
      );
    } else {
      t.equal('getSecurityLevel is null on iOS', null, level);
    }
  },
};
