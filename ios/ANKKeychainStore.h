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
/// The item's `kSecAttrAccessControl` as the Keychain has it, which a prompt evaluates; NULL when it wasn't read.
@property (nonatomic, readonly, nullable) SecAccessControlRef accessControlRef;

/// The item of a `SecItemCopyMatching` result.
- (instancetype)initWithAttributes:(NSDictionary *)attributes NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

@end

/// The Keychain items of one store (`Store` of the contract): generic passwords with `kSecAttrService` = `service`,
/// `kSecAttrAccount` = the key, `kSecAttrCreator` = `ANKItemCreator` and, when there is one, `kSecAttrAccessGroup` =
/// `accessGroup`. Reads, deletes and lists match synchronized items and others
/// (`kSecAttrSynchronizableAny`); a write leaves one item with the key.
///
/// Every method is synchronous and none shows a prompt: a read of an item with access control needs a context that was
/// authenticated, and fails with AUTH_REQUIRED without one. The callers serialize the methods on the module's queue.
/// Every method checks the installation first (`ANKInstallation`): no call reaches an item a new installation
/// deletes. A method that fails returns NO or nil and sets `error`, an `ANKErrorDomain` error; a missing item is no
/// failure: nil and no error.
@interface ANKKeychainStore : NSObject

@property (nonatomic, readonly, copy) NSString *service;
@property (nonatomic, readonly, copy, nullable) NSString *accessGroup;

- (instancetype)initWithService:(NSString *)service
                    accessGroup:(nullable NSString *)accessGroup NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

/// Writes the item with the key, replacing the one there is, whatever its protection and `synchronizable`. Atomic: when
/// the write fails, the old item stays. Checks first that the device can do the protection (`ANKDevice`): no
/// downgrade. A key another library's item has in the service fails with INVALID_ARGUMENT; that item stays.
- (BOOL)setData:(NSData *)data
         forKey:(NSString *)key
       encoding:(ANKEncoding)encoding
        options:(ANKWriteOptions *)options
          error:(NSError **)error;

/// The item with its value, or nil. `context` is a context that was authenticated for the item: nil — an item with
/// access control fails with AUTH_REQUIRED, without a prompt.
- (nullable ANKItem *)itemForKey:(NSString *)key
                         context:(nullable LAContext *)context
                           error:(NSError **)error;

/// The item's attributes without its value, or nil. Never needs authentication.
- (nullable ANKItem *)attributesForKey:(NSString *)key error:(NSError **)error;

/// @YES or @NO; nil when the Keychain failed.
- (nullable NSNumber *)hasItemForKey:(NSString *)key error:(NSError **)error;

/// Deletes the item; no item is no error.
- (BOOL)removeItemForKey:(NSString *)key error:(NSError **)error;

/// The keys of the store's items, in no order.
- (nullable NSArray<NSString *> *)allKeysWithError:(NSError **)error;

/// Deletes every item of the store.
- (BOOL)clearWithError:(NSError **)error;

@end

NS_ASSUME_NONNULL_END
