import type { Scenario } from '../harness/types';

export const allKeys: Scenario = {
  id: 'all-keys',
  milestone: 'M1',
  title: 'getAllKeys',
  description:
    'Lists the keys of one store, sorted: none in an empty store, no duplicates after overwrites, no keys of other stores.',
  async run(t) {
    const store = await t.store('all-keys');
    const other = await t.store('all-keys-other');

    await t.expect('an empty store', [], () => store.getAllKeys());

    // Sorted by UTF-16 code unit, as JavaScript sorts strings.
    const keys = ['b', 'B', 'a', 'z', 'ы', '🔑', 'with space', 'a.b', 'a/b', 'a:b', '1', '10', '2'];
    for (const key of keys) await store.setItem(key, `value of ${key}`);
    await other.setItem('foreign', 'x');
    await t.expect('the keys, sorted', [...keys].sort(), () => store.getAllKeys());

    await store.setItem('a', 'overwritten');
    await store.setBytes('b', Uint8Array.from([1]));
    await t.expect('overwrites add no keys', [...keys].sort(), () => store.getAllKeys());

    await store.removeItem('z');
    await t.expect('a removed key is gone', keys.filter((key) => key !== 'z').sort(), () =>
      store.getAllKeys()
    );
    await t.expect('the other store has its own', ['foreign'], () => other.getAllKeys());

    const many = Array.from(
      { length: 100 },
      (_, index) => `item ${String(index).padStart(3, '0')}`
    );
    await t.expect(
      '100 more keys',
      [...keys.filter((key) => key !== 'z'), ...many].sort(),
      async () => {
        await Promise.all(many.map((key) => store.setItem(key, 'v')));
        return store.getAllKeys();
      }
    );
  },
};
