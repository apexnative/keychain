#!/bin/bash
# The library's Android tests. Always the JVM tests (android/src/test): the file's format, the encodings, the options.
# With a device, the instrumented tests too (android/src/androidTest): the storage on its Keystore and, on an emulator,
# the prompt — answered by the tests themselves, which touch the emulator's fingerprint sensor through its console and
# tap the prompt with UiAutomator. Only on that device: Gradle alone would run them on every device connected, a phone
# included. Prints OK, or the tests that failed (or why they didn't compile).
# Usage: scripts/test-android.sh [--emulator [API] | SERIAL] [gradle args for the JVM tests...]
#   --emulator makes an emulator for the run from an installed system image — the newest with a fingerprint sensor, or
#   the newest of the API given, such as 30 — gives it the PIN 1234 and fingers 1 and 2, enrolled in Settings, runs the
#   tests on it and deletes it, whatever the result, so no emulator is left behind. With a SERIAL the tests run on that
#   device as it is: an emulator needs the PIN 1234 and fingers 1 and 2 (PIN=… and FINGERS=… for others), and is
#   unlocked with the PIN when locked; another device runs the prompt's tests only with an emulator's console, so
#   they're skipped there, and PIN=… lets the lock screen's tests run.
#   E.g. scripts/test-android.sh --emulator 30, scripts/test-android.sh emulator-5554, --tests '*Base64Test'
source "$(dirname "$0")/lib/quiet.sh"
SERIAL=
EMULATOR=
API=
case $1 in
  --emulator)
    EMULATOR=1 && shift
    case $1 in [0-9]*) API=$1 && shift ;; esac
    ;;
  '' | -*) ;;
  *) SERIAL=$1 && shift ;;
esac
gradle() {
  cd example/android && ../../scripts/android-env.sh ./gradlew -q -PapexKeychainWarningsAsErrors "$@"
}
rm -rf "$ROOT/android/build/test-results/testDebugUnitTest"
quiet test-android junit gradle :apexnative_keychain:testDebugUnitTest "$@" || exit 1
[ -n "$SERIAL$EMULATOR" ] || exit 0
device() {
  adb -s "$SERIAL" "$@"
}
fail() {
  echo "✗ test-android-device: $1"
  exit 1
}

