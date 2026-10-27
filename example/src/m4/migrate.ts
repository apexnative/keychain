import { AccessControl, KeychainErrorCode } from '@apexnative/keychain';
import {
  migrateFromExpoSecureStore,
  migrateFromReactNativeKeychain,
  migrateItem,
} from '@apexnative/keychain/migrate';
import { SERVICE_PREFIX } from '../harness/runner';
import type { Scenario } from '../harness/types';
import { codeOf } from '../harness/values';
import { legacy, MISSING } from './legacy';

const ABSENT = `${SERVICE_PREFIX}migrate-absent`;
const EMPTY = { migrated: [], skipped: [], warnings: [] };

export const migrateEmpty: Scenario = {
  id: 'migrate-empty',
  milestone: 'M4',
  title: 'migrate: nothing to move',
  description:
    'migrate asks the native side for old items and finds none: empty reports, nothing written, a missing item is not found, and options that are not valid are INVALID_ARGUMENT.',
  async run(t) {
    const into = await t.store('migrate-empty');
    await t.expect('react-native-keychain, a service and a server without items', EMPTY, () =>
      migrateFromReactNativeKeychain({ services: [ABSENT], servers: [ABSENT], into })
    );
    await t.expect('expo-secure-store, a keychainService without items', EMPTY, () =>
      migrateFromExpoSecureStore({ keychainService: ABSENT, into })
    );
    await t.expect('and a keychainService after another', EMPTY, () =>
      migrateFromExpoSecureStore({ keychainService: [ABSENT, `${ABSENT}-2`], into })
    );
    await t.expect(
      'a missing generic password is not found',
      {
        migrated: [],
        skipped: [{ key: ABSENT, kind: 'genericPassword', reason: 'notFound' }],
        warnings: [],
      },
      () => migrateItem({ library: 'reactNativeKeychain', service: ABSENT }, { into })
    );
    await t.expect(
      'missing internet credentials are not found',
      {
        migrated: [],
        skipped: [{ key: ABSENT, kind: 'internetPassword', reason: 'notFound' }],
        warnings: [],
      },
      () => migrateItem({ library: 'reactNativeKeychain', server: ABSENT }, { into })
    );
    await t.expect(
      'a missing item of expo-secure-store is not found',
      {
        migrated: [],
        skipped: [{ key: 'nothing', kind: 'secureStore', reason: 'notFound' }],
        warnings: [],
      },
      () =>
        migrateItem(
          { library: 'expoSecureStore', key: 'nothing', keychainService: ABSENT },
          { into }
        )
    );
    await t.expect('nothing was written', [], () => into.getAllKeys());

    await t.fails('an option migrate does not know', KeychainErrorCode.InvalidArgument, () =>
      migrateFromReactNativeKeychain({ servises: [ABSENT] } as never)
    );
    await t.fails('an item with a service and a server', KeychainErrorCode.InvalidArgument, () =>
      migrateItem({ library: 'reactNativeKeychain', service: 'a', server: 'b' } as never)
    );
    await t.fails('an into that is no store', KeychainErrorCode.InvalidArgument, () =>
      migrateFromExpoSecureStore({ into: {} as never })
    );
  },
};

const A = `${SERVICE_PREFIX}legacy-a`;
const B = `${SERVICE_PREFIX}legacy-b`;
const C = `${SERVICE_PREFIX}legacy-c`;
const SERVER = 'legacy.example.com';
const EXPO_SERVICE = `${SERVICE_PREFIX}legacy-expo`;

