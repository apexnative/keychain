#!/bin/bash
# TypeScript of the library and the example app. Prints OK, or the `error TS` lines.
source "$(dirname "$0")/lib/quiet.sh"
quiet typecheck tsc yarn typecheck
