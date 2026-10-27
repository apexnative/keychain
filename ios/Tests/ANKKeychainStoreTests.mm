#import <XCTest/XCTest.h>

#import <Security/Security.h>

#import "ANKDevice.h"
#import "ANKError.h"
#import "ANKKeychainStore.h"
#import "ANKTestBiometry.h"

// The store against the simulator's Keychain: every test has a service of its own and clears it.

static ANKWriteOptions *ANKOptionsWith(ANKAccessible accessible = ANKAccessibleAfterFirstUnlock,
                                       BOOL synchronizable = NO,
                                       NSString *label = nil) {
    return [[ANKWriteOptions alloc] initWithAccessible:accessible
                                         accessControl:ANKAccessControlNone
                                          authValidity:0
                                        synchronizable:synchronizable
                                                 label:label];
}

static ANKWriteOptions *ANKProtectedWith(ANKAccessControl accessControl,
                                         NSInteger authValidity = 0,
                                         NSString *label = nil) {
    return [[ANKWriteOptions alloc] initWithAccessible:ANKAccessibleWhenUnlockedThisDeviceOnly
                                         accessControl:accessControl
                                          authValidity:authValidity
                                        synchronizable:NO
                                                 label:label];
}

// A context the simulator takes as authenticated: its Keychain doesn't enforce access control.
static LAContext *ANKAuthenticated(void) {
    LAContext *context = [[LAContext alloc] init];
    context.interactionNotAllowed = YES;
    return context;
}

static NSData *ANKText(NSString *text) {
    return [text dataUsingEncoding:NSUTF8StringEncoding];
}

@interface ANKKeychainStoreTests : XCTestCase
@end

@implementation ANKKeychainStoreTests {
    ANKKeychainStore *_store;
    ANKKeychainStore *_other;
}

+ (void)setUp {
    ANKEnrollBiometryOnSimulator();
}

- (void)setUp {
    NSString *service = [@"dev.apexnative.keychain.tests." stringByAppendingString:NSUUID.UUID.UUIDString];
    _store = [[ANKKeychainStore alloc] initWithService:service accessGroup:nil];
    _other = [[ANKKeychainStore alloc] initWithService:[service stringByAppendingString:@".other"] accessGroup:nil];
}

