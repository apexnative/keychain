/* eslint-disable no-bitwise */
// How a scenario compares what a call returned with what was expected, and how it shows both.

/** A short fingerprint of a long value, so that two values that look alike in the table can still be told apart. */
function fingerprint(codes: ArrayLike<number>): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < codes.length; index++) {
    hash = Math.imul(hash ^ codes[index]!, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function stringCodes(text: string): number[] {
  const codes: number[] = [];
  for (let index = 0; index < text.length; index++) codes.push(text.charCodeAt(index));
  return codes;
}

function hex(byte: number): string {
  return byte.toString(16).padStart(2, '0');
}

function describeBytes(bytes: Uint8Array): string {
  if (bytes.length <= 12)
    return `bytes(${bytes.length}) ${Array.from(bytes, hex).join(' ')}`.trim();
  const head = Array.from(bytes.subarray(0, 8), hex).join(' ');
  const tail = Array.from(bytes.subarray(bytes.length - 2), hex).join(' ');
  return `bytes(${bytes.length}) ${head} … ${tail} #${fingerprint(bytes)}`;
}

function describeString(text: string): string {
  if (text.length <= 48) return JSON.stringify(text);
  const characters = Array.from(text);
  const head = JSON.stringify(characters.slice(0, 20).join('')).slice(1, -1);
  const tail = JSON.stringify(characters.slice(-8).join('')).slice(1, -1);
  return `"${head}…${tail}" (${text.length} chars #${fingerprint(stringCodes(text))})`;
}

/** A value as the table shows it: strings quoted with their control characters visible, bytes in hex, long ones cut. */
export function describe(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return describeString(value);
  if (value instanceof Uint8Array) return describeBytes(value);
  if (Array.isArray(value)) return `[${value.map(describe).join(', ')}]`;
  if (typeof value === 'object' && value !== null) {
    const fields = Object.entries(value)
      .filter(([, field]) => field !== undefined)
      .map(([name, field]) => `${name}: ${describe(field)}`);
    return `{ ${fields.join(', ')} }`.replace('{  }', '{}');
  }
  return String(value);
}

/** Whether two values are the same, deeply: bytes by content, objects by their fields, an undefined field as absent. */
export function same(a: unknown, b: unknown): boolean {
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    return (
      a instanceof Uint8Array &&
      b instanceof Uint8Array &&
      a.length === b.length &&
      a.every((byte, index) => byte === b[index])
    );
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => same(item, b[index]))
    );
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const fields = (value: object) =>
      Object.entries(value).filter(([, field]) => field !== undefined);
    const left = fields(a);
    const right = fields(b);
    return (
      left.length === right.length &&
      left.every(([name, field]) => same(field, (b as Record<string, unknown>)[name]))
    );
  }
  return a === b;
}

/** The code of an error: a `KeychainError`'s, or the `code` of a native rejection. */
export function codeOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code: unknown };
    if (typeof code === 'string') return code;
  }
  return undefined;
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

/** An error as one line: its code and message. */
export function describeError(error: unknown): string {
  const code = codeOf(error);
  return code ? `${code}: ${messageOf(error)}` : messageOf(error);
}

/** `count` bytes that differ from each other for a while and are not text: `(index * 31 + 7) mod 256`. */
export function patternBytes(count: number): Uint8Array {
  return Uint8Array.from({ length: count }, (_, index) => (index * 31 + 7) & 0xff);
}

/** UTF-8 bytes of a string, for the expectations about reading text as bytes and back. */
export function utf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) {
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
