---
name: native-dev
description: How a native change is made in ios/ or android/ — the draft mode (complete code for review, nothing written) and the write mode, the folders a change may touch, and the builds and tests that prove it. Use when implementing or changing native code.
argument-hint: <the task> [draft]
---

# A native change

## Modes

- **Draft** (the task says "draft"): return the complete code of the change — a unified diff per changed file, whole
  new files — and a short why for each part. Write nothing.
- **Write** (otherwise): make the change, then check it (below).

## Before writing

- The contract is fixed: names, defaults, errors and behavior per platform come from the task or its task file
  (`.tasks/<name>.md`), and from `src/native/NativeApexKeychain.ts` (what JavaScript checked before the call, how
  errors and values cross). If it can't work as written, stop and say why; don't change it on your own.
- Read the code around the change and its tests. Follow `.claude/rules/code-objc.md` or `code-kotlin.md`, their
  pitfalls included.
- A platform fact you aren't sure of: the `native-facts` skill.

## Limits

- iOS: only `ios/` and `example/ios/`. Android: only `android/` and `example/android/`. What else the change needs (JS,
  the mock in `src/jest/`, docs, the other platform) goes into the result, not into other folders.
- No commits, no new dependencies unless the task says so.
- Security is never downgraded silently: an option the device can't do throws, it isn't approximated.

## Check

- iOS: `scripts/build-ios.sh`, OK with no warnings; `scripts/test-ios.sh` when the store, the prompts, the device
  checks or the errors changed. A new file: `scripts/pods.sh` first.
- Android: `scripts/build-android.sh --lib`; `scripts/test-android.sh` (the JVM tests), and
  `scripts/test-android.sh <emulator serial>` when the storage, the prompts or the errors changed. Never a phone's
  serial.
- A behavior change comes with a test that fails without it.
- A changed codegen spec: `scripts/pods.sh` for iOS; the Gradle build regenerates Android's.

## The result

The files changed, what and why in a few lines, the checks' lines, and what is left for others.