# --emulator: an AVD of its own, in a directory of its own, deleted with it whatever happens to the run.
if [ -n "$EMULATOR" ]; then
  SDK=${ANDROID_HOME:-$HOME/Library/Android/sdk}
  ABI=x86_64
  [ "$(uname -m)" = arm64 ] && ABI=arm64-v8a
  NAME=ApexKeychainTests
  ANDROID_AVD_HOME=$(mktemp -d "${TMPDIR:-/tmp}/apexnative-keychain-avd.XXXXXX")
  export ANDROID_AVD_HOME
  EMULATOR_PID=
  stop() {
    [ -n "$EMULATOR_PID" ] || return 0
    device emu kill >/dev/null 2>&1 || kill "$EMULATOR_PID" 2>/dev/null
    wait "$EMULATOR_PID" 2>/dev/null
    EMULATOR_PID=
  }
  trap 'stop; rm -rf "$ANDROID_AVD_HOME"' EXIT
  # The installed images, newest first: "API tag". TVs, watches, cars and desktops have no fingerprint sensor.
  images() {
    local dir api tag
    for dir in "$SDK"/system-images/android-*/*/"$ABI"; do
      [ -d "$dir" ] || continue
      api=${dir#"$SDK"/system-images/android-} && api=${api%%/*}
      tag=${dir%/"$ABI"} && tag=${tag##*/}
      case $tag in *tv* | *wear* | *automotive* | *desktop* | *xr*) continue ;; esac
      [ -z "$API" ] || [ "$api" = "$API" ] && echo "$api $tag"
    done | sort -k1,1nr
  }
  # Boots an AVD of the image on a free port; succeeds when it has a fingerprint sensor.
  boot() {
    local port=5554
    while adb devices | grep -q "^emulator-$port[[:space:]]" || nc -z 127.0.0.1 "$port" 2>/dev/null; do
      port=$((port + 2))
    done
    SERIAL=emulator-$port
    echo no | "$ROOT/scripts/android-env.sh" "$SDK/cmdline-tools/latest/bin/avdmanager" -s create avd --force \
      -n "$NAME" -k "system-images;android-$1;$2;$ABI" -d pixel_8 >>"$LOGS/test-android-emulator.log" 2>&1 ||
      fail "no AVD of android-$1 $2: .logs/test-android-emulator.log"
    # The tests need little room: a data partition of 3 GB, not the device's 12.
    sed -i.bak 's/^disk.dataPartition.size=.*/disk.dataPartition.size=3G/' "$ANDROID_AVD_HOME/$NAME.avd/config.ini"
    "$SDK/emulator/emulator" -avd "$NAME" -port "$port" -no-window -no-audio -no-boot-anim -no-snapshot \
      -no-metrics -crash-report-mode disabled >>"$LOGS/test-android-emulator.log" 2>&1 &
    EMULATOR_PID=$!
    local deadline=$((SECONDS + 600))
    until [ "$(device shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do
      kill -0 "$EMULATOR_PID" 2>/dev/null || fail "the emulator stopped: .logs/test-android-emulator.log"
      [ $SECONDS -lt $deadline ] || fail "the emulator didn't boot in 10 minutes: .logs/test-android-emulator.log"
      sleep 3
    done
    device shell pm list features | grep -q 'feature:android.hardware.fingerprint$' && return 0
    stop
    return 1
  }
  : >"$LOGS/test-android-emulator.log"
  booted=
  while read -r api tag; do
    boot "$api" "$tag" && booted="android-$api $tag" && break
  done < <(images)
  [ -n "$booted" ] || fail "no installed system image${API:+ of API $API} with a fingerprint sensor ($ABI)"
  echo "  $SERIAL: $booted, made for the run"
  # Awake all along: the prompt needs the activity in front.
  device shell svc power stayon true
  device shell settings put system screen_off_timeout 2147483647
fi
export ANDROID_SERIAL=$SERIAL

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
    ;;
esac
[ -z "$PIN" ] || argument pin "$PIN"

# The emulator made for the run gets its PIN and its fingers from EmulatorSetup (androidTest), which the suite leaves
# out.
SETUP=dev.apexnative.keychain.EmulatorSetup
setup() {
  local result
  (gradle :apexnative_keychain:installDebugAndroidTest) || return 1
  result=$(device shell am instrument -w -e class "$SETUP" -e setUp true -e pin "$PIN" -e fingers "$FINGERS" \
    -e console "${SERIAL#emulator-}:$token" dev.apexnative.keychain.test/androidx.test.runner.AndroidJUnitRunner)
  echo "$result"
  grep -q 'OK (1 test)' <<<"$result"
}
if [ -n "$EMULATOR" ]; then
  quiet test-android-setup tail setup || exit 1
fi

if [[ $SERIAL == emulator-* ]]; then
  # The finger a test enrolls is deleted after it; one left behind by a test that was killed would be a stranger.
  enrolled=$(device shell dumpsys fingerprint | grep -oE '"count":[0-9]+' | head -1 | cut -d: -f2)
  expected=$(echo "$FINGERS" | tr ',' '\n' | grep -c .)
  [ "$enrolled" = "$expected" ] ||
    fail "$SERIAL has ${enrolled:-no} fingerprints, the tests expect $expected ($FINGERS): delete the others"
fi

# A device that hasn't been unlocked since it booted can't run the tests ("not encryption aware"): the PIN first.
locked() {
  device shell dumpsys window |
    grep -qE '(isKeyguardShowing|isStatusBarKeyguard|mShowingLockscreen|mDreamingLockscreen)=true'
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

argument notClass "$SETUP"
quiet test-android-device gradle gradle :apexnative_keychain:connectedDebugAndroidTest "${arguments[@]}"
