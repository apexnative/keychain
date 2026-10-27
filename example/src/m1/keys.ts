import type { Scenario } from '../harness/types';

const KEYS: Array<[string, string]> = [
  ['a word', 'token'],
  ['spaces inside', 'my secret token'],
  ['leading and trailing spaces', '  padded  '],
  ['only a space', ' '],
  ['dots, dashes and underscores', 'a.b-c_d'],
  ['slashes and a colon', 'path/to\\key:1'],
  ['a path to the parent', '../x'],
  ['Cyrillic', 'ключ доступа'],
  ['CJK', '鍵'],
  ['an emoji', '🔑'],
  ['a ZWJ sequence', '👨‍👩‍👧'],
  ['256 characters', 'k'.repeat(256)],
  ['256 emoji, 512 UTF-16 units', '🔑'.repeat(256)],
  ['quotes and a percent sign', `it's "100%" {key}`],
];

export const keys: Scenario = {
  id: 'keys',
  milestone: 'M1',
  title: 'Keys',
  description:
    'Any non-empty string of up to 256 characters is a key. Keys that differ in case, in spaces or in Unicode form are different items.',
  async run(t) {
    const store = await t.store('keys');

    for (const [name, key] of KEYS) {
      await t.expect(name, `value of ${name}`, async () => {
        await store.setItem(key, `value of ${name}`);
        return store.getItem(key);
      });
    }
    await t.expect('getAllKeys lists them all', KEYS.map(([, key]) => key).sort(), () =>
      store.getAllKeys()
    );

    const near = ['key', 'Key', 'key ', 'ключ', 'Ключ', 'é', 'é'];
    for (const key of near) await store.setItem(key, `near ${JSON.stringify(key)}`);
    await t.expect(
      'keys that look alike are different items',
      near.map((key) => `near ${JSON.stringify(key)}`),
      () => Promise.all(near.map((key) => store.getItem(key)))
    );
    await t.expect('and are listed apart', near.length, async () => {
      const listed = await store.getAllKeys();
      return near.filter((key) => listed.includes(key)).length;
    });
  },
};
