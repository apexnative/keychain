#!/bin/bash
# The library's Android tests. Always the JVM tests (android/src/test): the file's format, the encodings, the options.
# With a device's serial, the instrumented tests too (android/src/androidTest): the storage on that device's Keystore
# and, on an emulator, the prompt — answered by the tests themselves, which touch the emulator's fingerprint sensor
# through its console and tap the prompt with UiAutomator. Only on that device — Gradle alone would run them on every
# device connected, a phone included; an emulator is the one to give. Prints OK, or the tests that failed (or why they
# didn't compile).
# The emulator is expected set up as the repository's AVDs are: the PIN 1234 and fingers 1 and 2 enrolled (PIN=… and
# FINGERS=… for others). Locked — after a cold boot — it's unlocked with the PIN first. Another device runs the
# prompt's tests only with an emulator's console, so they're skipped there; PIN=… lets the lock screen's tests run.
# Usage: scripts/test-android.sh [SERIAL] [gradle args for the JVM tests...], e.g. emulator-5554, --tests '*Base64Test'
source "$(dirname "$0")/lib/quiet.sh"
SERIAL=
case $1 in
  '' | -*) ;;
  *) SERIAL=$1 && shift ;;
esac
gradle() {
  cd example/android && ../../scripts/android-env.sh ./gradlew -q -PapexKeychainWarningsAsErrors "$@"
}
rm -rf "$ROOT/android/build/test-results/testDebugUnitTest"
quiet test-android junit gradle :apexnative_keychain:testDebugUnitTest "$@" || exit 1
[ -n "$SERIAL" ] || exit 0
export ANDROID_SERIAL=$SERIAL
device() {
  adb -s "$SERIAL" "$@"
}
fail() {
  echo "✗ test-android-device: $1"
  exit 1
}

# What the tests are told about the device: Person.kt's Setup.
arguments=()
argument() {
  arguments+=("-Pandroid.testInstrumentationRunnerArguments.$1=$2")
}
case $SERIAL in
  emulator-*)
    PIN=${PIN-1234}
    FINGERS=${FINGERS-1,2}
    token=$(cat "$HOME/.emulator_console_auth_token" 2>/dev/null) ||
      fail "no ~/.emulator_console_auth_token: the tests reach the emulator's console with it"
    argument fingers "$FINGERS"
    argument console "${SERIAL#emulator-}:$token"
    # The finger a test enrolls is deleted after it; one left behind by a test that was killed would be a stranger.
    enrolled=$(device shell dumpsys fingerprint | grep -oE '"count":[0-9]+' | head -1 | cut -d: -f2)
    expected=$(echo "$FINGERS" | tr ',' '\n' | grep -c .)
    [ "$enrolled" = "$expected" ] ||
      fail "$SERIAL has ${enrolled:-no} fingerprints, the tests expect $expected ($FINGERS): delete the others"
    ;;
esac
[ -z "$PIN" ] || argument pin "$PIN"

# A device that hasn't been unlocked since it booted can't run the tests ("not encryption aware"): the PIN first.
locked() {
  device shell dumpsys window | grep -qE '(isKeyguardShowing|mShowingLockscreen|mDreamingLockscreen)=true'
}
device shell input keyevent KEYCODE_WAKEUP
if locked && [ -n "$PIN" ]; then
  device shell wm dismiss-keyguard >/dev/null 2>&1
  device shell input keyevent KEYCODE_MENU
  sleep 1
  device shell input text "$PIN"
  device shell input keyevent KEYCODE_ENTER
  sleep 2
fi
! locked || fail "$SERIAL is locked: unlock it (adb -s $SERIAL shell input text <PIN>, KEYCODE_ENTER) or give PIN=…"

quiet test-android-device gradle gradle :apexnative_keychain:connectedDebugAndroidTest "${arguments[@]}"
