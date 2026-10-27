/* eslint-disable no-bitwise */
// UTF-8 for the in-memory module, which stores bytes as the native side does. Jest's environment may lack
// TextEncoder and TextDecoder, so both directions are here.

/** The UTF-8 bytes of a well-formed string. */
export function encodeUtf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index++) {
    let code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        index++;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63)
      );
    }
  }
  return Uint8Array.from(bytes);
}

/** The text of UTF-8 bytes, or null when they aren't valid UTF-8. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  let text = '';
  let index = 0;
  while (index < bytes.length) {
    const first = bytes[index];
    let length: number;
    let code: number;
    let min: number;
    if (first < 0x80) {
      text += String.fromCharCode(first);
      index++;
      continue;
    } else if (first >= 0xc2 && first <= 0xdf) {
      [length, code, min] = [2, first & 0x1f, 0x80];
    } else if (first >= 0xe0 && first <= 0xef) {
      [length, code, min] = [3, first & 0x0f, 0x800];
    } else if (first >= 0xf0 && first <= 0xf4) {
      [length, code, min] = [4, first & 0x07, 0x10000];
    } else {
      return null;
    }
    if (index + length > bytes.length) return null;
    for (let offset = 1; offset < length; offset++) {
      const next = bytes[index + offset];
      if ((next & 0xc0) !== 0x80) return null;
      code = (code << 6) | (next & 0x3f);
    }
    if (code < min || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return null;
    text += String.fromCodePoint(code);
    index += length;
  }
  return text;
}
