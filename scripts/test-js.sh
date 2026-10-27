#!/bin/bash
# Jest. Prints OK, or the tests that failed with the first line of each failure.
# Usage: scripts/test-js.sh [jest args...]
source "$(dirname "$0")/lib/quiet.sh"
rm -f "$LOGS/jest.json"
quiet test-js jest node_modules/.bin/jest --silent --json --outputFile="$LOGS/jest.json" "$@"
