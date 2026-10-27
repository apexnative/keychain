import { decodeBase64, encodeBase64 } from '../base64';

const bytes = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

describe('base64', () => {
  // RFC 4648 §10.
  it.each([
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ])('encodes %p as %p and back', (text, base64) => {
    expect(encodeBase64(bytes(text))).toBe(base64);
    expect(decodeBase64(base64)).toEqual(bytes(text));
  });

  it('round-trips every byte value', () => {
    const all = Uint8Array.from({ length: 256 }, (_, index) => index);
    const base64 = encodeBase64(all);
    expect(base64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(decodeBase64(base64)).toEqual(all);
  });

  it('round-trips random lengths', () => {
    for (let length = 0; length < 70; length++) {
      const random = Uint8Array.from({ length }, () => Math.floor(Math.random() * 256));
      expect(decodeBase64(encodeBase64(random))).toEqual(random);
    }
  });

  it('decodes without padding', () => {
    expect(decodeBase64('Zm8')).toEqual(bytes('fo'));
    expect(decodeBase64('Zg')).toEqual(bytes('f'));
  });

  it('rejects what is not Base64', () => {
    expect(() => decodeBase64('Zm9v\n')).toThrow('Not Base64');
    expect(() => decodeBase64('Zm9-')).toThrow('Not Base64');
    expect(() => decodeBase64('Z=9v')).toThrow('Not Base64');
    expect(() => decodeBase64('Zm9vY')).toThrow('Not Base64');
    expect(() => decodeBase64('é')).toThrow('Not Base64');
  });
});