- (void)tearDown {
    // Every item of the services, the package's or not.
    for (ANKKeychainStore *store in @[ _store, _other ]) {
        SecItemDelete((__bridge CFDictionaryRef) @{
            (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService : store.service,
            (__bridge id)kSecAttrSynchronizable : (__bridge id)kSecAttrSynchronizableAny,
            (__bridge id)kSecUseDataProtectionKeychain : @YES,
        });
    }
    ANKDevice.testInfoDictionary = nil;
    ANKDevice.testBiometryState = nil;
}

// Stops the test when the device can't do the access control now (the simulator without Face ID enrolled).
- (void)requireAccessControl:(ANKAccessControl)accessControl {
    NSError *unavailable = [ANKDevice errorForWritingAccessControl:accessControl];
    if (unavailable != nil) ANKCantRun(unavailable.localizedDescription);
}

// Writes or fails the test.
- (void)set:(NSData *)data key:(NSString *)key options:(ANKWriteOptions *)options {
    [self set:data key:key encoding:ANKEncodingUTF8 options:options];
}

- (void)set:(NSData *)data key:(NSString *)key encoding:(ANKEncoding)encoding options:(ANKWriteOptions *)options {
    NSError *error = nil;
    XCTAssertTrue([_store setData:data forKey:key encoding:encoding options:options error:&error], @"%@", error);
}

// Reads or fails the test; nil when there's no item.
- (ANKItem *)itemForKey:(NSString *)key {
    NSError *error = nil;
    ANKItem *item = [_store itemForKey:key context:nil error:&error];
    XCTAssertNil(error);
    return item;
}

- (NSArray<NSString *> *)allKeys:(ANKKeychainStore *)store {
    NSError *error = nil;
    NSArray<NSString *> *keys = [store allKeysWithError:&error];
    XCTAssertNotNil(keys, @"%@", error);
    return [keys sortedArrayUsingSelector:@selector(compare:)];
}

// Every item with the key, or of the service with nil, synchronized or not, as the Keychain has them.
- (NSArray<NSDictionary *> *)rawItemsForKey:(NSString *)key {
    NSMutableDictionary *query = [@{
        (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService : _store.service,
        (__bridge id)kSecAttrSynchronizable : (__bridge id)kSecAttrSynchronizableAny,
        (__bridge id)kSecReturnAttributes : @YES,
        (__bridge id)kSecMatchLimit : (__bridge id)kSecMatchLimitAll,
        (__bridge id)kSecUseDataProtectionKeychain : @YES,
    } mutableCopy];
    if (key != nil) query[(__bridge id)kSecAttrAccount] = key;
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    NSArray *items = CFBridgingRelease(result);
    if (status == errSecItemNotFound) return @[];
    XCTAssertEqual(status, errSecSuccess);
    return items;
}

// Adds an item as the package would, without the package: its creator, and the attributes as they are.
- (OSStatus)addOwnItem:(NSString *)key attributes:(NSDictionary *)attributes {
    NSMutableDictionary *withCreator = [attributes mutableCopy];
    withCreator[(__bridge id)kSecAttrCreator] = @(ANKItemCreator);
    return [self addRawItem:key attributes:withCreator];
}

// Adds an item as another library would: the attributes as they are.
- (OSStatus)addRawItem:(NSString *)key attributes:(NSDictionary *)attributes {
    NSMutableDictionary *query = [@{
        (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService : _store.service,
        (__bridge id)kSecAttrAccount : key,
        (__bridge id)kSecUseDataProtectionKeychain : @YES,
    } mutableCopy];
    [query addEntriesFromDictionary:attributes];
    return SecItemAdd((__bridge CFDictionaryRef)query, NULL);
}

#pragma mark - Writing and reading

- (void)testWritesAndReadsText {
    [self set:ANKText(@"secret") key:@"token" options:ANKOptionsWith()];

    ANKItem *item = [self itemForKey:@"token"];
    XCTAssertEqualObjects(item.key, @"token");
    XCTAssertEqualObjects(item.data, ANKText(@"secret"));
    XCTAssertEqual(item.encoding, ANKEncodingUTF8);
    XCTAssertEqual(item.accessControl, ANKAccessControlNone);
    XCTAssertEqual(item.accessible, ANKAccessibleAfterFirstUnlock);
    XCTAssertFalse(item.synchronizable);
    XCTAssertNil(item.label);
    XCTAssertNotNil(item.metadata);
}

- (void)testWritesAndReadsBytes {
    uint8_t bytes[] = {0x00, 0xff, 0xfe, 0x80, 0x7f, 0x00};
    NSData *data = [NSData dataWithBytes:bytes length:sizeof(bytes)];
    [self set:data key:@"bytes" encoding:ANKEncodingBase64 options:ANKOptionsWith()];

    ANKItem *item = [self itemForKey:@"bytes"];
    XCTAssertEqualObjects(item.data, data);
    XCTAssertEqual(item.encoding, ANKEncodingBase64);
}

- (void)testWritesAndReadsAnEmptyValue {
    [self set:[NSData data] key:@"empty" options:ANKOptionsWith()];

    ANKItem *item = [self itemForKey:@"empty"];
    XCTAssertNotNil(item);
    XCTAssertEqual(item.data.length, 0u);
}

- (void)testKeysAreAnyUnicode {
    NSString *key = @"ключ 🔑 / with spaces:and.dots";
    [self set:ANKText(@"value") key:key options:ANKOptionsWith()];

    XCTAssertEqualObjects([self itemForKey:key].data, ANKText(@"value"));
    XCTAssertEqualObjects([self allKeys:_store], @[ key ]);
}

- (void)testKeysAreComparedAsTheyAre {
    // No normalization, no folding of case or spaces.
    NSArray<NSString *> *keys = @[ @"\u00e9", @"e\u0301", @"key", @"Key", @"key " ];
    for (NSString *key in keys) [self set:ANKText(key) key:key options:ANKOptionsWith()];

    XCTAssertEqual([self allKeys:_store].count, keys.count);
    for (NSString *key in keys) XCTAssertEqualObjects([self itemForKey:key].data, ANKText(key), @"%@", key);
}

- (void)testAMissingItemIsNilWithoutAnError {
    NSError *error = nil;
    XCTAssertNil([_store itemForKey:@"missing" context:nil error:&error]);
    XCTAssertNil(error);
    XCTAssertNil([_store attributesForKey:@"missing" error:&error]);
    XCTAssertNil(error);
    XCTAssertEqualObjects([_store hasItemForKey:@"missing" error:&error], @NO);
    XCTAssertTrue([_store removeItemForKey:@"missing" error:&error]);
    XCTAssertEqualObjects([self allKeys:_store], @[]);
    XCTAssertTrue([_store clearWithError:&error]);
}

#pragma mark - Overwriting

- (void)testOverwritingReplacesTheValueAndKeepsOneItem {
    [self set:ANKText(@"first") key:@"token" options:ANKOptionsWith()];
    ANKItem *first = [self itemForKey:@"token"];
    [NSThread sleepForTimeInterval:0.01];
    [self set:ANKText(@"second") key:@"token" options:ANKOptionsWith()];

    ANKItem *second = [self itemForKey:@"token"];
    XCTAssertEqualObjects(second.data, ANKText(@"second"));
    XCTAssertEqual([self rawItemsForKey:@"token"].count, 1u);
    XCTAssertEqualObjects(second.createdAt, first.createdAt);
    XCTAssertGreaterThanOrEqual(second.modifiedAt.timeIntervalSince1970, first.modifiedAt.timeIntervalSince1970);
}

- (void)testOverwritingChangesTheEncoding {
    [self set:ANKText(@"text") key:@"value" options:ANKOptionsWith()];
    [self set:ANKText(@"bytes") key:@"value" encoding:ANKEncodingBase64 options:ANKOptionsWith()];

    XCTAssertEqual([self itemForKey:@"value"].encoding, ANKEncodingBase64);
}

- (void)testOverwritingChangesTheAccessibility {
    [self set:ANKText(@"value") key:@"value" options:ANKOptionsWith()];
    [self set:ANKText(@"value") key:@"value" options:ANKOptionsWith(ANKAccessibleWhenUnlockedThisDeviceOnly)];

    NSError *error = nil;
    XCTAssertEqual([_store attributesForKey:@"value" error:&error].accessible,
                   ANKAccessibleWhenUnlockedThisDeviceOnly);
    XCTAssertEqual([self rawItemsForKey:@"value"].count, 1u);
}

- (void)testEveryAccessibilityIsWrittenAndReadBack {
    for (NSInteger accessible = ANKAccessibleAfterFirstUnlock; accessible <= ANKAccessibleWhenPasscodeSetThisDeviceOnly;
         accessible++) {
        NSString *key = ANKAccessibleName((ANKAccessible)accessible);
        NSError *error = nil;
        BOOL written = [_store setData:ANKText(@"value")
                                forKey:key
                              encoding:ANKEncodingUTF8
                               options:ANKOptionsWith((ANKAccessible)accessible)
                                 error:&error];
        if (accessible == ANKAccessibleWhenPasscodeSetThisDeviceOnly && !written) {
            // A simulator has no passcode.
            XCTAssertEqualObjects([ANKError codeOfError:error], ANKErrorPasscodeNotSet, @"%@", error);
            continue;
        }
        XCTAssertTrue(written, @"%@: %@", key, error);
        XCTAssertEqual([_store attributesForKey:key error:&error].accessible, accessible, @"%@", key);
    }
}

- (void)testAFailedWriteLeavesTheOldItem {
    [self requireAccessControl:ANKAccessControlBiometryAny];
    // iCloud Keychain takes no item with access control: the Keychain refuses the new item (errSecParam). The module
    // rejects these options before; the store leaves them to the Keychain. A short key, as most are: the Keychain
    // gives it back as a tagged pointer string.
    ANKWriteOptions *refused = [[ANKWriteOptions alloc] initWithAccessible:ANKAccessibleAfterFirstUnlock
                                                             accessControl:ANKAccessControlBiometryAny
                                                              authValidity:0
                                                            synchronizable:YES
                                                                     label:@"new label"];
    for (ANKWriteOptions *options in @[
             ANKOptionsWith(ANKAccessibleAfterFirstUnlock, NO, @"old label"),
             ANKProtectedWith(ANKAccessControlBiometryAny, 0, @"old label")
         ]) {
        [self set:ANKText(@"old") key:@"token" options:options];

        NSError *error = nil;
        XCTAssertFalse([_store setData:ANKText(@"new")
                                forKey:@"token"
                              encoding:ANKEncodingBase64
                               options:refused
                                 error:&error]);
        XCTAssertEqualObjects(error.userInfo[@"nativeCode"], @(errSecParam), @"%@", error);
        XCTAssertEqualObjects(error.userInfo[@"nativeDomain"], NSOSStatusErrorDomain);

        ANKItem *item = [_store itemForKey:@"token" context:ANKAuthenticated() error:&error];
        XCTAssertEqualObjects(item.data, ANKText(@"old"), @"%@", error);
        XCTAssertEqualObjects(item.label, @"old label");
        XCTAssertEqual(item.encoding, ANKEncodingUTF8);
        XCTAssertEqual(item.accessible, options.accessible);
        XCTAssertEqual(item.accessControl, options.accessControl);
        XCTAssertFalse(item.synchronizable);
        // And no temporary item.
        XCTAssertEqual([self rawItemsForKey:nil].count, 1u);
        XCTAssertTrue([_store clearWithError:&error]);
    }
}

- (void)testSwitchingSynchronizableLeavesOneItem {
    [self set:ANKText(@"local") key:@"value" options:ANKOptionsWith()];
    [self set:ANKText(@"synced") key:@"value" options:ANKOptionsWith(ANKAccessibleAfterFirstUnlock, YES)];

    NSArray<NSDictionary *> *items = [self rawItemsForKey:@"value"];
    XCTAssertEqual(items.count, 1u);
    XCTAssertTrue([items.firstObject[(__bridge id)kSecAttrSynchronizable] boolValue]);
    ANKItem *item = [self itemForKey:@"value"];
    XCTAssertEqualObjects(item.data, ANKText(@"synced"));
    XCTAssertTrue(item.synchronizable);

    [self set:ANKText(@"local again") key:@"value" options:ANKOptionsWith()];
    items = [self rawItemsForKey:@"value"];
    XCTAssertEqual(items.count, 1u);
    XCTAssertFalse([items.firstObject[(__bridge id)kSecAttrSynchronizable] boolValue]);
    XCTAssertEqualObjects([self itemForKey:@"value"].data, ANKText(@"local again"));
}

- (void)testAWriteMergesASynchronizedItemAndALocalOne {
    // Two items with the key, as an older write could leave them: the write keeps one.
    XCTAssertEqual(([self addOwnItem:@"value"
                         attributes:@{
                             (__bridge id)kSecValueData : ANKText(@"local"),
                             (__bridge id)kSecAttrSynchronizable : @NO,
                         }]),
                    errSecSuccess);
    XCTAssertEqual(([self addOwnItem:@"value"
                         attributes:@{
                             (__bridge id)kSecValueData : ANKText(@"synced"),
                             (__bridge id)kSecAttrSynchronizable : @YES,
                         }]),
                    errSecSuccess);
    XCTAssertEqualObjects([self allKeys:_store], @[ @"value" ]);

    [self set:ANKText(@"new") key:@"value" options:ANKOptionsWith()];

    XCTAssertEqual([self rawItemsForKey:@"value"].count, 1u);
    XCTAssertEqualObjects([self itemForKey:@"value"].data, ANKText(@"new"));
}

#pragma mark - Labels

- (void)testTheLabelIsWrittenReplacedAndRemoved {
    [self set:ANKText(@"value")
          key:@"value"
      options:ANKOptionsWith(ANKAccessibleAfterFirstUnlock, NO, @"user@example.com")];
    XCTAssertEqualObjects([self itemForKey:@"value"].label, @"user@example.com");

    [self set:ANKText(@"value") key:@"value" options:ANKOptionsWith(ANKAccessibleAfterFirstUnlock, NO, @"other")];
    XCTAssertEqualObjects([self itemForKey:@"value"].label, @"other");

    [self set:ANKText(@"value") key:@"value" options:ANKOptionsWith()];
    XCTAssertNil([self itemForKey:@"value"].label);

    [self set:ANKText(@"value") key:@"value" options:ANKOptionsWith(ANKAccessibleAfterFirstUnlock, NO, @"")];
    XCTAssertEqualObjects([self itemForKey:@"value"].label, @"");
}

- (void)testTheLabelIsReadWithoutTheValue {
    [self set:ANKText(@"value") key:@"value" options:ANKOptionsWith(ANKAccessibleAfterFirstUnlock, NO, @"label")];

    NSError *error = nil;
    ANKItem *item = [_store attributesForKey:@"value" error:&error];
    XCTAssertEqualObjects(item.label, @"label");
    XCTAssertNil(item.data);
}

#pragma mark - Has, remove, list, clear

- (void)testHasAndRemove {
    NSError *error = nil;
    [self set:ANKText(@"value") key:@"value" options:ANKOptionsWith()];
    XCTAssertEqualObjects([_store hasItemForKey:@"value" error:&error], @YES);

    XCTAssertTrue([_store removeItemForKey:@"value" error:&error]);
    XCTAssertEqualObjects([_store hasItemForKey:@"value" error:&error], @NO);
    XCTAssertNil([self itemForKey:@"value"]);
}

- (void)testRemoveDeletesASynchronizedItemToo {
    [self set:ANKText(@"synced") key:@"value" options:ANKOptionsWith(ANKAccessibleAfterFirstUnlock, YES)];
    NSError *error = nil;
    XCTAssertTrue([_store removeItemForKey:@"value" error:&error]);
    XCTAssertEqual([self rawItemsForKey:@"value"].count, 0u);
}

- (void)testAllKeysAndClearStayInTheStore {
    for (NSString *key in @[ @"a", @"b", @"c" ]) [self set:ANKText(key) key:key options:ANKOptionsWith()];
    [self set:ANKText(@"synced") key:@"d" options:ANKOptionsWith(ANKAccessibleAfterFirstUnlock, YES)];
    NSError *error = nil;
    XCTAssertTrue([_other setData:ANKText(@"other")
                           forKey:@"a"
                         encoding:ANKEncodingUTF8
                          options:ANKOptionsWith()
                            error:&error]);

    NSArray<NSString *> *expected = @[ @"a", @"b", @"c", @"d" ];
    XCTAssertEqualObjects([self allKeys:_store], expected);
    XCTAssertTrue([_store clearWithError:&error]);
    XCTAssertEqualObjects([self allKeys:_store], @[]);
    XCTAssertEqualObjects([self allKeys:_other], @[ @"a" ]);
}

#pragma mark - Items of others

- (void)testItemsOfOtherLibrariesAreNotTheStores {
    XCTAssertEqual(([self addRawItem:@"foreign"
                         attributes:@{
                             (__bridge id)kSecValueData : ANKText(@"theirs"),
                             (__bridge id)kSecAttrLabel : @"their label",
                         }]),
                   errSecSuccess);

    NSError *error = nil;
    XCTAssertNil([self itemForKey:@"foreign"]);
    XCTAssertNil([_store attributesForKey:@"foreign" error:&error]);
    XCTAssertEqualObjects([_store hasItemForKey:@"foreign" error:&error], @NO);
    XCTAssertEqualObjects([self allKeys:_store], @[]);
    XCTAssertTrue([_store removeItemForKey:@"foreign" error:&error]);
    XCTAssertTrue([_store clearWithError:&error]);
    XCTAssertEqual([self rawItemsForKey:@"foreign"].count, 1u);
}

- (void)testAKeyOfAnotherLibrarysItemIsNotTaken {
    XCTAssertEqual(([self addRawItem:@"shared"
                         attributes:@{
                             (__bridge id)kSecValueData : ANKText(@"theirs"),
                             (__bridge id)kSecAttrSynchronizable : @NO,
                         }]),
                   errSecSuccess);

    for (ANKWriteOptions *options in @[ ANKOptionsWith(), ANKOptionsWith(ANKAccessibleAfterFirstUnlock, YES) ]) {
        NSError *error = nil;
        XCTAssertFalse([_store setData:ANKText(@"ours")
                                forKey:@"shared"
                              encoding:ANKEncodingUTF8
                               options:options
                                 error:&error]);
        XCTAssertEqualObjects([ANKError codeOfError:error], ANKErrorInvalidArgument);
        XCTAssertTrue([error.localizedDescription containsString:@"migrate"], @"%@", error.localizedDescription);
    }
    NSArray<NSDictionary *> *items = [self rawItemsForKey:@"shared"];
    XCTAssertEqual(items.count, 1u);
    XCTAssertNil(items.firstObject[(__bridge id)kSecAttrCreator]);
    XCTAssertEqualObjects([self allKeys:_store], @[]);
    // Its value stays.
    NSDictionary *query = @{
        (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService : _store.service,
        (__bridge id)kSecAttrAccount : @"shared",
        (__bridge id)kSecReturnData : @YES,
        (__bridge id)kSecUseDataProtectionKeychain : @YES,
    };
    CFTypeRef result = NULL;
    XCTAssertEqual(SecItemCopyMatching((__bridge CFDictionaryRef)query, &result), errSecSuccess);
    XCTAssertEqualObjects(CFBridgingRelease(result), ANKText(@"theirs"));
    // Another key is free.
    [self set:ANKText(@"ours") key:@"own" options:ANKOptionsWith()];
}

- (void)testThePackagesItemsCarryItsCreator {
    [self set:ANKText(@"value") key:@"value" options:ANKOptionsWith()];

    NSArray<NSDictionary *> *items = [self rawItemsForKey:@"value"];
    XCTAssertEqualObjects(items.firstObject[(__bridge id)kSecAttrCreator], @(ANKItemCreator));
}

#pragma mark - Access control

- (void)testAnItemWithAccessControlIsReadOnlyWithAContext {
    [self requireAccessControl:ANKAccessControlBiometryAny];
    [self set:ANKText(@"secret") key:@"protected" options:ANKProtectedWith(ANKAccessControlBiometryAny, 30, @"label")];

    NSError *error = nil;
    XCTAssertNil([_store itemForKey:@"protected" context:nil error:&error]);
    XCTAssertEqualObjects([ANKError codeOfError:error], ANKErrorAuthRequired, @"%@", error);

    // Never a prompt for these.
    ANKItem *attributes = [_store attributesForKey:@"protected" error:&error];
    XCTAssertEqual(attributes.accessControl, ANKAccessControlBiometryAny);
    XCTAssertEqual(attributes.metadata.authValidity, 30);
    XCTAssertEqual(attributes.accessible, ANKAccessibleWhenUnlockedThisDeviceOnly);
    XCTAssertEqualObjects(attributes.label, @"label");
    XCTAssertTrue(attributes.accessControlRef != NULL);
    XCTAssertEqualObjects([_store hasItemForKey:@"protected" error:&error], @YES);
    XCTAssertEqualObjects([self allKeys:_store], @[ @"protected" ]);

    ANKItem *item = [_store itemForKey:@"protected" context:ANKAuthenticated() error:&error];
    XCTAssertEqualObjects(item.data, ANKText(@"secret"), @"%@", error);
}

- (void)testEveryAccessControlIsStoredWithItsFlags {
    [self requireAccessControl:ANKAccessControlBiometryCurrentSet];
    // The flags of each access control, spelled out here rather than taken from ANKAccessControlFlags.
    NSDictionary<NSNumber *, NSNumber *> *flags = @{
        @(ANKAccessControlBiometryAny) : @(kSecAccessControlBiometryAny),
        @(ANKAccessControlBiometryCurrentSet) : @(kSecAccessControlBiometryCurrentSet),
        @(ANKAccessControlBiometryAnyOrPasscode) : @(kSecAccessControlUserPresence),
        @(ANKAccessControlBiometryCurrentSetOrPasscode) :
            @(kSecAccessControlBiometryCurrentSet | kSecAccessControlOr | kSecAccessControlDevicePasscode),
        @(ANKAccessControlPasscode) : @(kSecAccessControlDevicePasscode),
    };
    NSDictionary<NSNumber *, id> *accessibles = @{
        @(ANKAccessibleWhenUnlockedThisDeviceOnly) : (__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        @(ANKAccessibleAfterFirstUnlock) : (__bridge id)kSecAttrAccessibleAfterFirstUnlock,
    };
    // What SecAccessControlCreateWithFlags makes of an accessibility and flags; two are CFEqual when both are the same.
    id (^expected)(NSNumber *, NSNumber *) = ^id(NSNumber *accessControl, NSNumber *accessible) {
      return CFBridgingRelease(SecAccessControlCreateWithFlags(
          kCFAllocatorDefault, (__bridge CFStringRef)accessibles[accessible],
          (SecAccessControlCreateFlags)flags[accessControl].unsignedIntegerValue, NULL));
    };

    for (NSNumber *accessControl in flags) {
        for (NSNumber *accessible in accessibles) {
            ANKAccessControl value = (ANKAccessControl)accessControl.integerValue;
            NSString *key = [NSString stringWithFormat:@"%@ %@", ANKAccessControlName(value),
                                                       ANKAccessibleName((ANKAccessible)accessible.integerValue)];
            [self set:ANKText(key)
                    key:key
                options:[[ANKWriteOptions alloc] initWithAccessible:(ANKAccessible)accessible.integerValue
                                                      accessControl:value
                                                       authValidity:0
                                                     synchronizable:NO
                                                              label:nil]];

            NSError *error = nil;
            ANKItem *item = [_store attributesForKey:key error:&error];
            XCTAssertEqual(item.accessControl, value, @"%@", key);
            XCTAssertEqual(item.accessible, accessible.integerValue, @"%@", key);
            // The Keychain's own access control: these flags and this accessibility, no other.
            XCTAssertTrue(item.accessControlRef != NULL, @"%@: %@", key, error);
            for (NSNumber *otherAccessControl in flags) {
                for (NSNumber *otherAccessible in accessibles) {
                    BOOL same = [otherAccessControl isEqual:accessControl] && [otherAccessible isEqual:accessible];
                    BOOL equal = item.accessControlRef != NULL &&
                                 CFEqual(item.accessControlRef,
                                         (__bridge CFTypeRef)expected(otherAccessControl, otherAccessible));
                    XCTAssertEqual(equal, same, @"%@ against %@ %@: %@", key, otherAccessControl, otherAccessible,
                                   item.accessControlRef);
                }
            }
        }
    }
}

- (void)testACurrentSetItemKeepsTheBiometrysState {
    [self requireAccessControl:ANKAccessControlBiometryCurrentSet];
    NSData *state = [@"state" dataUsingEncoding:NSUTF8StringEncoding];
    ANKDevice.testBiometryState = state;
    [self set:ANKText(@"secret") key:@"bound" options:ANKProtectedWith(ANKAccessControlBiometryCurrentSet)];

    NSError *error = nil;
    ANKItemMetadata *metadata = [_store attributesForKey:@"bound" error:&error].metadata;
    XCTAssertEqualObjects(metadata.domainState, state);
    XCTAssertEqual(metadata.osVersion, ANKDevice.majorOSVersion);
}

- (void)testProtectionChangesBothWaysLeavingOneItem {
    [self requireAccessControl:ANKAccessControlBiometryAny];
    [self set:ANKText(@"open") key:@"value" options:ANKOptionsWith()];
    ANKItem *open = [_store attributesForKey:@"value" error:NULL];

    [self set:ANKText(@"locked") key:@"value" options:ANKProtectedWith(ANKAccessControlBiometryAny)];
    ANKItem *locked = [_store itemForKey:@"value" context:ANKAuthenticated() error:NULL];
    XCTAssertEqualObjects(locked.data, ANKText(@"locked"));
    XCTAssertEqual(locked.accessControl, ANKAccessControlBiometryAny);
    XCTAssertEqual([self rawItemsForKey:@"value"].count, 1u);
    XCTAssertGreaterThanOrEqual(locked.createdAt.timeIntervalSince1970, open.createdAt.timeIntervalSince1970);

    [self set:ANKText(@"open again") key:@"value" options:ANKOptionsWith(ANKAccessibleAfterFirstUnlock, NO, @"l")];
    ANKItem *item = [self itemForKey:@"value"];
    XCTAssertEqualObjects(item.data, ANKText(@"open again"));
    XCTAssertEqual(item.accessControl, ANKAccessControlNone);
    XCTAssertEqualObjects(item.label, @"l");
    XCTAssertEqualObjects([self allKeys:_store], @[ @"value" ]);
    XCTAssertEqual([self rawItemsForKey:@"value"].count, 1u);
}

- (void)testAProtectedItemIsReplacedWithoutLeavingATemporaryItem {
    // Metadata that says 'biometryAny' over an item without access control: the write takes the path of a protected
    // item whatever the device can do.
    ANKItemMetadata *metadata = [[ANKItemMetadata alloc] initWithEncoding:ANKEncodingUTF8
                                                            accessControl:ANKAccessControlBiometryAny
                                                             authValidity:0
                                                                 hasLabel:NO
                                                                osVersion:0
                                                              domainState:nil];
    XCTAssertEqual(([self addOwnItem:@"protected"
                         attributes:@{
                             (__bridge id)kSecValueData : ANKText(@"old"),
                             (__bridge id)kSecAttrGeneric : metadata.attribute,
                             (__bridge id)kSecAttrSynchronizable : @NO,
                         }]),
                   errSecSuccess);
    XCTAssertEqual([_store attributesForKey:@"protected" error:NULL].accessControl, ANKAccessControlBiometryAny);

    [self set:ANKText(@"new") key:@"protected" options:ANKOptionsWith(ANKAccessibleAfterFirstUnlock, NO, @"label")];

    ANKItem *item = [self itemForKey:@"protected"];
    XCTAssertEqualObjects(item.data, ANKText(@"new"));
    XCTAssertEqual(item.accessControl, ANKAccessControlNone);
    XCTAssertEqualObjects(item.label, @"label");
    XCTAssertEqualObjects([self allKeys:_store], @[ @"protected" ]);
    XCTAssertEqual([self rawItemsForKey:@"protected"].count, 1u);
}

- (void)testAReplaceDeletesTheTemporaryItemsAnInterruptedOneLeft {
    [self requireAccessControl:ANKAccessControlBiometryAny];
    // What replaces of 'token' left when their process ended between the steps; and one of 'tokens'.
    NSString *(^temporaryOf)(NSString *) = ^NSString *(NSString *key) {
      return [NSString stringWithFormat:@"%@%C%@", key, (unichar)0, NSUUID.UUID.UUIDString];
    };
    NSArray<NSString *> *leftovers = @[ temporaryOf(@"token"), temporaryOf(@"token") ];
    NSString *another = temporaryOf(@"tokens");
    for (NSString *temporary in [leftovers arrayByAddingObject:another]) {
        XCTAssertEqual(([self addOwnItem:temporary
                             attributes:@{
                                 (__bridge id)kSecValueData : ANKText(@"left"),
                                 (__bridge id)kSecAttrSynchronizable : @NO,
                             }]),
                       errSecSuccess);
    }
    for (NSString *key in @[ @"tok", @"token", @"tokenRefresh" ]) {
        [self set:ANKText(key) key:key options:ANKOptionsWith()];
    }
    // A temporary item is no key.
    XCTAssertEqualObjects([self allKeys:_store], (@[ @"tok", @"token", @"tokenRefresh" ]));

    [self set:ANKText(@"new") key:@"token" options:ANKProtectedWith(ANKAccessControlBiometryAny)];

    // The key's temporary items went, and nothing else.
    NSMutableArray<NSString *> *accounts = [NSMutableArray array];
    for (NSDictionary *item in [self rawItemsForKey:nil]) [accounts addObject:item[(__bridge id)kSecAttrAccount]];
    NSArray *expected = @[ @"tok", @"token", @"tokenRefresh", another ];
    XCTAssertEqualObjects([accounts sortedArrayUsingSelector:@selector(compare:)],
                          [expected sortedArrayUsingSelector:@selector(compare:)]);
    ANKItem *item = [_store itemForKey:@"token" context:ANKAuthenticated() error:NULL];
    XCTAssertEqualObjects(item.data, ANKText(@"new"));
    XCTAssertEqual(item.accessControl, ANKAccessControlBiometryAny);
}

- (void)testAMissingUsageDescriptionStopsABiometricWrite {
    if (![ANKDevice.biometryTypes containsObject:@"faceID"]) ANKCantRun(@"No Face ID on this device.");
    ANKDevice.testInfoDictionary = @{};
    [self set:ANKText(@"old") key:@"value" options:ANKOptionsWith()];

    NSError *error = nil;
    XCTAssertFalse([_store setData:ANKText(@"new")
                            forKey:@"value"
                          encoding:ANKEncodingUTF8
                           options:ANKProtectedWith(ANKAccessControlBiometryAnyOrPasscode)
                             error:&error]);
    XCTAssertEqualObjects([ANKError codeOfError:error], ANKErrorMissingUsageDescription);
    XCTAssertEqualObjects([self itemForKey:@"value"].data, ANKText(@"old"));
    // The passcode alone needs no Face ID.
    XCTAssertTrue([_store setData:ANKText(@"new")
                           forKey:@"value"
                         encoding:ANKEncodingUTF8
                          options:ANKProtectedWith(ANKAccessControlPasscode)
                            error:&error],
                  @"%@", error);
}

#pragma mark - Errors

- (void)testAnAccessGroupWithoutAnEntitlementIsMissingEntitlement {
    ANKKeychainStore *store = [[ANKKeychainStore alloc] initWithService:_store.service
                                                            accessGroup:@"ABCDE12345.dev.apexnative.not-entitled"];
    NSError *error = nil;
    XCTAssertFalse([store setData:ANKText(@"value")
                           forKey:@"value"
                         encoding:ANKEncodingUTF8
                          options:ANKOptionsWith()
                            error:&error]);
    XCTAssertEqualObjects([ANKError codeOfError:error], ANKErrorMissingEntitlement, @"%@", error);
    XCTAssertEqualObjects(error.userInfo[@"nativeCode"], @(errSecMissingEntitlement));
    XCTAssertEqualObjects(error.userInfo[@"nativeDomain"], NSOSStatusErrorDomain);
}

@end
