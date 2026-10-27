---
name: fix
description: A bug from report to fix — understand, reproduce in a test or on a device, confirm it is the library's, find the root cause, fix on the platforms it affects, check, review, report. Stops only when the fix changes behavior an app can see or the API.
disable-model-invocation: true
argument-hint: '<scenario or call>, <platform>: <what happens> | #<issue> [flags]'
---

# A bug

Flags and the task file: `.claude/skills/task-flow/SKILL.md`. `#<number>` is a GitHub issue: read it with
`gh issue view <number>`; it follows the bug template (`.github/ISSUE_TEMPLATE/bug_report.yml`).

1. **Understand:** the call and its options, the code path (`src/api.ts` → `src/native/NativeApexKeychain.ts` →
   `ios/ANKKeychainModule.mm` or `android/src/main/java/dev/apexnative/keychain/KeychainModule.kt`), the platform and
   its version, the device state (locked, biometry enrolled or changed, the app in the background).
2. **Reproduce:** a failing test first where one can show it — Jest for JS, XCTest (`scripts/test-ios.sh`), a JVM or
   instrumented test (`scripts/test-android.sh [SERIAL]`). Otherwise the `qa` agent runs the scenario on the platform
   of the report and returns what it saw. Not reproduced: say so with what was tried, and stop.
3. **Is it the library?** Check how the platform itself behaves (the `native-facts` skill, or `researcher` when the
   question is large) before calling it a bug. A platform's own behavior is reported as such; a simulator or an
   emulator that differs from a device is said so.
4. **The root cause,** in one or two sentences. Stop here with `--cause`, and always when the fix changes behavior an
   app can see or the API: show the cause and the proposed fix, and wait.
5. **The fix** on the platforms it affects, and in the mock when JS sees it. A simple fix (task-flow, "Working rules")
   the main session makes itself, native code too, with the `native-dev` rules and the scripts. A large one:
   `ios-dev` and `android-dev` in parallel, JS in the main session. With `--code`, show the code first.
6. **Check:** the test of step 2 passes, and fails without the fix. A bug seen on a device: the same `qa` agent
   (`SendMessage`: it keeps the device and the steps) runs the steps again — on both platforms when the fix touches
   both. Skipped with `--no-device`.
7. **Review,** once for all the bugs of the request, at the end: the `review-change` skill for simple fixes, the
   `reviewer` agent for a large one. The scripts and `scripts/check.sh` pass.
8. **Pitfall:** if this kind of bug can happen again, one line in the pitfalls of `.claude/rules/code-objc.md` or
   `code-kotlin.md`.
9. **Report,** 3–5 lines: what was wrong, why, what changed, how it was checked.

The bug: $ARGUMENTS
