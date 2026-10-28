#import "ANKKeychainStore.h"
#import "ANKDevice.h"
#import "ANKError.h"
#import "ANKInstallation.h"

#import <React/RCTLog.h>

const UInt32 ANKItemCreator = 0x4170784B;

// How many times a write starts over when the item changed between its steps (another process with the access group,
// a call that isn't serialized with the module's queue).
static const NSInteger ANKWriteAttempts = 3;

// Sets `error` and returns NO: the end of a method that failed.
static BOOL ANKFail(NSError **error, NSError *failure) {
    if (error != NULL) *error = failure;
    return NO;
}

static BOOL ANKFailWithStatus(NSError **error, OSStatus status, NSString *action) {
    return ANKFail(error, [ANKError errorWithStatus:status action:action]);
}

LAContext *ANKSilentContext(void) {
    LAContext *context = [[LAContext alloc] init];
    context.interactionNotAllowed = YES;
    return context;
}

static NSError *ANKAuthRequiredError(void) {
    return [ANKError errorWithCode:ANKErrorAuthRequired
                           message:@"@apexnative/keychain: the item has access control: reading it needs a prompt, "
                                   @"and this call can't show one."];
}

// What errSecInteractionNotAllowed means for a call that can't prompt: an item with access control while protected
// data is available, else an item the locked device keeps out of reach (INTERACTION_NOT_ALLOWED).
static NSError *ANKOutOfReachError(NSString *action) {
    if (ANKDevice.isProtectedDataAvailable) return ANKAuthRequiredError();
    return [ANKError errorWithStatus:errSecInteractionNotAllowed action:action];
}

// Whether an item of the attributes has access control by its metadata: what the simulator, which enforces none,
// tells a protected item by.
static BOOL ANKIsProtected(NSDictionary *attributes) {
    ANKItemMetadata *metadata = [ANKItemMetadata metadataWithAttribute:attributes[(__bridge id)kSecAttrGeneric]];
    return metadata != nil && metadata.accessControl != ANKAccessControlNone;
}

// Whether the query finds an item, without a prompt and without reading it: errSecSuccess, errSecItemNotFound, or
// errSecInteractionNotAllowed for an item that needs authentication (or that the locked device keeps).
static OSStatus ANKProbe(NSMutableDictionary *query) {
    query[(__bridge id)kSecUseAuthenticationContext] = ANKSilentContext();
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    return SecItemCopyMatching((__bridge CFDictionaryRef)query, NULL);
}

@implementation ANKItem {
    // The item's kSecAttrAccessControl, a SecAccessControlRef kept as an object.
    id _accessControlObject;
}

- (instancetype)initWithAttributes:(NSDictionary *)attributes {
    if (self = [super init]) {
        id key = attributes[(__bridge id)kSecAttrAccount];
        _key = [key isKindOfClass:NSString.class] ? [key copy] : @"";
        id data = attributes[(__bridge id)kSecValueData];
        _data = [data isKindOfClass:NSData.class] ? data : nil;
        _metadata = [ANKItemMetadata metadataWithAttribute:attributes[(__bridge id)kSecAttrGeneric]];
        id label = attributes[(__bridge id)kSecAttrLabel];
        label = [label isKindOfClass:NSString.class] ? label : nil;
        // The package's item without a label keeps an empty kSecAttrLabel; another's has a label when it has one.
        _label = _metadata == nil ? label : _metadata.hasLabel ? (label ?: @"") : nil;
        // An accessibility the package doesn't write (the deprecated …Always) reads as the default.
        ANKAccessible accessible = ANKAccessibleAfterFirstUnlock;
        ANKAccessibleOfAttribute(attributes[(__bridge id)kSecAttrAccessible], &accessible);
        _accessible = accessible;
        id synchronizable = attributes[(__bridge id)kSecAttrSynchronizable];
        _synchronizable = [synchronizable isKindOfClass:NSNumber.class] && [synchronizable boolValue];
        id createdAt = attributes[(__bridge id)kSecAttrCreationDate];
        id modifiedAt = attributes[(__bridge id)kSecAttrModificationDate];
        _createdAt = [createdAt isKindOfClass:NSDate.class] ? createdAt : [NSDate dateWithTimeIntervalSince1970:0];
        _modifiedAt = [modifiedAt isKindOfClass:NSDate.class] ? modifiedAt : _createdAt;
        id accessControl = attributes[(__bridge id)kSecAttrAccessControl];
        if (accessControl != nil && CFGetTypeID((__bridge CFTypeRef)accessControl) == SecAccessControlGetTypeID()) {
            _accessControlObject = accessControl;
        }
    }
    return self;
}

