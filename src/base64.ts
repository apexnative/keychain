/* eslint-disable no-bitwise */
// Bytes cross to the native side as standard Base64 (RFC 4648 §4, with padding): the codegen has no type for binary
// data. Hermes has no Buffer, and atob/btoa work on binary strings, so the conversion is done here.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// The value of each Base64 character by its char code, -1 for anything else.
const VALUES = new Int16Array(128).fill(-1);
for (let index = 0; index < ALPHABET.length; index++) {
  VALUES[ALPHABET.charCodeAt(index)] = index;
}

/** Standard Base64 of the bytes, with padding. */
export function encodeBase64(bytes: Uint8Array): string {
  let result = '';
  let index = 0;
  for (; index + 2 < bytes.length; index += 3) {
    const chunk = (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
    result +=
      ALPHABET[(chunk >> 18) & 63] +
      ALPHABET[(chunk >> 12) & 63] +
      ALPHABET[(chunk >> 6) & 63] +
      ALPHABET[chunk & 63];
  }
  const rest = bytes.length - index;
  if (rest === 1) {
    const chunk = bytes[index] << 16;
    result += ALPHABET[(chunk >> 18) & 63] + ALPHABET[(chunk >> 12) & 63] + '==';
  } else if (rest === 2) {
    const chunk = (bytes[index] << 16) | (bytes[index + 1] << 8);
    result +=
      ALPHABET[(chunk >> 18) & 63] +
      ALPHABET[(chunk >> 12) & 63] +
      ALPHABET[(chunk >> 6) & 63] +
      '=';
  }
  return result;
}

/**
 * The bytes of standard Base64, with or without padding. Throws on a character outside the alphabet, on padding
 * anywhere but the end, and on a length no Base64 has.
 */
export function decodeBase64(text: string): Uint8Array {
  let end = text.length;
  if (end % 4 === 0 && text.endsWith('==')) end -= 2;
  else if (end % 4 === 0 && text.endsWith('=')) end -= 1;
  if (end % 4 === 1) throw new Error('Not Base64: the length is wrong.');

  const bytes = new Uint8Array(Math.floor((end * 3) / 4));
  let byteIndex = 0;
  let buffer = 0;
  let bits = 0;
  for (let index = 0; index < end; index++) {
    const code = text.charCodeAt(index);
    const value = code < 128 ? VALUES[code] : -1;
    if (value < 0) throw new Error(`Not Base64: '${text[index]}' at ${index}.`);
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[byteIndex++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes;
}
