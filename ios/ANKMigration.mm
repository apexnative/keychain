#import "ANKMigration.h"
#import "ANKDevice.h"
#import "ANKError.h"
#import "ANKKeychainStore.h"

#import <TargetConditionals.h>

// The marks of the sources moved and kept: [kind, service, account, access group or ''] each.
static NSString *const ANKMigratedKey = @"dev.apexnative.keychain.migrated";

static NSArray<NSString *> *ANKKindNames(void) {
    return @[ @"genericPassword", @"internetPassword", @"secureStore" ];
}

BOOL ANKMigrationKindOfName(NSString *name, ANKMigrationKind *kind) {
    NSUInteger index = name != nil ? [ANKKindNames() indexOfObject:name] : NSNotFound;
    if (index == NSNotFound) return NO;
    *kind = (ANKMigrationKind)index;
    return YES;
}

// The mark of a source moved and kept.
static NSArray<NSString *> *ANKMark(ANKMigrationKind kind,
                                    NSString *service,
                                    NSString *account,
                                    NSString *accessGroup) {
    return @[ ANKKindNames()[kind], service, account, accessGroup ?: @"" ];
}

static BOOL ANKFail(NSError **error, NSError *failure) {
    if (error != NULL) *error = failure;
    return NO;
}

@interface ANKMigrationSource ()
// Its mark among the moved ones.
- (NSArray<NSString *> *)mark;
@end

@implementation ANKMigrationSource

- (instancetype)initWithKind:(ANKMigrationKind)kind
                     service:(NSString *)service
                     account:(NSString *)account
                 accessGroup:(NSString *)accessGroup
                requiresAuth:(BOOL)requiresAuth
                    migrated:(BOOL)migrated {
    if (self = [super init]) {
        _kind = kind;
        _service = [service copy];
        _account = [account copy];
        _accessGroup = [accessGroup copy];
        _requiresAuth = requiresAuth;
        _migrated = migrated;
    }
    return self;
}

- (NSDictionary *)dictionary {
    NSMutableDictionary *dictionary = [@{
        @"kind" : ANKKindNames()[_kind],
        @"service" : _service,
        @"account" : _account,
        @"requiresAuth" : @(_requiresAuth),
        @"migrated" : @(_migrated),
    } mutableCopy];
    if (_accessGroup != nil) dictionary[@"accessGroup"] = _accessGroup;
    return dictionary;
}

- (NSArray<NSString *> *)mark {
    return ANKMark(_kind, _service, _account, _accessGroup);
}

@end

#pragma mark - The Keychain

// The items of a service or a server as a library wrote them, or the one with the account (a string, or the bytes
// expo-secure-store gives), synchronized or not. Never sent as it is: on a device, a query that matches a protected
// item without a context shows the system's prompt. A listing skips protected items, a read of the value and a delete
// add a context.
static NSMutableDictionary *ANKQuery(ANKMigrationKind kind, NSString *service, id account, NSString *accessGroup) {
    NSMutableDictionary *query = [NSMutableDictionary dictionary];
    if (kind == ANKMigrationKindInternetPassword) {
        query[(__bridge id)kSecClass] = (__bridge id)kSecClassInternetPassword;
        query[(__bridge id)kSecAttrServer] = service;
    } else {
        query[(__bridge id)kSecClass] = (__bridge id)kSecClassGenericPassword;
        query[(__bridge id)kSecAttrService] = service;
    }
    if (account != nil) query[(__bridge id)kSecAttrAccount] = account;
    if (accessGroup != nil) query[(__bridge id)kSecAttrAccessGroup] = accessGroup;
    query[(__bridge id)kSecAttrSynchronizable] = (__bridge id)kSecAttrSynchronizableAny;
    query[(__bridge id)kSecUseDataProtectionKeychain] = @YES;
    return query;
}

