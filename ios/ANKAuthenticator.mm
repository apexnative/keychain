#import "ANKAuthenticator.h"
#import "ANKDevice.h"
#import "ANKError.h"

#import <TargetConditionals.h>
#import <UIKit/UIKit.h>

// The reason a prompt gives when the call gives none: LocalAuthentication needs one.
static NSString *const ANKDefaultReason = @"Authenticate to unlock the saved data.";

typedef void (^ANKAuthenticationCompletion)(LAContext *context, BOOL cached, NSError *error);

// A read waiting for its prompt.
@interface ANKAuthenticationRequest : NSObject
// The item's SecAccessControlRef, which a prompt evaluates on a device.
@property (nonatomic, strong) id accessControl;
// The policy a prompt evaluates on the simulator.
@property (nonatomic) LAPolicy policy;
// Where its context is cached, for `authValidity` seconds; nil — never.
@property (nonatomic, copy) NSString *cacheKey;
@property (nonatomic) NSInteger authValidity;
@property (nonatomic, strong) ANKPrompt *prompt;
@property (nonatomic, copy) ANKAuthenticationCompletion completion;
@end

@implementation ANKAuthenticationRequest
@end

// A context a prompt authenticated, and when.
@interface ANKCachedContext : NSObject
@property (nonatomic, strong) LAContext *context;
@property (nonatomic, strong) NSDate *authenticatedAt;
@end

@implementation ANKCachedContext
@end

// The key of the cache: one context for a service and an access control.
static NSString *ANKCacheKey(NSString *service, ANKAccessControl accessControl) {
    return [NSString stringWithFormat:@"%@%C%@", service, (unichar)0, ANKAccessControlName(accessControl)];
}

@implementation ANKAuthenticator {
    // Owns the state below: the reads waiting, whether a prompt is open, the cache.
    dispatch_queue_t _queue;
    NSMutableArray<ANKAuthenticationRequest *> *_requests;
    BOOL _prompting;
    NSMutableDictionary<NSString *, ANKCachedContext *> *_cache;
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
        _queue = dispatch_queue_create("dev.apexnative.keychain.prompts", DISPATCH_QUEUE_SERIAL);
        _requests = [NSMutableArray array];
        _cache = [NSMutableDictionary dictionary];
        [NSNotificationCenter.defaultCenter addObserver:self
                                               selector:@selector(forgetAllContexts)
                                                   name:UIApplicationDidEnterBackgroundNotification
                                                 object:nil];
    }
    return self;
}

+ (LAContext *)contextForPrompt:(ANKPrompt *)prompt {
    LAContext *context = [[LAContext alloc] init];
    if (prompt.cancel != nil) context.localizedCancelTitle = prompt.cancel;
    if (prompt.fallback != nil) context.localizedFallbackTitle = prompt.fallback;
    return context;
}

- (void)dealloc {
    [NSNotificationCenter.defaultCenter removeObserver:self];
}

- (void)authenticateItem:(ANKItem *)item
                 service:(NSString *)service
                  prompt:(ANKPrompt *)prompt
              completion:(ANKAuthenticationCompletion)completion {
    ANKAuthenticationRequest *request = [[ANKAuthenticationRequest alloc] init];
    // The item's own access control; one made from its metadata if the attributes didn't have it.
    request.accessControl = (__bridge id)item.accessControlRef
                                ?: CFBridgingRelease(SecAccessControlCreateWithFlags(
                                       kCFAllocatorDefault, ANKAccessibleAttribute(item.accessible),
                                       ANKAccessControlFlags(item.accessControl), NULL));
    request.policy = ANKPolicyOfAccessControl(item.accessControl);
    request.cacheKey = ANKCacheKey(service, item.accessControl);
    request.authValidity = item.metadata.authValidity;
    [self enqueue:request prompt:prompt completion:completion];
}

- (void)authenticateAccessControl:(SecAccessControlRef)accessControl
                           prompt:(ANKPrompt *)prompt
                       completion:(ANKAuthenticationCompletion)completion {
    ANKAuthenticationRequest *request = [[ANKAuthenticationRequest alloc] init];
    request.accessControl = (__bridge id)accessControl;
    // The simulator can't tell its flags: biometry or the passcode shows a prompt for any.
    request.policy = LAPolicyDeviceOwnerAuthentication;
    [self enqueue:request prompt:prompt completion:completion];
}

- (void)enqueue:(ANKAuthenticationRequest *)request
         prompt:(ANKPrompt *)prompt
     completion:(ANKAuthenticationCompletion)completion {
    request.prompt = prompt;
    request.completion = completion;
    dispatch_async(_queue, ^{
      [self->_requests addObject:request];
      [self next];
    });
}

- (void)forgetContext:(LAContext *)context {
    dispatch_async(_queue, ^{
      for (NSString *key in self->_cache.allKeys) {
          if (self->_cache[key].context == context) [self->_cache removeObjectForKey:key];
      }
      [context invalidate];
    });
}

- (void)forgetAllContexts {
    dispatch_async(_queue, ^{
      for (ANKCachedContext *cached in self->_cache.allValues) [cached.context invalidate];
      [self->_cache removeAllObjects];
    });
}

#pragma mark - On the queue

// Answers the reads waiting, in order: from the cache while it can, then with one prompt.
- (void)next {
    while (!_prompting && _requests.count > 0) {
        ANKAuthenticationRequest *request = _requests.firstObject;
        [_requests removeObjectAtIndex:0];
        LAContext *cached = [self cachedContextFor:request];
        if (cached != nil) {
            request.completion(cached, YES, nil);
            continue;
        }
        _prompting = YES;
        [self prompt:request];
    }
}

// A context authenticated for the request's service and access control within the item's authValidity.
- (LAContext *)cachedContextFor:(ANKAuthenticationRequest *)request {
    NSInteger authValidity = request.authValidity;
    if (authValidity <= 0 || request.cacheKey == nil) return nil;
    ANKCachedContext *cached = _cache[request.cacheKey];
    if (cached == nil || -cached.authenticatedAt.timeIntervalSinceNow >= authValidity) return nil;
    return cached.context;
}

- (void)prompt:(ANKAuthenticationRequest *)request {
    LAContext *context = [ANKAuthenticator contextForPrompt:request.prompt];
    NSString *reason = request.prompt.title.length > 0 ? request.prompt.title : ANKDefaultReason;
    void (^reply)(BOOL, NSError *) = ^(BOOL success, NSError *error) {
      // The read that follows fails rather than show a second prompt.
      context.interactionNotAllowed = YES;
      dispatch_async(self->_queue, ^{
        if (success && request.authValidity > 0 && request.cacheKey != nil) {
            ANKCachedContext *cached = [[ANKCachedContext alloc] init];
            cached.context = context;
            cached.authenticatedAt = [NSDate date];
            self->_cache[request.cacheKey] = cached;
        }
        self->_prompting = NO;
        request.completion(success ? context : nil, NO,
                           success ? nil : [ANKError errorWithLAError:error action:@"couldn't unlock the item"]);
        [self next];
      });
    };
#if TARGET_OS_SIMULATOR
    // The simulator has no evaluateAccessControl, and its Keychain doesn't enforce access control: the policy of the
    // item's flags shows the same prompt.
    [context evaluatePolicy:request.policy localizedReason:reason reply:reply];
#else
    [context evaluateAccessControl:(__bridge SecAccessControlRef)request.accessControl
                         operation:LAAccessControlOperationUseItem
                   localizedReason:reason
                             reply:reply];
#endif
}

@end
