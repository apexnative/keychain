// `@apexnative/keychain/compat`: the API of react-native-keychain 10 over this package, to move an app without rewriting its
// calls. `import * as Keychain from '@apexnative/keychain/compat'` and `import Keychain from '@apexnative/keychain/compat'`
// both work. It reads and writes this package's items (see createCompat.ts); what rnk stored is moved by `migrate`.
import {
  createKeychain,
  getBiometryState,
  getBiometryTypes,
  getHardwareSecurityLevel,
  isPasscodeSet,
  keychain,
  canUseAccessControl,
} from '../index';
import { createCompat } from './createCompat';
import {
  ACCESS_CONTROL,
  ACCESSIBLE,
  AUTHENTICATION_TYPE,
  BIOMETRY_TYPE,
  SECURITY_LEVEL,
  STORAGE_TYPE,
} from './enums';

const compat = createCompat({
  keychain,
  createKeychain,
  getBiometryTypes,
  canUseAccessControl,
  isPasscodeSet,
  getBiometryState,
  getHardwareSecurityLevel,
});

export const {
  setGenericPassword,
  getGenericPassword,
  hasGenericPassword,
  resetGenericPassword,
  getAllGenericPasswordServices,
  setInternetCredentials,
  getInternetCredentials,
  hasInternetCredentials,
  resetInternetCredentials,
  requestSharedWebCredentials,
  setSharedWebCredentials,
  getSupportedBiometryType,
  canImplyAuthentication,
  getSecurityLevel,
  isPasscodeAuthAvailable,
} = compat;

export {
  ACCESS_CONTROL,
  ACCESSIBLE,
  AUTHENTICATION_TYPE,
  BIOMETRY_TYPE,
  SECURITY_LEVEL,
  STORAGE_TYPE,
} from './enums';
export type {
  AccessControlOption,
  AuthenticationPrompt,
  AuthenticationTypeOption,
  BaseOptions,
  GetAllOptions,
  GetOptions,
  InternetCredentials,
  Result,
  SetOptions,
  UserCredentials,
} from './types';
export { KeychainError, KeychainErrorCode, isKeychainError } from '../errors';

export default {
  ...compat,
  SECURITY_LEVEL,
  ACCESSIBLE,
  ACCESS_CONTROL,
  AUTHENTICATION_TYPE,
  BIOMETRY_TYPE,
  STORAGE_TYPE,
};