- (ANKEncoding)encoding {
    return _metadata != nil ? _metadata.encoding : ANKEncodingUTF8;
}

- (ANKAccessControl)accessControl {
    return _metadata != nil ? _metadata.accessControl : ANKAccessControlNone;
}

- (SecAccessControlRef)accessControlRef {
    return (__bridge SecAccessControlRef)_accessControlObject;
}

@end

@implementation ANKKeychainStore

- (instancetype)initWithService:(NSString *)service accessGroup:(NSString *)accessGroup {
    if (self = [super init]) {
        _service = [service copy];
        _accessGroup = [accessGroup copy];
    }
    return self;
}

#pragma mark - Queries

// Every item with the key, or of the service: of the package or not. Only a write asks for another library's, to leave
// them alone.
- (NSMutableDictionary *)anyItemQueryForKey:(NSString *)key {
    NSMutableDictionary *query = [NSMutableDictionary dictionary];
    query[(__bridge id)kSecClass] = (__bridge id)kSecClassGenericPassword;
    query[(__bridge id)kSecAttrService] = _service;
    if (key != nil) query[(__bridge id)kSecAttrAccount] = key;
    if (_accessGroup != nil) query[(__bridge id)kSecAttrAccessGroup] = _accessGroup;
    // The keychain of iOS, also on Mac Catalyst and visionOS, where the file-based keychain of macOS is there too.
    query[(__bridge id)kSecUseDataProtectionKeychain] = @YES;
    return query;
}

// The store's items, or its items with the key: the attributes every query starts from.
- (NSMutableDictionary *)queryForKey:(NSString *)key {
    NSMutableDictionary *query = [self anyItemQueryForKey:key];
    query[(__bridge id)kSecAttrCreator] = @(ANKItemCreator);
    return query;
}

// Every item with the key, or of the store, synchronized or not. Never sent as it is: on a device, a query that
// matches a protected item without a context shows the system's prompt, so a call adds a context, or skips them.
- (NSMutableDictionary *)matchQueryForKey:(NSString *)key {
    NSMutableDictionary *query = [self queryForKey:key];
    query[(__bridge id)kSecAttrSynchronizable] = (__bridge id)kSecAttrSynchronizableAny;
    return query;
}

// The same items with the silent context, for a delete: it needs no authentication, and can't prompt whatever the
// Keychain decides.
- (NSMutableDictionary *)silentMatchQueryForKey:(NSString *)key {
    NSMutableDictionary *query = [self matchQueryForKey:key];
    query[(__bridge id)kSecUseAuthenticationContext] = ANKSilentContext();
    return query;
}

// The attributes of every item of the query that needs no authentication: the Keychain skips the others silently
// (kSecUseAuthenticationUISkip, which, unlike kSecUseAuthenticationUIFail, isn't deprecated). The simulator skips
// none.
+ (NSMutableDictionary *)listingOf:(NSMutableDictionary *)query {
    query[(__bridge id)kSecUseAuthenticationUI] = (__bridge id)kSecUseAuthenticationUISkip;
    query[(__bridge id)kSecReturnAttributes] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitAll;
    return query;
}

// The one item with the key and the `synchronizable`, without a prompt.
- (NSMutableDictionary *)queryForKey:(NSString *)key synchronizable:(BOOL)synchronizable {
    NSMutableDictionary *query = [self queryForKey:key];
    query[(__bridge id)kSecAttrSynchronizable] = @(synchronizable);
    query[(__bridge id)kSecUseAuthenticationContext] = ANKSilentContext();
    return query;
}

#pragma mark - Writing

