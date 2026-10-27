#import <XCTest/XCTest.h>

#import <LocalAuthentication/LocalAuthentication.h>
#import <UIKit/UIKit.h>

#import "ANKAuthenticator.h"
#import "ANKDevice.h"
#import "ANKError.h"
#import "ANKKeychainModule.h"
#import "ANKKeychainStore.h"
#import "ANKTestBiometry.h"
#import "ANKTestPromise.h"

// Protected reads through the module, as JavaScript makes them, against the simulator's own prompts: Face ID is
// enrolled, a test shows it a face (ANKShowFace) and sees which prompts LocalAuthentication was asked for
// (ANKPrompts). A read that waits until a face matches had a prompt; one that settles without a face had none.
//
// What the simulator can't do is on the device checklist: a test can't tap its prompt's Cancel or fallback button
// (XCUIApplication is refused in a unit-test bundle), a face that doesn't match leaves the prompt waiting for a tap
// instead of failing with AUTH_FAILED, and its Face ID never locks out. Its Keychain doesn't enforce access control
// either: the prompt evaluates the policy of the item's flags (ANKAuthenticator).

// The reason a prompt gives when the read gives none (ANKAuthenticator).
static NSString *const ANKDefaultReason = @"Authenticate to unlock the saved data.";

// The options JavaScript sends: complete, with its defaults.
static NSDictionary *ANKOptions(NSDictionary *changes) {
    NSMutableDictionary *options = [@{
        @"accessible" : @"whenUnlockedThisDeviceOnly",
        @"accessControl" : @"none",
        @"authValidity" : @0,
        @"synchronizable" : @NO,
        @"keyStorage" : @"tee",
    } mutableCopy];
    [options addEntriesFromDictionary:changes];
    return options;
}

@interface ANKAuthenticationTests : XCTestCase
@end

@implementation ANKAuthenticationTests {
    ANKKeychainModule *_module;
    NSDictionary *_store;
}

+ (void)setUp {
    ANKEnrollBiometryOnSimulator();
}

- (void)setUp {
    // A step that fails would leave the next ones waiting for a prompt.
    self.continueAfterFailure = NO;
    if (!ANKSetBiometryEnrolledOnSimulator(YES)) ANKCantRun(@"The tests show faces to the simulator's Face ID.");
    _module = [[ANKKeychainModule alloc] init];
    _store = @{@"service" : [@"dev.apexnative.keychain.tests." stringByAppendingString:NSUUID.UUID.UUIDString]};
    ANKResetPrompts();
}

- (void)tearDown {
    // A prompt a failed test left open would hold up the next test's.
    ANKResetPrompts();
    [ANKAuthenticator.shared forgetAllContexts];
    if (_store == nil) return;
    JS::NativeApexKeychain::Store store(_store);
    ANKPromise *cleared = [ANKPromise new];
    [_module clear:store resolve:cleared.resolve reject:cleared.reject];
}

- (void)set:(NSString *)key value:(NSString *)value options:(NSDictionary *)changes {
    JS::NativeApexKeychain::Store store(_store);
    JS::NativeApexKeychain::WriteOptions options(ANKOptions(changes));
    ANKPromise *promise = [ANKPromise new];
    [_module setItem:store
                 key:key
               value:value
            encoding:@"utf8"
             options:options
             resolve:promise.resolve
              reject:promise.reject];
    XCTAssertTrue(promise.resolved, @"%@: %@ %@", key, promise.code, promise.message);
}

// getItem as React Native calls it, on the module's queue. The promise settles later.
- (ANKPromise *)read:(NSString *)key prompt:(NSDictionary *)texts {
    NSMutableDictionary *prompt = [@{@"confirmationRequired" : @YES} mutableCopy];
    [prompt addEntriesFromDictionary:texts];
    NSDictionary *storeValue = _store;
    ANKKeychainModule *module = _module;
    ANKPromise *promise = [ANKPromise new];
    dispatch_async(_module.methodQueue, ^{
      JS::NativeApexKeychain::Store store(storeValue);
      JS::NativeApexKeychain::Prompt options(prompt);
      [module getItem:store key:key encoding:@"utf8" prompt:options resolve:promise.resolve reject:promise.reject];
    });
    return promise;
}

- (ANKPromise *)read:(NSString *)key {
    return [self read:key prompt:@{}];
}

