import type { Scenario } from '../harness/types';
import { codeOf } from '../harness/values';

const keys = Array.from({ length: 20 }, (_, index) => `key${String(index).padStart(2, '0')}`);

export const parallel: Scenario = {
  id: 'parallel',
  milestone: 'M1',
  title: 'Parallel calls',
  description:
    'Many writes, reads and removals at once, to one key and to many: none is lost, none is mixed up.',
  async run(t) {
    const store = await t.store('parallel');

    const present = async (names: string[]) => {
      const found = await Promise.all(names.map((name) => store.hasItem(name)));
      return names.filter((_, index) => found[index]);
    };

    await t.expect('20 writes to 20 keys at once', keys, async () => {
      await Promise.all(keys.map((key) => store.setItem(key, `value of ${key}`)));
      return present(keys);
    });
    await t.expect(
      '20 reads at once, each its own value',
      keys.map((key) => `value of ${key}`),
      () => Promise.all(keys.map((key) => store.getItem(key)))
    );

    const candidates = Array.from({ length: 10 }, (_, index) => `write ${index}`);
    let winner: unknown;
    try {
      await Promise.all(candidates.map((value) => store.setItem('race', value)));
      winner = await store.getItem('race');
    } catch (error) {
      winner = `throws ${codeOf(error)}`;
    }
    t.oneOf('10 writes to one key at once leave one of them', candidates, winner);
    await t.expect('and the other keys stay', keys, () => present(keys));

    await t.expect(
      'writes and removals at once',
      keys.filter((_, i) => i % 2 === 0),
      async () => {
        await Promise.all(
          keys.map((key, index) =>
            index % 2 === 0 ? store.setItem(key, 'kept') : store.removeItem(key)
          )
        );
        return present(keys);
      }
    );
    await t.expect('reads while writing', 'x'.repeat(5000), async () => {
      const big = 'x'.repeat(5000);
      const [, read] = await Promise.all([store.setItem('big', big), store.getItem('big')]);
      // The read may come before the write, so it is null or the whole value, never a part of it.
      return read === null ? big : read;
    });
  },
};
