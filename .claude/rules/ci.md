---
paths:
  - '.github/**'
---

# GitHub Actions

- `ci.yml` runs on pushes and pull requests to `main` (and in a merge queue, which is off): `lint` (ESLint, `tsc`,
  headers), `test` (Jest), `test-android` (the library's JVM tests), `build-library` (`yarn prepare`),
  `build-android` and `build-ios` (the example), `build-expo-ios` and `build-expo-android` (`example-expo` with the
  packed library and its config plugin, after `expo prebuild`). Its first job, `changes`, runs
  `scripts/ci-changes.mjs` on the files the change touches: the code jobs run for any file but the docs, the native
  jobs for native code, the codegen spec, the config plugin, the example's native projects, the Expo app,
  dependencies and the build setup; the docs alone and a release run none of them. A new job takes `needs: changes`
  and the `if` of its kind; a file a job newly depends on goes into the lists of the script.
- The pod's XCTest and the instrumented Android tests need a simulator with Face ID and an emulator with a PIN and
  fingers: they run locally (`scripts/test-ios.sh`, `scripts/test-android.sh SERIAL`), not on CI.
- `rn-watch.yml` (05:00 UTC, or by hand with a version) runs `scripts/rn-watch.mjs`: for a React Native minor newer
  than the repository's (npm `latest`, `next`) it opens the issue `React Native 0.<minor>` (label `react-native`) and
  adds the minor's later versions to it as comments; the issue closes when the repository moves to that minor. The
  work on the new version starts from that issue.
- `release.yml` runs on every push to `main`: release-please keeps the release pull request open (the `release` skill),
  and after it is merged publishes to npm through the `npm` environment (trusted publishing, no token). By hand with a
  `tag` it publishes that existing tag, when the push run failed after tagging; the file name stays `release.yml`,
  which npm trusted publishing is bound to.
- `docs.yml` builds the docs site on a pull request that changes `docs/` or `package.json` (the version on the site),
  and on `main` publishes it to GitHub Pages (keychain.apexnative.dev). `pr-title.yml` checks that a pull request's
  title is a conventional commit; in a merge queue it passes with no steps.
- The rulesets: `main` takes squashed pull requests with the checks of `ci.yml` and `pr-title`, no force push or
  deletion; `release tags` lets only the maintainer and the release app create, move or delete `v*` tags. A renamed
  job is renamed in the `main` ruleset too, or pull requests wait for a check that never comes.
- Every job but `changes` starts with `actions/checkout` and the local `./.github/actions/setup` (Node from `.nvmrc`,
  the Yarn cache, `yarn install --immutable`). A new job does too.
- Third-party actions are pinned to a full commit SHA with the version in a comment
  (`uses: actions/checkout@<sha> # v5.0.0`), never a tag or a branch alone. An update changes both.
- Xcode comes from `XCODE_VERSION` in the job's `env`; only the iOS jobs run on macOS.
- A job runs what a local script runs (the same yarn script or Gradle task, with the same flags), so a failure
  reproduces with `scripts/`. A new check is a yarn script or a `scripts/` wrapper first, then a step.
- Each workflow keeps `concurrency` with `cancel-in-progress`, so a new push cancels the older run of its ref;
  `release.yml` alone queues its runs, so a publication is never cut off.
- The issue templates are in `ISSUE_TEMPLATE/`; `/fix #<number>` reads a bug report in that shape.
