#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <XCTest/XCTest.h>

NS_ASSUME_NONNULL_BEGIN

/// Stops a test this device can't run: under scripts/test-ios.sh (`ANK_REQUIRE_BIOMETRY`), whose simulator runs every
/// test, a failure; elsewhere a skip. In a test method.
#define ANKCantRun(reason)                                                                                             \
    ({                                                                                                                 \
        NSString *ANKReason = (reason);                                                                                \
        XCTAssertNil(NSProcessInfo.processInfo.environment[@"ANK_REQUIRE_BIOMETRY"], @"%@", ANKReason);                \
        XCTSkip(@"%@", ANKReason);                                                                                     \
    })

/// On the simulator, enrolls Face ID (as Features › Face ID › Enrolled does) and waits until LocalAuthentication sees
/// it, so the tests of access control run. Once per test run; nothing on a device.
void ANKEnrollBiometryOnSimulator(void);

/// On the simulator, enrolls Face ID or removes it, and waits until LocalAuthentication says so. NO when it didn't, and
/// on a device.
BOOL ANKSetBiometryEnrolledOnSimulator(BOOL enrolled);

/// A prompt LocalAuthentication was asked to show (`evaluatePolicy:localizedReason:reply:`, which the package calls on
/// the simulator), with what it was asked with. The prompt itself is the system's.
@interface ANKTestPrompt : NSObject
@property (nonatomic, readonly) LAPolicy policy;
@property (nonatomic, readonly, copy) NSString *reason;
@property (nonatomic, readonly, copy, nullable) NSString *cancelTitle;
@property (nonatomic, readonly, copy, nullable) NSString *fallbackTitle;
/// Set when LocalAuthentication answered, before the package hears of it.
@property (atomic, readonly) BOOL answered;
/// LocalAuthentication's error; nil after a success.
@property (atomic, readonly, nullable) NSError *error;
@end

/// The prompts of the process since `ANKResetPrompts`, in the order they were asked for. The first call of either
/// starts the recording.
NSArray<ANKTestPrompt *> *ANKPrompts(void);

/// Ends the prompts still open (their contexts invalidated: LAErrorAppCancel) and forgets them all.
void ANKResetPrompts(void);

/// Shows the open prompt a face on the simulator: one that matches, which ends the prompt, or another, after which the
/// simulator's prompt waits for a tap on "Try Face ID Again" or "Cancel". Posted again every 0.4 seconds, as a prompt
/// takes a moment to be ready for it, until LocalAuthentication answered or `seconds` passed. Whether it answered.
BOOL ANKShowFace(ANKTestPrompt *prompt, BOOL matching, NSTimeInterval seconds);

/// Runs the main run loop until `condition` holds or `seconds` passed; whether it holds.
BOOL ANKWaitUntil(NSTimeInterval seconds, BOOL (^condition)(void));

/// Sends the app to the background and back, as switching to another app and back does: scripts/test-ios.sh opens
/// Settings when a test posts the notification, then the app again. NO when the app didn't go (no script) or didn't
/// come back.
BOOL ANKTripToTheBackground(void);

NS_ASSUME_NONNULL_END
