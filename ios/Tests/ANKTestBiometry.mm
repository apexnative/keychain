#import "ANKTestBiometry.h"

#import <TargetConditionals.h>
#import <UIKit/UIKit.h>
#import <notify.h>
#import <objc/runtime.h>

BOOL ANKSetBiometryEnrolledOnSimulator(BOOL enrolled) {
#if TARGET_OS_SIMULATOR
    // The notification the simulator's biometry listens to. Posted from the host (notifyutil) right after a boot, it
    // may come before the listener and be lost, so it is posted until LocalAuthentication answers.
    static const char *const name = "com.apple.BiometricKit.enrollmentChanged";
    int token = 0;
    if (notify_register_check(name, &token) != NOTIFY_STATUS_OK) return NO;
    BOOL done = NO;
    for (int attempt = 0; attempt < 20 && !done; attempt++) {
        NSError *error = nil;
        BOOL can = [[[LAContext alloc] init] canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
                                                         error:&error];
        done = enrolled ? can : (!can && error.code == LAErrorBiometryNotEnrolled);
        if (!done) {
            notify_set_state(token, enrolled ? 1 : 0);
            notify_post(name);
            [NSThread sleepForTimeInterval:0.5];
        }
    }
    notify_cancel(token);
    return done;
#else
    return NO;
#endif
}

void ANKEnrollBiometryOnSimulator(void) {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
      ANKSetBiometryEnrolledOnSimulator(YES);
    });
}

#pragma mark - Prompts

@interface ANKTestPrompt ()
@property (atomic, readwrite) BOOL answered;
@property (atomic, readwrite, nullable) NSError *error;
@property (nonatomic, strong) LAContext *context;
@end

@implementation ANKTestPrompt

- (instancetype)initWithContext:(LAContext *)context policy:(LAPolicy)policy reason:(NSString *)reason {
    if (self = [super init]) {
        _context = context;
        _policy = policy;
        _reason = [reason copy];
        _cancelTitle = [context.localizedCancelTitle copy];
        _fallbackTitle = [context.localizedFallbackTitle copy];
    }
    return self;
}

@end

static NSMutableArray<ANKTestPrompt *> *ANKPromptList;

// Records every evaluatePolicy:localizedReason:reply: of the process, then lets LocalAuthentication show the prompt.
static void ANKRecordPrompts(void) {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
      ANKPromptList = [NSMutableArray array];
      SEL selector = @selector(evaluatePolicy:localizedReason:reply:);
      Method method = class_getInstanceMethod(LAContext.class, selector);
      typedef void (*ANKEvaluate)(LAContext *, SEL, LAPolicy, NSString *, void (^)(BOOL, NSError *));
      ANKEvaluate original = (ANKEvaluate)method_getImplementation(method);
      id evaluate = ^(LAContext *context, LAPolicy policy, NSString *reason, void (^reply)(BOOL, NSError *)) {
        ANKTestPrompt *prompt = [[ANKTestPrompt alloc] initWithContext:context policy:policy reason:reason];
        @synchronized(ANKPromptList) {
            [ANKPromptList addObject:prompt];
        }
        original(context, selector, policy, reason, ^(BOOL success, NSError *error) {
          prompt.error = error;
          prompt.answered = YES;
          reply(success, error);
        });
      };
      method_setImplementation(method, imp_implementationWithBlock(evaluate));
    });
}

NSArray<ANKTestPrompt *> *ANKPrompts(void) {
    ANKRecordPrompts();
    @synchronized(ANKPromptList) {
        return [ANKPromptList copy];
    }
}

void ANKResetPrompts(void) {
    NSArray<ANKTestPrompt *> *prompts = ANKPrompts();
    for (ANKTestPrompt *prompt in prompts) {
        if (prompt.answered) continue;
        [prompt.context invalidate];
        ANKWaitUntil(5, ^BOOL {
          return prompt.answered;
        });
    }
    @synchronized(ANKPromptList) {
        [ANKPromptList removeAllObjects];
    }
}

BOOL ANKShowFace(ANKTestPrompt *prompt, BOOL matching, NSTimeInterval seconds) {
    // The faces of Features › Face ID › Matching Face and Non-matching Face.
    const char *name = matching ? "com.apple.BiometricKit_Sim.pearl.match" : "com.apple.BiometricKit_Sim.pearl.nomatch";
    NSDate *end = [NSDate dateWithTimeIntervalSinceNow:seconds];
    while (!prompt.answered && end.timeIntervalSinceNow > 0) {
        notify_post(name);
        ANKWaitUntil(MIN(0.4, MAX(end.timeIntervalSinceNow, 0)), ^BOOL {
          return prompt.answered;
        });
    }
    return prompt.answered;
}

BOOL ANKWaitUntil(NSTimeInterval seconds, BOOL (^condition)(void)) {
    NSDate *end = [NSDate dateWithTimeIntervalSinceNow:seconds];
    while (!condition() && end.timeIntervalSinceNow > 0) {
        [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
    }
    return condition();
}

#pragma mark - The background

BOOL ANKTripToTheBackground(void) {
    __block BOOL left = NO;
    __block BOOL back = NO;
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    id leaving = [center addObserverForName:UIApplicationDidEnterBackgroundNotification
                                     object:nil
                                      queue:nil
                                 usingBlock:^(NSNotification *notification) {
                                   left = YES;
                                 }];
    id returning = [center addObserverForName:UIApplicationDidBecomeActiveNotification
                                       object:nil
                                        queue:nil
                                   usingBlock:^(NSNotification *notification) {
                                     back = left;
                                   }];
    // The tests keep running in the background until the app is back.
    UIApplication *application = UIApplication.sharedApplication;
    __block UIBackgroundTaskIdentifier task = [application beginBackgroundTaskWithExpirationHandler:^{
      [application endBackgroundTask:task];
      task = UIBackgroundTaskInvalid;
    }];
    // scripts/test-ios.sh waits for it.
    notify_post("dev.apexnative.keychain.tests.background");
    if (ANKWaitUntil(20, ^BOOL {
          return left;
        })) {
        ANKWaitUntil(20, ^BOOL {
          return back;
        });
    }
    if (task != UIBackgroundTaskInvalid) [application endBackgroundTask:task];
    [center removeObserver:leaving];
    [center removeObserver:returning];
    return left && back;
}
