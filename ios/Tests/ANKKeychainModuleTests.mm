#import <XCTest/XCTest.h>

#import "ANKAuthenticator.h"
#import "ANKDevice.h"
#import "ANKError.h"
#import "ANKKeychainModule.h"
#import "ANKTestBiometry.h"
#import "ANKTestPromise.h"

// The module as JavaScript sees it: the arguments of the contract in, its answers out. The asynchronous methods run
// where they are called, as React Native calls them on the module's queue.

@interface ANKKeychainModuleTests : XCTestCase
@end

@implementation ANKKeychainModuleTests {
    ANKKeychainModule *_module;
    NSDictionary *_store;
}

+ (void)setUp {
    ANKEnrollBiometryOnSimulator();
}

- (void)setUp {
    _module = [[ANKKeychainModule alloc] init];
    _store = @{@"service" : [@"dev.apexnative.keychain.tests." stringByAppendingString:NSUUID.UUID.UUIDString]};
}

- (void)tearDown {
    JS::NativeApexKeychain::Store store(_store);
    ANKPromise *promise = [ANKPromise new];
    [_module clear:store resolve:promise.resolve reject:promise.reject];
    ANKDevice.testBiometryState = nil;
    ANKDevice.testInfoDictionary = nil;
    [ANKAuthenticator.shared forgetAllContexts];
}

// Stops the test when the device can't do the access control now (the simulator without Face ID enrolled).
- (void)requireAccessControl:(NSString *)name {
    ANKAccessControl accessControl;
    XCTAssertTrue(ANKAccessControlOfName(name, &accessControl));
    NSError *unavailable = [ANKDevice errorForWritingAccessControl:accessControl];
    if (unavailable != nil) ANKCantRun(unavailable.localizedDescription);
}

// The options JavaScript sends: complete, with its defaults.
static NSDictionary *ANKOptions(NSDictionary *changes = @{}) {
    NSMutableDictionary *options = [@{
        @"accessible" : @"afterFirstUnlock",
        @"accessControl" : @"none",
        @"authValidity" : @0,
        @"synchronizable" : @NO,
        @"keyStorage" : @"tee",
    } mutableCopy];
    [options addEntriesFromDictionary:changes];
    return options;
}

- (ANKPromise *)setItem:(NSString *)key
                  value:(NSString *)value
               encoding:(NSString *)encoding
                options:(NSDictionary *)options {
    JS::NativeApexKeychain::Store store(_store);
    JS::NativeApexKeychain::WriteOptions writeOptions(options);
    ANKPromise *promise = [ANKPromise new];
    [_module setItem:store
                 key:key
               value:value
            encoding:encoding
             options:writeOptions
             resolve:promise.resolve
              reject:promise.reject];
    return promise;
}

- (void)set:(NSString *)key value:(NSString *)value {
    ANKPromise *promise = [self setItem:key value:value encoding:@"utf8" options:ANKOptions()];
    XCTAssertTrue(promise.resolved, @"%@ %@", promise.code, promise.message);
}

- (ANKPromise *)getItem:(NSString *)key encoding:(NSString *)encoding {
    JS::NativeApexKeychain::Store store(_store);
    JS::NativeApexKeychain::Prompt prompt(@{@"confirmationRequired" : @YES});
    ANKPromise *promise = [ANKPromise new];
    [_module getItem:store key:key encoding:encoding prompt:prompt resolve:promise.resolve reject:promise.reject];
    return promise;
}

#pragma mark - Asynchronous

- (void)testSetAndGetText {
    [self set:@"token" value:@"secret"];

    ANKPromise *promise = [self getItem:@"token" encoding:@"utf8"];
    XCTAssertTrue(promise.resolved);
    XCTAssertEqualObjects(promise.value, @{@"value" : @"secret"});
}

- (void)testSetAndGetBytes {
    ANKPromise *set = [self setItem:@"bytes" value:@"AP/+gA==" encoding:@"base64" options:ANKOptions()];
    XCTAssertTrue(set.resolved, @"%@", set.message);

    XCTAssertEqualObjects([self getItem:@"bytes" encoding:@"base64"].value, @{@"value" : @"AP/+gA=="});
    // Bytes that aren't UTF-8 are no text.
    ANKPromise *text = [self getItem:@"bytes" encoding:@"utf8"];
    XCTAssertFalse(text.resolved);
    XCTAssertEqualObjects(text.code, ANKErrorInvalidArgument);
}

