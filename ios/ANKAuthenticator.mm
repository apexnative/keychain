#import "ANKAuthenticator.h"
#import "ANKDevice.h"
#import "ANKError.h"

#import <TargetConditionals.h>
#import <UIKit/UIKit.h>

#import <atomic>

// The reason a prompt gives when the call gives none: LocalAuthentication needs one.
static NSString *const ANKDefaultReason = @"Authenticate to unlock the saved data.";

static NSString *const ANKUnlockAction = @"couldn't unlock the item";

static void (^ANKTestReadObserver)(LAContext *context);

// An open authValidity window: the context a prompt authenticated, for what, and when.
@interface ANKWindow : NSObject
@property (nonatomic, copy) NSString *service;
@property (nonatomic) ANKAccessControl accessControl;
@property (nonatomic, strong) LAContext *context;
@property (nonatomic, strong) NSDate *authenticatedAt;
@end

@implementation ANKWindow
@end

// The key of a window: one for a service and an access control.
static NSString *ANKWindowKey(NSString *service, ANKAccessControl accessControl) {
    return [NSString stringWithFormat:@"%@%C%@", service, (unichar)0, ANKAccessControlName(accessControl)];
}

// The OSStatus of a Keychain call an error of the store carries; 0 for another error.
static OSStatus ANKStatusOfError(NSError *error) {
    if (![error.userInfo[@"nativeDomain"] isEqual:NSOSStatusErrorDomain]) return 0;
    return (OSStatus)[error.userInfo[@"nativeCode"] intValue];
}

#if !TARGET_OS_SIMULATOR
// Whether the context holds a biometric authentication now: the read's prompt matched a face or a finger, which opens
// any item for biometry but one bound to the biometry of its write once that changed. Asked without a prompt: a
// context that holds none fails (LAErrorNotInteractive).
static BOOL ANKHoldsBiometry(LAContext *context) {
    SecAccessControlRef accessControl = SecAccessControlCreateWithFlags(
        kCFAllocatorDefault, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, kSecAccessControlBiometryAny, NULL);
    if (accessControl == NULL) return NO;
    context.interactionNotAllowed = YES;
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block BOOL holds = NO;
    [context evaluateAccessControl:accessControl
                         operation:LAAccessControlOperationUseItem
                   localizedReason:ANKDefaultReason
                             reply:^(BOOL success, NSError *error) {
                               holds = success;
                               dispatch_semaphore_signal(done);
                             }];
    BOOL answered = dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) == 0;
    CFRelease(accessControl);
    return answered && holds;
}
#endif

@implementation ANKAuthenticator {
    // Runs the reads that may prompt, one at a time: each waits there for its user.
    dispatch_queue_t _queue;
    // The open windows by service and access control. Under @synchronized: the app may go to the background while a
    // read waits for its prompt.
    NSMutableDictionary<NSString *, ANKWindow *> *_windows;
    // How many times the app went to the background: a prompt that saw it change was canceled by the system.
    std::atomic<NSUInteger> _backgrounds;
}

+ (ANKAuthenticator *)shared {
    static ANKAuthenticator *shared;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
      shared = [[ANKAuthenticator alloc] init];
    });
    return shared;
}

- (instancetype)init {
    if (self = [super init]) {
        _queue = dispatch_queue_create(
            "dev.apexnative.keychain.prompts",
            dispatch_queue_attr_make_with_qos_class(DISPATCH_QUEUE_SERIAL, QOS_CLASS_USER_INITIATED, 0));
        _windows = [NSMutableDictionary dictionary];
        _backgrounds = 0;
        [NSNotificationCenter.defaultCenter addObserver:self
                                               selector:@selector(didEnterBackground)
                                                   name:UIApplicationDidEnterBackgroundNotification
                                                 object:nil];
    }
    return self;
}

- (void)dealloc {
    [NSNotificationCenter.defaultCenter removeObserver:self];
}

+ (LAContext *)contextForPrompt:(ANKPrompt *)prompt {
    LAContext *context = [[LAContext alloc] init];
    context.localizedReason = prompt.title.length > 0 ? prompt.title : ANKDefaultReason;
    if (prompt.cancel != nil) context.localizedCancelTitle = prompt.cancel;
    // No fallback button: when the Keychain shows the prompt, a tap on it comes back as the status of a failed scan,
    // which the package can't tell from one.
    context.localizedFallbackTitle = @"";
    return context;
}

