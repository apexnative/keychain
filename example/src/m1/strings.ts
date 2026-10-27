import { KeychainErrorCode } from '@apexnative/keychain';
import type { Scenario } from '../harness/types';

const TEXTS: Array<[string, string]> = [
  ['an empty string', ''],
  ['a space', ' '],
  ['ASCII', 'hello, world'],
  ['Cyrillic', 'пароль'],
  ['CJK', '日本語のパスワード'],
  ['an emoji and a ZWJ sequence', '🔐 👨‍👩‍👧'],
  ['a combining accent, not normalized', 'é é'],
  ['line breaks and tabs', 'one\ntwo\r\nthree\tfour'],
  ['JSON', JSON.stringify({ token: 'abc', scopes: ['read', 'write'] })],
  ['quotes and backslashes', '"\'\\ \\n %s {0} <&>'],
  ['16 KB of ASCII', 'abcdefghijklmnop'.repeat(1024)],
  ['36 KB of mixed Unicode', 'ключ-🔑-鍵-'.repeat(2048)],
];

export const strings: Scenario = {
  id: 'strings',
  milestone: 'M1',
  title: 'Strings',
  description: 'Writes and reads text of every kind, overwrites it, reads a key that is not there.',
  async run(t) {
    const store = await t.store('strings');

    await t.expect('a missing key reads null', null, () => store.getItem('missing'));
    await t.expect('setItem resolves with nothing', undefined, () =>
      store.setItem('token', 'first')
    );
    await t.expect('write, then read', 'first', async () => {
      await store.setItem('token', 'first');
      return store.getItem('token');
    });
    await t.expect('overwrite', 'second', async () => {
      await store.setItem('token', 'second');
      return store.getItem('token');
    });
    await t.expect('overwriting leaves one key', ['token'], () => store.getAllKeys());

    // React Native cuts a string at U+0000 on the bridge, so the wrapper refuses it before anything is written.
    await t.fails('a value with U+0000 is refused', KeychainErrorCode.InvalidArgument, () =>
      store.setItem('token', 'a\u0000b')
    );
    await t.expect('and the item stays', 'second', () => store.getItem('token'));

    for (const [name, text] of TEXTS) {
      await t.expect(name, text, async () => {
        await store.setItem('text', text);
        return store.getItem('text');
      });
    }
  },
};