- (void)testTextReadAsBase64IsItsUTF8 {
    [self set:@"text" value:@"é"];
    XCTAssertEqualObjects([self getItem:@"text" encoding:@"base64"].value, @{@"value" : @"w6k="});
}

- (void)testEmptyValues {
    [self set:@"empty" value:@""];
    XCTAssertEqualObjects([self getItem:@"empty" encoding:@"utf8"].value, @{@"value" : @""});
    XCTAssertEqualObjects([self getItem:@"empty" encoding:@"base64"].value, @{@"value" : @""});
}

- (void)testTheLabelComesWithTheValue {
    ANKPromise *set = [self setItem:@"credentials"
                              value:@"password"
                           encoding:@"utf8"
                            options:ANKOptions(@{@"label" : @"user@example.com"})];
    XCTAssertTrue(set.resolved);
    XCTAssertEqualObjects([self getItem:@"credentials" encoding:@"utf8"].value,
                          (@{@"value" : @"password", @"label" : @"user@example.com"}));
}

- (void)testAMissingItemIsNull {
    ANKPromise *promise = [self getItem:@"missing" encoding:@"utf8"];
    XCTAssertTrue(promise.resolved);
    XCTAssertNil(promise.value);

    JS::NativeApexKeychain::Store store(_store);
    ANKPromise *info = [ANKPromise new];
    [_module getItemInfo:store key:@"missing" resolve:info.resolve reject:info.reject];
    XCTAssertTrue(info.resolved);
    XCTAssertNil(info.value);

    ANKPromise *removed = [ANKPromise new];
    [_module removeItem:store key:@"missing" resolve:removed.resolve reject:removed.reject];
    XCTAssertTrue(removed.resolved);
}

- (void)testHasAndRemove {
    JS::NativeApexKeychain::Store store(_store);
    ANKPromise *has = [ANKPromise new];
    [_module hasItem:store key:@"value" resolve:has.resolve reject:has.reject];
    XCTAssertEqualObjects(has.value, @NO);

    [self set:@"value" value:@"value"];
    has = [ANKPromise new];
    [_module hasItem:store key:@"value" resolve:has.resolve reject:has.reject];
    XCTAssertEqualObjects(has.value, @YES);

    ANKPromise *removed = [ANKPromise new];
    [_module removeItem:store key:@"value" resolve:removed.resolve reject:removed.reject];
    XCTAssertTrue(removed.resolved);
    XCTAssertNil([self getItem:@"value" encoding:@"utf8"].value);
}

- (void)testItemInfo {
    NSDate *before = [NSDate dateWithTimeIntervalSinceNow:-1];
    ANKPromise *set = [self setItem:@"value"
                              value:@"value"
                           encoding:@"utf8"
                            options:ANKOptions(@{@"accessible" : @"whenUnlocked", @"label" : @"label"})];
    XCTAssertTrue(set.resolved);

    JS::NativeApexKeychain::Store store(_store);
    ANKPromise *info = [ANKPromise new];
    [_module getItemInfo:store key:@"value" resolve:info.resolve reject:info.reject];
    NSDictionary *value = info.value;
    XCTAssertEqualObjects(value[@"key"], @"value");
    XCTAssertEqualObjects(value[@"label"], @"label");
    XCTAssertEqualObjects(value[@"accessible"], @"whenUnlocked");
    XCTAssertEqualObjects(value[@"accessControl"], @"none");
    XCTAssertEqualObjects(value[@"synchronizable"], @NO);
    XCTAssertNil(value[@"securityLevel"]);
    double createdAt = [value[@"createdAt"] doubleValue];
    XCTAssertGreaterThanOrEqual(createdAt, floor(before.timeIntervalSince1970 * 1000));
    XCTAssertLessThanOrEqual(createdAt, [NSDate date].timeIntervalSince1970 * 1000 + 1000);
    XCTAssertEqual(createdAt, floor(createdAt));
    XCTAssertGreaterThanOrEqual([value[@"modifiedAt"] doubleValue], createdAt);

    // No label: no key.
    [self set:@"value" value:@"value"];
    info = [ANKPromise new];
    [_module getItemInfo:store key:@"value" resolve:info.resolve reject:info.reject];
    XCTAssertNil(info.value[@"label"]);
}

