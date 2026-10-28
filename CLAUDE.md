# @apexnative/keychain

Secure storage for React Native: the iOS Keychain and the Android Keystore behind one API, with biometric and passcode
protection that means the same on both platforms. A TurboModule; React Native 0.80+ with the New Architecture only,
developed on 0.88; iOS 15.1+, Android minSdk 24.

More rules are in `.claude/rules/`: `general.md` always applies, the others load with the files they cover.

## How it works

```
app code      keychain, createKeychain(…), getBiometryTypes(), …                     src/index.ts (public)
   │ keys, values, options
   ▼
src/api.ts    checks keys, values and options, merges the store's with the call's (src/options.ts)
   │ TurboModule ApexKeychain (src/native/NativeApexKeychain.ts)
   ▼
native        iOS: ANKKeychainModule → ANKKeychainStore (Keychain), ANKAuthenticator (LocalAuthentication)
              Android: KeychainModule → Keychain (a file per service, Keystore keys), PromptQueue (BiometricPrompt)
   │ the value, or a rejection with a code
   ▼
src/errors.ts → KeychainError with its code; a missing item is null
```

- An item is bytes with its metadata (the encoding it was written with, a label, `accessible`, `accessControl`) on
  both platforms. iOS keeps it as a Keychain item of the store's service, marked with the package's creator code, so
  other libraries' items are invisible. Android keeps a file per service in `noBackupFilesDir`, each value encrypted
  with AES-GCM under a key in AndroidKeyStore; an item with access control has a key of its own that a Keystore key
  needing authentication wraps.
- JavaScript checks every argument first (`src/options.ts`); native checks again rather than guess. An option a device
  can't do throws: security is never downgraded silently.
- A read of an item with `accessControl` shows a prompt: one at a time, in the order asked (`ANKAuthenticator`,
  `PromptQueue`), off the queue that does the storage. `authValidity` lets one prompt open the reads of a service and
  access control for some seconds, until the app goes to the background. A write never prompts.
- Every call runs on one serial queue per platform, in the order JavaScript made them. The synchronous methods
  (`*Sync`) wait their turn, never prompt (`AUTH_REQUIRED`), and answer `{ error }` instead of throwing across JSI.
- The entry points: `/compat` (`src/compat/`) is react-native-keychain 10's API over this package; `/migrate`
  (`src/migrate/`, `ios/ANKMigration.mm`, `android/src/main/java/dev/apexnative/keychain/migration/`) moves what
  react-native-keychain and expo-secure-store stored; `/jest` (`src/jest/`) is the whole API over a module in memory.
  The Expo config plugin (`plugin/`, `app.plugin.js`) writes the Face ID usage text, `clearOnReinstall` and the access
  groups into the iOS project.
- Errors: the codes are `KeychainErrorCode` in `src/errors.ts`; what each means for an app and what to do about it is
  `docs/content/help/error-codes.mdx`.

## Map

- `src/index.ts` — the public exports. `src/api.ts` — the whole API over a native module; `src/options.ts` — checks and
  merges; `src/errors.ts`, `src/constants.ts`, `src/types.ts`. `src/native/NativeApexKeychain.ts` — the codegen spec,
  the only way to the native side; its header is the native contract.
- `ios/` — pod `ApexKeychain`, Objective-C++: `ANKKeychainModule` (the TurboModule), `ANKKeychainStore` (the
  Keychain), `ANKAuthenticator` and `ANKDevice` (LocalAuthentication), `ANKOptions`, `ANKError`, `ANKInstallation`
  (`clearOnReinstall`), `ANKMigration`. `ios/Tests/` — XCTest, run in the app `ios/TestHost/` (the podspec's test and
  app specs).
- `android/` — package `dev.apexnative.keychain`, Kotlin: `KeychainModule`, `Keychain` (the storage), `ServiceStore`
  and `StoreFormat` (the file), `Keys` (the Keystore), `Prompts`, `Capabilities` and `Device`, `KeychainError`,
  `migration/`. `android/src/test/` — JVM tests; `android/src/androidTest/` — tests on the emulator.
