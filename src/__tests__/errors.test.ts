import { KEYCHAIN_ERROR_CODES, KeychainError, isKeychainError, toKeychainError } from '../errors';
import type { KeychainErrorCode } from '../errors';
import type * as Native from '../native/NativeApexKeychain';
import type * as Public from '../types';

// The native contract and the public types name the same values. A difference fails `tsc` (yarn typecheck).
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const contract: [
  Equal<Native.ErrorCode, KeychainErrorCode>,
  Equal<Native.Accessible, Public.Accessible>,
  Equal<Native.AccessControl, Public.AccessControl>,
  Equal<Native.BiometryType, Public.BiometryType>,
  Equal<Native.SecurityLevel, Public.HardwareSecurityLevel>,
  Equal<Native.KeyStorage, NonNullable<Public.AndroidOptions['keyStorage']>>,
  Equal<
    Native.UnavailableReason,
    Extract<Public.AccessControlAvailability, { available: false }>['reason']
  >,
] = [true, true, true, true, true, true, true];

describe('KeychainError', () => {
  it('names the same types as the native contract', () => {
    expect(contract.every(Boolean)).toBe(true);
  });

  it('has every error code', () => {
    expect(KEYCHAIN_ERROR_CODES).toHaveLength(20);
    expect(new Set(KEYCHAIN_ERROR_CODES).size).toBe(20);
  });

  it('is an Error with a code', () => {
    const error = new KeychainError('USER_CANCELED', 'Canceled.', { nativeCode: -2 });
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(KeychainError);
    expect(error.name).toBe('KeychainError');
    expect(error.code).toBe('USER_CANCELED');
    expect(error.nativeCode).toBe(-2);
    expect(error.nativeDomain).toBeUndefined();
    expect(isKeychainError(error)).toBe(true);
    expect(isKeychainError(error, 'USER_CANCELED')).toBe(true);
    expect(isKeychainError(error, 'LOCKOUT')).toBe(false);
    expect(isKeychainError(new Error('x'))).toBe(false);
  });
});

describe('toKeychainError', () => {
  it('reads a rejection of iOS or Android', () => {
    const rejection = Object.assign(new Error('The item is locked.'), {
      code: 'INTERACTION_NOT_ALLOWED',
      userInfo: { nativeCode: -25308, nativeDomain: 'NSOSStatusErrorDomain', other: 1 },
    });
    const error = toKeychainError(rejection);
    expect(error).toBeInstanceOf(KeychainError);
    expect(error.code).toBe('INTERACTION_NOT_ALLOWED');
    expect(error.message).toBe('The item is locked.');
    expect(error.nativeCode).toBe(-25308);
    expect(error.nativeDomain).toBe('NSOSStatusErrorDomain');
    expect((error as { cause?: unknown }).cause).toBe(rejection);
  });

  it('reads the Failure of a synchronous method', () => {
    const failure: Native.Failure = {
      code: 'AUTH_REQUIRED',
      message: 'Needs a prompt.',
      nativeCode: 7,
      nativeDomain: 'D',
    };
    const error = toKeychainError(failure);
    expect([error.code, error.message, error.nativeCode, error.nativeDomain]).toEqual([
      'AUTH_REQUIRED',
      'Needs a prompt.',
      7,
      'D',
    ]);
  });

  it('makes an unknown code UNKNOWN and keeps the message', () => {
    const error = toKeychainError(
      Object.assign(new Error('Odd.'), { code: 'E_ODD', userInfo: null })
    );
    expect(error.code).toBe('UNKNOWN');
    expect(error.message).toBe('Odd.');
    expect(toKeychainError('text').code).toBe('UNKNOWN');
    expect(toKeychainError(null).message).toBe('null');
  });

  it('passes a KeychainError through', () => {
    const error = new KeychainError('LOCKOUT', 'Locked.');
    expect(toKeychainError(error)).toBe(error);
  });
});
