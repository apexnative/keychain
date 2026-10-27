#!/bin/bash
# The quick checks in a row: TypeScript, lint, Jest, copyright headers, the Claude hooks, the package build. One line
# each.
DIR="$(dirname "$0")"
source "$DIR/lib/quiet.sh"
failed=0
"$DIR/typecheck.sh" || failed=1
"$DIR/lint.sh" || failed=1
"$DIR/test-js.sh" || failed=1
quiet headers tail node scripts/check-license-headers.mjs || failed=1
quiet hooks tail node --test scripts/claude-hooks/pre-edit.test.mjs || failed=1
quiet build-lib tail yarn prepare || failed=1
exit $failed