- (BOOL)setData:(NSData *)data
         forKey:(NSString *)key
       encoding:(ANKEncoding)encoding
        options:(ANKWriteOptions *)options
          error:(NSError **)error {
    if (![ANKInstallation checkWithError:error]) return NO;
    ANKAccessControl accessControl = options.accessControl;
    NSError *unavailable = [ANKDevice errorForWritingAccessControl:accessControl]
                               ?: [ANKDevice errorForWritingAccessible:options.accessible];
    if (unavailable != nil) return ANKFail(error, unavailable);

    // An item bound to the current biometry keeps its state, which a read compares.
    NSInteger osVersion = 0;
    NSData *domainState = nil;
    if (ANKAccessControlIsCurrentSet(accessControl)) {
        BOOL known = NO;
        domainState = [ANKDevice biometryStateKnown:&known];
        if (known) osVersion = ANKDevice.majorOSVersion;
    }
    ANKItemMetadata *metadata = [[ANKItemMetadata alloc] initWithEncoding:encoding
                                                            accessControl:accessControl
                                                             authValidity:options.authValidity
                                                                 hasLabel:options.label != nil
                                                                osVersion:osVersion
                                                              domainState:domainState];
    // What a write sets, whether it adds the item or updates it: the whole item but its key and `synchronizable`.
    NSMutableDictionary *attributes = [@{
        (__bridge id)kSecValueData : data,
        (__bridge id)kSecAttrLabel : options.label ?: @"",
        (__bridge id)kSecAttrGeneric : metadata.attribute,
        (__bridge id)kSecAttrCreator : @(ANKItemCreator),
    } mutableCopy];
    CFStringRef accessible = ANKAccessibleAttribute(options.accessible);
    if (accessControl == ANKAccessControlNone) {
        attributes[(__bridge id)kSecAttrAccessible] = (__bridge id)accessible;
    } else {
        // The access control carries the accessibility: the Keychain takes one or the other.
        CFErrorRef cfError = NULL;
        SecAccessControlRef access = SecAccessControlCreateWithFlags(kCFAllocatorDefault, accessible,
                                                                     ANKAccessControlFlags(accessControl), &cfError);
        if (access == NULL) {
            NSError *failure = CFBridgingRelease(cfError);
            return ANKFail(error, [ANKError errorWithCode:ANKErrorUnknown
                                                  message:@"@apexnative/keychain: couldn't make the access control."
                                               nativeCode:failure.code
                                             nativeDomain:failure.domain ?: NSOSStatusErrorDomain]);
        }
        attributes[(__bridge id)kSecAttrAccessControl] = CFBridgingRelease(access);
    }
    BOOL synchronizable = options.synchronizable;

    for (NSInteger attempt = 0; attempt < ANKWriteAttempts; attempt++) {
        // A synchronized item and another are two items for the Keychain: the write keeps one.
        BOOL foreign = NO;
        BOOL hidden = NO;
        NSArray<ANKItem *> *items = [self itemsForKey:key foreign:&foreign hidden:&hidden error:error];
        if (items == nil) return NO;
        // Another library's data isn't the package's to destroy: migrate frees the key.
        if (foreign) {
            return ANKFail(error, [ANKError errorWithCode:ANKErrorInvalidArgument
                                                  message:@"@apexnative/keychain: the key is taken by an item another "
                                                          @"library wrote in this service: move it with migrate, or "
                                                          @"use another service or key."]);
        }
        ANKItem *same = nil;
        BOOL hasOther = NO;
        BOOL isProtected = accessControl != ANKAccessControlNone || hidden;
        for (ANKItem *item in items) {
            isProtected = isProtected || item.accessControl != ANKAccessControlNone;
            if (item.synchronizable == synchronizable) {
                same = item;
            } else {
                hasOther = YES;
            }
        }

        // Access control can't change in place, and an update of a protected item may need authentication.
        if (isProtected) {
            return [self replaceItemForKey:key synchronizable:synchronizable attributes:attributes error:error];
        }

        if (same == nil) {
            NSMutableDictionary *query = [self queryForKey:key synchronizable:synchronizable];
            [query addEntriesFromDictionary:attributes];
            OSStatus status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
            // An item was added since: the next attempt sees it.
            if (status == errSecDuplicateItem) continue;
            if (status != errSecSuccess) return ANKFailWithStatus(error, status, @"couldn't write the item");
            if (hasOther && ![self deleteKey:key synchronizable:!synchronizable error:error]) {
                // Back to the old item.
                SecItemDelete((__bridge CFDictionaryRef)[self queryForKey:key synchronizable:synchronizable]);
                return NO;
            }
            return YES;
        }

        // In place: when SecItemUpdate fails, it changed nothing.
        if (hasOther && ![self deleteKey:key synchronizable:!synchronizable error:error]) return NO;
        OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)[self queryForKey:key synchronizable:synchronizable],
                                        (__bridge CFDictionaryRef)attributes);
        if (status == errSecItemNotFound) continue;
        // An item locked away now: a new item can still take its place.
        if (status == errSecInteractionNotAllowed) {
            return [self replaceItemForKey:key synchronizable:synchronizable attributes:attributes error:error];
        }
        if (status != errSecSuccess) return ANKFailWithStatus(error, status, @"couldn't write the item");
        return YES;
    }
    return ANKFail(error, [ANKError errorWithCode:ANKErrorUnknown
                                          message:@"@apexnative/keychain: couldn't write the item: something else "
                                                  @"kept changing it."]);
}

