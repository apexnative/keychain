#import "ANKDevice.h"
#import "ANKError.h"

#import <React/RCTUtils.h>

#import <LocalAuthentication/LocalAuthentication.h>
#import <UIKit/UIKit.h>

#import <atomic>

static NSDictionary *ANKTestInfoDictionary;
static id ANKTestBiometryState;

// Whether protected data is available, as UIKit said last: 1, 0, or -1 before it said anything. UIApplication answers
// on the main thread only, and the Keychain calls run off it.
static std::atomic<int> ANKProtectedData(-1);

// Whether LocalAuthentication answered with the code.
static BOOL ANKIsLAError(NSError *error, LAError code) {
    return [error.domain isEqualToString:LAErrorDomain] && error.code == code;
}

LAPolicy ANKPolicyOfAccessControl(ANKAccessControl accessControl) {
    return ANKAccessControlAcceptsPasscode(accessControl) ? LAPolicyDeviceOwnerAuthentication
                                                          : LAPolicyDeviceOwnerAuthenticationWithBiometrics;
}

NSString *ANKUnavailableReason(ANKAccessControl accessControl,
                               BOOL biometryHardware,
                               BOOL biometryEnrolled,
                               BOOL passcodeSet) {
    if (accessControl == ANKAccessControlNone) return nil;
    // An item bound to the enrolled biometry needs biometry, even when the passcode opens it too (as on Android). Every
    // access control is there since iOS 11.3: never 'unsupportedOS'.
    BOOL needsBiometry = !ANKAccessControlAcceptsPasscode(accessControl) || ANKAccessControlIsCurrentSet(accessControl);
    if (needsBiometry && !biometryHardware) return @"noHardware";
    if (!passcodeSet) return @"passcodeNotSet";
    if (needsBiometry && !biometryEnrolled) return @"notEnrolled";
    return nil;
}

@implementation ANKDevice

+ (NSArray<NSString *> *)biometryTypes {
    // biometryType is set once a policy was checked, whatever the answer.
    LAContext *context = [[LAContext alloc] init];
    [context canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics error:NULL];
    if (context.biometryType == LABiometryTypeFaceID) return @[ @"faceID" ];
    if (context.biometryType == LABiometryTypeTouchID) return @[ @"touchID" ];
    if (@available(iOS 17.0, *)) {
        if (context.biometryType == LABiometryTypeOpticID) return @[ @"opticID" ];
    }
    return @[];
}

+ (BOOL)isPasscodeSet {
    NSError *error = nil;
    if ([[[LAContext alloc] init] canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:&error]) return YES;
    return !ANKIsLAError(error, LAErrorPasscodeNotSet);
}

+ (NSString *)unavailableReasonForAccessControl:(ANKAccessControl)accessControl {
    return [self unavailableReasonForAccessControl:accessControl cause:NULL];
}

// The reason, and the error of LocalAuthentication behind it.
+ (NSString *)unavailableReasonForAccessControl:(ANKAccessControl)accessControl cause:(NSError **)cause {
    if (accessControl == ANKAccessControlNone) return nil;
    LAContext *context = [[LAContext alloc] init];
    NSError *biometryError = nil;
    BOOL biometry = [context canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics error:&biometryError];
    // biometryType is set once a policy was checked, whatever the answer. Biometry the app may not use is none.
    BOOL hardware = biometry || (context.biometryType != LABiometryTypeNone &&
                                 !ANKIsLAError(biometryError, LAErrorBiometryNotAvailable));
    // A lockout passes: the item can be written now, and the passcode ends the lockout.
    BOOL enrolled = biometry || ANKIsLAError(biometryError, LAErrorBiometryLockout);
    NSError *passcodeError = nil;
    BOOL passcode = [[[LAContext alloc] init] canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication
                                                          error:&passcodeError] ||
                    !ANKIsLAError(passcodeError, LAErrorPasscodeNotSet);
    NSString *reason = ANKUnavailableReason(accessControl, hardware, enrolled, passcode);
    if (cause != NULL) *cause = [reason isEqualToString:@"passcodeNotSet"] ? passcodeError : biometryError;
    return reason;
}

+ (NSError *)errorForWritingAccessControl:(ANKAccessControl)accessControl {
    if (accessControl == ANKAccessControlNone) return nil;
    NSError *usage = [self usageDescriptionErrorForAccessControl:accessControl];
    if (usage != nil) return usage;
    NSError *cause = nil;
    NSString *reason = [self unavailableReasonForAccessControl:accessControl cause:&cause];
    if (reason == nil) return nil;
    ANKErrorCode code = [reason isEqualToString:@"noHardware"]       ? ANKErrorBiometryNotAvailable
                        : [reason isEqualToString:@"passcodeNotSet"] ? ANKErrorPasscodeNotSet
                                                                     : ANKErrorBiometryNotEnrolled;
    NSString *action = [NSString stringWithFormat:@"couldn't write the item with accessControl '%@'",
                                                  ANKAccessControlName(accessControl)];
    // LocalAuthentication's own words when it said the same; it may have named another reason first.
    NSError *error = cause != nil ? [ANKError errorWithLAError:cause action:action] : nil;
    if (error != nil && [[ANKError codeOfError:error] isEqualToString:code]) return error;
    NSString *why = [reason isEqualToString:@"noHardware"]       ? @"the device has no biometry the app can use"
                    : [reason isEqualToString:@"passcodeNotSet"] ? @"the device has no passcode"
                                                                 : @"no biometry is enrolled";
    return [ANKError errorWithCode:code
                           message:[NSString stringWithFormat:@"@apexnative/keychain: %@: %@.", action, why]];
}