// Waits for the read to settle, or fails the test.
- (void)waitFor:(ANKPromise *)promise {
    XCTAssertTrue(ANKWaitUntil(5,
                               ^BOOL {
                                 return promise.settled;
                               }),
                  @"The read didn't settle.");
}

// The read waits for the user: it hasn't settled a second later.
- (void)assertWaiting:(ANKPromise *)promise {
    XCTAssertFalse(ANKWaitUntil(1,
                                ^BOOL {
                                  return promise.settled;
                                }),
                   @"%@ %@ %@", promise.value, promise.code, promise.message);
}

// The test's prompt of the number, from 1, once LocalAuthentication was asked for it.
- (ANKTestPrompt *)prompt:(NSUInteger)number {
    ANKWaitUntil(5, ^BOOL {
      return ANKPrompts().count >= number;
    });
    NSArray<ANKTestPrompt *> *prompts = ANKPrompts();
    XCTAssertGreaterThanOrEqual(prompts.count, number, @"No prompt %lu.", (unsigned long)number);
    return prompts[number - 1];
}

// Shows the prompt a face that matches, or fails the test.
- (void)match:(ANKTestPrompt *)prompt {
    XCTAssertTrue(ANKShowFace(prompt, YES, 10), @"The prompt didn't end with a matching face.");
    XCTAssertNil(prompt.error);
}

- (NSString *)biometryState {
    ANKPromise *state = [ANKPromise new];
    [_module getBiometryState:state.resolve reject:state.reject];
    XCTAssertTrue(state.resolved);
    return state.value;
}

- (NSNumber *)has:(NSString *)key {
    JS::NativeApexKeychain::Store store(_store);
    return [_module hasItemSync:store key:key][@"value"];
}

// The context the authenticator keeps for the item: what a read of it gets inside its authValidity window.
- (LAContext *)cachedContextOf:(NSString *)key {
    ANKKeychainStore *keychain = [[ANKKeychainStore alloc] initWithService:_store[@"service"] accessGroup:nil];
    ANKItem *item = [keychain attributesForKey:key error:NULL];
    __block LAContext *context = nil;
    __block BOOL answered = NO;
    __block BOOL wasCached = NO;
    [ANKAuthenticator.shared authenticateItem:item
                                      service:keychain.service
                                       prompt:[[ANKPrompt alloc] initWithTitle:nil cancel:nil fallback:nil]
                                   completion:^(LAContext *authenticated, BOOL cached, NSError *error) {
                                     context = authenticated;
                                     wasCached = cached;
                                     answered = YES;
                                   }];
    XCTAssertTrue(ANKWaitUntil(5,
                               ^BOOL {
                                 return answered;
                               }),
                  @"The item's context wasn't cached: a prompt was asked for.");
    XCTAssertTrue(wasCached);
    return context;
}

#pragma mark - A prompt

- (void)testAReadWaitsForAFaceThatMatches {
    [self set:@"token" value:@"secret" options:@{@"accessControl" : @"biometryAny", @"label" : @"user"}];

    ANKPromise *read = [self read:@"token"
                           prompt:@{@"title" : @"Unlock the token", @"cancel" : @"Not now", @"fallback" : @"Password"}];
    ANKTestPrompt *prompt = [self prompt:1];
    XCTAssertEqual(prompt.policy, LAPolicyDeviceOwnerAuthenticationWithBiometrics);
    XCTAssertEqualObjects(prompt.reason, @"Unlock the token");
    XCTAssertEqualObjects(prompt.cancelTitle, @"Not now");
    XCTAssertEqualObjects(prompt.fallbackTitle, @"Password");
    [self assertWaiting:read];

    [self match:prompt];
    [self waitFor:read];
    XCTAssertEqualObjects(read.value, (@{@"value" : @"secret", @"label" : @"user"}), @"%@", read.message);
    XCTAssertEqual(ANKPrompts().count, 1u);
}

