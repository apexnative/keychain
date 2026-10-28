import { keychain, type Keychain, Accessible, KeychainErrorCode } from '@apexnative/keychain';
import type { Scenario } from '../harness/types';
import { SERVICE_PREFIX } from '../harness/runner';

// Services that must not be taken for each other.
const SERVICES = ['vault', 'Vault', 'vault.child', 'vault/ключ 🔐', ' vault'];

export const services: Scenario = {
  id: 'services',
  milestone: 'M1',
  title: 'Separate services',
  description:
    'createKeychain makes a store of its own: the same key in two services holds two items, and the options of the store are the defaults of its calls.',
  async run(t) {
    t.equal(
      'the default service is the app id',
      'dev.apexnative.keychain.example',
      keychain.service
    );

    const stores: Keychain[] = [];
    for (const [index, name] of SERVICES.entries()) {
      const store = await t.store(`services.${name}`);
      await store.setItem('shared', `value ${index}`);
      stores.push(store);
    }
    await t.expect(
      'the same key in 5 services, 5 values',
      SERVICES.map((_, index) => `value ${index}`),
      () => Promise.all(stores.map((store) => store.getItem('shared')))
    );
    t.equal(
      'service reports the name',
      `${SERVICE_PREFIX}services.vault/ключ 🔐`,
      stores[3]!.service
    );

    await stores[0]!.removeItem('shared');
    await t.expect('removing in one leaves the others', ['value 1', 'value 2'], async () => [
      await stores[1]!.getItem('shared'),
      await stores[2]!.getItem('shared'),
    ]);
    await stores[1]!.clear();
    await t.expect('clearing one leaves the others', 'value 2', () => stores[2]!.getItem('shared'));

    // The store's options are the defaults of its calls: a call that doesn't name one gets the store's. Both checks are
    // made by the package before anything is written, so no device feature is needed.
    const defaults = await t.store('services.defaults', { synchronizable: true });
    await t.fails('a call takes the options of the store', KeychainErrorCode.InvalidArgument, () =>
      defaults.setItem('inherits', 'v', { accessible: Accessible.WhenUnlockedThisDeviceOnly })
    );
    await t.expect('and its own options over them', 'v', async () => {
      await defaults.setItem('overrides', 'v', {
        accessible: Accessible.WhenUnlockedThisDeviceOnly,
        synchronizable: false,
      });
      return defaults.getItem('overrides');
    });
    await t.expect('the failed call wrote nothing', false, () => defaults.hasItem('inherits'));
  },
};