- (void)testAllKeysAndClear {
    for (NSString *key in @[ @"a", @"b" ]) [self set:key value:key];

    JS::NativeApexKeychain::Store store(_store);
    ANKPromise *keys = [ANKPromise new];
    [_module getAllKeys:store resolve:keys.resolve reject:keys.reject];
    XCTAssertEqualObjects([keys.value sortedArrayUsingSelector:@selector(compare:)], (@[ @"a", @"b" ]));

    ANKPromise *cleared = [ANKPromise new];
    [_module clear:store resolve:cleared.resolve reject:cleared.reject];
    XCTAssertTrue(cleared.resolved);
    keys = [ANKPromise new];
    [_module getAllKeys:store resolve:keys.resolve reject:keys.reject];
    XCTAssertEqualObjects(keys.value, @[]);
}

#pragma mark - Synchronous

- (void)testSynchronousMethods {
    JS::NativeApexKeychain::Store store(_store);
    JS::NativeApexKeychain::WriteOptions options(ANKOptions());

    XCTAssertEqualObjects([_module getItemSync:store key:@"value"], @{});
    XCTAssertEqualObjects([_module hasItemSync:store key:@"value"], @{@"value" : @NO});

    XCTAssertEqualObjects([_module setItemSync:store key:@"value" value:@"synchronous" options:options], @{});
    XCTAssertEqualObjects([_module getItemSync:store key:@"value"], @{@"value" : @"synchronous"});
    XCTAssertEqualObjects([_module hasItemSync:store key:@"value"], @{@"value" : @YES});
    XCTAssertEqualObjects([self getItem:@"value" encoding:@"utf8"].value, @{@"value" : @"synchronous"});

    XCTAssertEqualObjects([_module removeItemSync:store key:@"value"], @{});
    XCTAssertEqualObjects([_module getItemSync:store key:@"value"], @{});
    XCTAssertEqualObjects([_module removeItemSync:store key:@"value"], @{});
}

- (void)testSynchronousMethodsReturnTheirErrors {
    JS::NativeApexKeychain::Store store(_store);
    JS::NativeApexKeychain::WriteOptions options(
        ANKOptions(@{@"accessControl" : @"passcode", @"synchronizable" : @YES}));

    NSDictionary *result = [_module setItemSync:store key:@"value" value:@"value" options:options];
    XCTAssertEqualObjects(result[@"error"][@"code"], ANKErrorInvalidArgument);
    XCTAssertNotNil(result[@"error"][@"message"]);

    // Bytes that aren't UTF-8, read as text.
    XCTAssertTrue([self setItem:@"bytes" value:@"/w==" encoding:@"base64" options:ANKOptions()].resolved);
    XCTAssertEqualObjects([_module getItemSync:store key:@"bytes"][@"error"][@"code"], ANKErrorInvalidArgument);

    XCTAssertEqualObjects([_module hasItemSync:store key:@""][@"error"][@"code"], ANKErrorInvalidArgument);
}

- (void)testTheQueueIsSerialAndNotMain {
    dispatch_queue_t queue = _module.methodQueue;
    XCTAssertNotNil(queue);
    XCTAssertTrue(queue != dispatch_get_main_queue());
    XCTAssertTrue(queue == [[ANKKeychainModule alloc] init].methodQueue);

    // A synchronous method called on the queue doesn't wait for itself.
    __block NSDictionary *result;
    dispatch_sync(queue, ^{
      JS::NativeApexKeychain::Store store(self->_store);
      result = [self->_module hasItemSync:store key:@"value"];
    });
    XCTAssertEqualObjects(result, @{@"value" : @NO});
}

#pragma mark - Access control