export const migrateLegacy: Scenario = {
  id: 'migrate-legacy',
  milestone: 'M4',
  title: 'migrate: items written like react-native-keychain and expo-secure-store',
  description:
    'Old items are written by the old libraries, then moved: generic passwords into the stores of their services, internet credentials under their server, expo-secure-store items under their keys. A key that is taken is kept, a second run changes nothing, removeSource removes. Needs the old libraries in the app.',
  async run(t) {
    const { reactNativeKeychain: rnk, expoSecureStore: expo } = legacy;
    if (!rnk && !expo) return t.abort(MISSING);
    const into = await t.store('legacy-into');

    if (rnk) {
      t.cleanup(() => rnk.clean());
      const stores = [
        await t.store('legacy-a'),
        await t.store('legacy-b'),
        await t.store('legacy-c'),
      ];
      await rnk.plantGeneric(A, 'ivan', 'p1');
      await rnk.plantGeneric(B, 'anna', 'p2');
      await rnk.plantInternet(SERVER, 'petr', 'p3');

      await t.expect('react-native-keychain: what is moved', [A, B, SERVER].sort(), async () => {
        const report = await migrateFromReactNativeKeychain({
          services: [A, B],
          servers: [SERVER],
          into,
        });
        return [...report.migrated].sort();
      });
      await t.expect(
        'a generic password, in the store of its service',
        { username: 'ivan', password: 'p1' },
        () => stores[0]!.getCredentials()
      );
      await t.expect('another one', { username: 'anna', password: 'p2' }, () =>
        stores[1]!.getCredentials()
      );
      await t.expect(
        'internet credentials, under their server',
        { username: 'petr', password: 'p3' },
        () => into.getCredentials({ server: SERVER })
      );
      await t.expect('the old items are kept', [true, true, true], async () => [
        await rnk.hasGeneric(A),
        await rnk.hasGeneric(B),
        await rnk.hasInternet(SERVER),
      ]);
      await t.expect(
        'a second run moves nothing: every item exists',
        { migrated: [], reasons: ['exists', 'exists', 'exists'] },
        async () => {
          const report = await migrateFromReactNativeKeychain({
            services: [A, B],
            servers: [SERVER],
            into,
          });
          return { migrated: report.migrated, reasons: report.skipped.map((item) => item.reason) };
        }
      );

      await rnk.plantGeneric(C, 'old', 'old password');
      await stores[2]!.setCredentials({ username: 'new', password: 'kept' });
      await t.expect(
        'a key that is taken is not overwritten',
        { skipped: [{ key: C, reason: 'exists' }], kept: { username: 'new', password: 'kept' } },
        async () => {
          const report = await migrateFromReactNativeKeychain({
            services: [C],
            removeSource: true,
            into,
          });
          return {
            skipped: report.skipped.map(({ key, reason }) => ({ key, reason })),
            kept: await stores[2]!.getCredentials(),
          };
        }
      );
      await t.expect('and its old item stays', true, () => rnk.hasGeneric(C));

      await stores[2]!.removeCredentials();
      await t.expect(
        'removeSource: moved',
        [C],
        async () =>
          (await migrateFromReactNativeKeychain({ services: [C], removeSource: true, into }))
            .migrated
      );
      await t.expect(
        'removeSource: the old item is gone, the new one is there',
        [false, true],
        async () => [await rnk.hasGeneric(C), await stores[2]!.hasItem('credentials')]
      );
    } else {
      t.skip('react-native-keychain', 'not installed in the example');
    }

    if (expo) {
      t.cleanup(() => expo.clean());
      await expo.plant('plain', 'v1', EXPO_SERVICE);
      await expo.plant('unicode', 'пароль 🔑', EXPO_SERVICE);
      await expo.plant('taken', 'old', EXPO_SERVICE);
      await into.setItem('taken', 'kept');
      const report = await migrateFromExpoSecureStore({ keychainService: EXPO_SERVICE, into });
      t.equal(
        'expo-secure-store: what is moved',
        ['plain', 'unicode'],
        [...report.migrated].sort()
      );
      t.equal(
        'a key that is taken is skipped',
        [{ key: 'taken', reason: 'exists' }],
        report.skipped.map(({ key, reason }) => ({ key, reason }))
      );
      await t.expect('the items under their keys', ['v1', 'пароль 🔑', 'kept'], async () => [
        await into.getItem('plain'),
        await into.getItem('unicode'),
        await into.getItem('taken'),
      ]);
      await t.expect('removeSource', [false, false], async () => {
        await migrateFromExpoSecureStore({
          keychainService: EXPO_SERVICE,
          into,
          removeSource: true,
        });
        return [await expo.has('plain', EXPO_SERVICE), await expo.has('unicode', EXPO_SERVICE)];
      });
    } else {
      t.skip('expo-secure-store', 'not installed in the example');
    }
  },
};

const PROTECTED = `${SERVICE_PREFIX}legacy-protected`;

export const migrateProtected: Scenario = {
  id: 'migrate-protected',
  milestone: 'M4',
  manual: true,
  title: 'migrate: a protected item',
  description:
    'A protected old item is skipped as requiresAuth without a prompt; migrateItem moves it with one, and the new item is protected. Needs react-native-keychain in the app, and a biometry enrolled.',
  async run(t) {
    const rnk = legacy.reactNativeKeychain;
    if (!rnk) return t.abort(MISSING);
    t.cleanup(() => rnk.clean());
    const store = await t.store('legacy-protected');
    try {
      await rnk.plantGeneric(PROTECTED, 'ivan', 'locked', true);
    } catch (error) {
      return t.abort(`This device can't protect an item: ${codeOf(error) ?? 'an error'}.`);
    }
    await t.expect(
      'migrateFromReactNativeKeychain skips it, with no prompt',
      { migrated: [], skipped: [{ key: PROTECTED, reason: 'requiresAuth' }] },
      async () => {
        const report = await migrateFromReactNativeKeychain({ services: [PROTECTED] });
        return {
          migrated: report.migrated,
          skipped: report.skipped.map(({ key, reason }) => ({ key, reason })),
        };
      }
    );
    await t.fails(
      'and migrateItem wants the new item protected',
      KeychainErrorCode.InvalidArgument,
      () => migrateItem({ library: 'reactNativeKeychain', service: PROTECTED })
    );
    t.note('A prompt appears: authenticate. Its title is "Move the password".');
    await t.expect(
      'migrateItem moves it, with a prompt',
      [PROTECTED],
      async () =>
        (
          await migrateItem(
            { library: 'reactNativeKeychain', service: PROTECTED },
            {
              prompt: { title: 'Move the password', cancel: 'Not now' },
              setOptions: { accessControl: AccessControl.BiometryAny },
              removeSource: true,
            }
          )
        ).migrated
    );
    await t.expect(
      'the new item is protected, with the user name in the open',
      AccessControl.BiometryAny,
      async () => (await store.getItemInfo('credentials'))?.accessControl
    );
    await t.expect('and the old one is gone', false, () => rnk.hasGeneric(PROTECTED));
  },
};
