// Moving what react-native-keychain and expo-secure-store stored into this package. The native side finds
// the old items, reads them (with a prompt when they are protected) and deletes them or marks them as moved; this side
// writes the new ones with the ordinary API, and only after a write resolved lets the native side finish the old item,
// so that no item is ever lost between the two. The report is made here.
//
// Where an item goes: a generic password of react-native-keychain becomes the credentials of the store
// whose service is the password's; internet credentials become the credentials with the server; an item of
// expo-secure-store becomes the item with the same key in the store `into`. A key that is taken is never overwritten.
import type { Api } from '../api';
import { credentialsKey } from '../credentials';
import { invalidArgument, toKeychainError, type KeychainError } from '../errors';
import type * as Native from '../native/NativeApexKeychain';
import { checkObject, parsePrompt, resolvePrompt } from '../options';
import { createServiceIndex } from '../serviceIndex';
import type { Keychain, SetOptions } from '../types';
import type {
  MigrateFromExpoSecureStoreOptions,
  MigrateFromReactNativeKeychainOptions,
  MigrateItemOptions,
  MigrationItem,
  MigrationKind,
  MigrationReport,
  SkipReason,
} from './types';

const COMMON = ['into', 'removeSource', 'accessGroup'] as const;
const RNK_OPTIONS = [...COMMON, 'services', 'servers'];
const EXPO_OPTIONS = [...COMMON, 'keychainService'];
const ITEM_OPTIONS = [...COMMON, 'prompt', 'setOptions'];

type WriteOptions = Omit<SetOptions, 'label'>;

/** One item's way through: moved, or skipped for a reason; and whether its old item could be finished. */
type Outcome =
  | { moved: true; warning?: KeychainError }
  | { moved: false; reason: SkipReason; error?: KeychainError };

const keyOf = (source: Native.MigrationSource): string =>
  source.kind === 'secureStore' ? source.account : source.service;

function checkNames(value: unknown, what: string): string[] {
  if (value === undefined) return [];
  const list = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(list) || list.some((name) => typeof name !== 'string' || name === '')) {
    throw invalidArgument(`Invalid ${what}: expected a non-empty string, or an array of them.`);
  }
  return [...list];
}

function checkInto(value: unknown, fallback: Keychain): Keychain {
  if (value === undefined) return fallback;
  const store = value as Partial<Keychain> | null;
  if (
    typeof store !== 'object' ||
    store === null ||
    typeof store.setItem !== 'function' ||
    typeof store.hasItem !== 'function' ||
    typeof store.setCredentials !== 'function'
  ) {
    throw invalidArgument('Invalid into: expected a store, such as keychain or createKeychain(…).');
  }
  return store as Keychain;
}

function checkOptional<T>(value: unknown, type: 'string' | 'boolean', what: string): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== type || value === '') {
    throw invalidArgument(
      `Invalid ${what}: expected ${type === 'string' ? 'a non-empty string' : 'a boolean'}.`
    );
  }
  return value as T;
}