- (void)testEveryAccessControlPromptsWithItsPolicy {
    // Biometry alone, or biometry or the passcode. On the simulator a face opens a 'passcode' item too: it has no
    // evaluateAccessControl, which on a device asks for the passcode alone.
    NSDictionary<NSString *, NSNumber *> *policies = @{
        @"biometryAny" : @(LAPolicyDeviceOwnerAuthenticationWithBiometrics),
        @"biometryCurrentSet" : @(LAPolicyDeviceOwnerAuthenticationWithBiometrics),
        @"biometryAnyOrPasscode" : @(LAPolicyDeviceOwnerAuthentication),
        @"biometryCurrentSetOrPasscode" : @(LAPolicyDeviceOwnerAuthentication),
        @"passcode" : @(LAPolicyDeviceOwnerAuthentication),
    };
    NSArray<NSString *> *names = [policies.allKeys sortedArrayUsingSelector:@selector(compare:)];
    for (NSUInteger index = 0; index < names.count; index++) {
        NSString *name = names[index];
        [self set:name value:name options:@{@"accessControl" : name}];

        ANKPromise *read = [self read:name];
        ANKTestPrompt *prompt = [self prompt:index + 1];
        XCTAssertEqual(prompt.policy, policies[name].integerValue, @"%@", name);
        XCTAssertEqualObjects(prompt.reason, ANKDefaultReason, @"%@", name);
        XCTAssertNil(prompt.cancelTitle, @"%@", name);
        XCTAssertNil(prompt.fallbackTitle, @"%@", name);
        [self assertWaiting:read];
        [self match:prompt];
        [self waitFor:read];
        XCTAssertEqualObjects(read.value, @{@"value" : name}, @"%@: %@", name, read.message);
    }
    XCTAssertEqual(ANKPrompts().count, names.count);
}

- (void)testAFaceThatDoesntMatchLeavesTheItemLocked {
    [self set:@"token" value:@"secret" options:@{@"accessControl" : @"biometryAny"}];
    ANKPromise *read = [self read:@"token"];
    ANKTestPrompt *prompt = [self prompt:1];

    // The simulator's prompt says "Face Not Recognized" and waits for a tap: it doesn't end with AUTH_FAILED here.
    XCTAssertFalse(ANKShowFace(prompt, NO, 3));
    XCTAssertFalse(read.settled, @"%@ %@ %@", read.value, read.code, read.message);
    XCTAssertEqualObjects([self has:@"token"], @YES);

    [self match:prompt];
    [self waitFor:read];
    XCTAssertEqualObjects(read.value, @{@"value" : @"secret"}, @"%@", read.message);
    XCTAssertEqual(ANKPrompts().count, 1u);
}

- (void)testTheModulesQueueDoesntWaitForAPrompt {
    [self set:@"locked" value:@"secret" options:@{@"accessControl" : @"biometryAny"}];
    [self set:@"open" value:@"value" options:@{}];
    ANKPromise *locked = [self read:@"locked"];
    ANKTestPrompt *prompt = [self prompt:1];

    // The calls after it on the queue answer while its prompt is open.
    ANKPromise *open = [self read:@"open"];
    [self waitFor:open];
    XCTAssertEqualObjects(open.value, @{@"value" : @"value"});
    JS::NativeApexKeychain::Store store(_store);
    XCTAssertEqualObjects([_module getItemSync:store key:@"locked"][@"error"][@"code"], ANKErrorAuthRequired);
    XCTAssertEqualObjects([self has:@"locked"], @YES);
    XCTAssertFalse(locked.settled);

    [self match:prompt];
    [self waitFor:locked];
    XCTAssertEqualObjects(locked.value, @{@"value" : @"secret"}, @"%@", locked.message);
}

#pragma mark - One prompt at a time

- (void)testReadsAtOnceGetAPromptEachInTheOrderAsked {
    [self set:@"first" value:@"1" options:@{@"accessControl" : @"biometryAny"}];
    [self set:@"second" value:@"2" options:@{@"accessControl" : @"biometryAny"}];
    ANKPromise *first = [self read:@"first"];
    ANKPromise *second = [self read:@"second"];

    // The second read waits for the first one's prompt to end.
    ANKTestPrompt *prompt = [self prompt:1];
    [self assertWaiting:first];
    XCTAssertEqual(ANKPrompts().count, 1u);
    XCTAssertFalse(second.settled);

    // The face ends the first read's prompt; the second read has one of its own.
    [self match:prompt];
    [self waitFor:first];
    XCTAssertEqualObjects(first.value, @{@"value" : @"1"}, @"%@", first.message);
    ANKTestPrompt *next = [self prompt:2];
    [self assertWaiting:second];

    [self match:next];
    [self waitFor:second];
    XCTAssertEqualObjects(second.value, @{@"value" : @"2"}, @"%@", second.message);
    XCTAssertEqual(ANKPrompts().count, 2u);
}

