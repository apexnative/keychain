#!/bin/bash
# pod install for the example app, after a native or spec change on iOS. Prints OK, or the end of the error.
source "$(dirname "$0")/lib/quiet.sh"
# CocoaPods fails on paths without a UTF-8 locale.
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
quiet pods tail yarn example pods
