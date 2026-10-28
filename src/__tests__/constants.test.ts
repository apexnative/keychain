// The constants of the options (`AccessControl.BiometryAny`, `KeychainErrorCode.KeyInvalidated`, …): the same strings as
// the union types and the native contract, named in PascalCase, and the strings are still accepted wherever a constant is.
import {
  Accessible,
  AccessControl,
  BiometryType,
  HardwareSecurityLevel,
  KeyStorage,
} from '../constants';
import { KEYCHAIN_ERROR_CODES, KeychainError, KeychainErrorCode, isKeychainError } from '../errors';
import {
  createKeychain,
  getBiometryTypes,
  getHardwareSecurityLevel,
  keychain,
  keychainMock,
} from '../jest';
import type * as Native from '../native/NativeApexKeychain';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// A constant's type is the union of the contract's strings, and the other way round. A difference fails `tsc`.
const sameTypes: [
  Equal<Accessible, Native.Accessible>,
  Equal<AccessControl, Native.AccessControl>,
  Equal<KeyStorage, Native.KeyStorage>,
  Equal<BiometryType, Native.BiometryType>,
  Equal<HardwareSecurityLevel, Native.SecurityLevel>,
  Equal<KeychainErrorCode, Native.ErrorCode>,
] = [true, true, true, true, true, true];

// The string literals of the unions, and the constants, are both accepted.
const literals: [
  Accessible,
  AccessControl,
  KeyStorage,
  BiometryType,
  HardwareSecurityLevel,
  KeychainErrorCode,
] = ['whenUnlocked', 'biometryCurrentSet', 'strongbox', 'faceID', 'tee', 'KEY_INVALIDATED'];
const constants: typeof literals = [
  Accessible.WhenUnlocked,
  AccessControl.BiometryCurrentSet,
  KeyStorage.Strongbox,
  BiometryType.FaceID,
  HardwareSecurityLevel.Tee,
  KeychainErrorCode.KeyInvalidated,
];

const GROUPS = {
  Accessible,
  AccessControl,
  KeyStorage,
  BiometryType,
  HardwareSecurityLevel,
  KeychainErrorCode,
} as const;

declare const __dirname: string;

/** The members of the union type `name` as the contract spells them out in its source. */
function contractMembers(name: string): string[] {
  const fs = require('fs') as { readFileSync(path: string, encoding: string): string };
  const source = fs.readFileSync(`${__dirname}/../native/NativeApexKeychain.ts`, 'utf8');
  const match = new RegExp(`export type ${name} =([^;]*);`).exec(source);
  if (!match) throw new Error(`The contract has no type ${name}.`);
  return [...match[1]!.matchAll(/'([^']+)'/g)].map((member) => member[1]!);
}

/** `faceID` → `FaceID`, `USER_CANCELED` → `UserCanceled`. */
function pascalCase(value: string): string {
  if (/^[A-Z_]+$/.test(value)) {
    return value
      .split('_')
      .map((word) => word[0]! + word.slice(1).toLowerCase())
      .join('');
  }
  return value[0]!.toUpperCase() + value.slice(1);
}

describe('the constants', () => {
  it('have the types of the native contract', () => {
    expect(sameTypes.every(Boolean)).toBe(true);
    expect(constants).toEqual(literals);
  });

  it.each([
    ['Accessible', 'Accessible'],
    ['AccessControl', 'AccessControl'],
    ['KeyStorage', 'KeyStorage'],
    ['BiometryType', 'BiometryType'],
    ['HardwareSecurityLevel', 'SecurityLevel'],
    ['KeychainErrorCode', 'ErrorCode'],
  ] as const)('of %s are the strings of the contract, no more and no fewer', (name, native) => {
    const values = Object.values(GROUPS[name]);
    expect([...values].sort()).toEqual(contractMembers(native).sort());
    expect(new Set(values).size).toBe(values.length);
  });

  it.each(Object.entries(GROUPS))(
    'of %s are named in PascalCase after their strings',
    (_, group) => {
      for (const [member, value] of Object.entries(group)) {
        expect(member).toBe(pascalCase(value));
      }
    }
  );

  it('give the list of the error codes that the package keeps', () => {
    expect(KEYCHAIN_ERROR_CODES).toEqual(Object.values(KeychainErrorCode));
    expect(KeychainErrorCode.UserCanceled).toBe('USER_CANCELED');
    expect(KeychainErrorCode.KeyInvalidated).toBe('KEY_INVALIDATED');
  });

  it('are the same objects in the package and in the mock', () => {
    jest.doMock('../native/NativeApexKeychain', () => ({ __esModule: true, default: null }));
    const pkg = require('../index') as typeof import('../index');
    const mock = require('../jest') as typeof import('../jest');
    for (const name of Object.keys(GROUPS) as Array<keyof typeof GROUPS>) {
      expect(pkg[name]).toBe(mock[name]);
      expect(Object.values(pkg[name]).length).toBeGreaterThan(0);
    }
  });
});

describe('a constant and its string', () => {
  beforeEach(() => keychainMock.reset());

  it('are taken alike by every option', async () => {
    const options = {
      accessible: Accessible.WhenUnlockedThisDeviceOnly,
      accessControl: AccessControl.BiometryAny,
      android: { keyStorage: KeyStorage.StrongboxRequired },
    } as const;
    const strings = {
      accessible: 'whenUnlockedThisDeviceOnly',
      accessControl: 'biometryAny',
      android: { keyStorage: 'strongboxRequired' },
    } as const;
    await keychain.setItem('constants', 'v', options);
    await keychain.setItem('strings', 'v', strings);
    // Both are protected alike: a synchronous read refuses without a prompt.
    for (const key of ['constants', 'strings']) {
      await expect(keychain.hasItem(key)).resolves.toBe(true);
      expect(() => keychain.getItemSync(key)).toThrow(
        expect.objectContaining({ code: KeychainErrorCode.AuthRequired })
      );
    }
    expect(() =>
      createKeychain({ accessControl: AccessControl.BiometryCurrentSet, authValidity: 5 })
    ).toThrow(KeychainError);
  });

  it('name the codes of errors, which are the strings', async () => {
    await keychain.setItem('locked', 'v', { accessControl: AccessControl.BiometryAny });
    expect(() => keychain.getItemSync('locked')).toThrow(
      expect.objectContaining({ code: KeychainErrorCode.AuthRequired })
    );
    keychainMock.failNextAuthentication(KeychainErrorCode.UserCanceled);
    const error = await keychain.getItem('locked').catch((reason: unknown) => reason);
    expect(isKeychainError(error, KeychainErrorCode.UserCanceled)).toBe(true);
    expect(isKeychainError(error, 'USER_CANCELED')).toBe(true);
    expect(isKeychainError(error, KeychainErrorCode.Lockout)).toBe(false);
    expect(new KeychainError(KeychainErrorCode.Unknown, 'x').code).toBe('UNKNOWN');
  });

  it('describe the device the mock simulates', async () => {
    keychainMock.setDevice({
      biometryTypes: [BiometryType.Fingerprint, BiometryType.Face],
      hardwareSecurityLevel: HardwareSecurityLevel.Strongbox,
    });
    await expect(getBiometryTypes()).resolves.toEqual(['fingerprint', 'face']);
    await expect(getHardwareSecurityLevel()).resolves.toBe('strongbox');
    await keychain.setItem('a', 'v', { android: { keyStorage: KeyStorage.Strongbox } });
    await expect(keychain.hasItem('a')).resolves.toBe(true);
  });
});
