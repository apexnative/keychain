#!/bin/bash
# ESLint with Prettier, on the given files or on all of them. Prints OK, or one line per error.
# Usage: scripts/lint.sh [files...]
source "$(dirname "$0")/lib/quiet.sh"
[ $# -eq 0 ] && set -- '**/*.{js,mjs,ts,tsx}'
quiet lint eslint node_modules/.bin/eslint --format json "$@"