// Replaces the package's items with the key without a prompt, so that a failure leaves the old one: the new item is
// added first under a temporary key no caller has (a key has no U+0000), which proves it can be; then the old items
// go, the new one is added under the key, and the temporary one goes. No step changes an item with access control,
// which could need authentication.
- (BOOL)replaceItemForKey:(NSString *)key
           synchronizable:(BOOL)synchronizable
               attributes:(NSDictionary *)attributes
                    error:(NSError **)error {
    [self deleteTemporariesOfKey:key];
    NSString *temporaryKey = [NSString stringWithFormat:@"%@%C%@", key, (unichar)0, NSUUID.UUID.UUIDString];
    NSMutableDictionary *query = [self queryForKey:temporaryKey synchronizable:synchronizable];
    [query addEntriesFromDictionary:attributes];
    OSStatus status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
    if (status != errSecSuccess) return ANKFailWithStatus(error, status, @"couldn't write the item");
    NSDictionary *temporary = [self queryForKey:temporaryKey synchronizable:synchronizable];

    status = SecItemDelete((__bridge CFDictionaryRef)[self silentMatchQueryForKey:key]);
    if (status != errSecSuccess && status != errSecItemNotFound) {
        SecItemDelete((__bridge CFDictionaryRef)temporary);
        return ANKFailWithStatus(error, status, @"couldn't replace the item");
    }

    query = [self queryForKey:key synchronizable:synchronizable];
    [query addEntriesFromDictionary:attributes];
    status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
    if (status == errSecSuccess) {
        SecItemDelete((__bridge CFDictionaryRef)temporary);
        return YES;
    }
    // The old item is gone and the new one didn't take the key: the temporary item does, if the Keychain lets it.
    OSStatus renamed = SecItemUpdate((__bridge CFDictionaryRef)temporary,
                                     (__bridge CFDictionaryRef) @{(__bridge id)kSecAttrAccount : key});
    if (renamed == errSecSuccess) return YES;
    SecItemDelete((__bridge CFDictionaryRef)temporary);
    RCTLogWarn(@"[ApexKeychain] Replacing an item failed after its old value was deleted (OSStatus %d).",
               (int)status);
    return ANKFailWithStatus(error, status, @"couldn't replace the item");
}

// Deletes the temporary items a replace of the key left when its process ended between the steps: they hold a value
// no call can reach. Best effort: a failure leaves them for the next replace. The listing skips protected items, whose
// keys can't be read without a prompt: a protected temporary item stays until clear(), which deletes without reading.
- (void)deleteTemporariesOfKey:(NSString *)key {
    NSMutableDictionary *query = [ANKKeychainStore listingOf:[self matchQueryForKey:nil]];
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    NSArray<NSDictionary *> *found = CFBridgingRelease(result);
    if (status != errSecSuccess) return;
    NSString *prefix = [NSString stringWithFormat:@"%@%C", key, (unichar)0];
    for (NSDictionary *attributes in found) {
        id account = attributes[(__bridge id)kSecAttrAccount];
        // A literal search: hasPrefix: of a short key (a tagged pointer string) ignores the U+0000 at the end of the
        // prefix, and would take the key's own item.
        if ([account isKindOfClass:NSString.class] &&
            [account rangeOfString:prefix options:NSAnchoredSearch | NSLiteralSearch].location != NSNotFound) {
            SecItemDelete((__bridge CFDictionaryRef)[self silentMatchQueryForKey:account]);
        }
    }
}

