# General rules

- **Native names:** module and pod `ApexKeychain`, Kotlin package `dev.apexnative.keychain`, Objective-C prefix
  `ANK`, log prefix `[ApexKeychain]`.
- **One behavior change per commit.** Conventional commits (commitlint runs on commit-msg).
- **Android needs JDK 17.** Run Gradle and `react-native run-android` through `scripts/android-env.sh` (the example's
  scripts do); never change global Java settings.
- **Languages.** Android code in Kotlin, no Java. The iOS code is Objective-C++, no Swift in the library.
- **English** in code, comments, docs and commit messages. Comments are plain prose: what the code is for and why.
- **Examples** in code, docs and the example app use neutral names: keys `accessToken`, `refreshToken`, `pin`; stores
  `vault`, `settings`.
- **One meaning on both platforms.** An option, a default and an error mean the same on iOS and Android. A device or
  an OS that can't do what an option asks throws (`UNSUPPORTED`, `BIOMETRY_NOT_AVAILABLE`, `HARDWARE_UNAVAILABLE`, …):
  security is never downgraded silently. Where a platform differs, the option's JSDoc and its docs page say so.
- **Errors** are `KeychainError` with a code of `KeychainErrorCode` (`src/errors.ts`; the reader's list is
  `docs/content/help/error-codes.mdx`). A missing item is `null` (`false` for `hasItem`), never an error. A new code
  goes into `src/errors.ts`, `ios/ANKError.{h,mm}`, `KeychainError.kt` and that page together.
- **The native contract** is `src/native/NativeApexKeychain.ts`: its header says what JavaScript checks before a call,
  how errors and values cross, and on which threads. iOS and Android implement that one spec.
- **The mock behaves as the device does.** `src/jest/` runs the package's own API over a module in memory; a change of
  behavior goes into it too, and `src/__tests__/scenarios.test.ts` runs the example's M1 scenarios against it.
- **Both platforms.** A change of behavior is made on iOS and Android, or the docs say which platform has it.
- **Checks before done,** through `scripts/` (see Commands in `CLAUDE.md`): `scripts/check.sh` for TypeScript;
  `scripts/build-ios.sh` / `scripts/build-android.sh --lib` for native code (warnings are errors); the native tests
  (`scripts/test-ios.sh`, `scripts/test-android.sh [SERIAL]`) when the storage, the prompts or the errors changed.
- **Devices for tests:** the repository's simulators and the emulator only. Never the user's own phone: the
  instrumented tests enroll fingers, lock the screen and delete items.
- **Agents: the model fits the job.** Sonnet for mechanical work (applying decisions already made, coverage and
  cross-reference checks, tables, searches, scripts), Opus for design, native code and review, Haiku for plain
  lookups. Effort `high` for native code, design and review; `medium` for the mechanical agents (researcher,
  docs-writer, qa, ci-doctor); `xhigh` only for the hardest design questions. The agents in `.claude/agents/` carry
  their model; a generic agent gets `model` in its call.
- **Agents: few and focused.** At most four at a time. Each reads only its part and reports in a few lines, the details
  go into files. A restarted agent finishes only what is left.