- `plugin/` — the Expo config plugin. `example/` — `KeychainExample`: every feature as a scenario
  (`example/src/scenarios.ts`). `example-expo/` — an Expo app with the packed library.
- `docs/` — the Docusaurus site keychain.apexnative.dev, its own package and lockfile; the API reference is written by
  hand in `docs/reference/`. `scripts/` — builds, tests and checks. `.github/assets/` — the icon and the README banners.

## Working on a task

- Commands: `/feature`, `/api`, `/fix` (`.claude/skills/task-flow/SKILL.md`), `/docs`, `/release`.
- Skills: `native-facts`, `native-dev`, `review-change`, `docs`, `git`. Agents (`.claude/agents/`): `researcher`,
  `ios-dev`, `android-dev`, `reviewer`, `docs-writer`, `qa` (a scenario of the example on the simulator or the
  emulator), `ci-doctor` (a failed GitHub Actions run).

## Rules

- **Third-party copyright headers.** Never remove or change an existing copyright line or license text. When you
  modify a file that carries someone else's header, keep the header and add a `Modified by <name>, <year>` line below
  it. `yarn check:headers` and a Claude Code hook enforce this.
- The other rules: `.claude/rules/general.md`.

## Commands

Yarn 4 workspace: the library at the root, the example app in `example/`. Builds, tests and checks run through
`scripts/`. Each prints one line, `✓ name: OK`, or the errors and the path of the full log in `.logs/`. A hook blocks
the raw commands (`xcodebuild`, `gradlew`, `pod install`, `jest`, `tsc`, `eslint`); a command no script covers runs
with `APEX_RAW=1` in front.

```sh
yarn                                  # install (the docs site installs on its own: yarn --cwd docs install)
scripts/check.sh                      # the quick checks: types, lint, Jest, headers, the Claude hooks, the package build
scripts/typecheck.sh                  # TypeScript: the library, the plugin and the example
scripts/lint.sh [files...]            # ESLint + Prettier
scripts/test-js.sh [jest args...]     # Jest: the API, the mock, /compat, /migrate, the plugin, the scenarios
scripts/test-ios.sh [UDID | --ios V]  # the pod's XCTest on a simulator made for the run, Face ID prompts included
scripts/test-android.sh [--emulator [API] | SERIAL]  # the JVM tests; with --emulator or a serial, the device tests too
scripts/build-ios.sh [UDID]           # the example for the simulator; with a UDID: install and start it there
scripts/build-android.sh [--lib | SERIAL]  # the example (arm64); --lib: the library only; SERIAL: install, start
scripts/pods.sh                       # pod install, after a change of ios/ or of the codegen spec
scripts/docs.sh [typecheck | build]   # the docs site; the build fails on a broken link or anchor
yarn example start                    # Metro for the example
```

- Compiler warnings fail the native builds. The `headers` step of `scripts/check.sh` (`yarn check:headers`) checks
  the files listed in `scripts/license-headers.json`.
- `scripts/test-ios.sh` makes a simulator for the run — a Face ID iPhone on the newest iOS, or on `--ios 18.5` — and
  deletes it after, so none is left behind; with a UDID it runs on that simulator and keeps it. The tests enroll Face ID
  and show it faces themselves, the script grants the test host Face ID and takes the app to the background when a
  test asks; a test the simulator can't run fails rather than skips.
- `scripts/test-android.sh --emulator [API]` makes an emulator for the run — the newest installed system image with a
  fingerprint sensor, or the API given, such as `--emulator 30` — sets PIN 1234 and fingers 1 and 2 (`EmulatorSetup`),
  runs the instrumented tests and deletes it whatever the result. With a SERIAL they run on that emulator as it is,
  which needs the same PIN and fingers (`PIN=…`, `FINGERS=…` for others) — never the user's phone: the tests enroll
  and delete fingers, lock the screen and answer the prompt themselves. They reach the emulator's console with
  `~/.emulator_console_auth_token`; a locked emulator is unlocked with the PIN first.
- A change of `src/native/NativeApexKeychain.ts` changes the generated `NativeApexKeychainSpec` on both platforms: run
  `scripts/pods.sh` and both native builds.
