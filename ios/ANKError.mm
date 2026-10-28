#import "ANKError.h"

#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>

ANKErrorCode const ANKErrorUserCanceled = @"USER_CANCELED";
ANKErrorCode const ANKErrorSystemCanceled = @"SYSTEM_CANCELED";
ANKErrorCode const ANKErrorAuthFailed = @"AUTH_FAILED";
ANKErrorCode const ANKErrorLockout = @"LOCKOUT";
ANKErrorCode const ANKErrorLockoutPermanent = @"LOCKOUT_PERMANENT";
ANKErrorCode const ANKErrorBiometryNotEnrolled = @"BIOMETRY_NOT_ENROLLED";
ANKErrorCode const ANKErrorBiometryNotAvailable = @"BIOMETRY_NOT_AVAILABLE";
ANKErrorCode const ANKErrorPasscodeNotSet = @"PASSCODE_NOT_SET";
ANKErrorCode const ANKErrorKeyInvalidated = @"KEY_INVALIDATED";
ANKErrorCode const ANKErrorInteractionNotAllowed = @"INTERACTION_NOT_ALLOWED";
ANKErrorCode const ANKErrorAuthRequired = @"AUTH_REQUIRED";
ANKErrorCode const ANKErrorMissingEntitlement = @"MISSING_ENTITLEMENT";
ANKErrorCode const ANKErrorMissingUsageDescription = @"MISSING_USAGE_DESCRIPTION";
ANKErrorCode const ANKErrorHardwareUnavailable = @"HARDWARE_UNAVAILABLE";
ANKErrorCode const ANKErrorNoActivity = @"NO_ACTIVITY";
ANKErrorCode const ANKErrorUnsupported = @"UNSUPPORTED";
ANKErrorCode const ANKErrorInvalidArgument = @"INVALID_ARGUMENT";
ANKErrorCode const ANKErrorDataCorrupted = @"DATA_CORRUPTED";
ANKErrorCode const ANKErrorUnknown = @"UNKNOWN";

// Also the domain of the NSError a rejection carries; JavaScript reads only its userInfo.
NSErrorDomain const ANKErrorDomain = @"dev.apexnative.keychain";

// The keys of an ANKErrorDomain error's userInfo, next to NSLocalizedDescriptionKey (the message). `nativeCode` and
// `nativeDomain` are also the keys JavaScript reads from a rejection.
static NSString *const ANKCodeKey = @"code";
static NSString *const ANKNativeCodeKey = @"nativeCode";
static NSString *const ANKNativeDomainKey = @"nativeDomain";

// The error code for an OSStatus of a Keychain call. errSecItemNotFound never gets here: a missing item is
// null, not an error.
static ANKErrorCode ANKCodeOfStatus(OSStatus status) {
    switch (status) {
        case errSecUserCanceled:
            return ANKErrorUserCanceled;
        case errSecAuthFailed:
            return ANKErrorAuthFailed;
        case errSecInteractionNotAllowed:
            return ANKErrorInteractionNotAllowed;
        case errSecMissingEntitlement:
            return ANKErrorMissingEntitlement;
        case errSecDecode:
            return ANKErrorDataCorrupted;
        case errSecParam:
            return ANKErrorInvalidArgument;
        case errSecUnimplemented:
            return ANKErrorUnsupported;
        default:
            return ANKErrorUnknown;
    }
}

// Why a Keychain call failed, in words: ours where the system's would mislead, else the system's.
static NSString *ANKReasonOfStatus(OSStatus status) {
    switch (status) {
        case errSecInteractionNotAllowed:
            return @"the item can't be reached now: the device is locked, or the app is in the background and the "
                   @"item is 'whenUnlocked'";
        case errSecMissingEntitlement:
            return @"the app has no Keychain entitlement for the item: check keychain-access-groups when you pass an "
                   @"accessGroup";
        case errSecDecode:
            return @"the stored data can't be decrypted";
        default: {
            NSString *text = CFBridgingRelease(SecCopyErrorMessageString(status, NULL));
            if (text.length == 0) return @"the Keychain failed";
            // The system's sentences end with a period, ours don't: the status follows.
            return [text hasSuffix:@"."] ? [text substringToIndex:text.length - 1] : text;
        }
    }
}

// The error code for an LAError of a prompt or a check.
static ANKErrorCode ANKCodeOfLAError(NSInteger code) {
    switch (code) {
        // The fallback button is hidden; were it shown, the user chose not to authenticate.
        case LAErrorUserCancel:
        case LAErrorUserFallback:
            return ANKErrorUserCanceled;
        case LAErrorSystemCancel:
        case LAErrorAppCancel:
            return ANKErrorSystemCanceled;
        case LAErrorAuthenticationFailed:
            return ANKErrorAuthFailed;
        case LAErrorBiometryLockout:
            return ANKErrorLockout;
        case LAErrorBiometryNotEnrolled:
            return ANKErrorBiometryNotEnrolled;
        case LAErrorBiometryNotAvailable:
            return ANKErrorBiometryNotAvailable;
        case LAErrorPasscodeNotSet:
            return ANKErrorPasscodeNotSet;
        case LAErrorNotInteractive:
            return ANKErrorInteractionNotAllowed;
        default:
            return ANKErrorUnknown;
    }
}

