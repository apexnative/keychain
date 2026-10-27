#import <XCTest/XCTest.h>

#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>

#import "ANKError.h"
#import "ANKKeychainModule.h"
#import "ANKKeychainStore.h"
#import "ANKMigration.h"
#import "ANKTestBiometry.h"
#import "ANKTestPromise.h"

// migrate's sources against the simulator's Keychain: items written as react-native-keychain 10 and expo-secure-store
// write them (their iOS sources), in services and servers of each test's own.

static NSData *ANKText(NSString *text) {
    return [text dataUsingEncoding:NSUTF8StringEncoding];
}

// An access control as the libraries make one.
static id ANKAccessControlWith(SecAccessControlCreateFlags flags) {
    return CFBridgingRelease(SecAccessControlCreateWithFlags(
        kCFAllocatorDefault, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, flags, NULL));
}

// A context the simulator takes as authenticated: its Keychain doesn't enforce access control.
static LAContext *ANKAuthenticated(void) {
    LAContext *context = [[LAContext alloc] init];
    context.interactionNotAllowed = YES;
    return context;
}

// A source as a line: its kind, service, account, and 'auth' and 'migrated' when it is.
static NSString *ANKLine(ANKMigrationSource *source) {
    NSDictionary *dictionary = source.dictionary;
    return [NSString stringWithFormat:@"%@ %@ %@%@%@", dictionary[@"kind"], dictionary[@"service"],
                                      dictionary[@"account"], source.requiresAuth ? @" auth" : @"",
                                      source.migrated ? @" migrated" : @""];
}

@interface ANKMigrationTests : XCTestCase
@end

@implementation ANKMigrationTests {
    NSString *_service;
    NSString *_server;
    // expo-secure-store's keychainService.
    NSString *_expo;
    // The queries of the items written, deleted after the test.
    NSMutableArray<NSDictionary *> *_written;
}

+ (void)setUp {
    ANKEnrollBiometryOnSimulator();
}

- (void)setUp {
    NSString *unique = NSUUID.UUID.UUIDString;
    _service = [@"dev.apexnative.keychain.tests." stringByAppendingString:unique];
    _server = [unique.lowercaseString stringByAppendingString:@".example.com"];
    _expo = [@"tests-" stringByAppendingString:unique];
    _written = [NSMutableArray array];
    [ANKMigration forgetMarks];
}

- (void)tearDown {
    for (NSDictionary *query in _written) SecItemDelete((__bridge CFDictionaryRef)query);
    [ANKMigration forgetMarks];
}

#pragma mark - The libraries' items

// Adds an item with the attributes as they are, and deletes it after the test.
- (void)add:(NSDictionary *)attributes {
    NSMutableDictionary *item = [attributes mutableCopy];
    item[(__bridge id)kSecUseDataProtectionKeychain] = @YES;
    XCTAssertEqual(SecItemAdd((__bridge CFDictionaryRef)item, NULL), errSecSuccess, @"%@", attributes);
    NSMutableDictionary *query = [NSMutableDictionary dictionary];
    for (id key in @[
             (__bridge id)kSecClass, (__bridge id)kSecAttrService, (__bridge id)kSecAttrServer,
             (__bridge id)kSecAttrAccount
         ]) {
        query[key] = attributes[key];
    }
    query[(__bridge id)kSecAttrSynchronizable] = (__bridge id)kSecAttrSynchronizableAny;
    query[(__bridge id)kSecUseDataProtectionKeychain] = @YES;
    [_written addObject:query];
}

// `protection`: a kSecAttrAccessible value, or a SecAccessControl.
static NSString *ANKProtectionKey(id protection) {
    return (__bridge NSString *)([protection isKindOfClass:NSString.class] ? kSecAttrAccessible
                                                                           : kSecAttrAccessControl);
}

