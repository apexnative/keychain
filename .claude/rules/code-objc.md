---
paths:
  - 'ios/**/*.{h,m,mm}'
  - 'example/ios/**/*.{h,m,mm,swift}'
---

# Objective-C++

No formatter runs on these files; keep the style by hand. It is clang-format's LLVM style with 4 spaces and 120
columns.

## Format

- 4 spaces, no tabs. Lines up to 120 columns. Braces on the same line: `- (void)foo {`, `} else {`. `Type *name`,
  `(NSString *)`.
- `@property (nonatomic, strong)`, with a space after `@property`; attributes in the order `class`, `nonatomic`,
  `readonly`, ownership (`strong`, `copy`), `nullable`. No `retain`. `atomic` only for state read from any thread.
- A block's body is indented 2 from the line with `^{`. Multi-line selectors align their colons.
- A final newline, no trailing whitespace.

## Names

- Every class, enum, C function and constant starts with `ANK`: `ANKKeychainStore`, `ANKErrorCode`,
  `static BOOL ANKInvalidArgument(…)`.
- One class per `.h`/`.mm` pair, named after it; `.mm`, not `.m`. Tests: `ios/Tests/ANK<Class>Tests.mm`.
- No `get` prefix.

## Files

- `#import`, no include guards. The class's own header first, then the project's headers by bare name, then
  `<React/…>`, the system frameworks. A new file is picked up by the podspec's globs; run `scripts/pods.sh`.
- A header wraps its declarations in `NS_ASSUME_NONNULL_BEGIN` / `NS_ASSUME_NONNULL_END` and marks `nullable` what
  may be nil.
- Private state in the class extension or in `@implementation X { … }`, never in the header.
- Sections: `#pragma mark - <Topic>`.

## Threads

- Every Keychain call runs on the module's serial queue (`methodQueue` in `ANKKeychainModule.mm`): React Native calls
  the asynchronous methods on it, and a synchronous method runs its Keychain calls on it (`onQueue:`), so calls keep
  the order JavaScript made them in.
- That queue never waits for a person. A prompt is shown by `ANKAuthenticator`, one at a time, on a queue of its own;
  the read then goes back to the module's queue with the authenticated `LAContext`.
- In a block that may outlive its object: `__weak ANKFoo *weakSelf = self;` and a strong local inside it. A singleton
  (`ANKAuthenticator.shared`) may take `self`.
- Newer OS features: `if (@available(iOS 18.0, *))`, and `API_AVAILABLE(ios(18.0))` on methods called only inside
  such a check. Nothing at or below the deployment target (15.1) needs a check. What the simulator lacks goes under
  `#if TARGET_OS_SIMULATOR`, with a comment that says what a device does instead.

## Comments

- `//` above the code, in full sentences, saying why rather than what; backticks for option names. Header docs with
  `///`.
- No file headers of our own. A third-party file keeps its header; a change adds `//  Modified by <Name>, <year>.`
  below the copyright line.

## Errors and logs

- A call fails with an `NSError` of `ANKError` (`ios/ANKError.h`): a code of `KeychainErrorCode`, an English message,
  and the `OSStatus` or `LAError` with its domain as `nativeCode` and `nativeDomain`. `+reject:error:` sends it to
  JavaScript; a synchronous method returns it as `{ error }` (`+failureWithError:`), never throws.
- A missing item is no error: `errSecItemNotFound` reads as `nil`, and a delete of nothing succeeds.
- Logs: `RCTLogWarn(@"[ApexKeychain] …")`, never `NSLog`, and never a value or a key.

## Swift

- None in the library. The example's `AppDelegate.swift` uses 2 spaces.

## Pitfalls

Each of these was a bug once, or cost a test session a day.

- **`hasPrefix:` with U+0000.** For a short string the Keychain returns a tagged pointer `NSString`, whose
  `hasPrefix:@"token\0"` is YES for `"token"` itself: the store's temporary keys (`<key>\0…`) then match the key's own
  item. Search with `rangeOfString:options:NSAnchoredSearch | NSLiteralSearch` (`ANKKeychainStore.mm`,
  `deleteTemporariesOfKey:`).
- **The simulator's Keychain enforces no access control.** A silent read, update or delete of a protected item
  succeeds there. Whether a read needs a prompt comes from the item's own metadata, never from an `OSStatus`; only a
  device proves the Keychain refuses.
- **`evaluateAccessControl` isn't on the simulator** (LAError -1020): the simulator evaluates the policy of the item's
  flags instead (`#if TARGET_OS_SIMULATOR` in `ANKAuthenticator.mm`).
- **The biometry state.** `domainState.biometry.stateHash` is nil on iOS 18 (the simulator, at least); the package
  falls back to `evaluatedPolicyDomainState` (`ANKDevice.mm`). On the simulator the hash never changes with a new
  enrollment: `KEY_INVALIDATED` is tested with an injected state, and on a device.
- **An invalidated `LAContext`** makes a protected read fail with `errSecAuthFailed`: the module shows a new prompt
  instead of answering `AUTH_FAILED`.
- **The app leaving during a prompt** ends it with `SYSTEM_CANCELED` (-4); leaving the instant the first prompt is
  asked for once gave LocalAuthentication's private error 6 (`UNKNOWN`).
- **Tests can't tap the prompt.** `XCUIApplication` is refused in a unit-test bundle: cancel, fallback, `AUTH_FAILED`
  and `LOCKOUT` stay manual. The tests enroll Face ID and show it faces with `notify_post`
  (`ios/Tests/ANKTestBiometry.h`), and `scripts/test-ios.sh` grants the test host Face ID in the simulator's TCC
  database, as iOS 18 asks with an alert nothing can tap.

## Models

Read the closest one before writing.

- A store over the Keychain with its queries and errors: `ios/ANKKeychainStore.{h,mm}`.
- LocalAuthentication, the prompt queue and availability checks: `ios/ANKAuthenticator.{h,mm}`, `ios/ANKDevice.mm`.
- A test with a prompt: `ios/Tests/ANKAuthenticationTests.mm`.
