#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>

#import "ANKKeychainStore.h"
#import "ANKOptions.h"

NS_ASSUME_NONNULL_BEGIN

/// The prompts of protected reads: one at a time, in the order asked, and never on the module's queue,
/// which doesn't wait for a user. A prompt evaluates the item's own access control (`evaluateAccessControl`; on the
/// simulator, which lacks it, the policy of its flags); the read then passes the context to the Keychain and shows no
/// second prompt. A context stays usable for the item's `authValidity` seconds, for every read of the same service and
/// access control, until the app goes to the background.
@interface ANKAuthenticator : NSObject

@property (class, nonatomic, readonly) ANKAuthenticator *shared;

/// A context authenticated for the item: a cached one when the item's `authValidity` allows it (`cached`), else one a
/// prompt with the texts authenticated. The context can't show a prompt any more. `completion` runs on a queue of the
/// authenticator's; `error` is the prompt's, with its error code.
- (void)authenticateItem:(ANKItem *)item
                 service:(NSString *)service
                  prompt:(ANKPrompt *)prompt
              completion:(void (^)(LAContext *_Nullable context, BOOL cached, NSError *_Nullable error))completion;

/// A context a prompt authenticated for another library's item, by its own access control (`kSecAttrAccessControl`).
/// Never cached. As `authenticateItem:…`, else.
- (void)authenticateAccessControl:(SecAccessControlRef)accessControl
                           prompt:(ANKPrompt *)prompt
                       completion:
                           (void (^)(LAContext *_Nullable context, BOOL cached, NSError *_Nullable error))completion;

/// The context a prompt evaluates with the texts on it: `cancel` its `localizedCancelTitle`, `fallback` its
/// `localizedFallbackTitle`, which '' hides. An absent text leaves the system's. The fallback button of a prompt for
/// biometry alone ends it with USER_FALLBACK; the passcode is the fallback of the others.
+ (LAContext *)contextForPrompt:(ANKPrompt *)prompt;

/// Drops a cached context a read couldn't use.
- (void)forgetContext:(LAContext *)context;

/// Drops every cached context, as the app going to the background does.
- (void)forgetAllContexts;

@end

NS_ASSUME_NONNULL_END
