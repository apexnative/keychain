// `@apexnative/keychain/jest`: the package's API over a native module in memory, for Jest. It checks keys and options
// and merges them exactly as the package does; the device is simulated and controlled through `keychainMock`.
//
//   jest.mock('@apexnative/keychain', () => require('@apexnative/keychain/jest'));
//
//   import { keychainMock } from '@apexnative/keychain/jest';
//   beforeEach(() => keychainMock.reset());
//
// The entry points `@apexnative/keychain/migrate` and `@apexnative/keychain/compat` are here too, over the same memory, as
// `migrate` and `compat`:
//
//   jest.mock('@apexnative/keychain/migrate', () => require('@apexnative/keychain/jest').migrate);
//   jest.mock('@apexnative/keychain/compat', () => require('@apexnative/keychain/jest').compat);
//
// `keychainMock.addMigrationSource` plants the items of react-native-keychain and expo-secure-store for `migrate`.
import { createApi } from '../api';
import { createCompat } from '../compat/createCompat';
import * as compatEnums from '../compat/enums';
import { KeychainError, KeychainErrorCode, isKeychainError } from '../errors';
import { createMigrate } from '../migrate/createMigrate';
import type {
  AccessControl,
  AccessControlAvailability,
  BiometryType,
  HardwareSecurityLevel,
  Keychain,
  KeychainOptions,
} from '../types';
import { MemoryKeychain, type KeychainMock } from './MemoryKeychain';

const memory = new MemoryKeychain();
const api = createApi(() => memory);

/** Controls of the simulated device and of the prompts' outcome. */
export const keychainMock: KeychainMock = memory.controls;

export const keychain: Keychain = api.keychain;

// The entry points export the errors too: a test that mocks one imports them from it.
const errors = { KeychainError, KeychainErrorCode, isKeychainError };

/** `@apexnative/keychain/migrate` over the memory: `migrateFromReactNativeKeychain` and the rest. */
export const migrate = { ...createMigrate(() => memory, api), ...errors };

const compatFunctions = { ...createCompat(api), ...compatEnums, ...errors };

/** `@apexnative/keychain/compat` over the memory: the functions and the constants of react-native-keychain. */
export const compat = { ...compatFunctions, default: compatFunctions };

export function createKeychain(options?: KeychainOptions): Keychain {
  return api.createKeychain(options);
}

export function getBiometryTypes(): Promise<BiometryType[]> {
  return api.getBiometryTypes();
}

export function canUseAccessControl(
  accessControl: AccessControl
): Promise<AccessControlAvailability> {
  return api.canUseAccessControl(accessControl);
}

export function isPasscodeSet(): Promise<boolean> {
  return api.isPasscodeSet();
}

export function getBiometryState(): Promise<string | null> {
  return api.getBiometryState();
}

export function getHardwareSecurityLevel(): Promise<HardwareSecurityLevel | null> {
  return api.getHardwareSecurityLevel();
}

export {
  Accessible,
  AccessControl,
  BiometryType,
  HardwareSecurityLevel,
  KeyStorage,
} from '../constants';
export { KeychainError, KeychainErrorCode, isKeychainError } from '../errors';
export type { KeychainErrorDetails } from '../errors';
export type * from '../types';
export type {
  KeychainMock,
  MockDevice,
  MockMigrationItem,
  MockMigrationSource,
  MockPrompt,
} from './MemoryKeychain';
