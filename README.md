<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/apexnative/keychain/main/.github/assets/keychain-banner-dark.png">
  <img alt="@apexnative/keychain: secure storage for React Native, the iOS Keychain and the Android Keystore behind one API" src="https://raw.githubusercontent.com/apexnative/keychain/main/.github/assets/keychain-banner-light.png">
</picture>

<p align="center">
  <a href="https://www.npmjs.com/package/@apexnative/keychain"><img alt="npm version" src="https://img.shields.io/npm/v/@apexnative/keychain?label=npm&color=cb3837"></a>
  <a href="https://www.npmjs.com/package/@apexnative/keychain"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@apexnative/keychain"></a>
  <a href="https://github.com/apexnative/keychain/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/apexnative/keychain/ci.yml?branch=main&label=CI"></a>
  <img alt="Platforms: iOS, iPadOS, Android" src="https://img.shields.io/badge/platforms-iOS%20%7C%20iPadOS%20%7C%20Android-informational">
  <img alt="React Native 0.80 or newer, New Architecture" src="https://img.shields.io/badge/React%20Native-0.80%2B%20%C2%B7%20New%20Architecture-61dafb">
  <img alt="Expo SDK 54 or newer" src="https://img.shields.io/badge/Expo-SDK%2054%2B-000020">
  <img alt="TypeScript types included" src="https://img.shields.io/npm/types/@apexnative/keychain">
  <a href="https://github.com/apexnative/keychain/blob/main/LICENSE"><img alt="License: MIT" src="https://img.shields.io/npm/l/@apexnative/keychain"></a>
</p>

<p align="center">
  <a href="https://keychain.apexnative.dev/docs/start/introduction"><b>Documentation</b></a> ·
  <a href="https://keychain.apexnative.dev/docs/start/quick-start">Quick start</a> ·
  <a href="https://keychain.apexnative.dev/api/overview">API reference</a> ·
  <a href="https://github.com/apexnative/keychain/releases">Releases</a>
</p>

# @apexnative/keychain

**Biometrics is a lock on the value, not a yes from JavaScript.**

`@apexnative/keychain` keeps an app's secrets where the platform keeps its own: in the iOS Keychain and under keys
of the Android Keystore. Tokens, passwords and encryption keys go in by key and come out by key. A value can be locked
behind Face ID, a fingerprint or the device passcode, and then the operating system, not your code, decides when it
comes out. Every option means the same on iOS and Android; one the device can't give is an error, never a weaker item.

> **Status:** release candidate. `1.0.0-rc.0` is on npm under the `rc` tag, and under `latest` until 1.0.0. The API is
> final, except the migration from other libraries (`/migrate`); only fixes land until the release.

## Why

React Native has two common answers for secure storage, and both leave gaps. `react-native-keychain` is built around
one username and password per service, and on Android it stores a value without protection when biometrics is asked
for but not enrolled. `expo-secure-store` has the friendlier key/value model, but one switch for security, errors
without codes, and a changed fingerprint set that reads as `null`.

|                        | react-native-keychain 10                 | expo-secure-store | @apexnative/keychain                    |
| ---------------------- | ---------------------------------------- | ----------------- | --------------------------------------- |
| **Data**               | A username and a password per service    | A string per key  | A string or bytes per key, credentials  |
| **Protection**         | On Android `biometryAny` is `currentSet` | One boolean       | Six options, the same on both platforms |
| **No biometrics**      | Android stores it unprotected            | An error          | An error on both platforms              |
| **Changed biometrics** | An error                                 | `null`            | `KEY_INVALIDATED`; the item is removed  |
| **A prompt on write**  | Depends on the cipher                    | Android yes       | Never                                   |
| **Errors**             | `E_*` codes                              | Native messages   | `KeychainError` with a code             |

