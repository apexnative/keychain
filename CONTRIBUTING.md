# Contributing

Contributions are always welcome, no matter how large or small. Please read the
[code of conduct](./CODE_OF_CONDUCT.md) before contributing. To report a vulnerability, follow the
[security policy](./SECURITY.md) instead of opening an issue.

## Environment

| Tool        | Version                                   | Notes                                                                          |
| ----------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| Node.js     | see [`.nvmrc`](./.nvmrc) (>= 22.13)       |                                                                                |
| Yarn        | pinned in [`.yarnrc.yml`](./.yarnrc.yml)  | run `yarn` from the repository root; npm is used only by the Expo example      |
| Xcode       | 26 or newer                               | the library builds with the iOS 26 SDK                                         |
| Ruby        | see [`.ruby-version`](./.ruby-version)    | Bundler installs CocoaPods into `example/vendor/bundle`                        |
| JDK         | 17                                        | selected per command by `scripts/android-env.sh`; your global Java stays as is |
| Android SDK | platform 37, build-tools 37.0.0, NDK 27.1 | `ANDROID_HOME`, defaults to `~/Library/Android/sdk`                            |

## Development workflow

The repository contains the library in the root directory and the example app in
`example/`, connected with [Yarn workspaces](https://yarnpkg.com/features/workspaces).

```sh
yarn                  # install dependencies
yarn example pods     # install the example's pods
yarn example start    # start Metro
yarn example ios      # run the example app on iOS
yarn example android  # run the example app on Android
```

The example app uses the library from source: JavaScript changes show up without a rebuild,
native changes need one, and a change of `ios/` or of the codegen spec (`src/native/`) needs
`yarn example pods` first. To work on native code, open `example/ios/KeychainExample.xcworkspace`
in Xcode (sources under `Pods > Development Pods > ApexKeychain`) or `example/android` in
Android Studio.

`example-expo/` is a minimal Expo app that installs the library as npm ships it, with its config
plugin; its [README](./example-expo/README.md) says how to run it.

Before sending a change:

```sh
yarn typecheck
yarn lint             # yarn lint --fix to fix formatting
yarn test
yarn check:headers
```

`scripts/check.sh` runs them, the test of the Claude Code hooks and the package build in a row,
one line each. The native tests, each with its usage at its top:

- `scripts/test-ios.sh [UDID | --ios VERSION]` runs the pod's XCTest (`ios/Tests`) in its app host
  on an iOS simulator. Without a UDID it makes one for the run — a Face ID iPhone on the newest iOS
  installed, or on the version given, such as `--ios 18.5` — and deletes it after. The tests enroll
  Face ID on the simulator and answer the prompts themselves; the script grants the app Face ID and
  takes it to the background when a test asks. A test the simulator can't run fails rather than
  skips.
- `scripts/test-android.sh [SERIAL]` runs the JVM tests (`android/src/test`); with an emulator's
  serial, such as `emulator-5554`, the instrumented tests of `android/src/androidTest` too, on that
  emulator only. They enroll and delete fingerprints, lock the screen and answer the prompt
  themselves, so run them on an emulator, never on your own phone. The emulator needs the PIN
  `1234` and fingers 1 and 2 enrolled (`PIN=…` and `FINGERS=…` for others), and the tests reach its
  console with the token in `~/.emulator_console_auth_token`, which the emulator writes on its
  first start. A locked emulator is unlocked with the PIN first.

## Documentation

The site at [keychain.apexnative.dev](https://keychain.apexnative.dev) lives in `docs/`, a Yarn
project of its own (`yarn --cwd docs install`, then `yarn --cwd docs start`). Its API reference
is written by hand: a change of the API changes its page in the same pull request.
`scripts/docs.sh typecheck` and `scripts/docs.sh build` check the site; the build fails on a
broken link.

## Copyright headers

Some files carry copyright headers of their original authors. Never remove or change them.
When you modify such a file, keep the header and add a `Modified by <name>, <year>` line below
it. `yarn check:headers` (also run by CI and the pre-commit hook) verifies this for the files
listed in `scripts/license-headers.json`.

## Commit message convention

We follow the [conventional commits specification](https://www.conventionalcommits.org/en):

- `fix`: bug fixes, e.g. fix the error code of a cancelled prompt.
- `feat`: new features, e.g. add a new option.
- `refactor`: code refactoring without behavior changes.
- `docs`: documentation changes.
- `test`: adding or updating tests.
- `chore`: tooling changes, e.g. CI configuration.

Keep one behavior change per commit. The commit-msg hook checks the format.

## Publishing to npm

Releases are made by [release-please](https://github.com/googleapis/release-please). After every
merge into `main` it keeps a release pull request open with the next version and the changelog,
built from the titles of the merged pull requests. Merging it tags the version, creates the
GitHub release and publishes the package to npm from GitHub Actions, after a maintainer approves
the publication. There is no npm token: npm trusts the release workflow (trusted publishing),
and every version carries its provenance.

## Sending a pull request

- Prefer small pull requests focused on one change.
- Make sure linters, tests and the header check pass.
- For changes to the API or implementation, open an issue to discuss first.
