// The option and result types of react-native-keychain 10, as far as this package takes them.
import type {
  ACCESS_CONTROL,
  ACCESSIBLE,
  AUTHENTICATION_TYPE,
  SECURITY_LEVEL,
  STORAGE_TYPE,
} from './enums';

/** The texts of the prompt a protected read shows. A plain string is the title. */
export type AuthenticationPrompt = {
  /** Defaults to `Authenticate to retrieve secret`, as in rnk. */
  title?: string;
  /** Android. */
  subtitle?: string;
  /** Android. */
  description?: string;
  /** Defaults to `Cancel`, as in rnk. */
  cancel?: string;
};

/** Which item: `service` for a generic password, `server` for internet credentials. */
export type BaseOptions = {
  /** The name of the password. Defaults to the default service of the app (the bundle id, the application id). */
  service?: string;
  /** The server of internet credentials. */
  server?: string;
  /** iOS: keep the item in iCloud Keychain (`synchronizable`). */
  cloudSync?: boolean;
  /** iOS: the keychain access group. */
  accessGroup?: string;
};

export type AccessControlOption = {
  accessControl?: ACCESS_CONTROL;
};

export type AuthenticationTypeOption = {
  authenticationType?: AUTHENTICATION_TYPE;
};

export type SetOptions = BaseOptions &
  AccessControlOption & {
    accessible?: ACCESSIBLE;
    /** Android. `SECURE_HARDWARE` fails with `HARDWARE_UNAVAILABLE` on a device that has none. */
    securityLevel?: SECURITY_LEVEL;
    /** Not supported: any value is `UNSUPPORTED`. */
    storage?: STORAGE_TYPE;
    /** Taken for the reads; a write never shows a prompt. */
    authenticationPrompt?: AuthenticationPrompt | string;
  };

export type GetOptions = BaseOptions &
  AccessControlOption &
  Partial<AuthenticationTypeOption> & {
    authenticationPrompt?: AuthenticationPrompt | string;
  };

export type GetAllOptions = {
  /** iOS: skip the items that need authentication. Nothing here shows a prompt, so it changes nothing. */
  skipUIAuth?: boolean;
};

/** What a write answers: the service and where the item is kept. */
export type Result = {
  service: string;
  storage: STORAGE_TYPE | 'keychain';
};

export type UserCredentials = Result & {
  username: string;
  password: string;
};

/** Internet credentials also name the server. */
export type InternetCredentials = UserCredentials & {
  server: string;
};