- (void)testAProtectedItemIsNeverReadWithoutAPrompt {
    [self requireAccessControl:@"biometryAny"];
    ANKPromise *set = [self setItem:@"secret"
                              value:@"locked"
                           encoding:@"utf8"
                            options:ANKOptions(@{@"accessControl" : @"biometryAny", @"label" : @"user"})];
    XCTAssertTrue(set.resolved, @"%@", set.message);

    // On a device even its attributes need the user: whatever can't prompt answers AUTH_REQUIRED or leaves it out,
    // and only whether it's there is known.
    JS::NativeApexKeychain::Store store(_store);
    XCTAssertEqualObjects([_module getItemSync:store key:@"secret"][@"error"][@"code"], ANKErrorAuthRequired);
    XCTAssertEqualObjects([_module hasItemSync:store key:@"secret"], @{@"value" : @YES});
    ANKPromise *info = [ANKPromise new];
    [_module getItemInfo:store key:@"secret" resolve:info.resolve reject:info.reject];
    XCTAssertEqualObjects(info.code, ANKErrorAuthRequired, @"%@", info.value);
    [self set:@"open" value:@"open"];
    ANKPromise *keys = [ANKPromise new];
    [_module getAllKeys:store resolve:keys.resolve reject:keys.reject];
    XCTAssertEqualObjects(keys.value, @[ @"open" ]);
    // A write over it shows no prompt either.
    JS::NativeApexKeychain::WriteOptions open(ANKOptions());
    XCTAssertEqualObjects([_module setItemSync:store key:@"secret" value:@"open" options:open], @{});
    XCTAssertEqualObjects([_module getItemSync:store key:@"secret"], @{@"value" : @"open"});
}

// A state injected: the simulator gives every enrollment the same one, so a new face can't be shown there.
// ANKAuthenticationTests removes Face ID itself.
- (void)testABiometryChangeInvalidatesACurrentSetItem {
    [self requireAccessControl:@"biometryCurrentSet"];
    ANKDevice.testBiometryState = [@"enrolled" dataUsingEncoding:NSUTF8StringEncoding];
    ANKPromise *set = [self setItem:@"bound"
                              value:@"secret"
                           encoding:@"utf8"
                            options:ANKOptions(@{@"accessControl" : @"biometryCurrentSet"})];
    XCTAssertTrue(set.resolved, @"%@", set.message);

    ANKDevice.testBiometryState = [@"re-enrolled" dataUsingEncoding:NSUTF8StringEncoding];
    ANKPromise *read = [self getItem:@"bound" encoding:@"utf8"];
    XCTAssertEqualObjects(read.code, ANKErrorKeyInvalidated, @"%@", read.message);

    JS::NativeApexKeychain::Store store(_store);
    XCTAssertEqualObjects([_module hasItemSync:store key:@"bound"], @{@"value" : @NO});
}

- (void)testNoBiometryLeftInvalidatesACurrentSetItem {
    [self requireAccessControl:@"biometryCurrentSetOrPasscode"];
    ANKDevice.testBiometryState = [@"enrolled" dataUsingEncoding:NSUTF8StringEncoding];
    XCTAssertTrue([self setItem:@"bound"
                          value:@"secret"
                       encoding:@"utf8"
                        options:ANKOptions(@{@"accessControl" : @"biometryCurrentSetOrPasscode"})]
                      .resolved);

    ANKDevice.testBiometryState = NSNull.null;
    XCTAssertEqualObjects([self getItem:@"bound" encoding:@"utf8"].code, ANKErrorKeyInvalidated);
}

- (void)testAMissingUsageDescriptionStopsAPrompt {
    [self requireAccessControl:@"biometryAny"];
    XCTAssertTrue([self setItem:@"secret"
                          value:@"locked"
                       encoding:@"utf8"
                        options:ANKOptions(@{@"accessControl" : @"biometryAny"})]
                      .resolved);
    if (![ANKDevice.biometryTypes containsObject:@"faceID"]) ANKCantRun(@"No Face ID on this device.");

    ANKDevice.testInfoDictionary = @{};
    XCTAssertEqualObjects([self getItem:@"secret" encoding:@"utf8"].code, ANKErrorMissingUsageDescription);
}

#pragma mark - The device