/** The migration over the native module that `native` returns (or throws without) and the API `api`. */
export function createMigrate(
  native: () => Native.Spec,
  api: Pick<Api, 'keychain' | 'createKeychain'>
) {
  const index = createServiceIndex(api);

  /** The common options, checked and with their defaults. */
  function common(options: Record<string, unknown>) {
    return {
      into: checkInto(options.into, api.keychain),
      removeSource:
        checkOptional<boolean>(options.removeSource, 'boolean', 'removeSource') ?? false,
      accessGroup: checkOptional<string>(options.accessGroup, 'string', 'accessGroup'),
    };
  }

  /** Where the new item goes, and how to tell it is taken and to write it. */
  function targetOf(
    source: Native.MigrationSource,
    into: Keychain,
    accessGroup: string | undefined,
    setOptions: WriteOptions
  ) {
    if (source.kind === 'secureStore') {
      return {
        exists: () => into.hasItem(source.account),
        write: (value: string) => into.setItem(source.account, value, setOptions),
        register: async () => {},
      };
    }
    if (source.kind === 'internetPassword') {
      return {
        exists: () => into.hasItem(credentialsKey(source.service)),
        write: (value: string) =>
          into.setCredentials(
            { username: source.account, password: value },
            { ...setOptions, server: source.service }
          ),
        register: async () => {},
      };
    }
    const group = source.accessGroup ?? accessGroup;
    const store = api.createKeychain({
      service: source.service,
      ...(group === undefined ? {} : { accessGroup: group }),
    });
    return {
      exists: () => store.hasItem(credentialsKey(undefined)),
      write: (value: string) =>
        store.setCredentials({ username: source.account, password: value }, setOptions),
      // The list `getAllGenericPasswordServices` of the compatibility layer reads.
      register: () =>
        source.service === api.keychain.service ? Promise.resolve() : index.add(source.service),
    };
  }

  async function moveOne(
    source: Native.MigrationSource,
    config: {
      into: Keychain;
      accessGroup: string | undefined;
      removeSource: boolean;
      prompt: Native.Prompt;
      setOptions: WriteOptions;
      /** Whether a protected item may be read, with a prompt. */
      interactive: boolean;
    }
  ): Promise<Outcome> {
    try {
      const target = targetOf(source, config.into, config.accessGroup, config.setOptions);
      // An earlier run moved this item and kept it: it is not read again, nor written again. When this run is to remove
      // old items, this one goes now, if the new one is still there to show it was moved.
      if (source.migrated) {
        if (config.removeSource && (await target.exists())) {
          await native().finishMigrationSource(source, true);
        }
        return { moved: false, reason: 'exists' };
      }
      if (source.requiresAuth && !config.interactive) {
        return { moved: false, reason: 'requiresAuth' };
      }
      if (await target.exists()) return { moved: false, reason: 'exists' };
      const value = await native().readMigrationSource(source, config.prompt);
      if (value === null) return { moved: false, reason: 'notFound' };
      await target.write(value);
      // Written. From here the old item is the one that may stay, never the new one that may be missing.
      const warnings: KeychainError[] = [];
      try {
        await target.register();
      } catch (error) {
        warnings.push(toKeychainError(error));
      }
      try {
        await native().finishMigrationSource(source, config.removeSource);
      } catch (error) {
        warnings.push(toKeychainError(error));
      }
      return warnings.length > 0 ? { moved: true, warning: warnings[0] } : { moved: true };
    } catch (error) {
      return { moved: false, reason: 'error', error: toKeychainError(error) };
    }
  }

  function report(sources: Native.MigrationSource[], outcomes: Outcome[]): MigrationReport {
    const result: MigrationReport = { migrated: [], skipped: [], warnings: [] };
    sources.forEach((source, position) => {
      const outcome = outcomes[position]!;
      const key = keyOf(source);
      if (outcome.moved) {
        result.migrated.push(key);
        if (outcome.warning)
          result.warnings.push({ key, kind: source.kind, error: outcome.warning });
      } else {
        result.skipped.push({
          key,
          kind: source.kind,
          reason: outcome.reason,
          ...(outcome.error ? { error: outcome.error } : {}),
        });
      }
    });
    return result;
  }

  async function sourcesOf(query: Native.MigrationQuery): Promise<Native.MigrationSource[]> {
    try {
      return [...(await native().getMigrationSources(query))];
    } catch (error) {
      throw toKeychainError(error);
    }
  }

  async function migrateAll(query: Native.MigrationQuery, options: ReturnType<typeof common>) {
    const sources = await sourcesOf(query);
    const outcomes: Outcome[] = [];
    // One after another: the native side and the stores are not asked for many things at once.
    for (const source of sources) {
      outcomes.push(
        await moveOne(source, {
          ...options,
          prompt: resolvePrompt(undefined, undefined),
          setOptions: {},
          interactive: false,
        })
      );
    }
    return report(sources, outcomes);
  }

  const queryOf = (
    library: Native.MigrationLibrary,
    services: string[],
    servers: string[],
    accessGroup: string | undefined
  ): Native.MigrationQuery => ({
    library,
    services,
    servers,
    ...(accessGroup === undefined ? {} : { accessGroup }),
  });

  /** The old item `item` names, among what the native side finds for it. */
  async function find(item: MigrationItem, accessGroup: string | undefined) {
    const entry = item as Record<string, unknown>;
    if (item.library === 'reactNativeKeychain') {
      const service = checkOptional<string>(entry.service, 'string', 'service');
      const server = checkOptional<string>(entry.server, 'string', 'server');
      if (service !== undefined && server !== undefined) {
        throw invalidArgument('Invalid item: name a service or a server, not both.');
      }
      const sources = await sourcesOf(
        queryOf(
          'reactNativeKeychain',
          service === undefined ? [] : [service],
          server === undefined ? [] : [server],
          accessGroup
        )
      );
      return sources.find((source) =>
        server === undefined
          ? source.kind === 'genericPassword' &&
            (service === undefined || source.service === service)
          : source.kind === 'internetPassword' && source.service === server
      );
    }
    if (item.library !== 'expoSecureStore') {
      throw invalidArgument(
        "Invalid item: library must be 'reactNativeKeychain' or 'expoSecureStore'."
      );
    }
    const key = checkOptional<string>(entry.key, 'string', 'key');
    const service = checkOptional<string>(entry.keychainService, 'string', 'keychainService');
    if (key === undefined)
      throw invalidArgument('Invalid item: an item of expo-secure-store needs a key.');
    const sources = await sourcesOf(
      queryOf('expoSecureStore', service === undefined ? [] : [service], [], accessGroup)
    );
    return sources.find(
      (source) =>
        source.kind === 'secureStore' &&
        source.account === key &&
        (service === undefined || source.service === service)
    );
  }

  return {
    /**
     * Moves the items of react-native-keychain into this package: the generic passwords of `services` (default: the
     * default service of the library) and the internet credentials of `servers`. Never shows a prompt: a protected item
     * is skipped as `requiresAuth`, and `migrateItem` moves it.
     */
    async migrateFromReactNativeKeychain(
      options: MigrateFromReactNativeKeychainOptions = {}
    ): Promise<MigrationReport> {
      const checked = checkObject(options, 'options', RNK_OPTIONS) ?? {};
      const settings = common(checked);
      return migrateAll(
        queryOf(
          'reactNativeKeychain',
          checkNames(checked.services, 'services'),
          checkNames(checked.servers, 'servers'),
          settings.accessGroup
        ),
        settings
      );
    },

    /**
     * Moves the items of expo-secure-store into this package, with the keys they have: those of `keychainService`
     * (default `app`). Never shows a prompt: a protected item is skipped as `requiresAuth`, and `migrateItem` moves it.
     */
    async migrateFromExpoSecureStore(
      options: MigrateFromExpoSecureStoreOptions = {}
    ): Promise<MigrationReport> {
      const checked = checkObject(options, 'options', EXPO_OPTIONS) ?? {};
      const settings = common(checked);
      return migrateAll(
        queryOf(
          'expoSecureStore',
          checkNames(checked.keychainService, 'keychainService'),
          [],
          settings.accessGroup
        ),
        settings
      );
    },

    /**
     * Moves one old item, with a prompt when it is protected. The report is that of one item; a prompt that was
     * canceled is a skipped item whose `error` is `USER_CANCELED`.
     */
    async migrateItem(
      item: MigrationItem,
      options: MigrateItemOptions = {}
    ): Promise<MigrationReport> {
      const checked = checkObject(options, 'options', ITEM_OPTIONS) ?? {};
      const settings = common(checked);
      const prompt = resolvePrompt(undefined, parsePrompt(checked.prompt));
      const setOptions = (checkObject(checked.setOptions, 'setOptions', SET_OPTIONS) ??
        {}) as WriteOptions;
      const found = await find(item, settings.accessGroup);
      if (!found) return report([stub(item)], [{ moved: false, reason: 'notFound' }]);
      if (
        found.requiresAuth &&
        (setOptions.accessControl === undefined || setOptions.accessControl === 'none')
      ) {
        throw invalidArgument(
          `The old item '${keyOf(found)}' is protected, and the new one must be: give setOptions an accessControl.`
        );
      }
      const outcome = await moveOne(found, {
        ...settings,
        prompt,
        setOptions,
        interactive: true,
      });
      return report([found], [outcome]);
    },
  };
}

const SET_OPTIONS = ['accessible', 'accessControl', 'authValidity', 'synchronizable', 'android'];

/** A source for an item the native side did not find, so that the report can name it. */
function stub(item: MigrationItem): Native.MigrationSource {
  if (item.library === 'expoSecureStore') {
    return {
      kind: 'secureStore',
      service: item.keychainService ?? 'app',
      account: item.key,
      requiresAuth: false,
      migrated: false,
    };
  }
  return {
    kind: item.server === undefined ? 'genericPassword' : 'internetPassword',
    service: item.server ?? item.service ?? '',
    account: '',
    requiresAuth: false,
    migrated: false,
  };
}

export type Migrate = ReturnType<typeof createMigrate>;
export type { MigrationKind };
