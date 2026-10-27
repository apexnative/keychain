import type { Scenario } from '../harness/types';

export const hasRemove: Scenario = {
  id: 'has-remove',
  milestone: 'M1',
  title: 'hasItem and removeItem',
  description:
    'hasItem tells an item from a missing one, an empty value included. removeItem deletes one item and is no error when there is none.',
  async run(t) {
    const store = await t.store('has-remove');

    await t.expect('hasItem of a missing key', false, () => store.hasItem('a'));
    await store.setItem('a', 'value');
    await store.setItem('b', 'other');
    await t.expect('hasItem after a write', true, () => store.hasItem('a'));
    await t.expect('hasItem of an empty value', true, async () => {
      await store.setItem('empty', '');
      return store.hasItem('empty');
    });
    await t.expect('hasItem of an empty value of bytes', true, async () => {
      await store.setBytes('empty-bytes', new Uint8Array(0));
      return store.hasItem('empty-bytes');
    });

    await t.expect('removeItem resolves', undefined, () => store.removeItem('a'));
    await t.expect('hasItem after removeItem', false, () => store.hasItem('a'));
    await t.expect('getItem after removeItem', null, () => store.getItem('a'));
    await t.expect('getBytes after removeItem', null, () => store.getBytes('a'));
    await t.expect('getItemInfo after removeItem', null, () => store.getItemInfo('a'));
    await t.expect('another item stays', 'other', () => store.getItem('b'));
    await t.expect('getAllKeys after removeItem', ['b', 'empty', 'empty-bytes'], () =>
      store.getAllKeys()
    );
    await t.expect('removeItem of a missing item is no error', undefined, () =>
      store.removeItem('a')
    );
    await t.expect('removeItem of a never written key is no error', undefined, () =>
      store.removeItem('never written')
    );
    await t.expect('write again after removal', 'again', async () => {
      await store.setItem('a', 'again');
      return store.getItem('a');
    });
  },
};