- (void)testTheDevice {
    // The simulator of scripts/test-ios.sh: Face ID enrolled, and it acts as if a passcode is set.
    if (!ANKSetBiometryEnrolledOnSimulator(YES)) ANKCantRun(@"The test needs the simulator with Face ID enrolled.");
    ANKPromise *types = [ANKPromise new];
    [_module getBiometryTypes:types.resolve reject:types.reject];
    XCTAssertEqualObjects(types.value, @[ @"faceID" ]);

    ANKPromise *passcode = [ANKPromise new];
    [_module isPasscodeSet:passcode.resolve reject:passcode.reject];
    XCTAssertEqualObjects(passcode.value, @YES);

    ANKPromise *level = [ANKPromise new];
    [_module getHardwareSecurityLevel:level.resolve reject:level.reject];
    XCTAssertTrue(level.resolved);
    XCTAssertNil(level.value);
}

- (void)testCanUseAccessControl {
    // Face ID enrolled and a passcode: every access control. testCurrentSetNeedsEnrolledBiometry has the simulator
    // without Face ID.
    if (!ANKSetBiometryEnrolledOnSimulator(YES)) ANKCantRun(@"The test needs the simulator with Face ID enrolled.");
    for (NSString *name in @[
             @"none", @"biometryAny", @"biometryCurrentSet", @"biometryAnyOrPasscode", @"biometryCurrentSetOrPasscode",
             @"passcode"
         ]) {
        ANKPromise *promise = [ANKPromise new];
        [_module canUseAccessControl:name resolve:promise.resolve reject:promise.reject];
        XCTAssertEqualObjects(promise.value, @{@"available" : @YES}, @"%@: %@", name, promise.message);
    }
    ANKPromise *unknown = [ANKPromise new];
    [_module canUseAccessControl:@"faceID" resolve:unknown.resolve reject:unknown.reject];
    XCTAssertEqualObjects(unknown.code, ANKErrorInvalidArgument);
}

- (void)testCanUseAccessControlRejectsWithoutTheUsageDescription {
    if (![ANKDevice.biometryTypes containsObject:@"faceID"]) ANKCantRun(@"No Face ID on this device.");
    ANKDevice.testInfoDictionary = @{};
    ANKPromise *biometry = [ANKPromise new];
    [_module canUseAccessControl:@"biometryAnyOrPasscode" resolve:biometry.resolve reject:biometry.reject];
    XCTAssertEqualObjects(biometry.code, ANKErrorMissingUsageDescription);
    ANKPromise *passcode = [ANKPromise new];
    [_module canUseAccessControl:@"passcode" resolve:passcode.resolve reject:passcode.reject];
    XCTAssertTrue(passcode.resolved);
}

- (void)testCurrentSetNeedsEnrolledBiometry {
    if (!ANKSetBiometryEnrolledOnSimulator(NO)) {
        ANKCantRun(@"Face ID can't be removed here (a device, or no simulator).");
    }
    [self addTeardownBlock:^{
      XCTAssertTrue(ANKSetBiometryEnrolledOnSimulator(YES));
    }];

    NSDictionary *expected = @{
        @"biometryAny" : @{@"available" : @NO, @"reason" : @"notEnrolled"},
        @"biometryCurrentSet" : @{@"available" : @NO, @"reason" : @"notEnrolled"},
        @"biometryCurrentSetOrPasscode" : @{@"available" : @NO, @"reason" : @"notEnrolled"},
        @"biometryAnyOrPasscode" : @{@"available" : @YES},
        @"passcode" : @{@"available" : @YES},
    };
    [expected enumerateKeysAndObjectsUsingBlock:^(NSString *name, NSDictionary *availability, BOOL *stop) {
      ANKPromise *promise = [ANKPromise new];
      [self->_module canUseAccessControl:name resolve:promise.resolve reject:promise.reject];
      XCTAssertEqualObjects(promise.value, availability, @"%@", name);
    }];
    for (NSString *accessControl in @[ @"biometryCurrentSet", @"biometryCurrentSetOrPasscode" ]) {
        ANKPromise *set = [self setItem:@"bound"
                                  value:@"secret"
                               encoding:@"utf8"
                                options:ANKOptions(@{@"accessControl" : accessControl})];
        XCTAssertEqualObjects(set.code, ANKErrorBiometryNotEnrolled, @"%@", accessControl);
    }
    XCTAssertTrue([self setItem:@"open"
                          value:@"secret"
                       encoding:@"utf8"
                        options:ANKOptions(@{@"accessControl" : @"biometryAnyOrPasscode"})]
                      .resolved);
}

