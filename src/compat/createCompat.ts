// The functions of react-native-keychain 10 over this package's core, with its names and signatures. They work with this
// package's items, not with rnk's: moving what rnk stored is `migrate`'s job. Everything here is the core's own:
//
// - A generic password is the credentials of the core (`setCredentials`) in the store of its service, the user name their
//   label: the app's default service is the default store. Internet
//   credentials are the credentials of the default store under their server. The package can't list the stores there
//   are, so `getAllGenericPasswordServices` lists the services written through this layer and by `migrate`.
// - What rnk takes and the package doesn't, the compat layer refuses with `UNSUPPORTED` instead of ignoring it: shared web
//   credentials, `storage`, `ACCESSIBLE.ALWAYS`, `ACCESS_CONTROL.APPLICATION_PASSWORD`. An option rnk has dropped long
//   ago, or never had, is ignored, as rnk ignores it.
import { Platform } from 'react-native';
import type { Api } from '../api';
import { credentialsKey } from '../credentials';
import { invalidArgument, KeychainError, KeychainErrorCode } from '../errors';
import { createServiceIndex } from '../serviceIndex';
import { Accessible, AccessControl, BiometryType, HardwareSecurityLevel } from '../constants';
import type { Keychain, Prompt, SetOptions as CoreSetOptions } from '../types';
import {
  ACCESS_CONTROL,
  ACCESSIBLE,
  AUTHENTICATION_TYPE,
  BIOMETRY_TYPE,
  SECURITY_LEVEL,
  STORAGE_TYPE,
} from './enums';
import type {
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

const PREFIX = '@apexnative/keychain/compat:';

function unsupported(what: string, why: string): KeychainError {
  return new KeychainError(KeychainErrorCode.Unsupported, `${PREFIX} ${what} ${why}`);
}

const ACCESSIBLE_TO_CORE: Record<Exclude<ACCESSIBLE, typeof ACCESSIBLE.ALWAYS>, Accessible> = {
  [ACCESSIBLE.WHEN_UNLOCKED]: Accessible.WhenUnlocked,
  [ACCESSIBLE.AFTER_FIRST_UNLOCK]: Accessible.AfterFirstUnlock,
  [ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY]: Accessible.WhenPasscodeSetThisDeviceOnly,
  [ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY]: Accessible.WhenUnlockedThisDeviceOnly,
  [ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY]: Accessible.AfterFirstUnlockThisDeviceOnly,
};

const ACCESS_CONTROL_TO_CORE: Record<
  Exclude<ACCESS_CONTROL, typeof ACCESS_CONTROL.APPLICATION_PASSWORD>,
  AccessControl
> = {
  [ACCESS_CONTROL.USER_PRESENCE]: AccessControl.BiometryAnyOrPasscode,
  [ACCESS_CONTROL.BIOMETRY_ANY]: AccessControl.BiometryAny,
  [ACCESS_CONTROL.BIOMETRY_CURRENT_SET]: AccessControl.BiometryCurrentSet,
  [ACCESS_CONTROL.DEVICE_PASSCODE]: AccessControl.Passcode,
  [ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE]: AccessControl.BiometryAnyOrPasscode,
  [ACCESS_CONTROL.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE]:
    AccessControl.BiometryCurrentSetOrPasscode,
};

const BIOMETRY_TO_RNK: Record<BiometryType, BIOMETRY_TYPE> = {
  [BiometryType.FaceID]: BIOMETRY_TYPE.FACE_ID,
  [BiometryType.TouchID]: BIOMETRY_TYPE.TOUCH_ID,
  [BiometryType.OpticID]: BIOMETRY_TYPE.OPTIC_ID,
  [BiometryType.Fingerprint]: BIOMETRY_TYPE.FINGERPRINT,
  [BiometryType.Face]: BIOMETRY_TYPE.FACE,
  [BiometryType.Iris]: BIOMETRY_TYPE.IRIS,
};

function mapAccessible(value: unknown): Accessible | undefined {
  if (value === undefined) return undefined;
  if (value === ACCESSIBLE.ALWAYS) {
    throw unsupported(
      'ACCESSIBLE.ALWAYS',
      'is deprecated by iOS and not supported: use ACCESSIBLE.AFTER_FIRST_UNLOCK.'
    );
  }
  const mapped = ACCESSIBLE_TO_CORE[value as keyof typeof ACCESSIBLE_TO_CORE];
  if (!mapped) throw invalidArgument(`Invalid accessible: ${String(value)}.`);
  return mapped;
}

function mapAccessControl(value: unknown): AccessControl | undefined {
  if (value === undefined) return undefined;
  if (value === ACCESS_CONTROL.APPLICATION_PASSWORD) {
    throw unsupported(
      'ACCESS_CONTROL.APPLICATION_PASSWORD',
      'is not supported: use a biometry, the device passcode, or both.'
    );
  }
  const mapped = ACCESS_CONTROL_TO_CORE[value as keyof typeof ACCESS_CONTROL_TO_CORE];
  if (!mapped) throw invalidArgument(`Invalid accessControl: ${String(value)}.`);
  return mapped;
}

/** The prompt of a read: the texts rnk would show, its defaults included. */
function toPrompt(value: AuthenticationPrompt | string | undefined): Prompt {
  const prompt: Prompt = { title: 'Authenticate to retrieve secret', cancel: 'Cancel' };
  if (typeof value === 'string') return { ...prompt, title: value };
  for (const field of ['title', 'subtitle', 'description', 'cancel'] as const) {
    const text = value?.[field];
    if (typeof text === 'string') prompt[field] = text;
  }
  return prompt;
}

function check(options: unknown): Record<string, unknown> {
  if (options === undefined || options === null) return {};
  if (typeof options !== 'object') {
    throw invalidArgument(`Invalid options: expected an object, got ${String(options)}.`);
  }
  return options as Record<string, unknown>;
}

/** The functions of react-native-keychain 10, over the API that `api` is. */
export function createCompat(api: Api) {
  const storageName = (): Result['storage'] =>
    Platform.OS === 'ios' ? 'keychain' : STORAGE_TYPE.AES_GCM;

  /** The store of an access group, or the default store. */
  const storeOf = (options: BaseOptions): Keychain =>
    options.accessGroup === undefined
      ? api.keychain
      : api.createKeychain({ accessGroup: options.accessGroup });

  const index = createServiceIndex(api);

  /** The store of a generic password: that of its service, which for the app's default service is the default store. */
  const genericOf = (options: BaseOptions) => {
    const name = options.service ?? api.keychain.service;
    const isDefault = name === api.keychain.service;
    const store =
      isDefault && options.accessGroup === undefined
        ? api.keychain
        : api.createKeychain({
            service: name,
            ...(options.accessGroup === undefined ? {} : { accessGroup: options.accessGroup }),
          });
    return { name, isDefault, store };
  };

  const writeOptions = async (
    options: SetOptions,
    server: string | undefined
  ): Promise<Omit<CoreSetOptions, 'label'> & { server?: string }> => {
    if (options.storage !== undefined) {
      throw unsupported(
        'the storage option',
        'is not supported: the package chooses its cipher (AES-GCM in the Android Keystore, the iOS Keychain).'
      );
    }
    if (options.securityLevel === SECURITY_LEVEL.SECURE_HARDWARE && Platform.OS === 'android') {
      if ((await api.getHardwareSecurityLevel()) === HardwareSecurityLevel.Software) {
        throw new KeychainError(
          KeychainErrorCode.HardwareUnavailable,
          `${PREFIX} SECURITY_LEVEL.SECURE_HARDWARE needs a device with secure hardware, and this one keeps keys in software.`
        );
      }
    }
    const result: Omit<CoreSetOptions, 'label'> & { server?: string } = {};
    const accessible = mapAccessible(options.accessible);
    const accessControl = mapAccessControl(options.accessControl);
    if (accessible !== undefined) result.accessible = accessible;
    if (accessControl !== undefined) result.accessControl = accessControl;
    if (options.cloudSync !== undefined) result.synchronizable = options.cloudSync;
    if (server !== undefined) result.server = server;
    return result;
  };

  async function set(
    name: string,
    store: Keychain,
    server: string | undefined,
    username: string,
    password: string,
    options: SetOptions
  ): Promise<Result> {
    await store.setCredentials({ username, password }, await writeOptions(options, server));
    return { service: name, storage: storageName() };
  }

  async function get(
    name: string,
    store: Keychain,
    server: string | undefined,
    options: GetOptions
  ): Promise<UserCredentials | false> {
    mapAccessControl(options.accessControl);
    const credentials = await store.getCredentials({
      ...(server === undefined ? {} : { server }),
      prompt: toPrompt(options.authenticationPrompt),
    });
    if (!credentials) return false;
    return { service: name, ...credentials, storage: storageName() };
  }

  const has = (store: Keychain, server: string | undefined): Promise<boolean> =>
    store.hasItem(credentialsKey(server));

  const serverOfInternet = (value: string | BaseOptions | undefined, what: string): string => {
    const server = typeof value === 'string' ? value : value?.server;
    if (typeof server !== 'string' || server === '') {
      throw invalidArgument(`${what} needs a server: a non-empty string.`);
    }
    return server;
  };

  const sharedWebCredentials = (what: string): never => {
    throw unsupported(
      what,
      'is not supported: shared web credentials are an iOS-only service of rnk with no equivalent here. Use the Passwords of the system, or a password manager.'
    );
  };

  return {
    // Generic passwords.

    async setGenericPassword(
      username: string,
      password: string,
      options: SetOptions = {}
    ): Promise<Result> {
      const { name, isDefault, store } = genericOf(check(options));
      const result = await set(name, store, undefined, username, password, options);
      if (!isDefault) await index.add(name);
      return result;
    },

    async getGenericPassword(options: GetOptions = {}): Promise<UserCredentials | false> {
      const { name, store } = genericOf(check(options));
      return get(name, store, undefined, options);
    },

    async hasGenericPassword(options: BaseOptions = {}): Promise<boolean> {
      return has(genericOf(check(options)).store, undefined);
    },

    async resetGenericPassword(options: BaseOptions = {}): Promise<boolean> {
      const { name, isDefault, store } = genericOf(check(options));
      await store.removeCredentials();
      if (!isDefault) await index.remove(name);
      return true;
    },

    /**
     * The services that have a generic password: the app's default service, and the others written through this
     * layer (or by `migrate`) whose password is still there.
     */
    async getAllGenericPasswordServices(options: GetAllOptions = {}): Promise<string[]> {
      check(options);
      const services: string[] = [];
      if (await api.keychain.hasItem(credentialsKey(undefined)))
        services.push(api.keychain.service);
      for (const name of await index.list()) {
        if (
          name !== api.keychain.service &&
          (await api.createKeychain({ service: name }).hasItem(credentialsKey(undefined)))
        ) {
          services.push(name);
        }
      }
      return services;
    },

    // Internet credentials.

    async setInternetCredentials(
      server: string,
      username: string,
      password: string,
      options: SetOptions = {}
    ): Promise<Result> {
      const name = serverOfInternet(server, 'setInternetCredentials');
      return set(name, storeOf(check(options)), name, username, password, options);
    },

    async getInternetCredentials(
      server: string,
      options: GetOptions = {}
    ): Promise<InternetCredentials | false> {
      const name = serverOfInternet(server, 'getInternetCredentials');
      const credentials = await get(name, storeOf(check(options)), name, options);
      return credentials && { ...credentials, server: name };
    },

    async hasInternetCredentials(options: string | BaseOptions): Promise<boolean> {
      const server = serverOfInternet(options, 'hasInternetCredentials');
      return has(storeOf(typeof options === 'string' ? {} : options), server);
    },

    async resetInternetCredentials(options: string | BaseOptions): Promise<void> {
      const server = serverOfInternet(options, 'resetInternetCredentials');
      await storeOf(typeof options === 'string' ? {} : options).removeCredentials({ server });
    },

    // Shared web credentials: not here.

    async requestSharedWebCredentials(): Promise<never> {
      return sharedWebCredentials('requestSharedWebCredentials');
    },

    async setSharedWebCredentials(
      _server: string,
      _username: string,
      _password?: string
    ): Promise<never> {
      return sharedWebCredentials('setSharedWebCredentials');
    },

    // The device.

    /**
     * The biometry the device can use now, or `null` without one enrolled, as rnk does. A device with several (Android)
     * answers the first of them.
     */
    async getSupportedBiometryType(): Promise<BIOMETRY_TYPE | null> {
      const [types, state] = await Promise.all([api.getBiometryTypes(), api.getBiometryState()]);
      const first = types[0];
      return state !== null && first !== undefined ? BIOMETRY_TO_RNK[first] : null;
    },

    /**
     * Whether the device can authenticate: with a biometry or the passcode (`DEVICE_PASSCODE_OR_BIOMETRICS`, the
     * default), or with a biometry only (`BIOMETRICS`). rnk answers on iOS only; here Android answers too.
     */
    async canImplyAuthentication(options: AuthenticationTypeOption = {}): Promise<boolean> {
      const type =
        check(options).authenticationType ?? AUTHENTICATION_TYPE.DEVICE_PASSCODE_OR_BIOMETRICS;
      const enrolled = (await api.getBiometryState()) !== null;
      if (type === AUTHENTICATION_TYPE.BIOMETRICS) return enrolled;
      return enrolled || (await api.isPasscodeSet());
    },

    /** (Android) Where a new key lives, as rnk names it; `null` on iOS. The `accessControl` of the options changes nothing. */
    async getSecurityLevel(options: AccessControlOption = {}): Promise<SECURITY_LEVEL | null> {
      mapAccessControl(check(options).accessControl);
      const level = await api.getHardwareSecurityLevel();
      if (level === null) return null;
      return level === HardwareSecurityLevel.Software
        ? SECURITY_LEVEL.SECURE_SOFTWARE
        : SECURITY_LEVEL.SECURE_HARDWARE;
    },

    /** Whether the device has a passcode, PIN or pattern. */
    isPasscodeAuthAvailable(): Promise<boolean> {
      return api.isPasscodeSet();
    },
  };
}

export type Compat = ReturnType<typeof createCompat>;
