#import <Foundation/Foundation.h>

#import "ANKOptions.h"

NS_ASSUME_NONNULL_BEGIN

/// What the package keeps about an item next to its value, in the item's `kSecAttrGeneric`: format v1, a
/// binary property list `{ v: 1, e: encoding, ac: accessControl, l: has a label, av?: authValidity, os?: the major
/// version of iOS when the biometry's state was taken, ds?: that state }`. Nothing secret: the attributes are read
/// without a prompt. An item without it was written by something else.
@interface ANKItemMetadata : NSObject

/// The version of the format the package writes.
@property (class, nonatomic, readonly) NSInteger currentVersion;

/// What the value was written as.
@property (nonatomic, readonly) ANKEncoding encoding;
/// What unlocks the item. `kSecAttrAccessControl` can't be read back, so this is how a read knows it needs a prompt.
@property (nonatomic, readonly) ANKAccessControl accessControl;
/// Seconds one authentication unlocks the item for; 0 — every read.
@property (nonatomic, readonly) NSInteger authValidity;
/// Whether the item has a label: an update can't remove `kSecAttrLabel`, so an item without one keeps it empty.
@property (nonatomic, readonly) BOOL hasLabel;
/// The major version of iOS when `domainState` was taken; 0 — it wasn't. A `biometryCurrentSet*` read compares the
/// state only under the same version: Apple's hash may change with a major update of the OS.
@property (nonatomic, readonly) NSInteger osVersion;
/// The enrolled biometry's state hash when the item was written; nil with `osVersion` — no biometry was enrolled.
@property (nonatomic, readonly, nullable) NSData *domainState;

- (instancetype)initWithEncoding:(ANKEncoding)encoding
                   accessControl:(ANKAccessControl)accessControl
                    authValidity:(NSInteger)authValidity
                        hasLabel:(BOOL)hasLabel
                       osVersion:(NSInteger)osVersion
                     domainState:(nullable NSData *)domainState NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

/// The metadata of an item's `kSecAttrGeneric`; nil when it isn't the package's format v1.
+ (nullable instancetype)metadataWithAttribute:(nullable id)attribute;

/// The value of `kSecAttrGeneric`.
- (NSData *)attribute;

@end

NS_ASSUME_NONNULL_END
