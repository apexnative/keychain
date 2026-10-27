// Old items, written by the libraries `migrate` moves from: how the scenarios of milestone M4 plant them on a device.
// react-native-keychain and expo-secure-store are optional here: an app that has them (the example does not yet, and
// adding them is the example's native projects' business) gets the full scenarios, one that does not gets the scenarios
// that need no old items, and the others end as skipped, saying what is missing. The Jest suite plants the items in the
// in-memory module instead (src/__tests__/scenarios.test.ts).

/** Plants and checks the items of react-native-keychain. */
export type LegacyReactNativeKeychain = {
  /** A generic password of `service`. `protectedItem`: behind the biometry, as `ACCESS_CONTROL.BIOMETRY_ANY` does. */
  plantGeneric(
    service: string,
    username: string,
    password: string,
    protectedItem?: boolean
  ): Promise<void>;
  plantInternet(server: string, username: string, password: string): Promise<void>;
  hasGeneric(service: string): Promise<boolean>;
  hasInternet(server: string): Promise<boolean>;
  /** Removes whatever it planted. */
  clean(): Promise<void>;
};

/** Plants and checks the items of expo-secure-store. */
export type LegacyExpoSecureStore = {
  /** An item of `keychainService`. `protectedItem`: `requireAuthentication`. */
  plant(
    key: string,
    value: string,
    keychainService: string,
    protectedItem?: boolean
  ): Promise<void>;
  /** Whether the item is there, which reading it can't tell for a protected one: it shows a prompt. */
  has(key: string, keychainService: string): Promise<boolean>;
  clean(): Promise<void>;
};

export type Legacy = {
  reactNativeKeychain?: LegacyReactNativeKeychain;
  expoSecureStore?: LegacyExpoSecureStore;
};

declare const require: (name: string) => unknown;

// `require` in a `try`: Metro takes the module as optional, and bundles the app without it.
let rnk: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let expo: any; // eslint-disable-line @typescript-eslint/no-explicit-any
try {
  rnk = require('react-native-keychain');
} catch {
  rnk = undefined;
}
try {
  expo = require('expo-secure-store');
} catch {
  expo = undefined;
}

function reactNativeKeychain(): LegacyReactNativeKeychain {
  const generic: string[] = [];
  const internet: string[] = [];
  return {
    async plantGeneric(service, username, password, protectedItem = false) {
      generic.push(service);
      await rnk.setGenericPassword(username, password, {
        service,
        ...(protectedItem ? { accessControl: rnk.ACCESS_CONTROL.BIOMETRY_ANY } : {}),
      });
    },
    async plantInternet(server, username, password) {
      internet.push(server);
      await rnk.setInternetCredentials(server, username, password);
    },
    hasGeneric: (service) => rnk.hasGenericPassword({ service }),
    hasInternet: (server) => rnk.hasInternetCredentials({ server }),
    async clean() {
      for (const service of generic.splice(0)) await rnk.resetGenericPassword({ service });
      for (const server of internet.splice(0)) await rnk.resetInternetCredentials({ server });
    },
  };
}

function expoSecureStore(): LegacyExpoSecureStore {
  const planted: Array<[string, string]> = [];
  return {
    async plant(key, value, keychainService, protectedItem = false) {
      planted.push([key, keychainService]);
      await expo.setItemAsync(key, value, {
        keychainService,
        ...(protectedItem ? { requireAuthentication: true } : {}),
      });
    },
    async has(key, keychainService) {
      return (await expo.getItemAsync(key, { keychainService })) !== null;
    },
    async clean() {
      for (const [key, keychainService] of planted.splice(0)) {
        await expo.deleteItemAsync(key, { keychainService });
      }
    },
  };
}

/** What can plant old items here: each library that is installed. */
export const legacy: Legacy = {
  ...(rnk ? { reactNativeKeychain: reactNativeKeychain() } : {}),
  ...(expo ? { expoSecureStore: expoSecureStore() } : {}),
};

export const MISSING =
  'react-native-keychain / expo-secure-store are not installed in the example: add them to write old items on a device.';
