import { keychain } from '@apexnative/keychain';
import type { Scenario } from '../harness/types';

const MARKER = 'apexnative.example.clear.marker';

export const clear: Scenario = {
  id: 'clear',
  milestone: 'M1',
  title: 'clear',
  description:
    'Deletes every item of one store and only of it: another store, and the default store, keep theirs.',
  async run(t) {
    const store = await t.store('clear');
    const other = await t.store('clear-other');
    await keychain.setItem(MARKER, 'default store');
    t.cleanup(() => keychain.removeItem(MARKER));

    await t.expect('clear of an empty store resolves', undefined, () => store.clear());

    for (let index = 0; index < 20; index++) await store.setItem(`item${index}`, 'v');
    await store.setBytes('bytes', Uint8Array.from([1, 2, 3]));
    await other.setItem('kept', 'still here');

    await t.expect('clear resolves', undefined, () => store.clear());
    await t.expect('hasItem after clear', [false, false, false], () =>
      Promise.all([store.hasItem('item0'), store.hasItem('item19'), store.hasItem('bytes')])
    );
    await t.expect('getItem after clear', null, () => store.getItem('item0'));
    await t.expect('getBytes after clear', null, () => store.getBytes('bytes'));
    await t.expect('another store keeps its items', 'still here', () => other.getItem('kept'));
    await t.expect('the default store keeps its items', 'default store', () =>
      keychain.getItem(MARKER)
    );

    await t.expect('a write after clear', 'new', async () => {
      await store.setItem('item0', 'new');
      return store.getItem('item0');
    });
    await t.expect('clear twice in a row', undefined, async () => {
      await store.clear();
      await store.clear();
    });
    await t.expect('and the store is empty', false, () => store.hasItem('item0'));
  },
};