// As react-native-keychain's setGenericPassword writes.
- (void)addGeneric:(NSString *)service
          username:(NSString *)username
          password:(NSData *)password
        protection:(id)protection
         cloudSync:(BOOL)cloudSync {
    [self add:@{
        (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService : service,
        (__bridge id)kSecAttrAccount : username,
        (__bridge id)kSecAttrSynchronizable : @(cloudSync),
        (__bridge id)kSecValueData : password,
        ANKProtectionKey(protection) : protection,
    }];
}

- (void)addGeneric:(NSString *)service username:(NSString *)username password:(NSString *)password {
    [self addGeneric:service
            username:username
            password:ANKText(password)
          protection:(__bridge id)kSecAttrAccessibleAfterFirstUnlock
           cloudSync:NO];
}

// As react-native-keychain's setInternetCredentials writes.
- (void)addInternet:(NSString *)server username:(NSString *)username password:(NSString *)password {
    [self add:@{
        (__bridge id)kSecClass : (__bridge id)kSecClassInternetPassword,
        (__bridge id)kSecAttrServer : server,
        (__bridge id)kSecAttrAccount : username,
        (__bridge id)kSecAttrSynchronizable : @NO,
        (__bridge id)kSecValueData : ANKText(password),
        (__bridge id)kSecAttrAccessible : (__bridge id)kSecAttrAccessibleAfterFirstUnlock,
    }];
}

// As expo-secure-store's setItemAsync writes: `suffix` ':no-auth', ':auth' (requireAuthentication) or '' (its first
// versions).
- (void)addExpo:(NSString *)key value:(NSString *)value suffix:(NSString *)suffix {
    NSMutableDictionary *item = [@{
        (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService : [_expo stringByAppendingString:suffix],
        (__bridge id)kSecAttrGeneric : ANKText(key),
        (__bridge id)kSecAttrAccount : ANKText(key),
        (__bridge id)kSecValueData : ANKText(value),
    } mutableCopy];
    if ([suffix isEqualToString:@":auth"]) {
        item[(__bridge id)kSecAttrAccessControl] = ANKAccessControlWith(kSecAccessControlBiometryCurrentSet);
    } else {
        item[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleWhenUnlocked;
    }
    [self add:item];
}

#pragma mark - Reading them

- (NSArray<ANKMigrationSource *> *)sourcesOf:(NSString *)library
                                    services:(NSArray<NSString *> *)services
                                     servers:(NSArray<NSString *> *)servers {
    NSError *error = nil;
    NSArray<ANKMigrationSource *> *sources = [ANKMigration sourcesOfLibrary:library
                                                                   services:services
                                                                    servers:servers
                                                                accessGroup:nil
                                                                      error:&error];
    XCTAssertNotNil(sources, @"%@", error);
    return sources;
}

- (NSArray<NSString *> *)linesOf:(NSString *)library
                        services:(NSArray<NSString *> *)services
                         servers:(NSArray<NSString *> *)servers {
    NSMutableArray<NSString *> *lines = [NSMutableArray array];
    for (ANKMigrationSource *source in [self sourcesOf:library services:services servers:servers]) {
        [lines addObject:ANKLine(source)];
    }
    return [lines sortedArrayUsingSelector:@selector(compare:)];
}

- (ANKMigrationSource *)sourceOf:(NSString *)library account:(NSString *)account {
    NSArray<NSString *> *services = [library isEqualToString:@"expoSecureStore"] ? @[ _expo ] : @[ _service ];
    for (ANKMigrationSource *source in [self sourcesOf:library services:services servers:@[]]) {
        if ([source.account isEqualToString:account]) return source;
    }
    XCTFail(@"No source %@.", account);
    return nil;
}

// The value as text; nil when the item is gone.
- (NSString *)valueOf:(ANKMigrationSource *)source context:(LAContext *)context {
    NSError *error = nil;
    NSData *data = [ANKMigration dataOfSource:source context:context error:&error];
    XCTAssertNil(error);
    return data != nil ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
}

#pragma mark - react-native-keychain

- (void)testReactNativeKeychainsPasswordsAreTheSources {
    [self addGeneric:_service username:@"alice" password:@"secret"];
    [self addInternet:_server username:@"bob" password:@"hunter2"];
    // The package's own item in the service is none.
    ANKKeychainStore *store = [[ANKKeychainStore alloc] initWithService:_service accessGroup:nil];
    ANKWriteOptions *options = [[ANKWriteOptions alloc] initWithAccessible:ANKAccessibleAfterFirstUnlock
                                                             accessControl:ANKAccessControlNone
                                                              authValidity:0
                                                            synchronizable:NO
                                                                     label:nil];
    XCTAssertTrue([store setData:ANKText(@"ours") forKey:@"own" encoding:ANKEncodingUTF8 options:options error:NULL]);
    [self addTeardownBlock:^{
      [store clearWithError:NULL];
    }];

    NSArray<ANKMigrationSource *> *sources = [self sourcesOf:@"reactNativeKeychain"
                                                    services:@[ _service ]
                                                     servers:@[ _server ]];
    XCTAssertEqualObjects(ANKLine(sources[0]), ([NSString stringWithFormat:@"genericPassword %@ alice", _service]));
    XCTAssertEqualObjects(ANKLine(sources[1]), ([NSString stringWithFormat:@"internetPassword %@ bob", _server]));
    XCTAssertEqual(sources.count, 2u);
    XCTAssertEqualObjects([self valueOf:sources[0] context:nil], @"secret");
    XCTAssertEqualObjects([self valueOf:sources[1] context:nil], @"hunter2");
}

- (void)testTheDefaultServiceIsTheBundleIdentifier {
    NSString *username = NSUUID.UUID.UUIDString;
    [self addGeneric:NSBundle.mainBundle.bundleIdentifier username:username password:@"secret"];

    NSArray<NSString *> *lines = [self linesOf:@"reactNativeKeychain" services:@[] servers:@[]];
    NSString *line =
        [NSString stringWithFormat:@"genericPassword %@ %@", NSBundle.mainBundle.bundleIdentifier, username];
    XCTAssertTrue([lines containsObject:line], @"%@", lines);
}

- (void)testICloudItemsAreSourcesToo {
    [self addGeneric:_service
            username:@"alice"
            password:ANKText(@"secret")
          protection:(__bridge id)kSecAttrAccessibleAfterFirstUnlock
           cloudSync:YES];

    ANKMigrationSource *source = [self sourceOf:@"reactNativeKeychain" account:@"alice"];
    XCTAssertEqualObjects([self valueOf:source context:nil], @"secret");
    XCTAssertTrue([ANKMigration finishSource:source removeSource:YES error:NULL]);
    XCTAssertEqualObjects([self linesOf:@"reactNativeKeychain" services:@[ _service ] servers:@[]], @[]);
}

- (void)testAProtectedSourceNeedsAPrompt {
    for (NSNumber *flags in @[
             @(kSecAccessControlBiometryAny), @(kSecAccessControlBiometryCurrentSet), @(kSecAccessControlUserPresence),
             @(kSecAccessControlDevicePasscode)
         ]) {
        NSString *service = [_service stringByAppendingFormat:@".%@", flags];
        [self addGeneric:service
                username:@"alice"
                password:ANKText(@"secret")
              protection:ANKAccessControlWith((SecAccessControlCreateFlags)flags.unsignedIntegerValue)
               cloudSync:NO];

        ANKMigrationSource *source =
            [self sourcesOf:@"reactNativeKeychain" services:@[ service ] servers:@[]].firstObject;
        XCTAssertTrue(source.requiresAuth, @"%@", flags);
        NSError *error = nil;
        XCTAssertNil([ANKMigration dataOfSource:source context:nil error:&error]);
        XCTAssertEqualObjects([ANKError codeOfError:error], ANKErrorAuthRequired);
        SecAccessControlRef accessControl = [ANKMigration copyAccessControlOfSource:source error:NULL];
        XCTAssertTrue(accessControl != NULL);
        if (accessControl != NULL) CFRelease(accessControl);
        XCTAssertEqualObjects([self valueOf:source context:ANKAuthenticated()], @"secret");
    }
}

#pragma mark - expo-secure-store

- (void)testExpoKeysAreOneSourceEachAsItsGetItemReadsThem {
    [self addExpo:@"a" value:@"no-auth" suffix:@":no-auth"];
    [self addExpo:@"a" value:@"auth" suffix:@":auth"];
    [self addExpo:@"a" value:@"first versions" suffix:@""];
    [self addExpo:@"b" value:@"auth" suffix:@":auth"];
    [self addExpo:@"c" value:@"first versions" suffix:@""];
    // Another library's item in the service without a suffix isn't expo-secure-store's.
    [self add:@{
        (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService : _expo,
        (__bridge id)kSecAttrAccount : @"other",
        (__bridge id)kSecValueData : ANKText(@"theirs"),
    }];

    XCTAssertEqualObjects([self linesOf:@"expoSecureStore" services:@[ _expo ] servers:@[]], (@[
                              [NSString stringWithFormat:@"secureStore %@ a", _expo],
                              [NSString stringWithFormat:@"secureStore %@ b auth", _expo],
                              [NSString stringWithFormat:@"secureStore %@ c", _expo],
                          ]));
    XCTAssertEqualObjects([self valueOf:[self sourceOf:@"expoSecureStore" account:@"a"] context:nil], @"no-auth");
    XCTAssertEqualObjects([self valueOf:[self sourceOf:@"expoSecureStore" account:@"c"] context:nil],
                          @"first versions");
    ANKMigrationSource *b = [self sourceOf:@"expoSecureStore" account:@"b"];
    NSError *error = nil;
    XCTAssertNil([ANKMigration dataOfSource:b context:nil error:&error]);
    XCTAssertEqualObjects([ANKError codeOfError:error], ANKErrorAuthRequired);
    XCTAssertEqualObjects([self valueOf:b context:ANKAuthenticated()], @"auth");
}

- (void)testFinishingAnExpoKeyRemovesEveryVariant {
    [self addExpo:@"a" value:@"no-auth" suffix:@":no-auth"];
    [self addExpo:@"a" value:@"auth" suffix:@":auth"];
    [self addExpo:@"a" value:@"first versions" suffix:@""];
    [self addExpo:@"b" value:@"no-auth" suffix:@":no-auth"];

    XCTAssertTrue([ANKMigration finishSource:[self sourceOf:@"expoSecureStore" account:@"a"]
                                removeSource:YES
                                       error:NULL]);
    XCTAssertEqualObjects([self linesOf:@"expoSecureStore" services:@[ _expo ] servers:@[]],
                          (@[ [NSString stringWithFormat:@"secureStore %@ b", _expo] ]));
}

#pragma mark - Finishing

- (void)testAKeptSourceIsMarkedAndARemovedOneIsGone {
    [self addGeneric:_service username:@"alice" password:@"secret"];
    ANKMigrationSource *source = [self sourceOf:@"reactNativeKeychain" account:@"alice"];
    XCTAssertFalse(source.migrated);

    XCTAssertTrue([ANKMigration finishSource:source removeSource:NO error:NULL]);
    source = [self sourceOf:@"reactNativeKeychain" account:@"alice"];
    XCTAssertTrue(source.migrated);
    XCTAssertEqualObjects([self valueOf:source context:nil], @"secret");

    XCTAssertTrue([ANKMigration finishSource:source removeSource:YES error:NULL]);
    XCTAssertEqualObjects([self linesOf:@"reactNativeKeychain" services:@[ _service ] servers:@[]], @[]);
    XCTAssertNil([self valueOf:source context:nil]);
    // Its mark went with it: an item written again is a source again.
    [self addGeneric:_service username:@"alice" password:@"again"];
    XCTAssertFalse([self sourceOf:@"reactNativeKeychain" account:@"alice"].migrated);
    // No item is no error.
    XCTAssertTrue([ANKMigration finishSource:source removeSource:YES error:NULL]);
}

#pragma mark - The module

- (void)testTheModuleAnswersAsTheContractSays {
    [self addGeneric:_service username:@"alice" password:@"secret"];
    NSString *binary = [_service stringByAppendingString:@".binary"];
    [self addGeneric:binary
            username:@"bytes"
            password:[NSData dataWithBytes:"\xff\xfe" length:2]
          protection:(__bridge id)kSecAttrAccessibleAfterFirstUnlock
           cloudSync:NO];
    NSString *nul = [_service stringByAppendingString:@".nul"];
    [self addGeneric:nul
            username:@"nul"
            password:[NSData dataWithBytes:"a\0b" length:3]
          protection:(__bridge id)kSecAttrAccessibleAfterFirstUnlock
           cloudSync:NO];
    ANKKeychainModule *module = [[ANKKeychainModule alloc] init];
    JS::NativeApexKeychain::Prompt prompt(@{@"confirmationRequired" : @YES});

    JS::NativeApexKeychain::MigrationQuery query(
        @{@"library" : @"reactNativeKeychain", @"services" : @[ _service, binary, nul ], @"servers" : @[]});
    ANKPromise *found = [ANKPromise new];
    [module getMigrationSources:query resolve:found.resolve reject:found.reject];
    NSArray<NSDictionary *> *sources = found.value;
    XCTAssertEqual(sources.count, 3u, @"%@ %@", found.code, found.message);
    for (NSDictionary *dictionary in sources) {
        XCTAssertEqualObjects(dictionary[@"kind"], @"genericPassword");
        XCTAssertEqualObjects(dictionary[@"requiresAuth"], @NO);
        XCTAssertEqualObjects(dictionary[@"migrated"], @NO);
    }

    NSDictionary *alice = sources[0];
    JS::NativeApexKeychain::MigrationSource aliceSource(alice);
    ANKPromise *read = [ANKPromise new];
    [module readMigrationSource:aliceSource prompt:prompt resolve:read.resolve reject:read.reject];
    XCTAssertEqualObjects(read.value, @"secret");
    for (NSDictionary *corrupted in @[ sources[1], sources[2] ]) {
        JS::NativeApexKeychain::MigrationSource source(corrupted);
        ANKPromise *promise = [ANKPromise new];
        [module readMigrationSource:source prompt:prompt resolve:promise.resolve reject:promise.reject];
        XCTAssertEqualObjects(promise.code, ANKErrorDataCorrupted, @"%@", corrupted);
    }

    ANKPromise *finished = [ANKPromise new];
    [module finishMigrationSource:aliceSource removeSource:YES resolve:finished.resolve reject:finished.reject];
    XCTAssertTrue(finished.resolved);
    ANKPromise *gone = [ANKPromise new];
    [module readMigrationSource:aliceSource prompt:prompt resolve:gone.resolve reject:gone.reject];
    XCTAssertTrue(gone.resolved);
    XCTAssertNil(gone.value);
}

- (void)testTheModuleRejectsWhatIsntOfTheContract {
    ANKKeychainModule *module = [[ANKKeychainModule alloc] init];
    for (NSDictionary *arguments in @[
             @{@"library" : @"keychain", @"services" : @[], @"servers" : @[]},
             @{@"library" : @"reactNativeKeychain", @"services" : @[ @"" ], @"servers" : @[]},
             @{@"library" : @"reactNativeKeychain", @"services" : @[], @"servers" : @[ @"" ]},
             @{@"library" : @"expoSecureStore", @"services" : @[], @"servers" : @[], @"accessGroup" : @""},
         ]) {
        JS::NativeApexKeychain::MigrationQuery query(arguments);
        ANKPromise *promise = [ANKPromise new];
        [module getMigrationSources:query resolve:promise.resolve reject:promise.reject];
        XCTAssertEqualObjects(promise.code, ANKErrorInvalidArgument, @"%@", arguments);
    }
    JS::NativeApexKeychain::MigrationSource source(@{
        @"kind" : @"password",
        @"service" : _service,
        @"account" : @"alice",
        @"requiresAuth" : @NO,
        @"migrated" : @NO,
    });
    ANKPromise *finished = [ANKPromise new];
    [module finishMigrationSource:source removeSource:YES resolve:finished.resolve reject:finished.reject];
    XCTAssertEqualObjects(finished.code, ANKErrorInvalidArgument);
}

@end
