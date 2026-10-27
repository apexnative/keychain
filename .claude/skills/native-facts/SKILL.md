---
name: native-facts
description: Finds exact facts about iOS, Android and React Native APIs — signatures, the OS version they need, how the system behaves — from the SDKs this project builds with: the Keychain (Security), LocalAuthentication, the Android Keystore, BiometricPrompt. Use before native code relies on a platform API, and before calling something a bug of the library.
argument-hint: <a question about a Security, LocalAuthentication, Keystore, BiometricPrompt or React Native API>
---

# Native facts

Answer from the sources the project builds with, in this order of trust. Never from memory alone: memory is where a
question starts, not its answer.

## Sources

1. **iOS SDK headers** of the installed Xcode (`xcodebuild -version`). The SDK:
   `$(xcrun --sdk iphonesimulator --show-sdk-path)`.
   - Objective-C APIs: `System/Library/Frameworks/<Framework>.framework/Headers/*.h` — signatures,
     `API_AVAILABLE(ios(…))`, `API_DEPRECATED`, the documented `OSStatus` and `LAError` values. The library's:
     `Security` (`SecItem.h`, `SecAccessControl.h`, `SecBase.h`) and `LocalAuthentication` (`LAContext.h`,
     `LAError.h`, `LADomainState.h`).
2. **Android.**
   - The framework: `$ANDROID_HOME/sources/android-<level>/` (`ANDROID_HOME` defaults to `~/Library/Android/sdk`), at
     the project's `compileSdkVersion` (`example/android/build.gradle`). The library's: `android/security/keystore/`,
     `android/security/KeyStoreException.java`, `android/hardware/biometrics/`. When that level's sources aren't
     installed, use the nearest installed level and name it in the answer.
   - AndroidX (`androidx.biometric`): its `*-sources.jar` in
     `~/.gradle/caches/modules-2/files-2.1/<group>/<artifact>/<version>/`, at the version in `android/build.gradle`;
     read a file with `unzip -p <jar> <path inside>`. When that version isn't cached, use the nearest cached one and
     name it.
   - What the Keystore does below the framework (keystore2, KeyMint, the response codes): AOSP's source on
     cs.android.com, at the tag of the Android version in question.
3. **React Native** in `node_modules/react-native/` (its version in `package.json` there): `React/` (iOS),
   `ReactAndroid/` (Android), `ReactCommon/` (C++, the TurboModule glue), `Libraries/` (JS).
4. **A test**, for behavior the sources can't show (what the Keychain answers for a locked item, what a prompt does
   when the app leaves). An XCTest in `ios/Tests/` or an instrumented test in `android/src/androidTest/`, run with
   `scripts/test-ios.sh` or `scripts/test-android.sh <emulator serial>`; or a minimal app in the scratchpad, never in
   the repository. The simulator's Keychain enforces no access control: a fact about it needs a device.
5. **Apple and Android documentation** on the web: to explain, not to settle a signature or a version.

## The answer

For each fact:

- the fact, in one or two sentences;
- the source: `file:line` or a URL;
- the OS version or library version it needs;
- how sure: `header` / `source`, `test`, `docs`, or `not verified`.

Add a short code example when it helps. Say plainly when sources disagree, when a version had to be approximated, when
the simulator or the emulator may differ from a device, or when the answer wasn't found.

## Don't

- Edit the repository, except a test the task asked for.
- Download SDK packages, sources or system images without asking: say what is missing, its size, and how to install
  it.
