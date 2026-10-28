#import <XCTest/XCTest.h>

#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>

#import "ANKAuthenticator.h"
#import "ANKDevice.h"
#import "ANKError.h"
#import "ANKItemMetadata.h"
#import "ANKOptions.h"

// What needs no Keychain: the names, the values' encodings, the metadata, the errors, the reasons of the device, the
// prompt's context.

@interface ANKValueTests : XCTestCase
@end

@implementation ANKValueTests

#pragma mark - Names

- (void)testNamesRoundTrip {
    for (NSString *name in @[
             @"afterFirstUnlock", @"afterFirstUnlockThisDeviceOnly", @"whenUnlocked", @"whenUnlockedThisDeviceOnly",
             @"whenPasscodeSetThisDeviceOnly"
         ]) {
        ANKAccessible accessible;
        XCTAssertTrue(ANKAccessibleOfName(name, &accessible), @"%@", name);
        XCTAssertEqualObjects(ANKAccessibleName(accessible), name);
        ANKAccessible back;
        XCTAssertTrue(ANKAccessibleOfAttribute((__bridge id)ANKAccessibleAttribute(accessible), &back));
        XCTAssertEqual(back, accessible);
    }
    for (NSString *name in @[
             @"none", @"biometryAny", @"biometryCurrentSet", @"biometryAnyOrPasscode", @"biometryCurrentSetOrPasscode",
             @"passcode"
         ]) {
        ANKAccessControl accessControl;
        XCTAssertTrue(ANKAccessControlOfName(name, &accessControl), @"%@", name);
        XCTAssertEqualObjects(ANKAccessControlName(accessControl), name);
    }
    for (NSString *name in @[ @"utf8", @"base64" ]) {
        ANKEncoding encoding;
        XCTAssertTrue(ANKEncodingOfName(name, &encoding), @"%@", name);
        XCTAssertEqualObjects(ANKEncodingName(encoding), name);
    }
}

- (void)testAccessControlsAsSpecifiedInSection8 {
    XCTAssertEqual(ANKAccessControlFlags(ANKAccessControlNone), 0u);
    XCTAssertEqual(ANKAccessControlFlags(ANKAccessControlBiometryAny), kSecAccessControlBiometryAny);
    XCTAssertEqual(ANKAccessControlFlags(ANKAccessControlBiometryCurrentSet), kSecAccessControlBiometryCurrentSet);
    XCTAssertEqual(ANKAccessControlFlags(ANKAccessControlBiometryAnyOrPasscode), kSecAccessControlUserPresence);
    XCTAssertEqual(ANKAccessControlFlags(ANKAccessControlBiometryCurrentSetOrPasscode),
                   kSecAccessControlBiometryCurrentSet | kSecAccessControlOr | kSecAccessControlDevicePasscode);
    XCTAssertEqual(ANKAccessControlFlags(ANKAccessControlPasscode), kSecAccessControlDevicePasscode);
    XCTAssertTrue(ANKAccessControlIsCurrentSet(ANKAccessControlBiometryCurrentSetOrPasscode));
    XCTAssertFalse(ANKAccessControlIsCurrentSet(ANKAccessControlBiometryAnyOrPasscode));
    XCTAssertFalse(ANKAccessControlUsesBiometry(ANKAccessControlPasscode));
    XCTAssertTrue(ANKAccessControlAcceptsPasscode(ANKAccessControlPasscode));
    XCTAssertFalse(ANKAccessControlAcceptsPasscode(ANKAccessControlBiometryCurrentSet));
    XCTAssertTrue(ANKAccessibleIsThisDeviceOnly(ANKAccessibleWhenPasscodeSetThisDeviceOnly));
    XCTAssertFalse(ANKAccessibleIsThisDeviceOnly(ANKAccessibleWhenUnlocked));
}

- (void)testUnknownNamesAreNoValues {
    ANKAccessible accessible;
    ANKAccessControl accessControl;
    ANKEncoding encoding;
    XCTAssertFalse(ANKAccessibleOfName(@"always", &accessible));
    XCTAssertFalse(ANKAccessibleOfName(@"AfterFirstUnlock", &accessible));
    XCTAssertFalse(ANKAccessControlOfName(@"biometry", &accessControl));
    XCTAssertFalse(ANKEncodingOfName(@"utf-8", &encoding));
    XCTAssertFalse(ANKAccessibleOfAttribute(@"dk", &accessible));
    XCTAssertFalse(ANKAccessibleOfAttribute(nil, &accessible));
}