- (void)testReadsAtOnceShareAPromptInsideAuthValidity {
    NSDictionary *options = @{@"accessControl" : @"biometryAny", @"authValidity" : @30};
    [self set:@"first" value:@"1" options:options];
    [self set:@"second" value:@"2" options:options];
    ANKPromise *first = [self read:@"first"];
    ANKPromise *second = [self read:@"second"];

    [self match:[self prompt:1]];
    [self waitFor:first];
    [self waitFor:second];
    XCTAssertEqualObjects(first.value, @{@"value" : @"1"}, @"%@", first.message);
    XCTAssertEqualObjects(second.value, @{@"value" : @"2"}, @"%@", second.message);
    XCTAssertEqual(ANKPrompts().count, 1u);
}

#pragma mark - authValidity

- (void)testAuthValidityOpensTheItemsWithoutAPromptForItsWindow {
    NSDictionary *options = @{@"accessControl" : @"biometryAny", @"authValidity" : @3};
    [self set:@"token" value:@"secret" options:options];
    [self set:@"other" value:@"other" options:options];
    [self set:@"strict" value:@"strict" options:@{@"accessControl" : @"biometryAny"}];
    ANKPromise *read = [self read:@"token"];
    [self match:[self prompt:1]];
    [self waitFor:read];
    NSDate *authenticated = NSDate.date;

    // Inside the window: no prompt, for the item and for another of the store with its access control.
    for (NSString *key in @[ @"token", @"other" ]) {
        ANKPromise *again = [self read:key];
        [self waitFor:again];
        XCTAssertEqualObjects(again.value[@"value"], [key isEqualToString:@"token"] ? @"secret" : @"other", @"%@", key);
    }
    XCTAssertEqual(ANKPrompts().count, 1u);
    XCTAssertLessThan(-authenticated.timeIntervalSinceNow, 3, @"The reads took the whole window.");
    // An item without authValidity has a prompt every time.
    ANKPromise *strict = [self read:@"strict"];
    [self match:[self prompt:2]];
    [self waitFor:strict];
    XCTAssertEqualObjects(strict.value, @{@"value" : @"strict"}, @"%@", strict.message);

    // After the window: a prompt again.
    ANKWaitUntil(4, ^BOOL {
      return -authenticated.timeIntervalSinceNow > 3.5;
    });
    ANKPromise *late = [self read:@"token"];
    ANKTestPrompt *prompt = [self prompt:3];
    [self assertWaiting:late];
    [self match:prompt];
    [self waitFor:late];
    XCTAssertEqualObjects(late.value, @{@"value" : @"secret"}, @"%@", late.message);
}

- (void)testGoingToTheBackgroundClosesTheWindow {
    [self set:@"token" value:@"secret" options:@{@"accessControl" : @"biometryAny", @"authValidity" : @300}];
    ANKPromise *read = [self read:@"token"];
    [self match:[self prompt:1]];
    [self waitFor:read];
    ANKPromise *cached = [self read:@"token"];
    [self waitFor:cached];
    XCTAssertEqualObjects(cached.value, @{@"value" : @"secret"}, @"%@", cached.message);
    XCTAssertEqual(ANKPrompts().count, 1u);

    if (!ANKTripToTheBackground()) ANKCantRun(@"The app didn't go to the background: scripts/test-ios.sh takes it.");
    ANKPromise *after = [self read:@"token"];
    ANKTestPrompt *prompt = [self prompt:2];
    [self assertWaiting:after];
    [self match:prompt];
    [self waitFor:after];
    XCTAssertEqualObjects(after.value, @{@"value" : @"secret"}, @"%@", after.message);
}

- (void)testAPromptTheAppLeavesEndsWithSystemCanceled {
    [self set:@"token" value:@"secret" options:@{@"accessControl" : @"biometryAny"}];
    ANKPromise *read = [self read:@"token"];
    [self prompt:1];
    // The prompt on screen, with the app inactive under it, for a moment.
    XCTAssertTrue(ANKWaitUntil(5, ^BOOL {
      return UIApplication.sharedApplication.applicationState == UIApplicationStateInactive;
    }));
    [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:1]];

    if (!ANKTripToTheBackground()) ANKCantRun(@"The app didn't go to the background: scripts/test-ios.sh takes it.");
    [self waitFor:read];
    XCTAssertEqualObjects(read.code, ANKErrorSystemCanceled, @"%@", read.message);
    XCTAssertEqualObjects(read.error.userInfo[@"nativeCode"], @(LAErrorSystemCancel));
    XCTAssertEqualObjects(read.error.userInfo[@"nativeDomain"], LAErrorDomain);

    // The item stays, and the next read has a prompt of its own.
    XCTAssertEqualObjects([self has:@"token"], @YES);
    ANKPromise *again = [self read:@"token"];
    [self match:[self prompt:2]];
    [self waitFor:again];
    XCTAssertEqualObjects(again.value, @{@"value" : @"secret"}, @"%@", again.message);
}

