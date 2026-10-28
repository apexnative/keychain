#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>

#import "ANKItemMetadata.h"
#import "ANKOptions.h"

NS_ASSUME_NONNULL_BEGIN

/// The creator code (`kSecAttrCreator`) of every item the package writes, 'ApxK'. Every query of the store has it: the
/// package sees only its own items, and a query by it alone finds them in every service
/// (`clearOnReinstall`).
extern const UInt32 ANKItemCreator;

/// An item of a store: its attributes and, after a read of the value, its bytes.
@interface ANKItem : NSObject

@property (nonatomic, readonly, copy) NSString *key;
/// Nil when only the attributes were read.
@property (nonatomic, readonly, nullable) NSData *data;
@property (nonatomic, readonly, copy, nullable) NSString *label;
@property (nonatomic, readonly) ANKAccessible accessible;
@property (nonatomic, readonly) BOOL synchronizable;
@property (nonatomic, readonly) NSDate *createdAt;
@property (nonatomic, readonly) NSDate *modifiedAt;
/// Nil when `kSecAttrGeneric` isn't the package's format: the item reads as text with access control 'none'.
@property (nonatomic, readonly, nullable) ANKItemMetadata *metadata;
@property (nonatomic, readonly) ANKEncoding encoding;
@property (nonatomic, readonly) ANKAccessControl accessControl;
/// The item's `kSecAttrAccessControl` as the Keychain has it; NULL when it has none.
@property (nonatomic, readonly, nullable) SecAccessControlRef accessControlRef;

/// The item of a `SecItemCopyMatching` result.
- (instancetype)initWithAttributes:(NSDictionary *)attributes NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

@end

/// A context that makes a Keychain call needing the user's authentication fail with errSecInteractionNotAllowed
/// instead of showing the system's prompt. Every query that may match a protected item and must not prompt carries one
/// (`kSecUseAuthenticationContext`): on a device, a query without a context shows the system's own prompt for a
/// protected item, even one that asks for its attributes only.
LAContext *ANKSilentContext(void);

/// The Keychain items of one store (`Store` of the contract): generic passwords with `kSecAttrService` = `service`,
/// `kSecAttrAccount` = the key, `kSecAttrCreator` = `ANKItemCreator` and, when there is one, `kSecAttrAccessGroup` =
/// `accessGroup`. Reads, deletes and lists match synchronized items and others
/// (`kSecAttrSynchronizableAny`); a write leaves one item with the key.
///
/// On a device the Keychain authenticates every query that matches a protected item, its attributes included. So no
/// method shows a prompt and none needs a protected item's attributes: reads and probes pass the silent context, lists
/// skip protected items (`kSecUseAuthenticationUISkip`), and a protected item is told by the silent read's
/// errSecInteractionNotAllowed while protected data is available (`ANKDevice`). The simulator's Keychain enforces no
/// access control: there the item's metadata tells it, so that every method answers as on a device.
///
/// Every method is synchronous; the callers serialize them on the module's queue, but for the read with a context
/// that may prompt, which `ANKAuthenticator` runs on its own. Every method checks the installation first
/// (`ANKInstallation`): no call reaches an item a new installation deletes. A method that fails returns NO or nil and
/// sets `error`, an `ANKErrorDomain` error; a missing item is no failure: nil and no error.
@interface ANKKeychainStore : NSObject

@property (nonatomic, readonly, copy) NSString *service;
@property (nonatomic, readonly, copy, nullable) NSString *accessGroup;

- (instancetype)initWithService:(NSString *)service
                    accessGroup:(nullable NSString *)accessGroup NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

/// Writes the item with the key, replacing the one there is, whatever its protection and `synchronizable`, without a
/// prompt. Atomic: when the write fails, the old item stays. Checks first that the device can do the protection
/// (`ANKDevice`): no downgrade. A key another library's item has in the service fails with INVALID_ARGUMENT; that
/// item stays.
- (BOOL)setData:(NSData *)data
         forKey:(NSString *)key
       encoding:(ANKEncoding)encoding
        options:(ANKWriteOptions *)options
          error:(NSError **)error;

/// The item with its value, or nil. Without `context`, the read can't prompt: an item with access control fails with
/// AUTH_REQUIRED, and any item the locked device keeps out of reach with INTERACTION_NOT_ALLOWED. With `context`, the
/// read uses it as it is: an authenticated one opens the item silently, and one that may show a prompt lets the
/// Keychain show it, with the context's texts, and waits for the user on the calling thread.
- (nullable ANKItem *)itemForKey:(NSString *)key
                         context:(nullable LAContext *)context
                           error:(NSError **)error;

/// The attributes of an item without access control, without its value, or nil. A protected item fails with
/// AUTH_REQUIRED: its attributes need the user's authentication on a device.
- (nullable ANKItem *)attributesForKey:(NSString *)key error:(NSError **)error;

/// @YES or @NO, a protected item included; nil when the Keychain failed.
- (nullable NSNumber *)hasItemForKey:(NSString *)key error:(NSError **)error;

/// Deletes the item, protected or not; no item is no error.
- (BOOL)removeItemForKey:(NSString *)key error:(NSError **)error;

/// The keys of the store's items without access control, in no order: a protected item can't be listed without a
/// prompt.
- (nullable NSArray<NSString *> *)allKeysWithError:(NSError **)error;

/// Deletes every item of the store, protected or not.
- (BOOL)clearWithError:(NSError **)error;

@end

NS_ASSUME_NONNULL_END
