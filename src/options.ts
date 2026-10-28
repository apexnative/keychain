// The checks of keys, values and options, and how the options of a store and of a call make the complete options the
// native side gets (src/native/NativeApexKeychain.ts). Every check throws a KeychainError INVALID_ARGUMENT. An option
// name the package doesn't know is an error too: a misspelt `accessControl` would otherwise store a secret unprotected.
import { Platform } from 'react-native';
import { invalidArgument } from './errors';
import type * as Native from './native/NativeApexKeychain';
import { Accessible, AccessControl, KeyStorage } from './constants';
import type { AndroidOptions, GetOptions, KeychainOptions, Prompt, SetOptions } from './types';

export const ACCESSIBLE: readonly Accessible[] = Object.values(Accessible);

export const ACCESS_CONTROL: readonly AccessControl[] = Object.values(AccessControl);

export const KEY_STORAGE: readonly KeyStorage[] = Object.values(KeyStorage);

/** The longest key or service, in Unicode characters (code points). */
export const MAX_KEY_LENGTH = 256;

/** The longest `authValidity`, in seconds: Android takes it as an `int`. */
const MAX_AUTH_VALIDITY = 2147483647;

/** The defaults of the options. */
const DEFAULTS = {
  accessible: Accessible.AfterFirstUnlock,
  accessControl: AccessControl.None,
  authValidity: 0,
  synchronizable: false,
  keyStorage: KeyStorage.Tee,
  confirmationRequired: true,
} as const;

const KEYCHAIN_OPTIONS = [
  'service',
  'accessible',
  'accessControl',
  'authValidity',
  'synchronizable',
  'accessGroup',
  'prompt',
  'android',
] as const;
const SET_OPTIONS = [
  'accessible',
  'accessControl',
  'authValidity',
  'synchronizable',
  'android',
] as const;
const GET_OPTIONS = ['prompt'] as const;
const PROMPT_OPTIONS = [
  'title',
  'subtitle',
  'description',
  'cancel',
  'confirmationRequired',
] as const;
const ANDROID_OPTIONS = ['keyStorage'] as const;

