// `@apexnative/keychain/migrate`: moves what react-native-keychain and expo-secure-store stored into this package.
// A separate entry point: an app that doesn't migrate doesn't load it.
//
//   const report = await migrateFromReactNativeKeychain({ services: ['auth'], removeSource: true });
//   // { migrated: ['auth'], skipped: [{ key: 'api.example.com', kind: 'internetPassword', reason: 'requiresAuth' }], warnings: [] }
import { createKeychain, keychain } from '../index';
import { nativeModule } from '../native/module';
import { createMigrate } from './createMigrate';

const migrate = createMigrate(nativeModule, { keychain, createKeychain });

export const { migrateFromReactNativeKeychain, migrateFromExpoSecureStore, migrateItem } = migrate;

export type {
  MigrateFromExpoSecureStoreOptions,
  MigrateFromReactNativeKeychainOptions,
  MigrateItemOptions,
  MigrationItem,
  MigrationKind,
  MigrationReport,
  SkippedItem,
  SkipReason,
} from './types';
export { KeychainError, KeychainErrorCode, isKeychainError } from '../errors';