#pragma mark - Values

- (void)testTextIsItsUTF8 {
    NSError *error = nil;
    NSString *text = @"Привет, 🔑é\u0000end";
    NSData *data = ANKDataOfValue(text, ANKEncodingUTF8, &error);
    XCTAssertEqualObjects(data, [text dataUsingEncoding:NSUTF8StringEncoding]);
    XCTAssertEqualObjects(ANKValueOfData(data, ANKEncodingUTF8, &error), text);
}

- (void)testAByteOrderMarkStays {
    NSError *error = nil;
    NSString *bom = [NSString stringWithFormat:@"%C", (unichar)0xFEFF];
    NSArray<NSString *> *texts = @[
        [bom stringByAppendingString:@"text"], [bom stringByAppendingString:bom], [@"text" stringByAppendingString:bom]
    ];
    for (NSString *text in texts) {
        NSData *data = ANKDataOfValue(text, ANKEncodingUTF8, &error);
        XCTAssertEqualObjects(data, [text dataUsingEncoding:NSUTF8StringEncoding]);
        XCTAssertEqualObjects(ANKValueOfData(data, ANKEncodingUTF8, &error), text);
    }
}

- (void)testEmptyValues {
    NSError *error = nil;
    XCTAssertEqualObjects(ANKDataOfValue(@"", ANKEncodingUTF8, &error), [NSData data]);
    XCTAssertEqualObjects(ANKDataOfValue(@"", ANKEncodingBase64, &error), [NSData data]);
    XCTAssertEqualObjects(ANKValueOfData([NSData data], ANKEncodingUTF8, &error), @"");
    XCTAssertEqualObjects(ANKValueOfData([NSData data], ANKEncodingBase64, &error), @"");
}

- (void)testBytesAreStandardBase64 {
    uint8_t bytes[] = {0xfb, 0xff, 0xbf, 0x00, 0x01};
    NSData *data = [NSData dataWithBytes:bytes length:sizeof(bytes)];
    NSError *error = nil;
    XCTAssertEqualObjects(ANKValueOfData(data, ANKEncodingBase64, &error), @"+/+/AAE=");
    XCTAssertEqualObjects(ANKDataOfValue(@"+/+/AAE=", ANKEncodingBase64, &error), data);
}

- (void)testAValueThatIsntBase64IsInvalid {
    for (NSString *value in @[ @"-_-_AAE=", @"AAE", @"AA E=", @"AAE=\n", @"=AAE" ]) {
        NSError *error = nil;
        XCTAssertNil(ANKDataOfValue(value, ANKEncodingBase64, &error), @"%@", value);
        XCTAssertEqualObjects([ANKError codeOfError:error], ANKErrorInvalidArgument);
    }
}

- (void)testALoneSurrogateIsInvalid {
    unichar surrogate = 0xD800;
    NSString *text = [NSString stringWithCharacters:&surrogate length:1];
    NSError *error = nil;
    XCTAssertNil(ANKDataOfValue(text, ANKEncodingUTF8, &error));
    XCTAssertEqualObjects([ANKError codeOfError:error], ANKErrorInvalidArgument);
}

- (void)testBytesThatArentUTF8AreNoText {
    NSArray<NSString *> *sequences = @[
        @"fffe41",   // bytes UTF-8 never has
        @"41804142", // a lone continuation byte
        @"e282",     // a sequence cut off
        @"c080",     // an overlong form of U+0000
        @"e08080",   // an overlong form, three bytes
        @"eda080",   // an encoded surrogate, U+D800
        @"f4908080", // above U+10FFFF
        @"f8888080", // a five-byte lead
    ];
    for (NSString *hex in sequences) {
        NSMutableData *data = [NSMutableData data];
        for (NSUInteger index = 0; index < hex.length; index += 2) {
            uint8_t byte = (uint8_t)strtoul([hex substringWithRange:NSMakeRange(index, 2)].UTF8String, NULL, 16);
            [data appendBytes:&byte length:1];
        }
        NSError *error = nil;
        XCTAssertNil(ANKValueOfData(data, ANKEncodingUTF8, &error), @"%@", hex);
        XCTAssertEqualObjects([ANKError codeOfError:error], ANKErrorInvalidArgument, @"%@", hex);
    }
}

