import { Accessible, KeychainErrorCode } from '@apexnative/keychain';
import type { Scenario } from '../harness/types';
import { utf8 } from '../harness/values';

export const sync: Scenario = {
  id: 'sync',
  milestone: 'M1',
  title: 'Synchronous methods',
  description:
    'getItemSync, setItemSync, hasItemSync and removeItemSync work on the JavaScript thread and see the same items as the asynchronous ones.',
  async run(t) {
    const store = await t.store('sync');

    await t.expect('getItemSync of a missing key', null, () => store.getItemSync('missing'));
    await t.expect('hasItemSync of a missing key', false, () => store.hasItemSync('missing'));
    await t.expect('removeItemSync of a missing key is no error', undefined, () =>
      store.removeItemSync('missing')
    );

    await t.expect('setItemSync, then getItemSync', 'sync value', () => {
      store.setItemSync('a', 'sync value');
      return store.getItemSync('a');
    });
    await t.expect('hasItemSync after a write', true, () => store.hasItemSync('a'));
    await t.expect('setItemSync overwrites', 'second', () => {
      store.setItemSync('a', 'second');
      return store.getItemSync('a');
    });
    await t.expect('an empty string', '', () => {
      store.setItemSync('empty', '');
      return store.getItemSync('empty');
    });
    await t.expect('Unicode', 'пароль 🔐 日本', () => {
      store.setItemSync('unicode', 'пароль 🔐 日本');
      return store.getItemSync('unicode');
    });

    await t.expect('an item written by setItemSync, read by getItem', 'second', () =>
      store.getItem('a')
    );
    await t.expect('an item written by setItem, read by getItemSync', 'async value', async () => {
      await store.setItem('b', 'async value');
      return store.getItemSync('b');
    });
    await t.expect('an item written by setItemSync, read as bytes', utf8('второй'), async () => {
      store.setItemSync('c', 'второй');
      return store.getBytes('c');
    });
    await t.expect('bytes that are UTF-8, read by getItemSync', 'дa', async () => {
      await store.setBytes('d', utf8('дa'));
      return store.getItemSync('d');
    });
    await t.fails(
      'bytes that are not UTF-8, read by getItemSync',
      KeychainErrorCode.InvalidArgument,
      async () => {
        await store.setBytes('binary', Uint8Array.from([0xff, 0xfe]));
        return store.getItemSync('binary');
      }
    );
    await t.expect('a label written by setItemSync', 'Sync label', async () => {
      store.setItemSync('labeled', 'v', { label: 'Sync label' });
      return (await store.getItemInfo('labeled'))?.label;
    });
    await t.expect('accessible written by setItemSync', Accessible.WhenUnlocked, async () => {
      store.setItemSync('labeled', 'v', { accessible: Accessible.WhenUnlocked });
      return (await store.getItemInfo('labeled'))?.accessible;
    });

    await t.expect('removeItemSync, then hasItem', false, async () => {
      store.removeItemSync('a');
      return store.hasItem('a');
    });
    await t.expect('removeItemSync, then getItemSync', null, () => store.getItemSync('a'));
    await t.expect('hasItemSync sees an item written by setItem', true, () =>
      store.hasItemSync('b')
    );

    const started = Date.now();
    for (let index = 0; index < 200; index++) {
      store.setItemSync('loop', `value ${index}`);
      store.getItemSync('loop');
    }
    t.within('200 writes and 200 reads in a loop, ms', 0, 5000, Date.now() - started);
  },
};
