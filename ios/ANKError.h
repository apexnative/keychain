#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

NS_ASSUME_NONNULL_BEGIN

/// A code of `KeychainError`: the `code` a promise rejects with and a synchronous `Failure` carries.
typedef NSString *ANKErrorCode NS_TYPED_ENUM;

extern ANKErrorCode const ANKErrorUserCanceled;
extern ANKErrorCode const ANKErrorUserFallback;
extern ANKErrorCode const ANKErrorSystemCanceled;
extern ANKErrorCode const ANKErrorAuthFailed;
extern ANKErrorCode const ANKErrorLockout;
extern ANKErrorCode const ANKErrorLockoutPermanent;
extern ANKErrorCode const ANKErrorBiometryNotEnrolled;
extern ANKErrorCode const ANKErrorBiometryNotAvailable;
extern ANKErrorCode const ANKErrorPasscodeNotSet;
extern ANKErrorCode const ANKErrorKeyInvalidated;
extern ANKErrorCode const ANKErrorInteractionNotAllowed;
extern ANKErrorCode const ANKErrorAuthRequired;
extern ANKErrorCode const ANKErrorMissingEntitlement;
extern ANKErrorCode const ANKErrorMissingUsageDescription;
extern ANKErrorCode const ANKErrorHardwareUnavailable;
extern ANKErrorCode const ANKErrorNoActivity;
extern ANKErrorCode const ANKErrorUnsupported;
extern ANKErrorCode const ANKErrorInvalidArgument;
extern ANKErrorCode const ANKErrorDataCorrupted;
extern ANKErrorCode const ANKErrorUnknown;

/// The domain of the errors the store and the module make (`+errorWithCode:…`, `+errorWithStatus:…`). Such an error
/// keeps its error code and its message in userInfo, and the native code and domain of what failed when there are.
extern NSErrorDomain const ANKErrorDomain;

/// How an error reaches JavaScript (src/native/NativeApexKeychain.ts, "Errors"): a promise rejects with the code, the
/// message and, in the error's userInfo, `nativeCode` and `nativeDomain`; a synchronous method returns `{ error }`.
@interface ANKError : NSObject

/// An error with an error code and a message in English.
+ (NSError *)errorWithCode:(ANKErrorCode)code message:(NSString *)message;

/// An error with an error code and a message in English, and the native code and domain of what failed (an
/// `OSStatus`, an `LAError`).
+ (NSError *)errorWithCode:(ANKErrorCode)code
                   message:(NSString *)message
                nativeCode:(NSInteger)nativeCode
              nativeDomain:(NSString *)nativeDomain;

/// The error of a Keychain call that answered `status`: its error code, a message that says what failed (`action`,
/// such as "couldn't read the item") and the system's reason, and the status in `NSOSStatusErrorDomain`.
+ (NSError *)errorWithStatus:(OSStatus)status action:(NSString *)action;

/// The error of LocalAuthentication (`LAErrorDomain`) a prompt or a check failed with: its error code, a message that
/// says what failed (`action`) and why, and the `LAError` in `LAErrorDomain`. Another error is UNKNOWN with its own
/// code and domain.
+ (NSError *)errorWithLAError:(NSError *)error action:(NSString *)action;

/// The error code an error carries: UNKNOWN for an error of another domain.
+ (ANKErrorCode)codeOfError:(NSError *)error;

/// Rejects a promise with the error: its error code, its message, and its native code and domain when it has them.
+ (void)reject:(RCTPromiseRejectBlock)reject error:(NSError *)error;

/// The answer of a synchronous method that failed with the error: `{ error: { code, message, nativeCode?,
/// nativeDomain? } }`.
+ (NSDictionary *)failureWithError:(NSError *)error;

/// Rejects a promise with the code and the message.
+ (void)reject:(RCTPromiseRejectBlock)reject code:(ANKErrorCode)code message:(NSString *)message;

/// Rejects a promise with the code and the message, and the native code and domain of what failed (an `OSStatus`, an
/// `LAError`).
+ (void)reject:(RCTPromiseRejectBlock)reject
            code:(ANKErrorCode)code
         message:(NSString *)message
      nativeCode:(NSInteger)nativeCode
    nativeDomain:(NSString *)nativeDomain;

/// The answer of a synchronous method that failed: `{ error: { code, message } }`.
+ (NSDictionary *)failureWithCode:(ANKErrorCode)code message:(NSString *)message;

/// The answer of a synchronous method that failed, with the native code and domain of what failed.
+ (NSDictionary *)failureWithCode:(ANKErrorCode)code
                          message:(NSString *)message
                       nativeCode:(NSInteger)nativeCode
                     nativeDomain:(NSString *)nativeDomain;

@end

NS_ASSUME_NONNULL_END
