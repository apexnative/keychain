#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>

#import "ANKOptions.h"

NS_ASSUME_NONNULL_BEGIN

/// The policy that checks an access control: biometry alone, or biometry or the passcode.
LAPolicy ANKPolicyOfAccessControl(ANKAccessControl accessControl);

/// The `UnavailableReason` of an access control on a device with what it has, in this order:
/// 'noHardware', 'passcodeNotSet', 'notEnrolled'; nil when an item can be written with it. A lockout counts as
/// enrolled.
NSString *_Nullable ANKUnavailableReason(ANKAccessControl accessControl,
                                         BOOL biometryHardware,
                                         BOOL biometryEnrolled,
                                         BOOL passcodeSet);

/// What the device can do for an access control, as LocalAuthentication says. Every
/// method only checks: none shows a prompt or touches the Keychain.
@interface ANKDevice : NSObject

/// `BiometryType`s of the hardware, enrolled or not: one at most on iOS.
@property (class, nonatomic, readonly) NSArray<NSString *> *biometryTypes;

/// Whether the device has a passcode.
@property (class, nonatomic, readonly) BOOL isPasscodeSet;

/// Nil when an item can be written with the access control now, a lockout included; else the `UnavailableReason`
/// (`ANKUnavailableReason` with what LocalAuthentication says).
+ (nullable NSString *)unavailableReasonForAccessControl:(ANKAccessControl)accessControl;

/// Nil when an item can be written with the access control now; else why not: MISSING_USAGE_DESCRIPTION first, then
/// the error of the `UnavailableReason` — BIOMETRY_NOT_AVAILABLE, PASSCODE_NOT_SET, BIOMETRY_NOT_ENROLLED. Never a
/// downgrade: the write fails instead. A lockout doesn't stop a write.
+ (nullable NSError *)errorForWritingAccessControl:(ANKAccessControl)accessControl;

/// PASSCODE_NOT_SET when the item is 'whenPasscodeSetThisDeviceOnly' and the device has no passcode; else nil. The
/// Keychain's own answer doesn't say so.
+ (nullable NSError *)errorForWritingAccessible:(ANKAccessible)accessible;

/// MISSING_USAGE_DESCRIPTION when the access control may use Face ID and Info.plist has no `NSFaceIDUsageDescription`,
/// which would make iOS refuse the prompt; else nil.
+ (nullable NSError *)usageDescriptionErrorForAccessControl:(ANKAccessControl)accessControl;

/// The state hash of the enrolled biometry: `domainState.biometry.stateHash` on iOS 18 and later,
/// `evaluatedPolicyDomainState` before and where the system has no `domainState` (the simulator of iOS 18). Nil when no
/// biometry is enrolled. `known` is NO when it can't be read now (a lockout without `domainState`).
+ (nullable NSData *)biometryStateKnown:(BOOL *)known;

/// The major version of iOS: the biometry's state hash may change with it.
@property (class, nonatomic, readonly) NSInteger majorOSVersion;

/// Whether the data the passcode protects can be read now: NO while the device is locked, when a `whenUnlocked*` item
/// (and a protected item) answers errSecInteractionNotAllowed. What UIKit said last (`isProtectedDataAvailable`, then
/// its notifications); YES until it said anything. From any thread.
@property (class, nonatomic, readonly) BOOL isProtectedDataAvailable;

/// Starts following whether protected data is available, once: as early as possible, so that UIKit answered before a
/// read asks.
+ (void)followProtectedData;

/// For the tests: an Info.plist to read instead of the app's, and a biometry state to report instead of the device's
/// (`NSNull` — none enrolled). Nil — the real ones.
@property (class, nonatomic, nullable) NSDictionary *testInfoDictionary;
@property (class, nonatomic, nullable) id testBiometryState;

@end

NS_ASSUME_NONNULL_END
