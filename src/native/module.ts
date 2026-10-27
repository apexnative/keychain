import { KeychainError } from '../errors';
import NativeApexKeychain, { type Spec } from './NativeApexKeychain';

/**
 * The TurboModule, or a KeychainError UNSUPPORTED that says why it isn't in the app. Called on every native call, not
 * at import: importing the package never fails.
 */
export function nativeModule(): Spec {
  if (NativeApexKeychain) return NativeApexKeychain;
  throw new KeychainError(
    'UNSUPPORTED',
    "@apexnative/keychain: the native module 'ApexKeychain' isn't in this app. In Expo Go it can't be: use a " +
      'development build (npx expo run:ios, npx expo run:android, or EAS Build). In a React Native app, rebuild ' +
      'it after installing the package (cd ios && pod install for iOS). The package needs the New Architecture.'
  );
}