+ (void (^)(LAContext *))testReadObserver {
    return ANKTestReadObserver;
}

+ (void)setTestReadObserver:(void (^)(LAContext *))testReadObserver {
    ANKTestReadObserver = [testReadObserver copy];
}

- (void)didEnterBackground {
    _backgrounds++;
    [self forgetAllContexts];
}

- (void)forgetAllContexts {
    @synchronized(_windows) {
        for (ANKWindow *window in _windows.allValues) [window.context invalidate];
        [_windows removeAllObjects];
    }
}

- (LAContext *)cachedContextForService:(NSString *)service accessControl:(ANKAccessControl)accessControl {
    @synchronized(_windows) {
        return _windows[ANKWindowKey(service, accessControl)].context;
    }
}

#pragma mark - Reads

- (void)readItemForKey:(NSString *)key
              keychain:(ANKKeychainStore *)keychain
                prompt:(ANKPrompt *)prompt
            completion:(void (^)(ANKItem *, NSError *))completion {
    dispatch_async(_queue, ^{
      ANKItem *item = [self windowItemForKey:key keychain:keychain];
      if (item != nil) {
          completion(item, nil);
          return;
      }
      NSError *error = nil;
      item = [self promptedItemForKey:key keychain:keychain prompt:prompt error:&error];
      completion(item, error);
    });
}

- (void)readWithPrompt:(ANKPrompt *)prompt
                policy:(LAPolicy)policy
                  read:(id (^)(LAContext *, NSError **))read
            completion:(void (^)(id, NSError *))completion {
    dispatch_async(_queue, ^{
      NSError *error = nil;
      id result = [self promptedRead:read prompt:prompt policy:policy context:NULL error:&error];
      completion(result, error);
    });
}

#pragma mark - On the queue

// The item through the context of an open window of its service, without a prompt; nil when none opens it. A context
// may open an item of another access control too: its value is taken only when the item's own access control and
// authValidity hold the window open.
- (ANKItem *)windowItemForKey:(NSString *)key keychain:(ANKKeychainStore *)keychain {
    NSMutableArray<ANKWindow *> *windows = [NSMutableArray array];
    @synchronized(_windows) {
        for (ANKWindow *window in _windows.allValues) {
            if ([window.service isEqualToString:keychain.service]) [windows addObject:window];
        }
    }
    for (ANKWindow *window in windows) {
        NSError *error = nil;
        ANKItem *item = [keychain itemForKey:key context:window.context error:&error];
        if (item != nil) {
            NSInteger authValidity = item.metadata.authValidity;
            if (item.accessControl == window.accessControl && authValidity > 0 &&
                -window.authenticatedAt.timeIntervalSinceNow < authValidity) {
                return item;
            }
            continue;
        }
        // A context LocalAuthentication no longer keeps (too many in the process, its daemon restarted): the Keychain
        // answers errSecAuthFailed for good, and the window closes.
        if (ANKStatusOfError(error) == errSecAuthFailed) {
            @synchronized(_windows) {
                NSString *windowKey = ANKWindowKey(window.service, window.accessControl);
                if (_windows[windowKey] == window) [_windows removeObjectForKey:windowKey];
            }
        }
    }
    return nil;
}

// The item through one prompt; a window opens with it when the item has an authValidity.
- (ANKItem *)promptedItemForKey:(NSString *)key
                       keychain:(ANKKeychainStore *)keychain
                         prompt:(ANKPrompt *)prompt
                          error:(NSError **)error {
    // The policy of the simulator's prompt, which needs the item's access control: there the Keychain gives the item
    // without authentication. A device reads nothing before its prompt.
    LAPolicy policy = LAPolicyDeviceOwnerAuthentication;
#if TARGET_OS_SIMULATOR
    ANKItem *peek = [keychain itemForKey:key context:ANKSilentContext() error:error];
    if (peek == nil) return nil;
    policy = ANKPolicyOfAccessControl(peek.accessControl);
#endif
    LAContext *context = nil;
    ANKItem *item = [self promptedRead:^id(LAContext *readContext, NSError **readError) {
      return [keychain itemForKey:key context:readContext error:readError];
    }
                                prompt:prompt
                                policy:policy
                               context:&context
                                 error:error];
    if (item == nil || item.metadata.authValidity <= 0) return item;
    ANKWindow *window = [[ANKWindow alloc] init];
    window.service = keychain.service;
    window.accessControl = item.accessControl;
    window.context = context;
    window.authenticatedAt = [NSDate date];
    @synchronized(_windows) {
        _windows[ANKWindowKey(window.service, window.accessControl)] = window;
    }
    return item;
}