- (void)testTheLongestSequencesAreText {
    NSError *error = nil;
    NSString *text = @"\U0010FFFD\uFFFD\u0800\u0080\U00010000";
    XCTAssertEqualObjects(ANKValueOfData([text dataUsingEncoding:NSUTF8StringEncoding], ANKEncodingUTF8, &error), text);
}

#pragma mark - Metadata

- (void)testMetadataRoundTrips {
    uint8_t state[] = {1, 2, 3};
    NSData *domainState = [NSData dataWithBytes:state length:sizeof(state)];
    ANKItemMetadata *metadata = [[ANKItemMetadata alloc] initWithEncoding:ANKEncodingBase64
                                                            accessControl:ANKAccessControlBiometryCurrentSet
                                                             authValidity:0
                                                                 hasLabel:YES
                                                                osVersion:27
                                                              domainState:domainState];

    ANKItemMetadata *read = [ANKItemMetadata metadataWithAttribute:metadata.attribute];
    XCTAssertEqual(read.encoding, ANKEncodingBase64);
    XCTAssertEqual(read.accessControl, ANKAccessControlBiometryCurrentSet);
    XCTAssertTrue(read.hasLabel);
    XCTAssertEqual(read.osVersion, 27);
    XCTAssertEqualObjects(read.domainState, domainState);

    read = [ANKItemMetadata
        metadataWithAttribute:[[ANKItemMetadata alloc] initWithEncoding:ANKEncodingUTF8
                                                          accessControl:ANKAccessControlBiometryAny
                                                           authValidity:30
                                                               hasLabel:NO
                                                              osVersion:0
                                                            domainState:nil]
                                  .attribute];
    XCTAssertEqual(read.encoding, ANKEncodingUTF8);
    XCTAssertEqual(read.accessControl, ANKAccessControlBiometryAny);
    XCTAssertEqual(read.authValidity, 30);
    XCTAssertFalse(read.hasLabel);
    XCTAssertEqual(read.osVersion, 0);
    XCTAssertNil(read.domainState);
}

- (void)testMetadataOfAnotherFormatIsNone {
    NSData * (^plist)(NSDictionary *) = ^NSData *(NSDictionary *dictionary) {
      return [NSPropertyListSerialization dataWithPropertyList:dictionary
                                                        format:NSPropertyListBinaryFormat_v1_0
                                                       options:0
                                                         error:NULL];
    };
    XCTAssertNil([ANKItemMetadata metadataWithAttribute:nil]);
    XCTAssertNil([ANKItemMetadata metadataWithAttribute:@"text"]);
    XCTAssertNil([ANKItemMetadata metadataWithAttribute:[@"not a plist" dataUsingEncoding:NSUTF8StringEncoding]]);
    XCTAssertNil(
        [ANKItemMetadata metadataWithAttribute:plist(@{@"v" : @2, @"e" : @"utf8", @"ac" : @"none", @"l" : @NO})]);
    XCTAssertNil(
        [ANKItemMetadata metadataWithAttribute:plist(@{@"v" : @1, @"e" : @"hex", @"ac" : @"none", @"l" : @NO})]);
    XCTAssertNil([ANKItemMetadata metadataWithAttribute:plist(@{@"v" : @1, @"e" : @"utf8", @"l" : @NO})]);
    XCTAssertNotNil(
        [ANKItemMetadata metadataWithAttribute:plist(@{@"v" : @1, @"e" : @"utf8", @"ac" : @"none", @"l" : @NO})]);
}

#pragma mark - Errors

- (void)testStatusesHaveTheCodesOfTheSpec {
    NSDictionary<NSNumber *, ANKErrorCode> *codes = @{
        @(errSecUserCanceled) : ANKErrorUserCanceled,
        @(errSecAuthFailed) : ANKErrorAuthFailed,
        @(errSecInteractionNotAllowed) : ANKErrorInteractionNotAllowed,
        @(errSecMissingEntitlement) : ANKErrorMissingEntitlement,
        @(errSecDecode) : ANKErrorDataCorrupted,
        @(errSecParam) : ANKErrorInvalidArgument,
        @(errSecUnimplemented) : ANKErrorUnsupported,
        @(errSecDuplicateItem) : ANKErrorUnknown,
        @(-99999) : ANKErrorUnknown,
    };
    [codes enumerateKeysAndObjectsUsingBlock:^(NSNumber *status, ANKErrorCode code, BOOL *stop) {
      NSError *error = [ANKError errorWithStatus:status.intValue action:@"couldn't read the item"];
      XCTAssertEqualObjects([ANKError codeOfError:error], code, @"%@", status);
      XCTAssertEqualObjects(error.userInfo[@"nativeCode"], status);
      XCTAssertEqualObjects(error.userInfo[@"nativeDomain"], NSOSStatusErrorDomain);
      XCTAssertTrue([error.localizedDescription hasPrefix:@"@apexnative/keychain: couldn't read the item: "],
                    @"%@", error.localizedDescription);
      XCTAssertTrue([error.localizedDescription containsString:status.stringValue], @"%@", error.localizedDescription);
    }];
}

