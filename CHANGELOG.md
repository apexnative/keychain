# Changelog

## [1.0.0](https://github.com/apexnative/keychain/compare/v1.0.0-rc.2...v1.0.0) (2026-10-28)


### ⚠ BREAKING CHANGES

* Keychain.getItemInfo, Keychain.getAllKeys, the ItemInfo type, the label option of setItem and setBytes, the fallback field of prompt and the error code USER_FALLBACK are gone. Keep a user name to show before the prompt as an item without access control.

### Features

* leave getItemInfo, getAllKeys, labels and the fallback button for 1.1 ([#10](https://github.com/apexnative/keychain/issues/10)) ([01f7d33](https://github.com/apexnative/keychain/commit/01f7d3388a9e5facc7b7ddffca6c06909bebcb90))


### Bug Fixes

* **ios:** read a protected item with one prompt, as a native app does ([#9](https://github.com/apexnative/keychain/issues/9)) ([a35378f](https://github.com/apexnative/keychain/commit/a35378f8985a5c3913905a030c31c421fa355343))


### Miscellaneous Chores

* release 1.0.0 as the first stable version ([#13](https://github.com/apexnative/keychain/issues/13)) ([d95fbb0](https://github.com/apexnative/keychain/commit/d95fbb0d2b70ed51ad71bd66cc63c12f23bb4967))

## [1.0.0-rc.2](https://github.com/apexnative/keychain/compare/v1.0.0-rc.1...v1.0.0-rc.2) (2026-10-28)


### Bug Fixes

* **android:** end biometryCurrentSetOrPasscode items on a new fingerprint, as on iOS ([#7](https://github.com/apexnative/keychain/issues/7)) ([2895494](https://github.com/apexnative/keychain/commit/2895494c0dedd120be467a556f1a02b54f3a6654))

## [1.0.0-rc.1](https://github.com/apexnative/keychain/compare/v1.0.0-rc.0...v1.0.0-rc.1) (2026-10-27)


### Features

* secure storage for React Native, the iOS Keychain and the Android Keystore behind one API ([1538ea1](https://github.com/apexnative/keychain/commit/1538ea103cbd754a6a5136232a6a49bb73cfb85f))


### Bug Fixes

* build the package's targets in order ([#2](https://github.com/apexnative/keychain/issues/2)) ([80e3f28](https://github.com/apexnative/keychain/commit/80e3f286eaaf06a7420995bb62b0b29aa85fd18a))