@implementation ANKError

+ (NSError *)errorWithCode:(ANKErrorCode)code message:(NSString *)message {
    return [NSError errorWithDomain:ANKErrorDomain
                               code:0
                           userInfo:@{ANKCodeKey : code, NSLocalizedDescriptionKey : message}];
}

+ (NSError *)errorWithCode:(ANKErrorCode)code
                   message:(NSString *)message
                nativeCode:(NSInteger)nativeCode
              nativeDomain:(NSString *)nativeDomain {
    return [NSError errorWithDomain:ANKErrorDomain
                               code:nativeCode
                           userInfo:@{
                               ANKCodeKey : code,
                               NSLocalizedDescriptionKey : message,
                               ANKNativeCodeKey : @(nativeCode),
                               ANKNativeDomainKey : nativeDomain,
                           }];
}

+ (NSError *)errorWithStatus:(OSStatus)status action:(NSString *)action {
    NSString *message = [NSString stringWithFormat:@"@apexnative/keychain: %@: %@ (OSStatus %d).", action,
                                                   ANKReasonOfStatus(status), (int)status];
    return [self errorWithCode:ANKCodeOfStatus(status)
                       message:message
                    nativeCode:status
                  nativeDomain:NSOSStatusErrorDomain];
}

+ (NSError *)errorWithLAError:(NSError *)error action:(NSString *)action {
    BOOL authentication = [error.domain isEqualToString:LAErrorDomain];
    NSString *reason = error.localizedDescription.length > 0 ? error.localizedDescription
                                                             : @"the authentication failed";
    if ([reason hasSuffix:@"."]) reason = [reason substringToIndex:reason.length - 1];
    NSString *message = [NSString stringWithFormat:@"@apexnative/keychain: %@: %@ (%@ %ld).", action, reason,
                                                   authentication ? @"LAError" : error.domain, (long)error.code];
    return [self errorWithCode:authentication ? ANKCodeOfLAError(error.code) : ANKErrorUnknown
                       message:message
                    nativeCode:error.code
                  nativeDomain:error.domain];
}

+ (ANKErrorCode)codeOfError:(NSError *)error {
    NSString *code = [error.domain isEqualToString:ANKErrorDomain] ? error.userInfo[ANKCodeKey] : nil;
    return code ?: ANKErrorUnknown;
}

+ (void)reject:(RCTPromiseRejectBlock)reject error:(NSError *)error {
    NSNumber *nativeCode = error.userInfo[ANKNativeCodeKey];
    NSString *nativeDomain = error.userInfo[ANKNativeDomainKey];
    if (nativeCode != nil && nativeDomain != nil) {
        [self reject:reject
                    code:[self codeOfError:error]
                 message:error.localizedDescription
              nativeCode:nativeCode.integerValue
            nativeDomain:nativeDomain];
    } else {
        [self reject:reject code:[self codeOfError:error] message:error.localizedDescription];
    }
}

+ (NSDictionary *)failureWithError:(NSError *)error {
    NSNumber *nativeCode = error.userInfo[ANKNativeCodeKey];
    NSString *nativeDomain = error.userInfo[ANKNativeDomainKey];
    if (nativeCode != nil && nativeDomain != nil) {
        return [self failureWithCode:[self codeOfError:error]
                             message:error.localizedDescription
                          nativeCode:nativeCode.integerValue
                        nativeDomain:nativeDomain];
    }
    return [self failureWithCode:[self codeOfError:error] message:error.localizedDescription];
}

+ (void)reject:(RCTPromiseRejectBlock)reject code:(ANKErrorCode)code message:(NSString *)message {
    reject(code, message, nil);
}

+ (void)reject:(RCTPromiseRejectBlock)reject
            code:(ANKErrorCode)code
         message:(NSString *)message
      nativeCode:(NSInteger)nativeCode
    nativeDomain:(NSString *)nativeDomain {
    NSError *error = [NSError errorWithDomain:ANKErrorDomain
                                         code:nativeCode
                                     userInfo:@{
                                         NSLocalizedDescriptionKey : message,
                                         ANKNativeCodeKey : @(nativeCode),
                                         ANKNativeDomainKey : nativeDomain,
                                     }];
    reject(code, message, error);
}

+ (NSDictionary *)failureWithCode:(ANKErrorCode)code message:(NSString *)message {
    return @{@"error" : @{@"code" : code, @"message" : message}};
}

+ (NSDictionary *)failureWithCode:(ANKErrorCode)code
                          message:(NSString *)message
                       nativeCode:(NSInteger)nativeCode
                     nativeDomain:(NSString *)nativeDomain {
    return @{
        @"error" : @{
            @"code" : code,
            @"message" : message,
            @"nativeCode" : @(nativeCode),
            @"nativeDomain" : nativeDomain,
        }
    };
}

@end
