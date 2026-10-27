import { KeychainErrorCode } from '@apexnative/keychain';
import type { Scenario } from '../harness/types';
import { patternBytes, utf8 } from '../harness/values';

const SIZES = [0, 1, 2, 3, 4, 5, 15, 16, 17, 255, 256, 257, 1000, 32768];

// Bytes that are no UTF-8 text, each for another reason.
const NOT_UTF8: Array<[string, number[]]> = [
  ['0xFF 0xFE', [0xff, 0xfe]],
  ['a continuation byte alone', [0x80]],
  ['a cut-off sequence', [0xe2, 0x82]],
  ['an overlong NUL', [0xc0, 0x80]],
  ['an encoded surrogate', [0xed, 0xa0, 0x80]],
];

export const bytes: Scenario = {
  id: 'bytes',
  milestone: 'M1',
  title: 'Bytes',
  description:
    'Writes and reads bytes of every length, and crosses text and bytes: text read as bytes, bytes read as text.',
  async run(t) {
    const store = await t.store('bytes');

    for (const size of SIZES) {
      const value = patternBytes(size);
      await t.expect(`${size} bytes`, value, async () => {
        await store.setBytes('data', value);
        return store.getBytes('data');
      });
    }
    const everyByte = Uint8Array.from({ length: 256 }, (_, index) => index);
    await t.expect('every byte value, 0 to 255', everyByte, async () => {
      await store.setBytes('data', everyByte);
      return store.getBytes('data');
    });
    // Bytes cross as Base64, so zeros are no problem for them, unlike for a string.
    for (const [name, content] of [
      ['a zero in the middle', [0x61, 0x00, 0x62]],
      ['only zeros', [0, 0, 0, 0, 0, 0, 0, 0]],
      ['a zero at both ends', [0x00, 0x41, 0x00]],
    ] as const) {
      await t.expect(name, Uint8Array.from(content), async () => {
        await store.setBytes('zeros', Uint8Array.from(content));
        return store.getBytes('zeros');
      });
    }
    await t.expect('a missing key reads null', null, () => store.getBytes('missing'));

    await t.expect('UTF-8 bytes read as text', 'дa🔐', async () => {
      await store.setBytes('utf8', utf8('дa🔐'));
      return store.getItem('utf8');
    });
    for (const [name, content] of NOT_UTF8) {
      await store.setBytes('binary', Uint8Array.from(content));
      await t.fails(`${name}, read as text`, KeychainErrorCode.InvalidArgument, () =>
        store.getItem('binary')
      );
      await t.expect(`${name}, read as bytes`, Uint8Array.from(content), () =>
        store.getBytes('binary')
      );
    }

    for (const text of ['дa🔐', '']) {
      await t.expect(`text ${JSON.stringify(text)} read as bytes`, utf8(text), async () => {
        await store.setItem('text', text);
        return store.getBytes('text');
      });
    }

    await t.expect('text overwritten by bytes', Uint8Array.from([1, 2, 3]), async () => {
      await store.setItem('both', 'text');
      await store.setBytes('both', Uint8Array.from([1, 2, 3]));
      return store.getBytes('both');
    });
    await t.expect('bytes overwritten by text', 'text again', async () => {
      await store.setItem('both', 'text again');
      return store.getItem('both');
    });
  },
};