// The item of expo-secure-store with the key in a Keychain service of it: its key is its kSecAttrGeneric too, as its
// own queries say, which no item of the package has (its metadata is there).
static NSMutableDictionary *ANKExpoQuery(NSString *service, NSData *key, NSString *accessGroup) {
    NSMutableDictionary *query = ANKQuery(ANKMigrationKindSecureStore, service, key, accessGroup);
    query[(__bridge id)kSecAttrGeneric] = key;
    return query;
}

// The Keychain services of a keychainService of expo-secure-store, in the order its getItemAsync reads them.
static NSArray<NSString *> *ANKExpoServices(NSString *keychainService) {
    return @[
        [keychainService stringByAppendingString:@":no-auth"],
        [keychainService stringByAppendingString:@":auth"],
        keychainService,
    ];
}

// The account as text: expo-secure-store writes the key's UTF-8 bytes. Nil when it isn't UTF-8.
static NSString *ANKAccountText(id account) {
    if ([account isKindOfClass:NSString.class]) return account;
    if (![account isKindOfClass:NSData.class]) return nil;
    return [[NSString alloc] initWithData:account encoding:NSUTF8StringEncoding];
}

// Whether the attributes are of an item another library wrote: not the package's, and for the first versions of
// expo-secure-store, whose service has no suffix, with its shape (the key in kSecAttrGeneric too).
static BOOL ANKIsSourceItem(NSDictionary *attributes, BOOL expoWithoutSuffix) {
    if ([attributes[(__bridge id)kSecAttrCreator] isEqual:@(ANKItemCreator)]) return NO;
    if (!expoWithoutSuffix) return YES;
    id account = attributes[(__bridge id)kSecAttrAccount];
    NSData *bytes = [account isKindOfClass:NSString.class] ? [account dataUsingEncoding:NSUTF8StringEncoding] : account;
    return [attributes[(__bridge id)kSecAttrGeneric] isEqual:bytes];
}

#if TARGET_OS_SIMULATOR
// The simulator's Keychain enforces no access control, so its answer can't say whether a device would ask. The item's
// access control does: a constraint (`od(…)`) shows in its description only.
static BOOL ANKHasConstraints(NSDictionary *attributes) {
    id accessControl = attributes[(__bridge id)kSecAttrAccessControl];
    if (accessControl == nil) return NO;
    NSString *description = CFBridgingRelease(CFCopyDescription((__bridge CFTypeRef)accessControl));
    return [description containsString:@";od("];
}
#endif

// The attributes of the items of the query that need no authentication; an empty list when there are none. The
// Keychain skips the others (kSecUseAuthenticationUISkip): their attributes need a prompt on a device. The simulator
// lists them, and they are left out as a device leaves them.
static NSArray<NSDictionary *> *ANKAttributes(NSMutableDictionary *query, NSError **error) {
    query[(__bridge id)kSecUseAuthenticationUI] = (__bridge id)kSecUseAuthenticationUISkip;
    query[(__bridge id)kSecReturnAttributes] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitAll;
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    NSArray<NSDictionary *> *items = CFBridgingRelease(result);
    if (status == errSecItemNotFound) return @[];
    if (status != errSecSuccess) {
        ANKFail(error, [ANKError errorWithStatus:status action:@"couldn't look for the items to migrate"]);
        return nil;
    }
#if TARGET_OS_SIMULATOR
    NSMutableArray<NSDictionary *> *open = [NSMutableArray arrayWithCapacity:items.count];
    for (NSDictionary *attributes in items) {
        if (!ANKHasConstraints(attributes)) [open addObject:attributes];
    }
    items = open;
#endif
    return items;
}