/** A value for an error message: strings quoted, the rest as JSON when it can be. */
function show(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`;
  if (typeof value === 'function') return 'a function';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Whether a string is well-formed UTF-16: no lone surrogate, so it has a UTF-8 form. */
function isWellFormed(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** The length of a well-formed string in code points. */
function codePoints(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) index++;
    count++;
  }
  return count;
}

/**
 * A key or a service: a non-empty, well-formed string of up to 256 characters without U+0000 (Android binds the
 * ciphertext to `service \0 key`).
 */
export function checkName(name: unknown, what: string): string {
  if (
    typeof name !== 'string' ||
    name === '' ||
    !isWellFormed(name) ||
    codePoints(name) > MAX_KEY_LENGTH ||
    name.includes('\0')
  ) {
    throw invalidArgument(
      `Invalid ${what}: expected a non-empty string of up to ${MAX_KEY_LENGTH} characters without U+0000, got ${show(name)}.`
    );
  }
  return name;
}

/** A key. */
export function checkKey(key: unknown): string {
  return checkName(key, 'key');
}

/**
 * A string that is stored, such as a value or a label: any well-formed string without U+0000, empty included. React
 * Native cuts a string at U+0000 on the bridge, on both platforms, so such a string would come back shorter; binary
 * data goes through `setBytes`, which isn't affected.
 */
export function checkText(text: unknown, what: string): string {
  if (typeof text !== 'string') {
    throw invalidArgument(`Invalid ${what}: expected a string, got ${show(text)}.`);
  }
  if (!isWellFormed(text)) {
    throw invalidArgument(
      `Invalid ${what}: the string has a lone surrogate, so it has no UTF-8 form. Store it with setBytes.`
    );
  }
  if (text.includes('\0')) {
    throw invalidArgument(
      `Invalid ${what}: the string has U+0000, and React Native cuts a string there on the bridge.` +
        (what === 'value' ? ' Store binary data with setBytes.' : '')
    );
  }
  return text;
}

/** The value of `setBytes`. */
export function checkBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw invalidArgument(`Invalid value: expected a Uint8Array, got ${show(value)}.`);
  }
  return value;
}

/** An options object: undefined, or a plain object whose every key is one of `known`. */
export function checkObject(
  value: unknown,
  what: string,
  known: readonly string[]
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidArgument(`Invalid ${what}: expected an object, got ${show(value)}.`);
  }
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) {
      throw invalidArgument(
        `Invalid ${what}: unknown option '${key}'. The options are ${known.join(', ')}.`
      );
    }
  }
  return value as Record<string, unknown>;
}

/** The access control of `canUseAccessControl`. */
export function checkAccessControl(value: unknown): AccessControl {
  const accessControl = checkOneOf(value, ACCESS_CONTROL, 'accessControl');
  if (accessControl === undefined) {
    throw invalidArgument(
      `Invalid accessControl: expected one of ${ACCESS_CONTROL.join(', ')}, got undefined.`
    );
  }
  return accessControl;
}

function checkOneOf<T extends string>(
  value: unknown,
  values: readonly T[],
  what: string
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw invalidArgument(
      `Invalid ${what}: expected one of ${values.join(', ')}, got ${show(value)}.`
    );
  }
  return value as T;
}

function checkBoolean(value: unknown, what: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw invalidArgument(`Invalid ${what}: expected a boolean, got ${show(value)}.`);
  }
  return value;
}

function checkString(value: unknown, what: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw invalidArgument(`Invalid ${what}: expected a string, got ${show(value)}.`);
  }
  return value;
}

function checkAuthValidity(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_AUTH_VALIDITY
  ) {
    throw invalidArgument(
      `Invalid authValidity: expected a whole number of seconds from 0 to ${MAX_AUTH_VALIDITY}, got ${show(value)}.`
    );
  }
  return value;
}

/** An object without the keys whose value is undefined: the native side gets only what is set. */
function defined<T extends object>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (field !== undefined) result[key] = field;
  }
  return result as T;
}

/** The prompt's texts, checked. */
export function parsePrompt(value: unknown, what = 'prompt'): Prompt | undefined {
  const prompt = checkObject(value, what, PROMPT_OPTIONS);
  if (!prompt) return undefined;
  return defined({
    title: checkString(prompt.title, `${what}.title`),
    subtitle: checkString(prompt.subtitle, `${what}.subtitle`),
    description: checkString(prompt.description, `${what}.description`),
    cancel: checkString(prompt.cancel, `${what}.cancel`),
    confirmationRequired: checkBoolean(prompt.confirmationRequired, `${what}.confirmationRequired`),
  });
}

function parseAndroid(value: unknown): AndroidOptions | undefined {
  const android = checkObject(value, 'android', ANDROID_OPTIONS);
  if (!android) return undefined;
  return defined({
    keyStorage: checkOneOf(android.keyStorage, KEY_STORAGE, 'android.keyStorage'),
  });
}

/** The options of `createKeychain`, checked, the forbidden combinations included. */
export function parseKeychainOptions(value: unknown): KeychainOptions {
  const options = checkObject(value, 'keychain options', KEYCHAIN_OPTIONS) ?? {};
  const accessGroup = checkString(options.accessGroup, 'accessGroup');
  if (accessGroup === '')
    throw invalidArgument('Invalid accessGroup: expected a non-empty string.');
  const parsed: KeychainOptions = defined({
    service: options.service === undefined ? undefined : checkName(options.service, 'service'),
    accessible: checkOneOf(options.accessible, ACCESSIBLE, 'accessible'),
    accessControl: checkOneOf(options.accessControl, ACCESS_CONTROL, 'accessControl'),
    authValidity: checkAuthValidity(options.authValidity),
    synchronizable: checkBoolean(options.synchronizable, 'synchronizable'),
    accessGroup,
    prompt: parsePrompt(options.prompt),
    android: parseAndroid(options.android),
  });
  // The store's own options must make a valid write, before any call.
  resolveWrite(parsed, {});
  return parsed;
}

/** The options of a write, checked; `extra` are the names a method adds, such as `server`, passed on unchecked. */
export function parseSetOptions(
  value: unknown,
  extra: readonly string[] = []
): SetOptions & { [name: string]: unknown } {
  const options = checkObject(value, 'options', [...SET_OPTIONS, ...extra]) ?? {};
  return withExtra(options, extra, {
    accessible: checkOneOf(options.accessible, ACCESSIBLE, 'accessible'),
    accessControl: checkOneOf(options.accessControl, ACCESS_CONTROL, 'accessControl'),
    authValidity: checkAuthValidity(options.authValidity),
    synchronizable: checkBoolean(options.synchronizable, 'synchronizable'),
    android: parseAndroid(options.android),
  });
}

/** The options of a read, checked; `extra` are the names a method adds, such as `server`, passed on unchecked. */
export function parseGetOptions(
  value: unknown,
  extra: readonly string[] = []
): GetOptions & { [name: string]: unknown } {
  const options = checkObject(value, 'options', [...GET_OPTIONS, ...extra]) ?? {};
  return withExtra(options, extra, { prompt: parsePrompt(options.prompt) });
}

/** The checked options, without undefined fields, and the `extra` names of `options` as they are. */
function withExtra<T extends object>(
  options: Record<string, unknown>,
  extra: readonly string[],
  checked: T
): T & { [name: string]: unknown } {
  const result = defined(checked) as Record<string, unknown>;
  for (const name of extra) {
    if (options[name] !== undefined) result[name] = options[name];
  }
  return result as T & { [name: string]: unknown };
}

let warnedSynchronizable = false;

/**
 * The complete options of a write: the call's over the store's over the defaults. Throws on the forbidden
 * combinations, on both platforms alike, so that code that works on one works on the other.
 */
export function resolveWrite(
  store: KeychainOptions,
  call: SetOptions & { label?: string }
): Native.WriteOptions {
  const accessible = call.accessible ?? store.accessible ?? DEFAULTS.accessible;
  const accessControl = call.accessControl ?? store.accessControl ?? DEFAULTS.accessControl;
  const authValidity = call.authValidity ?? store.authValidity ?? DEFAULTS.authValidity;
  const synchronizable = call.synchronizable ?? store.synchronizable ?? DEFAULTS.synchronizable;
  const keyStorage = call.android?.keyStorage ?? store.android?.keyStorage ?? DEFAULTS.keyStorage;

  if (
    authValidity > 0 &&
    (accessControl === AccessControl.BiometryCurrentSet ||
      accessControl === AccessControl.BiometryCurrentSetOrPasscode)
  ) {
    throw invalidArgument(
      `accessControl '${accessControl}' can't be used with authValidity > 0: Android invalidates a key on new ` +
        `biometry only when every use authenticates. Use authValidity 0, or 'biometryAny'.`
    );
  }
  if (synchronizable && accessible.endsWith('ThisDeviceOnly')) {
    throw invalidArgument(
      `synchronizable can't be used with accessible '${accessible}': iCloud Keychain syncs no item that stays on ` +
        `this device.`
    );
  }
  if (synchronizable && accessControl !== AccessControl.None) {
    throw invalidArgument(
      `synchronizable can't be used with accessControl '${accessControl}': iCloud Keychain syncs no item with ` +
        `access control.`
    );
  }
  if (synchronizable && Platform.OS === 'android' && __DEV__ && !warnedSynchronizable) {
    warnedSynchronizable = true;
    console.warn(
      '[ApexKeychain] synchronizable is iOS only (iCloud Keychain): Android keeps the item on this device.'
    );
  }

  return defined({
    accessible,
    accessControl,
    authValidity: accessControl === AccessControl.None ? 0 : authValidity,
    synchronizable,
    keyStorage,
    label: call.label,
  });
}

/** The complete prompt of a read: the call's texts over the store's, field by field. */
export function resolvePrompt(store: Prompt | undefined, call: Prompt | undefined): Native.Prompt {
  return {
    ...store,
    ...call,
    confirmationRequired:
      call?.confirmationRequired ?? store?.confirmationRequired ?? DEFAULTS.confirmationRequired,
  };
}
