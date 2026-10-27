import { KeychainError } from '../errors';
import type { Spec } from './NativeApexKeychain';

/** The web has no keychain: every call throws UNSUPPORTED. Tests use `@apexnative/keychain/jest`. */
export function nativeModule(): Spec {
  throw new KeychainError(
    'UNSUPPORTED',
    '@apexnative/keychain is not available on the web. In tests, use the mock: @apexnative/keychain/jest.'
  );
}
