#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>

#import "ANKKeychainStore.h"
#import "ANKOptions.h"

NS_ASSUME_NONNULL_BEGIN

/// The prompts of protected reads, shown as a native app shows them: the read passes the Keychain a context with the
/// prompt's texts (`localizedReason`, `localizedCancelTitle`, no fallback button), and the Keychain shows one
/// prompt, for the item's own access control, then gives the value. Nothing about the item is read before: on a device
/// a protected item's attributes need the same authentication as its value.
///
/// The reads run one at a time, in the order asked, on a queue of the authenticator's that waits for the user, never on
/// the module's queue. On the simulator, whose Keychain enforces no access control and shows no prompt, the
/// authenticator shows the prompt itself, for the policy of the item's flags (`evaluatePolicy`), then reads.
///
/// A context a prompt opened stays usable for the item's `authValidity` seconds, for the reads of the same service and
/// access control, until the app goes to the background: a read tries the contexts of its service's windows silently
/// before it prompts, and takes the value only from the window of the item's own access control.
@interface ANKAuthenticator : NSObject

@property (class, nonatomic, readonly) ANKAuthenticator *shared;

/// Reads the store's item with its value, through an open `authValidity` window or one prompt. `completion` runs on
/// the authenticator's queue with the item; nil and no error when it's gone; or the error: the prompt's
/// (USER_CANCELED, SYSTEM_CANCELED, AUTH_FAILED, LOCKOUT, …), KEY_INVALIDATED when the Keychain refused
/// a `biometryCurrentSet*` item after a change of the biometry (the caller deletes it), or the Keychain's. The caller
/// checks the item it gets against the biometry too: the Keychain may still give a bound item after a change.
- (void)readItemForKey:(NSString *)key
              keychain:(ANKKeychainStore *)keychain
                prompt:(ANKPrompt *)prompt
            completion:(void (^)(ANKItem *_Nullable item, NSError *_Nullable error))completion;

/// A read of another library's item that needs a prompt: `read` reads it with the context it gets, as
/// `readItemForKey:…` reads the store's; `policy` is the prompt the simulator shows. No window: never cached.
- (void)readWithPrompt:(ANKPrompt *)prompt
                policy:(LAPolicy)policy
                  read:(id _Nullable (^)(LAContext *context, NSError **error))read
            completion:(void (^)(id _Nullable result, NSError *_Nullable error))completion;

/// The context a read passes the Keychain, with the texts on it: `title` its `localizedReason` (a default without
/// one: the Keychain's prompt needs a reason), `cancel` its `localizedCancelTitle`, an absent one the system's; the
/// fallback button is always hidden (`localizedFallbackTitle` '').
+ (LAContext *)contextForPrompt:(ANKPrompt *)prompt;

/// Closes every `authValidity` window, as the app going to the background does.
- (void)forgetAllContexts;

/// For the tests: the context of the open window of the service and access control; nil without one.
- (nullable LAContext *)cachedContextForService:(NSString *)service accessControl:(ANKAccessControl)accessControl;

/// For the tests: called with the context of every read that may prompt, just before the read.
@property (class, nonatomic, copy, nullable) void (^testReadObserver)(LAContext *context);

@end

NS_ASSUME_NONNULL_END
