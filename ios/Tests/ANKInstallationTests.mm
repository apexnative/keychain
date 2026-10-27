#import <XCTest/XCTest.h>

#import <Security/Security.h>

#import "ANKDevice.h"
#import "ANKInstallation.h"
#import "ANKKeychainStore.h"

// clearOnReinstall against the simulator's Keychain. A new installation is the marker removed from UserDefaults, as
// deleting the app does, and the check forgotten, as a new process has it.

static ANKWriteOptions *ANKOptionsWith(BOOL synchronizable = NO) {
    return [[ANKWriteOptions alloc] initWithAccessible:ANKAccessibleAfterFirstUnlock
                                         accessControl:ANKAccessControlNone
                                          authValidity:0
                                        synchronizable:synchronizable
                                                 label:nil];
}

static NSData *ANKText(NSString *text) {
    return [text dataUsingEncoding:NSUTF8StringEncoding];
}

// The app's default access group: the one the Keychain puts an item in when the query names none.
static NSString *ANKDefaultAccessGroup(void) {
    NSDictionary *query = @{
        (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService : @"dev.apexnative.keychain.tests.access-group",
        (__bridge id)kSecAttrAccount : @"",
        (__bridge id)kSecUseDataProtectionKeychain : @YES,
    };
    SecItemDelete((__bridge CFDictionaryRef)query);
    NSMutableDictionary *item = [query mutableCopy];
    item[(__bridge id)kSecValueData] = [NSData data];
    item[(__bridge id)kSecReturnAttributes] = @YES;
    CFTypeRef result = NULL;
    SecItemAdd((__bridge CFDictionaryRef)item, &result);
    NSDictionary *attributes = CFBridgingRelease(result);
    SecItemDelete((__bridge CFDictionaryRef)query);
    return attributes[(__bridge id)kSecAttrAccessGroup];
}

// The second group of ios/TestHost/TestHost.entitlements, which stands for one shared with other apps: the team
// prefix of the default group, and its own name.
static NSString *ANKSharedAccessGroup(void) {
    NSString *group = ANKDefaultAccessGroup();
    NSString *bundle = NSBundle.mainBundle.bundleIdentifier;
    NSString *prefix = [group hasSuffix:bundle] ? [group substringToIndex:group.length - bundle.length] : @"";
    return [prefix stringByAppendingString:@"dev.apexnative.keychain.tests.shared"];
}

@interface ANKInstallationTests : XCTestCase
@end

@implementation ANKInstallationTests {
    ANKKeychainStore *_store;
    ANKKeychainStore *_other;
}

- (void)setUp {
    NSString *service = [@"dev.apexnative.keychain.tests." stringByAppendingString:NSUUID.UUID.UUIDString];
    _store = [[ANKKeychainStore alloc] initWithService:service accessGroup:nil];
    _other = [[ANKKeychainStore alloc] initWithService:[service stringByAppendingString:@".other"] accessGroup:nil];
}

- (void)tearDown {
    for (ANKKeychainStore *store in @[ _store, _other ]) {
        SecItemDelete((__bridge CFDictionaryRef) @{
            (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService : store.service,
            (__bridge id)kSecAttrSynchronizable : (__bridge id)kSecAttrSynchronizableAny,
            (__bridge id)kSecUseDataProtectionKeychain : @YES,
        });
    }
    ANKDevice.testInfoDictionary = nil;
    [NSUserDefaults.standardUserDefaults setBool:YES forKey:ANKInstallationMarkerKey];
    [ANKInstallation reset];
}

// The app deleted and installed again, with ApexKeychainClearOnReinstall or without it.
- (void)reinstallClearing:(BOOL)clear {
    [NSUserDefaults.standardUserDefaults removeObjectForKey:ANKInstallationMarkerKey];
    ANKDevice.testInfoDictionary = clear ? @{ANKClearOnReinstallKey : @YES} : @{};
    [ANKInstallation reset];
}

// The app launched again: the check forgotten, the marker kept.
- (void)relaunch {
    [ANKInstallation reset];
}

- (void)set:(NSString *)value key:(NSString *)key store:(ANKKeychainStore *)store options:(ANKWriteOptions *)options {
    NSError *error = nil;
    XCTAssertTrue([store setData:ANKText(value) forKey:key encoding:ANKEncodingUTF8 options:options error:&error],
                  @"%@", error);
}

- (NSString *)valueForKey:(NSString *)key store:(ANKKeychainStore *)store {
    NSError *error = nil;
    ANKItem *item = [store itemForKey:key context:nil error:&error];
    XCTAssertNil(error);
    return item != nil ? [[NSString alloc] initWithData:item.data encoding:NSUTF8StringEncoding] : nil;
}

// The items of the service as the Keychain has them, the package's or not, synchronized or not.
- (NSUInteger)countOfRawItems:(ANKKeychainStore *)store {
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef) @{
        (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService : store.service,
        (__bridge id)kSecAttrSynchronizable : (__bridge id)kSecAttrSynchronizableAny,
        (__bridge id)kSecReturnAttributes : @YES,
        (__bridge id)kSecMatchLimit : (__bridge id)kSecMatchLimitAll,
        (__bridge id)kSecUseDataProtectionKeychain : @YES,
    },
                                          &result);
    NSArray *items = CFBridgingRelease(result);
    return status == errSecSuccess ? items.count : 0;
}

- (void)testANewInstallationReadsNothingOfThePreviousOne {
    [self set:@"a" key:@"a" store:_store options:ANKOptionsWith()];
    [self set:@"b" key:@"b" store:_other options:ANKOptionsWith()];
    [self reinstallClearing:YES];

    // The first call, a read, finds nothing: the items went before it.
    XCTAssertNil([self valueForKey:@"a" store:_store]);
    XCTAssertEqualObjects([_other allKeysWithError:NULL], @[]);
    XCTAssertTrue([NSUserDefaults.standardUserDefaults boolForKey:ANKInstallationMarkerKey]);
}

- (void)testEveryReadStartsWithTheCheck {
    NSArray<NSString * (^)(void)> *calls = @[
        ^NSString * {
          return [self->_store hasItemForKey:@"a" error:NULL].boolValue ? @"has" : nil;
        },
        ^NSString * {
          return [self->_store attributesForKey:@"a" error:NULL] != nil ? @"attributes" : nil;
        },
        ^NSString * {
          return [self->_store allKeysWithError:NULL].count > 0 ? @"keys" : nil;
        },
    ];
    for (NSString * (^call)(void) in calls) {
        [self set:@"a" key:@"a" store:_store options:ANKOptionsWith()];
        [self reinstallClearing:YES];
        XCTAssertNil(call());
    }
}

- (void)testOtherLibrariesItemsAndICloudItemsStay {
    [self set:@"synchronized" key:@"synchronized" store:_store options:ANKOptionsWith(YES)];
    XCTAssertEqual(SecItemAdd((__bridge CFDictionaryRef) @{
                       (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
                       (__bridge id)kSecAttrService : _store.service,
                       (__bridge id)kSecAttrAccount : @"foreign",
                       (__bridge id)kSecValueData : ANKText(@"theirs"),
                       (__bridge id)kSecUseDataProtectionKeychain : @YES,
                   },
                              NULL),
                   errSecSuccess);
    [self reinstallClearing:YES];

    XCTAssertEqualObjects([self valueForKey:@"synchronized" store:_store], @"synchronized");
    XCTAssertEqual([self countOfRawItems:_store], 2u);
}

- (void)testItemsOfASharedAccessGroupStay {
    ANKKeychainStore *shared = [[ANKKeychainStore alloc] initWithService:_store.service
                                                             accessGroup:ANKSharedAccessGroup()];
    ANKKeychainStore *own = [[ANKKeychainStore alloc] initWithService:_store.service
                                                          accessGroup:ANKDefaultAccessGroup()];
    [self set:@"shared" key:@"shared" store:shared options:ANKOptionsWith()];
    [self set:@"own" key:@"own" store:own options:ANKOptionsWith()];
    [self set:@"default" key:@"default" store:_store options:ANKOptionsWith()];
    // A store without a group sees the items of every group.
    XCTAssertEqualObjects([[_store allKeysWithError:NULL] sortedArrayUsingSelector:@selector(compare:)],
                          (@[ @"default", @"own", @"shared" ]));
    [self reinstallClearing:YES];

    // The items of the app's default group went, named or not; the shared group's stay.
    XCTAssertEqualObjects([_store allKeysWithError:NULL], @[ @"shared" ]);
    XCTAssertEqualObjects([self valueForKey:@"shared" store:shared], @"shared");
    XCTAssertEqualObjects([own allKeysWithError:NULL], @[]);
}

- (void)testTheMarkerKeepsTheItems {
    [self set:@"a" key:@"a" store:_store options:ANKOptionsWith()];
    ANKDevice.testInfoDictionary = @{ANKClearOnReinstallKey : @YES};
    [self relaunch];

    XCTAssertEqualObjects([self valueForKey:@"a" store:_store], @"a");
}

- (void)testOnlyTheFirstCallClears {
    [self reinstallClearing:YES];
    XCTAssertEqualObjects([_store allKeysWithError:NULL], @[]);
    [self set:@"new" key:@"a" store:_store options:ANKOptionsWith()];

    XCTAssertEqualObjects([self valueForKey:@"a" store:_store], @"new");
}

- (void)testWithoutTheKeyTheItemsStayAndTheMarkerIsSet {
    [self set:@"a" key:@"a" store:_store options:ANKOptionsWith()];
    [self reinstallClearing:NO];

    XCTAssertEqualObjects([self valueForKey:@"a" store:_store], @"a");
    XCTAssertTrue([NSUserDefaults.standardUserDefaults boolForKey:ANKInstallationMarkerKey]);
    // An update that turns the key on deletes nothing: the installation is the same.
    ANKDevice.testInfoDictionary = @{ANKClearOnReinstallKey : @YES};
    [self relaunch];
    XCTAssertEqualObjects([self valueForKey:@"a" store:_store], @"a");
}

@end