// Deletes the item with the key and the `synchronizable`; no item is no error.
- (BOOL)deleteKey:(NSString *)key synchronizable:(BOOL)synchronizable error:(NSError **)error {
    OSStatus status = SecItemDelete((__bridge CFDictionaryRef)[self queryForKey:key synchronizable:synchronizable]);
    if (status == errSecSuccess || status == errSecItemNotFound) return YES;
    return ANKFailWithStatus(error, status, @"couldn't write the item");
}

#pragma mark - Reading

- (ANKItem *)itemForKey:(NSString *)key context:(LAContext *)context error:(NSError **)error {
    if (![ANKInstallation checkWithError:error]) return nil;
    NSMutableDictionary *query = [self matchQueryForKey:key];
    query[(__bridge id)kSecUseAuthenticationContext] = context ?: ANKSilentContext();
    query[(__bridge id)kSecReturnAttributes] = @YES;
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    NSDictionary *attributes = CFBridgingRelease(result);
    if (status == errSecSuccess) {
        // The simulator's Keychain gives a protected value without authentication; the contract doesn't.
        if (context == nil && ANKIsProtected(attributes)) {
            ANKFail(error, ANKAuthRequiredError());
            return nil;
        }
        return [[ANKItem alloc] initWithAttributes:attributes];
    }
    if (status == errSecItemNotFound) return [self notFound:error];
    // The value needs a prompt, or the device is locked: no query of the attributes can tell, as on a device it needs
    // the authentication too.
    if (status == errSecInteractionNotAllowed && context == nil) {
        ANKFail(error, ANKOutOfReachError(@"couldn't read the item"));
        return nil;
    }
    ANKFailWithStatus(error, status, @"couldn't read the item");
    return nil;
}

- (ANKItem *)attributesForKey:(NSString *)key error:(NSError **)error {
    if (![ANKInstallation checkWithError:error]) return nil;
    NSMutableDictionary *query = [ANKKeychainStore listingOf:[self matchQueryForKey:key]];
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    NSDictionary *attributes = CFBridgingRelease(result);
    if (status == errSecSuccess) {
        if (!ANKIsProtected(attributes)) return [[ANKItem alloc] initWithAttributes:attributes];
        ANKFail(error, ANKAuthRequiredError());
        return nil;
    }
    if (status != errSecItemNotFound) {
        ANKFailWithStatus(error, status, @"couldn't read the item's attributes");
        return nil;
    }
    // Skipped, or none: a protected item is there when a probe finds one.
    NSNumber *has = [self hasItemForKey:key error:error];
    if (has == nil) return nil;
    if (!has.boolValue) return [self notFound:error];
    ANKFail(error, ANKOutOfReachError(@"couldn't read the item's attributes"));
    return nil;
}

- (NSNumber *)hasItemForKey:(NSString *)key error:(NSError **)error {
    if (![ANKInstallation checkWithError:error]) return nil;
    OSStatus status = ANKProbe([self matchQueryForKey:key]);
    // errSecInteractionNotAllowed: there is an item, its protection keeps it out of reach now.
    if (status == errSecSuccess || status == errSecInteractionNotAllowed) return @YES;
    if (status == errSecItemNotFound) return @NO;
    ANKFailWithStatus(error, status, @"couldn't look for the item");
    return nil;
}