// Runs a read with a context that may show one prompt, and gives the context, which can't prompt any more after it.
- (id)promptedRead:(id (^)(LAContext *, NSError **))read
            prompt:(ANKPrompt *)prompt
            policy:(LAPolicy)policy
           context:(LAContext **)usedContext
             error:(NSError **)error {
    LAContext *context = [ANKAuthenticator contextForPrompt:prompt];
    if (usedContext != NULL) *usedContext = context;
    NSUInteger backgrounds = _backgrounds;
#if TARGET_OS_SIMULATOR
    // The simulator's Keychain shows no prompt: the authenticator shows the one of the item's flags, and the read then
    // passes its authenticated context. A device's Keychain shows the prompt itself, during the read.
    NSError *promptError = [self evaluatePolicy:policy context:context];
    if (promptError != nil) {
        if (error != NULL) *error = promptError;
        return nil;
    }
#endif
    void (^observer)(LAContext *) = ANKTestReadObserver;
    if (observer != nil) observer(context);
    NSError *readError = nil;
    id result = read(context, &readError);
    // A window hands the context to reads that must not prompt.
    context.interactionNotAllowed = YES;
    if (result == nil && readError != nil) {
        readError = [self errorOfPromptedRead:readError context:context backgrounds:backgrounds];
    }
    if (error != NULL) *error = readError;
    return result;
}

#if TARGET_OS_SIMULATOR
// Shows the prompt of the policy and waits for the user; nil when it passed, else its error.
- (NSError *)evaluatePolicy:(LAPolicy)policy context:(LAContext *)context {
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block NSError *failure = nil;
    [context evaluatePolicy:policy
            localizedReason:context.localizedReason
                      reply:^(BOOL success, NSError *error) {
                        if (!success) {
                            failure = error ?: [NSError errorWithDomain:LAErrorDomain
                                                                   code:LAErrorAuthenticationFailed
                                                               userInfo:nil];
                        }
                        dispatch_semaphore_signal(done);
                      }];
    dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
    return failure != nil ? [ANKError errorWithLAError:failure action:ANKUnlockAction] : nil;
}
#endif

// What the Keychain's answer to a read that could prompt means. It answers with an OSStatus, not with
// LocalAuthentication's error: errSecUserCanceled for a prompt the user or the system ended, errSecAuthFailed for one
// that failed, or for an item whose access control can't be met any more. The state of the app and of the biometry
// after the prompt tell more.
- (NSError *)errorOfPromptedRead:(NSError *)error context:(LAContext *)context backgrounds:(NSUInteger)backgrounds {
    OSStatus status = ANKStatusOfError(error);
    if (status == errSecUserCanceled && _backgrounds != backgrounds) {
        return [ANKError errorWithCode:ANKErrorSystemCanceled
                               message:@"@apexnative/keychain: couldn't unlock the item: the app went to the "
                                       @"background during the prompt."
                            nativeCode:status
                          nativeDomain:NSOSStatusErrorDomain];
    }
    if (status != errSecAuthFailed) return error;
    // Face ID that iOS won't show without the usage text fails the read.
    NSError *usage = [ANKDevice usageDescriptionErrorForAccessControl:ANKAccessControlBiometryAny];
    if (usage != nil) return usage;
    NSError *biometryError = nil;
    if (![[[LAContext alloc] init] canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
                                               error:&biometryError] &&
        [biometryError.domain isEqualToString:LAErrorDomain] &&
        (biometryError.code == LAErrorBiometryLockout || biometryError.code == LAErrorBiometryNotEnrolled)) {
        return [ANKError errorWithLAError:biometryError action:ANKUnlockAction];
    }
#if !TARGET_OS_SIMULATOR
    // The user passed the prompt with biometry, and the item still refused: only an item bound to the biometry of its
    // write does, once that changed. The Keychain keeps it, but nothing can open it any more.
    if (ANKHoldsBiometry(context)) {
        return [ANKError errorWithCode:ANKErrorKeyInvalidated
                               message:@"@apexnative/keychain: the enrolled biometry changed since the item was "
                                       @"written, so the item was deleted. Sign the user in again."
                            nativeCode:status
                          nativeDomain:NSOSStatusErrorDomain];
    }
#endif
    return error;
}

@end
