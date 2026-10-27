#!/bin/bash
# The docs site, a Yarn project of its own in docs/ (`yarn --cwd docs install` first): `typecheck` (default) checks
# its TypeScript, `build` builds it and fails on a broken link or anchor. Prints OK, or why it failed.
# Usage: scripts/docs.sh [typecheck | build]
source "$(dirname "$0")/lib/quiet.sh"
case ${1:-typecheck} in
  typecheck) quiet docs-typecheck tsc yarn --cwd docs typecheck ;;
  build) quiet docs-build tail yarn --cwd docs build ;;
  *) echo "Usage: scripts/docs.sh [typecheck | build]" && exit 1 ;;
esac
