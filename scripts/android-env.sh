#!/usr/bin/env bash
# Runs a command with the Android toolchain this repository expects, without touching
# global settings: JDK 17 (resolved on macOS via /usr/libexec/java_home) and ANDROID_HOME.
#
#   scripts/android-env.sh ./gradlew assembleDebug
#
# On CI (Linux) JAVA_HOME and ANDROID_HOME come from the runner and are used as is.
set -euo pipefail

if [[ -x /usr/libexec/java_home ]]; then
  if ! JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null)"; then
    echo "error: JDK 17 not found. Install one (e.g. Zulu 17) and run 'yarn doctor'." >&2
    exit 1
  fi
  export JAVA_HOME
fi

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"

exec "$@"
