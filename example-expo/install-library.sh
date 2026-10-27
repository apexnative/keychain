#!/bin/bash
# Packs the library as npm would ship it, then installs this app's dependencies, the packed library among them
# (package.json points at .library/apexnative-keychain.tgz). It is `npm install` for this app: run it instead, and again
# after a change of the library.
#
#   ./install-library.sh && npx expo prebuild
set -euo pipefail
cd "$(dirname "$0")/.."
yarn prepare
PACK_DIR=$(mktemp -d)
npm pack --ignore-scripts --pack-destination "$PACK_DIR" >/dev/null
cd example-expo
mkdir -p .library
mv "$PACK_DIR"/apexnative-keychain-*.tgz .library/apexnative-keychain.tgz
rmdir "$PACK_DIR"
# A lockfile would pin the checksum of an older tarball.
rm -f package-lock.json
npm install --no-audit --no-fund