- (void)testLAErrorsHaveTheCodesOfTheSpec {
    NSDictionary<NSNumber *, ANKErrorCode> *codes = @{
        @(LAErrorUserCancel) : ANKErrorUserCanceled,
        @(LAErrorUserFallback) : ANKErrorUserCanceled,
        @(LAErrorSystemCancel) : ANKErrorSystemCanceled,
        @(LAErrorAppCancel) : ANKErrorSystemCanceled,
        @(LAErrorAuthenticationFailed) : ANKErrorAuthFailed,
        @(LAErrorBiometryLockout) : ANKErrorLockout,
        @(LAErrorBiometryNotEnrolled) : ANKErrorBiometryNotEnrolled,
        @(LAErrorBiometryNotAvailable) : ANKErrorBiometryNotAvailable,
        @(LAErrorPasscodeNotSet) : ANKErrorPasscodeNotSet,
        @(LAErrorNotInteractive) : ANKErrorInteractionNotAllowed,
        @(LAErrorInvalidContext) : ANKErrorUnknown,
    };
    [codes enumerateKeysAndObjectsUsingBlock:^(NSNumber *code, ANKErrorCode expected, BOOL *stop) {
      NSError *error = [ANKError
          errorWithLAError:[NSError errorWithDomain:LAErrorDomain
                                               code:code.integerValue
                                           userInfo:@{NSLocalizedDescriptionKey : @"Canceled by user."}]
                    action:@"couldn't unlock the item"];
      XCTAssertEqualObjects([ANKError codeOfError:error], expected, @"%@", code);
      XCTAssertEqualObjects(error.userInfo[@"nativeCode"], code);
      XCTAssertEqualObjects(error.userInfo[@"nativeDomain"], LAErrorDomain);
      XCTAssertEqualObjects(error.localizedDescription,
                            ([NSString stringWithFormat:@"@apexnative/keychain: couldn't unlock the item: Canceled by "
                                                        @"user (LAError %@).",
                                                        code]));
    }];
    NSError *other = [ANKError errorWithLAError:[NSError errorWithDomain:NSCocoaErrorDomain code:4 userInfo:nil]
                                         action:@"couldn't unlock the item"];
    XCTAssertEqualObjects([ANKError codeOfError:other], ANKErrorUnknown);
    XCTAssertEqualObjects(other.userInfo[@"nativeDomain"], NSCocoaErrorDomain);
}

- (void)testAnErrorOfAnotherDomainIsUnknown {
    XCTAssertEqualObjects([ANKError codeOfError:[NSError errorWithDomain:NSCocoaErrorDomain code:1 userInfo:nil]],
                          ANKErrorUnknown);
}

- (void)testAFailureCarriesTheNativeCodeWhenThereIsOne {
    NSDictionary *failure = [ANKError failureWithError:[ANKError errorWithStatus:errSecMissingEntitlement
                                                                          action:@"couldn't write the item"]];
    XCTAssertEqualObjects(failure[@"error"][@"code"], ANKErrorMissingEntitlement);
    XCTAssertEqualObjects(failure[@"error"][@"nativeCode"], @(errSecMissingEntitlement));
    XCTAssertEqualObjects(failure[@"error"][@"nativeDomain"], NSOSStatusErrorDomain);
    XCTAssertNotNil(failure[@"error"][@"message"]);

    failure = [ANKError failureWithError:[ANKError errorWithCode:ANKErrorAuthRequired message:@"message"]];
    XCTAssertEqualObjects(failure, (@{@"error" : @{@"code" : ANKErrorAuthRequired, @"message" : @"message"}}));
}