// The value of the one item of the query; nil without an error when it's gone. Without a context, the read can't
// prompt: an item that needs a prompt fails with AUTH_REQUIRED, one the locked device keeps with
// INTERACTION_NOT_ALLOWED. With one, the Keychain may show its prompt.
static NSData *ANKData(NSMutableDictionary *query, LAContext *context, NSError **error) {
    query[(__bridge id)kSecUseAuthenticationContext] = context ?: ANKSilentContext();
    query[(__bridge id)kSecReturnAttributes] = @YES;
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    NSDictionary *found = CFBridgingRelease(result);
    BOOL needsPrompt = context == nil && status == errSecInteractionNotAllowed && ANKDevice.isProtectedDataAvailable;
#if TARGET_OS_SIMULATOR
    needsPrompt = needsPrompt || (context == nil && status == errSecSuccess && ANKHasConstraints(found));
#endif
    if (needsPrompt) {
        ANKFail(error, [ANKError errorWithCode:ANKErrorAuthRequired
                                       message:@"@apexnative/keychain: the item to migrate has access control: reading "
                                               @"it needs a prompt."]);
        return nil;
    }
    if (status == errSecSuccess) return found[(__bridge id)kSecValueData] ?: [NSData data];
    if (status != errSecItemNotFound) {
        ANKFail(error, [ANKError errorWithStatus:status action:@"couldn't read the item to migrate"]);
    } else if (error != NULL) {
        *error = nil;
    }
    return nil;
}

@implementation ANKMigration

+ (NSArray<ANKMigrationSource *> *)sourcesOfLibrary:(NSString *)library
                                           services:(NSArray<NSString *> *)services
                                            servers:(NSArray<NSString *> *)servers
                                        accessGroup:(NSString *)accessGroup
                                              error:(NSError **)error {
    NSMutableArray<ANKMigrationSource *> *sources = [NSMutableArray array];
    NSArray *marks = [NSUserDefaults.standardUserDefaults arrayForKey:ANKMigratedKey] ?: @[];
    __block NSError *failure = nil;
    // Adds the sources of a Keychain service or server; `keychainService` names them (expo-secure-store's has no
    // suffix), `seen` holds the keys of a keychainService an earlier variant gave.
    BOOL (^add)(ANKMigrationKind, NSString *, NSString *, BOOL, NSMutableSet *) =
        ^BOOL(ANKMigrationKind kind, NSString *service, NSString *keychainService, BOOL expoWithoutSuffix,
              NSMutableSet *seen) {
          NSError *listError = nil;
          NSArray<NSDictionary *> *items = ANKAttributes(ANKQuery(kind, service, nil, accessGroup), &listError);
          if (items == nil) {
              failure = listError;
              return NO;
          }
          for (NSDictionary *attributes in items) {
              id account = attributes[(__bridge id)kSecAttrAccount];
              NSString *text = ANKAccountText(account);
              if (text == nil || [seen containsObject:text] || !ANKIsSourceItem(attributes, expoWithoutSuffix)) {
                  continue;
              }
              [seen addObject:text];
              NSString *group = attributes[(__bridge id)kSecAttrAccessGroup];
              NSError *readError = nil;
              BOOL gone = ANKData(ANKQuery(kind, service, account, group), nil, &readError) == nil && readError == nil;
              if (gone) continue;
              BOOL requiresAuth = [[ANKError codeOfError:readError] isEqualToString:ANKErrorAuthRequired];
              if (readError != nil && !requiresAuth) {
                  failure = readError;
                  return NO;
              }
              BOOL migrated = [marks containsObject:ANKMark(kind, keychainService, text, group)];
              [sources addObject:[[ANKMigrationSource alloc] initWithKind:kind
                                                                  service:keychainService
                                                                  account:text
                                                              accessGroup:group
                                                             requiresAuth:requiresAuth
                                                                 migrated:migrated]];
          }
          return YES;
        };

    if ([library isEqualToString:@"expoSecureStore"]) {
        for (NSString *keychainService in services.count > 0 ? services : @[ @"app" ]) {
            NSMutableSet *seen = [NSMutableSet set];
            for (NSString *service in ANKExpoServices(keychainService)) {
                BOOL withoutSuffix = [service isEqualToString:keychainService];
                if (!add(ANKMigrationKindSecureStore, service, keychainService, withoutSuffix, seen)) {
                    ANKFail(error, failure);
                    return nil;
                }
            }
        }
        return sources;
    }
    for (NSString *service in services.count > 0 ? services : @[ NSBundle.mainBundle.bundleIdentifier ?: @"" ]) {
        if (!add(ANKMigrationKindGenericPassword, service, service, NO, [NSMutableSet set])) {
            ANKFail(error, failure);
            return nil;
        }
    }
    for (NSString *server in servers) {
        if (!add(ANKMigrationKindInternetPassword, server, server, NO, [NSMutableSet set])) {
            ANKFail(error, failure);
            return nil;
        }
    }
    return sources;
}