// The package's items with the key the Keychain lists without a prompt, synchronized or not: their attributes,
// normally one or none. `foreign` says whether another library has an item with the key, `hidden` whether the package
// has one the listing skipped, an item with access control. No query reads a protected item: one with access control
// is never synchronized, and silent probes tell whose it is.
- (NSArray<ANKItem *> *)itemsForKey:(NSString *)key
                            foreign:(BOOL *)foreign
                             hidden:(BOOL *)hidden
                              error:(NSError **)error {
    NSMutableDictionary *query = [self anyItemQueryForKey:key];
    query[(__bridge id)kSecAttrSynchronizable] = (__bridge id)kSecAttrSynchronizableAny;
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)[ANKKeychainStore listingOf:query], &result);
    NSArray<NSDictionary *> *found = CFBridgingRelease(result);
    if (status == errSecItemNotFound) found = @[];
    if (status != errSecSuccess && status != errSecItemNotFound) {
        ANKFailWithStatus(error, status, @"couldn't write the item");
        return nil;
    }
    NSMutableArray<ANKItem *> *items = [NSMutableArray arrayWithCapacity:found.count];
    BOOL listedLocal = NO;
    for (NSDictionary *attributes in found) {
        id synchronizable = attributes[(__bridge id)kSecAttrSynchronizable];
        listedLocal = listedLocal || ![synchronizable isKindOfClass:NSNumber.class] || ![synchronizable boolValue];
        if ([attributes[(__bridge id)kSecAttrCreator] isEqual:@(ANKItemCreator)]) {
            [items addObject:[[ANKItem alloc] initWithAttributes:attributes]];
        } else {
            *foreign = YES;
        }
    }
    if (listedLocal) return items;

    // An item that isn't synchronized the listing skipped: the package's, or another library's.
    NSMutableDictionary *local = [self anyItemQueryForKey:key];
    local[(__bridge id)kSecAttrSynchronizable] = @NO;
    status = ANKProbe(local);
    if (status == errSecItemNotFound) return items;
    if (status != errSecSuccess && status != errSecInteractionNotAllowed) {
        ANKFailWithStatus(error, status, @"couldn't write the item");
        return nil;
    }
    status = ANKProbe([self queryForKey:key synchronizable:NO]);
    if (status == errSecSuccess || status == errSecInteractionNotAllowed) {
        *hidden = YES;
    } else if (status == errSecItemNotFound) {
        *foreign = YES;
    } else {
        ANKFailWithStatus(error, status, @"couldn't write the item");
        return nil;
    }
    return items;
}

- (NSArray<NSString *> *)allKeysWithError:(NSError **)error {
    if (![ANKInstallation checkWithError:error]) return nil;
    NSMutableDictionary *query = [ANKKeychainStore listingOf:[self matchQueryForKey:nil]];
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    NSArray<NSDictionary *> *found = CFBridgingRelease(result);
    if (status == errSecItemNotFound) return @[];
    if (status != errSecSuccess) {
        ANKFailWithStatus(error, status, @"couldn't list the items");
        return nil;
    }
    // A key once, when a synchronized item and another have it; the temporary key of a replace is no key. A protected
    // item, which the simulator lists, is left out as a device skips it.
    NSMutableOrderedSet<NSString *> *keys = [NSMutableOrderedSet orderedSetWithCapacity:found.count];
    NSString *nul = [NSString stringWithFormat:@"%C", (unichar)0];
    for (NSDictionary *attributes in found) {
        id key = attributes[(__bridge id)kSecAttrAccount];
        if ([key isKindOfClass:NSString.class] && [key length] > 0 && ![key containsString:nul] &&
            !ANKIsProtected(attributes)) {
            [keys addObject:key];
        }
    }
    return keys.array;
}

#pragma mark - Deleting

- (BOOL)removeItemForKey:(NSString *)key error:(NSError **)error {
    if (![ANKInstallation checkWithError:error]) return NO;
    OSStatus status = SecItemDelete((__bridge CFDictionaryRef)[self silentMatchQueryForKey:key]);
    if (status == errSecSuccess || status == errSecItemNotFound) return YES;
    return ANKFailWithStatus(error, status, @"couldn't delete the item");
}

- (BOOL)clearWithError:(NSError **)error {
    if (![ANKInstallation checkWithError:error]) return NO;
    OSStatus status = SecItemDelete((__bridge CFDictionaryRef)[self silentMatchQueryForKey:nil]);
    if (status == errSecSuccess || status == errSecItemNotFound) return YES;
    return ANKFailWithStatus(error, status, @"couldn't clear the store");
}

#pragma mark -

// A missing item: nil, and no error.
- (id)notFound:(NSError **)error {
    if (error != NULL) *error = nil;
    return nil;
}

@end
