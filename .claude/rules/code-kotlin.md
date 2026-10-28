---
paths:
  - 'android/**/*.{kt,java}'
  - 'example/android/**/*.{kt,java}'
---

# Kotlin

All library code is Kotlin; no Java. No formatter runs on these files; keep the style by hand.

## Format

- 4 spaces, no tabs (the example's own Kotlin: 2). Lines up to 120 columns. K&R braces.
- Continuation indent 4; trailing commas in multi-line parameter lists. Expression bodies for one-liners; one-line
  guards (`if (x) return`, `?: return`).
- `when` for branches of more than two ways. Imports sorted.

## Names

- Package `dev.apexnative.keychain`; migration from other libraries in `.migration`. One main type per file, named
  after it; small related types may share a file (`Keys.kt`, `Prompts.kt`).
- Constants: `const val UPPER_SNAKE` in a (private) `companion object`, or private at the top of the file.
- The TurboModule is `KeychainModule`, named `ApexKeychain` through the codegen spec (`NativeApexKeychainSpec.NAME`).

## Kotlin

- `val` unless it changes. No `!!`: `?.let`, `?: return`, or `requireNotNull(x) { "why" }`. No `lateinit`; `by lazy`
  for what is made on first use.
- `object` for singletons (`KeychainExecutor`, `AesGcm`); Kotlin function types for callbacks.
- `internal` for everything but what React Native needs to see (`KeychainModule`, `KeychainPackage`).

## Threads

- Every method of the module runs on `KeychainExecutor`, one at a time, in the order JavaScript called them; a
  synchronous method blocks the JavaScript thread until its turn is done (`sync` in `KeychainModule.kt`).
- Prompts go through `PromptQueue` (`Prompts.kt`): one at a time, on the main thread, in the activity React Native
  has. The executor never waits for a person: a read that needs a prompt ends on the executor again.

## Android versions

- A behavior that depends on the Android version asks `device.sdk` (`Device.kt`), which tests replace to play an older
  Android; `Build.VERSION.SDK_INT` only guards a call of a newer API.
- The passcode variants and `authValidity` need Android 11; below, they are `UNSUPPORTED`, never a weaker key.

## Comments

- KDoc on public and internal members, `//` on private ones; full sentences, why rather than what; `[name]` links and
  backticked option names, no `@param` / `@return`. No "we", no TODO.

## Errors and logs

- A call fails with `KeychainException` (`KeychainError.kt`): a code of `KeychainErrorCode`, an English sentence, and
  the platform's code and class as `nativeCode` and `nativeDomain`. `toKeychainException()` turns any exception into
  one, searching the cause chain: the Keystore wraps its errors in one another. The module rejects with
  `promise.rejectWith`; a synchronous method returns `{ error }`.
- A missing item is no error: `null`.
- Logs: `Log.w(TAG, "[ApexKeychain] …")` with the tag `ApexKeychain`, never a value or a key.

## Pitfalls

Each of these was a bug once, or cost a test session a day.

- **keystore2 LOCKED.** On Android 15+ a key with `setUnlockedDeviceRequired`, used while the device is locked, fails
  with a plain `InvalidKeyException` caused by a `KeyStoreException` whose numeric code is 2 (keystore2's `LOCKED`),
  not with `UserNotAuthenticatedException`. The library checks the lock itself before any key is touched
  (`checkUnlocked` in `Keychain.kt`, on every API), and maps `LOCKED` to `INTERACTION_NOT_ALLOWED`
  (`KeychainError.kt`). `KeyStoreException` and its numeric code are public from Android 13; before, it is a hidden
  class that says so only in its message (Android 11: "Device locked").
- **A Keystore operation outlives its key.** A read waiting for its prompt still decrypts the old value after
  `removeItem`, `clear` or a write. After the prompt the read checks the item is still the store's, and starts over
  when it isn't (`afterPrompt`, `PromptAgainException`).
- **Lockout on Android 15+.** The system asks for the PIN inside the prompt, and that PIN is bound to the prompt's
  operation: the finger after it doesn't unlock it, so the queue shows the prompt once more. `LOCKOUT` reaches the app
  only on Android 14 and lower; `BiometricManager` reports a locked-out sensor as available.
- **Home during a prompt.** Android 11+ reports it as `ERROR_USER_CANCELED`, Android 9 and 10 as `ERROR_CANCELED`, and
  the error can come about 30 ms before the activity's pause: the queue waits before the next prompt
  (`LEAVING_MILLIS`), or it shows over the launcher. Before Android 9 the prompt is androidx.biometric's own dialog in
  the activity: a cancel would leave a dead dialog, so it stays for the user to answer when the app comes back.
- **`setInvalidatedByBiometricEnrollment`** is ignored for a key that takes both the biometry and the device
  credential. The library ends `biometryCurrentSetOrPasscode` items itself, as iOS does: the item stores the
  `getBiometryState` token it was written with, and a read after a change deletes it with `KEY_INVALIDATED`
  (`checkBiometry` in `Keychain.kt`).
- **Emulators before Android 10 never change the fingerprint ID**, so a new finger invalidates nothing there. Leaving
  Settings' fingerprint list cancels the enrollment's challenge: enroll every finger in one visit.
- **Instrumented tests run on every connected device** when Gradle starts them, a phone included: only through
  `scripts/test-android.sh SERIAL`, with the emulator's serial.
- **The emulator under instrumentation.** A cold-booted emulator is locked and can't run the tests ("not encryption
  aware"): the script unlocks it with the PIN. The system never sends `TRIM_MEMORY_UI_HIDDEN` to a process under
  instrumentation (the test dispatches it itself), and `UiDevice.launcherPackageName` reports `com.android.settings`.

## Models

Read the closest one before writing (paths under `android/src/`).

- The storage, its keys and its errors: `main/java/dev/apexnative/keychain/Keychain.kt`, `Keys.kt`,
  `KeychainError.kt`.
- The prompt queue: `main/java/dev/apexnative/keychain/Prompts.kt`.
- A JVM test: `test/java/dev/apexnative/keychain/OptionsTest.kt`.
- An instrumented test with a prompt: `androidTest/java/dev/apexnative/keychain/PromptTest.kt`, over
  `PromptTestCase.kt` and `Person.kt` (the person at the emulator: fingers through its console, the PIN, Home).