- (void)testACachedContextThatNoLongerOpensTheItemGivesWayToAPrompt {
    [self set:@"token" value:@"secret" options:@{@"accessControl" : @"biometryAny", @"authValidity" : @300}];
    ANKPromise *read = [self read:@"token"];
    [self match:[self prompt:1]];
    [self waitFor:read];

    // The context the reads share ends, as LocalAuthentication ends one it no longer keeps (too many contexts in the
    // process, its daemon restarted): the Keychain no longer takes it.
    LAContext *context = [self cachedContextOf:@"token"];
    [context invalidate];
    ANKKeychainStore *keychain = [[ANKKeychainStore alloc] initWithService:_store[@"service"] accessGroup:nil];
    NSError *error = nil;
    XCTAssertNil([keychain itemForKey:@"token" context:context error:&error]);
    XCTAssertEqualObjects([ANKError codeOfError:error], ANKErrorAuthFailed, @"%@", error);

    // The read doesn't fail with it: a prompt takes its place, and the new context the cache's.
    ANKPromise *retried = [self read:@"token"];
    ANKTestPrompt *prompt = [self prompt:2];
    [self assertWaiting:retried];
    [self match:prompt];
    [self waitFor:retried];
    XCTAssertEqualObjects(retried.value, @{@"value" : @"secret"}, @"%@ %@", retried.code, retried.message);
    ANKPromise *cached = [self read:@"token"];
    [self waitFor:cached];
    XCTAssertEqualObjects(cached.value, @{@"value" : @"secret"}, @"%@", cached.message);
    XCTAssertEqual(ANKPrompts().count, 2u);
}

#pragma mark - The enrolled biometry

- (void)testRemovingFaceIDInvalidatesTheItemsBoundToIt {
    [self set:@"bound" value:@"secret" options:@{@"accessControl" : @"biometryCurrentSet"}];
    [self set:@"boundOrPasscode" value:@"secret" options:@{@"accessControl" : @"biometryCurrentSetOrPasscode"}];
    [self set:@"any" value:@"secret" options:@{@"accessControl" : @"biometryAny"}];
    XCTAssertNotNil([self biometryState]);

    XCTAssertTrue(ANKSetBiometryEnrolledOnSimulator(NO));
    [self addTeardownBlock:^{
      XCTAssertTrue(ANKSetBiometryEnrolledOnSimulator(YES));
    }];
    XCTAssertNil([self biometryState]);

    // The items bound to the biometry they were written with go, without a prompt.
    for (NSString *key in @[ @"bound", @"boundOrPasscode" ]) {
        ANKPromise *read = [self read:key];
        [self waitFor:read];
        XCTAssertEqualObjects(read.code, ANKErrorKeyInvalidated, @"%@: %@ %@", key, read.value, read.message);
        XCTAssertEqualObjects([self has:key], @NO, @"%@", key);
    }
    XCTAssertEqual(ANKPrompts().count, 0u);

    // An item for any biometry isn't bound to it: without biometry it can't be opened, and it stays.
    ANKPromise *any = [self read:@"any"];
    [self waitFor:any];
    XCTAssertEqualObjects(any.code, ANKErrorBiometryNotEnrolled, @"%@ %@", any.value, any.message);
    XCTAssertEqual([self prompt:1].error.code, LAErrorBiometryNotEnrolled);
    XCTAssertEqualObjects([self has:@"any"], @YES);

    // Face ID again: the item opens with a face. (The simulator gives every enrollment the same state, so a new face
    // can't be told from the old one here: the device checklist has it.)
    XCTAssertTrue(ANKSetBiometryEnrolledOnSimulator(YES));
    XCTAssertNotNil([self biometryState]);
    ANKPromise *again = [self read:@"any"];
    [self match:[self prompt:2]];
    [self waitFor:again];
    XCTAssertEqualObjects(again.value, @{@"value" : @"secret"}, @"%@", again.message);
}

@end