[Compared with others](https://keychain.apexnative.dev/docs/security/comparison) goes through every row.

## A quick look

```ts
import {
  AccessControl,
  Accessible,
  createKeychain,
  keychain,
  KeychainErrorCode,
  isKeychainError,
} from '@apexnative/keychain';

// The default storage: no prompt, readable in the background.
await keychain.setItem('accessToken', accessToken);

// A vault that opens only with the biometrics enrolled today.
const vault = createKeychain({
  service: 'vault',
  accessible: Accessible.WhenUnlockedThisDeviceOnly,
  accessControl: AccessControl.BiometryCurrentSet,
  prompt: { title: 'Unlock your account' },
});

await vault.setItem('refreshToken', refreshToken); // no prompt
try {
  const token = await vault.getItem('refreshToken'); // Face ID, then the value; null when nothing is stored
} catch (error) {
  if (isKeychainError(error, KeychainErrorCode.KeyInvalidated)) {
    // A new face or finger was enrolled: the item is gone, sign the user in again.
  }
}
```

## What's in it

- **Storage:** strings, bytes and credentials by key, in services of their own; `hasItem` without a prompt;
  `clear`; a synchronous API for startup that never shows a prompt.
- **Protection:** `accessible` and six values of `accessControl`, a reuse window (`authValidity`), StrongBox on Android,
  iCloud Keychain and shared access groups on iOS.
- **The device:** `canUseAccessControl` says whether a protection can be used now and why not, before you offer it;
  `getBiometryTypes`, `getBiometryState`, `isPasscodeSet`, `getHardwareSecurityLevel`.
- **Errors you can act on:** a missing item is `null`; everything else is a `KeychainError` with one of twenty codes,
  the same on both platforms.
- **Moving in:** `@apexnative/keychain/migrate` moves the items of react-native-keychain and expo-secure-store;
  `@apexnative/keychain/compat` keeps react-native-keychain's calls working on the new storage.
- **Tests:** `@apexnative/keychain/jest`, the package over memory with a simulated device you control.
- **Expo:** a config plugin for the Face ID text, `clearOnReinstall` and access groups.

## Requirements

|                |                                                        |
| -------------- | ------------------------------------------------------ |
| React Native   | 0.80 or newer, with the New Architecture               |
| iOS and iPadOS | 15.1 or newer; Mac Catalyst too                        |
| Android        | 7.0 or newer (minSdk 24); the passcode options need 11 |
| Expo           | SDK 54 or newer, with a development build; not Expo Go |
| Web            | every call throws `UNSUPPORTED`; Jest has a mock       |

## Installation

**A bare app:**

```sh
npm install @apexnative/keychain
cd ios && pod install
```

If an item uses biometrics, add `NSFaceIDUsageDescription` to `ios/<App>/Info.plist`. Android needs nothing.

**An Expo app:**

```sh
npx expo install @apexnative/keychain
```

```json
{
  "expo": {
    "plugins": [["@apexnative/keychain", { "faceIDPermission": "Face ID unlocks your account." }]]
  }
}
```

Then a development build: `npx expo prebuild` and `npx expo run:ios`, or `eas build`. The
[installation guide](https://keychain.apexnative.dev/docs/start/installation) has the details, and the
[quick start](https://keychain.apexnative.dev/docs/start/quick-start) builds a sign-in with Face ID.

Coming from another library:
[react-native-keychain](https://keychain.apexnative.dev/docs/migration/from-react-native-keychain),
[expo-secure-store](https://keychain.apexnative.dev/docs/migration/from-expo-secure-store).

## Testing

```ts
jest.mock('@apexnative/keychain', () => require('@apexnative/keychain/jest'));

import { keychainMock, KeychainErrorCode } from '@apexnative/keychain/jest';
beforeEach(() => keychainMock.reset());

test('a canceled Face ID shows the password form', async () => {
  keychainMock.failNextAuthentication(KeychainErrorCode.UserCanceled);
  // …
});
```

[Testing](https://keychain.apexnative.dev/docs/guides/testing) covers the simulated device, the prompts, migrations
and Detox.

## Contributing

The repository is a Yarn workspace: the library at the root, the example app in `example/`, an Expo app in
`example-expo/`, and the documentation site in `docs/`, a project of its own.

```sh
yarn                     # install
scripts/check.sh         # types, lint, Jest and the package build
scripts/test-ios.sh      # XCTest on an iOS simulator
scripts/test-android.sh  # the JVM tests; with an emulator's serial, the instrumented tests too
scripts/pods.sh          # pod install for the example app
scripts/build-ios.sh     # build the example app for the iOS simulator
scripts/build-android.sh # build the example app for Android
yarn --cwd docs start    # the documentation site, locally
```

## License

[MIT](https://github.com/apexnative/keychain/blob/main/LICENSE) © Artashes Bayazetyan
