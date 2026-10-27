# Expo example

A minimal Expo app (SDK 58) that uses `@apexnative/keychain` through its config plugin: one screen that writes an item
and reads it back. Its native projects are made by `expo prebuild`, not kept.

```sh
cd example-expo
./install-library.sh      # packs the library, then `npm install` with the tarball among the dependencies
npx expo prebuild         # ios/ and android/
npx expo run:ios          # or run:android
```

`app.json` lists the plugin with its options:

- `faceIDPermission`: the `NSFaceIDUsageDescription` text (a default if left out, `false` for none);
- `clearOnReinstall`: delete the package's items when the app is installed again (iOS);
- `accessGroups`: keychain access groups to share items in, written to the `keychain-access-groups` entitlement (needs a
  team: not set here).

In Expo Go the screen shows an `UNSUPPORTED` error that says to use a development build: Expo Go has no native code of
the package. The CI jobs `build-expo-ios` and `build-expo-android` in `.github/workflows/ci.yml` do the steps above on
a runner, one platform each.

`package.json` pins `expo-file-system` to 58.0.11 with `overrides`: its 58.0.12 (27 October 2026) needs an
`expo-modules-core` that is not published yet, and an app with the pair crashes at launch (dyld, a missing
`AnyModule` symbol). Drop the override once Expo has released the matching `expo-modules-core`.