// The query of the item the source names: for expo-secure-store, the variant its getItemAsync reads, found by silent
// probes, which read nothing of a protected item. Nil without an error when the item is gone.
+ (NSMutableDictionary *)queryOfSource:(ANKMigrationSource *)source error:(NSError **)error {
    if (source.kind != ANKMigrationKindSecureStore) {
        return ANKQuery(source.kind, source.service, source.account, source.accessGroup);
    }
    NSData *key = [source.account dataUsingEncoding:NSUTF8StringEncoding];
    for (NSString *service in ANKExpoServices(source.service)) {
        NSMutableDictionary *probe = ANKExpoQuery(service, key, source.accessGroup);
        probe[(__bridge id)kSecUseAuthenticationContext] = ANKSilentContext();
        probe[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
        OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)probe, NULL);
        // errSecInteractionNotAllowed: there is one, its access control keeps it.
        if (status == errSecSuccess || status == errSecInteractionNotAllowed) {
            return ANKExpoQuery(service, key, source.accessGroup);
        }
        if (status != errSecItemNotFound) {
            ANKFail(error, [ANKError errorWithStatus:status action:@"couldn't look for the item to migrate"]);
            return nil;
        }
    }
    if (error != NULL) *error = nil;
    return nil;
}

+ (NSData *)dataOfSource:(ANKMigrationSource *)source context:(LAContext *)context error:(NSError **)error {
    NSMutableDictionary *query = [self queryOfSource:source error:error];
    return query != nil ? ANKData(query, context, error) : nil;
}

+ (BOOL)finishSource:(ANKMigrationSource *)source removeSource:(BOOL)removeSource error:(NSError **)error {
    NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
    NSMutableArray *marks = [[defaults arrayForKey:ANKMigratedKey] ?: @[] mutableCopy];
    if (!removeSource) {
        if (![marks containsObject:[source mark]]) [marks addObject:[source mark]];
        [defaults setObject:marks forKey:ANKMigratedKey];
        return YES;
    }
    // Every variant of an expo-secure-store key, as its deleteItemAsync does: deleted without reading them, so a
    // protected one goes without a prompt. The first versions' service may hold other items: only those of
    // expo-secure-store's shape go.
    NSMutableArray<NSMutableDictionary *> *queries = [NSMutableArray array];
    if (source.kind != ANKMigrationKindSecureStore) {
        [queries addObject:ANKQuery(source.kind, source.service, source.account, source.accessGroup)];
    } else {
        NSData *key = [source.account dataUsingEncoding:NSUTF8StringEncoding];
        for (NSString *service in ANKExpoServices(source.service)) {
            [queries addObject:ANKExpoQuery(service, key, source.accessGroup)];
        }
    }
    for (NSMutableDictionary *query in queries) {
        query[(__bridge id)kSecUseAuthenticationContext] = ANKSilentContext();
        OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
        if (status != errSecSuccess && status != errSecItemNotFound) {
            return ANKFail(error, [ANKError errorWithStatus:status action:@"couldn't delete the migrated item"]);
        }
    }
    [marks removeObject:[source mark]];
    [defaults setObject:marks forKey:ANKMigratedKey];
    return YES;
}

+ (void)forgetMarks {
    [NSUserDefaults.standardUserDefaults removeObjectForKey:ANKMigratedKey];
}

@end
