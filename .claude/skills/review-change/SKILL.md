---
name: review-change
description: Reviews a change in this repository against its contract and rules — bugs, security, the same behavior on iOS, Android, JS and the Jest mock, errors, threads, conventions, copyright headers, docs. Reports findings and fixes nothing.
argument-hint: [files, or the task the change was for]
---

# Review a change

## Read

- The change: the diff given, or `git diff` of the files the task names.
- What it was for: the task file (`.tasks/<name>.md`) or the task's own words.

## Check, in this order

1. **Security:** a secret never weaker than asked — an option the device can't do throws, never falls back to less;
   no value or key in a log, an error message or a crash report; an item stays protected when a write fails half-way
   (the old value kept, no temporary item left).
2. **Bugs:** wrong logic and missed cases — a missing item, an empty value, U+0000, a key or a service of another
   library, called twice or at once, a prompt canceled or interrupted, the app in the background, the device locked,
   the biometry changed, a JS reload; leaks; the wrong thread or queue.
3. **Parity:** iOS, Android, JS and the mock (`src/jest/`) do the same thing, with the same names, defaults and error
   codes. Where a platform can't, the JSDoc and the docs say so.
4. **Errors:** a code of `KeychainErrorCode` that fits, `nativeCode` and `nativeDomain` kept; a missing item `null`,
   never an error; a synchronous method answers `{ error }`, never throws across JSI.
5. **Native:** the pitfalls of `.claude/rules/code-objc.md` and `code-kotlin.md`; availability checks for newer
   APIs; `ANK` on new iOS names; no `!!` in Kotlin.
6. **Tests:** a behavior change has a test that fails without it — Jest, XCTest (`ios/Tests/`), JVM or instrumented
   (`android/src/`).
7. **Conventions:** `.claude/rules/code-*.md` for the files changed; comments in plain prose that say why.
8. **Public API:** JSDoc on every export; its page in `docs/reference/` and `docs/sections.json` changed with it; an
   error code on `docs/content/help/error-codes.mdx`.
9. **Third-party headers** kept, with a `Modified by` line on a changed file.

Run `scripts/check.sh`, and the native builds and tests when the task asks.

## The result

Findings, the most severe first. For each: `file:line`, what is wrong, a concrete case where it fails, and how sure
(sure / likely). No style remarks a rule doesn't back. Say what to change, don't change it. "No findings" is a valid
result.
