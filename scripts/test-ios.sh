#!/bin/bash
# The pod's XCTest (ios/Tests) in its app host (ios/TestHost) on an iOS simulator: the store, the module and its
# prompts against the Keychain and LocalAuthentication; warnings in ios/ fail it. The tests enroll Face ID on the
# simulator and show it faces themselves, and this script takes the app to the background when a test asks; here a
# test the simulator can't run fails rather than skips (ANK_REQUIRE_BIOMETRY). Run scripts/pods.sh first after a native
# or spec change.
# Usage: scripts/test-ios.sh [UDID | --ios VERSION]
#   Without a UDID it makes a simulator for the run, a Face ID iPhone on the newest iOS (or the iOS VERSION given, such
#   as 18.5), and deletes it after, so no simulator is left behind. With a UDID it runs on that one and keeps it.
source "$(dirname "$0")/lib/quiet.sh"
# The app the tests run in (the app spec TestHost), and what a test posts to go to the background
# (ANKTripToTheBackground).
HOST=org.cocoapods.ApexKeychain-TestHost
TRIP=dev.apexnative.keychain.tests.background
UDID=
IOS=
case $1 in
  --ios) IOS=$2 ;;
  '') ;;
  *) UDID=$1 ;;
esac
if [ -z "$UDID" ]; then
  # The newest runtime (of the version asked) with a Face ID iPhone: "runtime device-type".
  PICK=$(xcrun simctl list runtimes -j | node -e '
    const asked = process.argv[1];
    const iphones = ["iPhone 17", "iPhone 17 Pro", "iPhone 16", "iPhone 16 Pro", "iPhone 15", "iPhone 14", "iPhone 13",
      "iPhone 12", "iPhone 11"];
    const newer = (a, b) => b.version.localeCompare(a.version, undefined, { numeric: true });
    const runtimes = JSON.parse(require("fs").readFileSync(0, "utf8")).runtimes
      .filter((runtime) => runtime.platform === "iOS" && runtime.isAvailable)
      .filter((runtime) => !asked || runtime.version === asked || runtime.version.startsWith(asked + "."))
      .sort(newer);
    for (const runtime of runtimes) {
      const types = runtime.supportedDeviceTypes ?? [];
      const type = iphones.map((name) => types.find((t) => t.name === name)).find(Boolean);
      if (type) {
        console.log(runtime.identifier, type.identifier);
        break;
      }
    }
  ' "$IOS")
  if [ -z "$PICK" ]; then
    echo "✗ test-ios: no iOS ${IOS:-runtime} with a Face ID iPhone. xcrun simctl list runtimes lists what's installed."
    exit 1
  fi
  UDID=$(xcrun simctl create "ApexKeychain Tests" ${PICK#* } ${PICK% *}) || exit 1
  # Deleted whatever happens to the run.
  trap 'xcrun simctl shutdown "$UDID" >/dev/null 2>&1; xcrun simctl delete "$UDID"' EXIT
fi
# Each time a test posts the notification: Settings in front, then the app again, which keeps its process, as a user
# switching apps does.
trips() {
  while xcrun simctl spawn "$UDID" notifyutil -1 "$TRIP" >/dev/null; do
    xcrun simctl launch "$UDID" com.apple.Preferences >/dev/null && sleep 1 &&
      xcrun simctl launch "$UDID" "$HOST" >/dev/null
  done
}
xctest() {
  # Booted here rather than by xcodebuild, as the trips need it first; shut down after, as xcodebuild would.
  local booted=0 trips result
  xcrun simctl list devices | grep -q "($UDID) (Booted)" && booted=1
  xcrun simctl bootstatus "$UDID" -b >/dev/null || return 1
  # Face ID for the app, as OK on its "Allow … to use Face ID?" alert gives it (iOS 18 asks): the simulator's privacy
  # database, as simctl privacy has no Face ID.
  sqlite3 "$HOME/Library/Developer/CoreSimulator/Devices/$UDID/data/Library/TCC/TCC.db" "insert or replace into access
    (service, client, client_type, auth_value, auth_reason, auth_version, flags)
    values ('kTCCServiceFaceID', '$HOST', 0, 2, 4, 1, 0)" || return 1
  trips &
  trips=$!
  # Its own derived data: a build of the example may run at the same time. No diagnostics after a failure: collecting
  # them takes xcodebuild ten minutes.
  (cd example/ios && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 TEST_RUNNER_ANK_REQUIRE_BIOMETRY=1 \
    node ../../scripts/ios-warnings.mjs xcodebuild test \
    -workspace KeychainExample.xcworkspace -scheme ApexKeychain-Unit-Tests -configuration Debug -sdk iphonesimulator \
    -destination "id=$UDID" -derivedDataPath build/DerivedDataTests -collect-test-diagnostics never \
    COMPILER_INDEX_STORE_ENABLE=NO)
  result=$?
  # The loop stops, then the notification frees its last wait in the simulator.
  kill "$trips"
  xcrun simctl spawn "$UDID" notifyutil -p "$TRIP" >/dev/null
  [ "$booted" = 1 ] || xcrun simctl shutdown "$UDID"
  return $result
}
quiet test-ios xcode xctest