- (void)testARejectionCarriesTheNativeCodeInUserInfo {
    __block NSString *rejectedCode;
    __block NSString *rejectedMessage;
    __block NSError *rejectedError;
    RCTPromiseRejectBlock reject = ^(NSString *code, NSString *message, NSError *error) {
      rejectedCode = code;
      rejectedMessage = message;
      rejectedError = error;
    };

    NSError *error = [ANKError errorWithStatus:errSecInteractionNotAllowed action:@"couldn't read the item"];
    [ANKError reject:reject error:error];
    XCTAssertEqualObjects(rejectedCode, ANKErrorInteractionNotAllowed);
    XCTAssertEqualObjects(rejectedMessage, error.localizedDescription);
    XCTAssertEqualObjects(rejectedError.userInfo[@"nativeCode"], @(errSecInteractionNotAllowed));
    XCTAssertEqualObjects(rejectedError.userInfo[@"nativeDomain"], NSOSStatusErrorDomain);
    XCTAssertNil(rejectedError.userInfo[@"code"]);

    [ANKError reject:reject error:[ANKError errorWithCode:ANKErrorInvalidArgument message:@"message"]];
    XCTAssertEqualObjects(rejectedCode, ANKErrorInvalidArgument);
    XCTAssertNil(rejectedError);
}

#pragma mark - The device and the prompt

- (void)testUnavailableReasonsComeInTheSpecsOrder {
    // Per device — biometric hardware, biometry enrolled, a passcode — the reason of biometryAny, biometryCurrentSet,
    // biometryAnyOrPasscode, biometryCurrentSetOrPasscode and passcode; NSNull: available.
    id ok = NSNull.null;
    NSString *noHardware = @"noHardware", *noPasscode = @"passcodeNotSet", *notEnrolled = @"notEnrolled";
    NSArray *devices = @[
        @[ @NO, @NO, @NO, @[ noHardware, noHardware, noPasscode, noHardware, noPasscode ] ],
        @[ @NO, @NO, @YES, @[ noHardware, noHardware, ok, noHardware, ok ] ],
        @[ @YES, @NO, @NO, @[ noPasscode, noPasscode, noPasscode, noPasscode, noPasscode ] ],
        @[ @YES, @NO, @YES, @[ notEnrolled, notEnrolled, ok, notEnrolled, ok ] ],
        @[ @YES, @YES, @YES, @[ ok, ok, ok, ok, ok ] ],
    ];
    const ANKAccessControl accessControls[] = {
        ANKAccessControlBiometryAny,
        ANKAccessControlBiometryCurrentSet,
        ANKAccessControlBiometryAnyOrPasscode,
        ANKAccessControlBiometryCurrentSetOrPasscode,
        ANKAccessControlPasscode,
    };
    for (NSArray *device in devices) {
        BOOL hardware = [device[0] boolValue], enrolled = [device[1] boolValue], passcode = [device[2] boolValue];
        for (NSUInteger i = 0; i < 5; i++) {
            XCTAssertEqualObjects(ANKUnavailableReason(accessControls[i], hardware, enrolled, passcode) ?: ok,
                                  device[3][i], @"%@ on %@", ANKAccessControlName(accessControls[i]), device);
        }
        XCTAssertNil(ANKUnavailableReason(ANKAccessControlNone, hardware, enrolled, passcode));
    }
}

- (void)testThePromptsTextsAreOnItsContext {
    LAContext *context = [ANKAuthenticator contextForPrompt:[[ANKPrompt alloc] initWithTitle:@"Sign in"
                                                                                      cancel:@"Not now"]];
    // The Keychain's prompt takes its reason from the context: the read passes no other.
    XCTAssertEqualObjects(context.localizedReason, @"Sign in");
    XCTAssertEqualObjects(context.localizedCancelTitle, @"Not now");
    // The fallback button is always hidden: a tap on it would come back as a failed scan.
    XCTAssertEqualObjects(context.localizedFallbackTitle, @"");
    XCTAssertFalse(context.interactionNotAllowed);

    // nil leaves the system's cancel text, and the reason is the package's default.
    context = [ANKAuthenticator contextForPrompt:[[ANKPrompt alloc] initWithTitle:nil cancel:nil]];
    XCTAssertEqualObjects(context.localizedFallbackTitle, @"");
    XCTAssertNil(context.localizedCancelTitle);
    XCTAssertEqualObjects(context.localizedReason, @"Authenticate to unlock the saved data.");
}

@end
