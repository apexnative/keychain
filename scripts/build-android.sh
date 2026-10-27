#!/bin/bash
# Builds the example app for Android (arm64, debug); Kotlin and Java warnings fail it. --lib compiles only the
# library, the quickest check. With a device's serial it installs the app there, forwards Metro's port and starts it.
# Usage: scripts/build-android.sh [--lib | SERIAL]
source "$(dirname "$0")/lib/quiet.sh"
gradle() {
  cd example/android && ../../scripts/android-env.sh ./gradlew -q -PapexKeychainWarningsAsErrors "$@"
}
if [ "$1" = --lib ]; then
  quiet build-android-lib gradle gradle :apexnative_keychain:compileDebugKotlin \
    :apexnative_keychain:compileDebugJavaWithJavac
  exit
fi
SERIAL=$1
quiet build-android gradle gradle :app:assembleDebug -PreactNativeArchitectures=arm64-v8a || exit 1
start() {
  adb -s "$SERIAL" install -r example/android/app/build/outputs/apk/debug/app-debug.apk &&
    adb -s "$SERIAL" reverse tcp:8081 tcp:8081 &&
    adb -s "$SERIAL" shell am start -S -n dev.apexnative.keychain.example/.MainActivity
}
[ -z "$SERIAL" ] || quiet start-android tail start