+ (NSError *)errorForWritingAccessible:(ANKAccessible)accessible {
    if (accessible != ANKAccessibleWhenPasscodeSetThisDeviceOnly) return nil;
    NSError *error = nil;
    if ([[[LAContext alloc] init] canEvaluatePolicy:LAPolicyDeviceOwnerAuthentication error:&error] ||
        !ANKIsLAError(error, LAErrorPasscodeNotSet)) {
        return nil;
    }
    return [ANKError errorWithCode:ANKErrorPasscodeNotSet
                           message:@"@apexnative/keychain: the device has no passcode, and an item "
                                   @"'whenPasscodeSetThisDeviceOnly' needs one."
                        nativeCode:error.code
                      nativeDomain:error.domain];
}

+ (NSError *)usageDescriptionErrorForAccessControl:(ANKAccessControl)accessControl {
    if (!ANKAccessControlUsesBiometry(accessControl)) return nil;
    NSDictionary *info = ANKTestInfoDictionary ?: NSBundle.mainBundle.infoDictionary;
    id description = info[@"NSFaceIDUsageDescription"];
    if ([description isKindOfClass:NSString.class] && [description length] > 0) return nil;
    LAContext *context = [[LAContext alloc] init];
    [context canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics error:NULL];
    if (context.biometryType != LABiometryTypeFaceID) return nil;
    return [ANKError errorWithCode:ANKErrorMissingUsageDescription
                           message:@"@apexnative/keychain: Info.plist has no NSFaceIDUsageDescription, and this device "
                                   @"has Face ID: iOS won't show the prompt. Add the key (in Expo, the config plugin "
                                   @"does)."];
}

+ (NSData *)biometryStateKnown:(BOOL *)known {
    if (ANKTestBiometryState != nil) {
        *known = YES;
        return ANKTestBiometryState == NSNull.null ? nil : ANKTestBiometryState;
    }
    LAContext *context = [[LAContext alloc] init];
    NSError *error = nil;
    if (![context canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics error:&error]) {
        // The simulator has a hash without biometry too: the policy, not the hash, says whether there is one.
        if (ANKIsLAError(error, LAErrorBiometryNotEnrolled) ||
            (ANKIsLAError(error, LAErrorBiometryNotAvailable) && context.biometryType == LABiometryTypeNone)) {
            *known = YES;
            return nil;
        }
        if (@available(iOS 18.0, *)) {
            NSData *state = context.domainState.biometry.stateHash;
            if (ANKIsLAError(error, LAErrorBiometryLockout) && state != nil) {
                *known = YES;
                return state;
            }
        }
        *known = NO;
        return nil;
    }
    *known = YES;
    if (@available(iOS 18.0, *)) {
        // The simulator of iOS 18 has no domainState; the property it replaces has the same hash.
        NSData *state = context.domainState.biometry.stateHash;
        if (state != nil) return state;
    }
    return context.evaluatedPolicyDomainState;
}

+ (NSInteger)majorOSVersion {
    return NSProcessInfo.processInfo.operatingSystemVersion.majorVersion;
}

+ (void)followProtectedData {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
      NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
      [center addObserverForName:UIApplicationProtectedDataWillBecomeUnavailable
                          object:nil
                           queue:nil
                      usingBlock:^(NSNotification *notification) {
                        ANKProtectedData = 0;
                      }];
      [center addObserverForName:UIApplicationProtectedDataDidBecomeAvailable
                          object:nil
                           queue:nil
                      usingBlock:^(NSNotification *notification) {
                        ANKProtectedData = 1;
                      }];
      // The state now; RCTSharedApplication is nil in an app extension, where the notifications still come.
      void (^read)(void) = ^{
        UIApplication *application = RCTSharedApplication();
        if (application != nil) ANKProtectedData = application.isProtectedDataAvailable ? 1 : 0;
      };
      if (NSThread.isMainThread) {
          read();
      } else {
          dispatch_async(dispatch_get_main_queue(), read);
      }
    });
}

+ (BOOL)isProtectedDataAvailable {
    [self followProtectedData];
    if (NSThread.isMainThread) {
        UIApplication *application = RCTSharedApplication();
        if (application != nil) return application.isProtectedDataAvailable;
    }
    return ANKProtectedData != 0;
}

+ (NSDictionary *)testInfoDictionary {
    return ANKTestInfoDictionary;
}

+ (void)setTestInfoDictionary:(NSDictionary *)testInfoDictionary {
    ANKTestInfoDictionary = [testInfoDictionary copy];
}

+ (id)testBiometryState {
    return ANKTestBiometryState;
}

+ (void)setTestBiometryState:(id)testBiometryState {
    ANKTestBiometryState = testBiometryState;
}

@end