- (void)testTheBiometryStateIsAnOpaqueToken {
    ANKDevice.testBiometryState = [NSData dataWithBytes:"\x01\x02\x03" length:3];
    ANKPromise *state = [ANKPromise new];
    [_module getBiometryState:state.resolve reject:state.reject];
    XCTAssertEqualObjects(state.value, @"AQID");

    ANKDevice.testBiometryState = NSNull.null;
    state = [ANKPromise new];
    [_module getBiometryState:state.resolve reject:state.reject];
    XCTAssertTrue(state.resolved);
    XCTAssertNil(state.value);
}

#pragma mark - Arguments

- (void)testForbiddenCombinationsAreInvalidArguments {
    NSArray<NSDictionary *> *options = @[
        ANKOptions(@{@"authValidity" : @5}),
        ANKOptions(@{@"accessControl" : @"biometryCurrentSet", @"authValidity" : @5}),
        ANKOptions(@{@"accessControl" : @"biometryCurrentSetOrPasscode", @"authValidity" : @5}),
        ANKOptions(@{@"accessControl" : @"biometryAny", @"synchronizable" : @YES}),
        ANKOptions(@{@"accessible" : @"afterFirstUnlockThisDeviceOnly", @"synchronizable" : @YES}),
    ];
    for (NSDictionary *option in options) {
        ANKPromise *promise = [self setItem:@"value" value:@"value" encoding:@"utf8" options:option];
        XCTAssertEqualObjects(promise.code, ANKErrorInvalidArgument, @"%@", option);
    }
    XCTAssertNil([self getItem:@"value" encoding:@"utf8"].value);
}

- (void)testUnknownNamesAreInvalidArguments {
    NSArray<NSDictionary *> *options = @[
        ANKOptions(@{@"accessible" : @"always"}),
        ANKOptions(@{@"accessControl" : @"faceID"}),
        ANKOptions(@{@"keyStorage" : @"secureEnclave"}),
        ANKOptions(@{@"authValidity" : @(-1)}),
        ANKOptions(@{@"authValidity" : @(1.5)}),
    ];
    for (NSDictionary *option in options) {
        ANKPromise *promise = [self setItem:@"value" value:@"value" encoding:@"utf8" options:option];
        XCTAssertEqualObjects(promise.code, ANKErrorInvalidArgument, @"%@", option);
    }
    XCTAssertEqualObjects([self setItem:@"value" value:@"value" encoding:@"hex" options:ANKOptions()].code,
                          ANKErrorInvalidArgument);
    XCTAssertEqualObjects([self setItem:@"value" value:@"not base64" encoding:@"base64" options:ANKOptions()].code,
                          ANKErrorInvalidArgument);
    XCTAssertEqualObjects([self getItem:@"value" encoding:@"hex"].code, ANKErrorInvalidArgument);
}

- (void)testEmptyKeysAndServicesAreInvalidArguments {
    XCTAssertEqualObjects([self setItem:@"" value:@"value" encoding:@"utf8" options:ANKOptions()].code,
                          ANKErrorInvalidArgument);
    NSString *nul = [NSString stringWithFormat:@"a%Cb", (unichar)0];
    XCTAssertEqualObjects([self setItem:nul value:@"value" encoding:@"utf8" options:ANKOptions()].code,
                          ANKErrorInvalidArgument);

    JS::NativeApexKeychain::Store store(@{@"service" : @""});
    ANKPromise *promise = [ANKPromise new];
    [_module getAllKeys:store resolve:promise.resolve reject:promise.reject];
    XCTAssertEqualObjects(promise.code, ANKErrorInvalidArgument);
}

- (void)testAKeychainErrorRejectsWithItsStatus {
    NSMutableDictionary *store = [_store mutableCopy];
    store[@"accessGroup"] = @"ABCDE12345.dev.apexnative.not-entitled";
    _store = store;

    ANKPromise *promise = [self setItem:@"value" value:@"value" encoding:@"utf8" options:ANKOptions()];
    XCTAssertEqualObjects(promise.code, ANKErrorMissingEntitlement, @"%@", promise.message);
    XCTAssertEqualObjects(promise.error.userInfo[@"nativeCode"], @(errSecMissingEntitlement));
    XCTAssertEqualObjects(promise.error.userInfo[@"nativeDomain"], NSOSStatusErrorDomain);
}

@end
