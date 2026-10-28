#import "ANKKeychainModule.h"
#import "ANKAuthenticator.h"
#import "ANKDevice.h"
#import "ANKError.h"
#import "ANKKeychainStore.h"
#import "ANKMigration.h"
#import "ANKOptions.h"

#import <TargetConditionals.h>

#pragma mark - Arguments

// What JavaScript checked already (src/options.ts), native checks again where a wrong value would be stored or guessed
// at: an unknown name, a combination the options forbid, an empty service or key, a key with U+0000 (the store's
// temporary keys have one).

static BOOL ANKInvalidArgument(NSError **error, NSString *message) {
    *error = [ANKError errorWithCode:ANKErrorInvalidArgument
                             message:[@"@apexnative/keychain: " stringByAppendingString:message]];
    return NO;
}

static ANKKeychainStore *ANKStoreOf(JS::NativeApexKeychain::Store &store, NSError **error) {
    NSString *service = store.service();
    NSString *accessGroup = store.accessGroup();
    if (service.length == 0) {
        ANKInvalidArgument(error, @"the service is empty.");
        return nil;
    }
    if (accessGroup != nil && accessGroup.length == 0) {
        ANKInvalidArgument(error, @"the access group is empty.");
        return nil;
    }
    return [[ANKKeychainStore alloc] initWithService:service accessGroup:accessGroup];
}

static BOOL ANKCheckKey(NSString *key, NSError **error) {
    if (key.length == 0) return ANKInvalidArgument(error, @"the key is empty.");
    if ([key rangeOfString:[NSString stringWithFormat:@"%C", (unichar)0]].location != NSNotFound) {
        return ANKInvalidArgument(error, @"the key has the character U+0000.");
    }
    return YES;
}

static BOOL ANKEncodingOf(NSString *name, ANKEncoding *encoding, NSError **error) {
    if (ANKEncodingOfName(name, encoding)) return YES;
    return ANKInvalidArgument(error, [NSString stringWithFormat:@"unknown encoding '%@'.", name]);
}

static ANKWriteOptions *ANKWriteOptionsOf(JS::NativeApexKeychain::WriteOptions &options, NSError **error) {
    ANKAccessible accessible;
    ANKAccessControl accessControl;
    if (!ANKAccessibleOfName(options.accessible(), &accessible)) {
        ANKInvalidArgument(error, [NSString stringWithFormat:@"unknown accessible '%@'.", options.accessible()]);
        return nil;
    }
    if (!ANKAccessControlOfName(options.accessControl(), &accessControl)) {
        ANKInvalidArgument(error,
                           [NSString stringWithFormat:@"unknown accessControl '%@'.", options.accessControl()]);
        return nil;
    }
    // Android's: iOS has no Keystore levels, but still knows the names.
    if (![@[ @"tee", @"strongbox", @"strongboxRequired" ] containsObject:options.keyStorage() ?: @""]) {
        ANKInvalidArgument(error, [NSString stringWithFormat:@"unknown keyStorage '%@'.", options.keyStorage()]);
        return nil;
    }
    double authValidity = options.authValidity();
    if (!(authValidity >= 0 && authValidity <= INT32_MAX) || authValidity != floor(authValidity)) {
        ANKInvalidArgument(error, @"authValidity isn't a whole number of seconds.");
        return nil;
    }
    if (accessControl == ANKAccessControlNone && authValidity != 0) {
        ANKInvalidArgument(error, @"authValidity needs an accessControl.");
        return nil;
    }
    if (ANKAccessControlIsCurrentSet(accessControl) && authValidity != 0) {
        // Android's Keystore invalidates a key on new biometry only when every use authenticates.
        ANKInvalidArgument(error, @"biometryCurrentSet* can't have an authValidity.");
        return nil;
    }
    if (options.synchronizable() &&
        (accessControl != ANKAccessControlNone || ANKAccessibleIsThisDeviceOnly(accessible))) {
        ANKInvalidArgument(error, @"iCloud Keychain takes no item with accessControl or one '…ThisDeviceOnly'.");
        return nil;
    }
    return [[ANKWriteOptions alloc] initWithAccessible:accessible
                                         accessControl:accessControl
                                          authValidity:(NSInteger)authValidity
                                        synchronizable:options.synchronizable()
                                                 label:options.label()];
}

static ANKPrompt *ANKPromptOf(JS::NativeApexKeychain::Prompt &prompt) {
    return [[ANKPrompt alloc] initWithTitle:prompt.title() cancel:prompt.cancel()];
}

static BOOL ANKAccessControlOf(NSString *name, ANKAccessControl *accessControl, NSError **error) {
    if (ANKAccessControlOfName(name, accessControl)) return YES;
    return ANKInvalidArgument(error, [NSString stringWithFormat:@"unknown accessControl '%@'.", name]);
}

// The names of a query: non-empty strings.
static NSArray<NSString *> *ANKNamesOf(facebook::react::LazyVector<NSString *> names, NSString *what, NSError **error) {
    NSMutableArray<NSString *> *array = [NSMutableArray arrayWithCapacity:names.size()];
    for (NSString *name : names) {
        if (name.length == 0) {
            ANKInvalidArgument(error, [NSString stringWithFormat:@"a migration query has an empty %@.", what]);
            return nil;
        }
        [array addObject:name];
    }
    return array;
}

static ANKMigrationSource *ANKMigrationSourceOf(JS::NativeApexKeychain::MigrationSource &source, NSError **error) {
    ANKMigrationKind kind;
    if (!ANKMigrationKindOfName(source.kind(), &kind)) {
        ANKInvalidArgument(error, [NSString stringWithFormat:@"unknown migration source kind '%@'.", source.kind()]);
        return nil;
    }
    if (source.service().length == 0 || source.account() == nil ||
        (source.accessGroup() != nil && source.accessGroup().length == 0)) {
        ANKInvalidArgument(error, @"a migration source isn't one getMigrationSources gave.");
        return nil;
    }
    return [[ANKMigrationSource alloc] initWithKind:kind
                                            service:source.service()
                                            account:source.account()
                                        accessGroup:source.accessGroup()
                                       requiresAuth:source.requiresAuth()
                                           migrated:source.migrated()];
}

// `readMigrationSource`'s answer: the value as text (the bridge cuts a string at U+0000), the error, or null for an
// item that's gone.
static void ANKAnswerSource(NSData *data,
                            NSError *error,
                            RCTPromiseResolveBlock resolve,
                            RCTPromiseRejectBlock reject) {
    if (data == nil) {
        error != nil ? [ANKError reject:reject error:error] : resolve(nil);
        return;
    }
    NSString *text = ANKValueOfData(data, ANKEncodingUTF8, NULL);
    if (text != nil && [text rangeOfString:[NSString stringWithFormat:@"%C", (unichar)0]].location == NSNotFound) {
        resolve(text);
        return;
    }
    [ANKError reject:reject
                code:ANKErrorDataCorrupted
             message:@"@apexnative/keychain: the value of the item to migrate isn't text: its bytes aren't UTF-8, or "
                     @"have U+0000."];
}

#pragma mark - Answers

// Whether a `biometryCurrentSet*` item's biometry changed since the write. Compared only under the major version of
// iOS that took the state: Apple's hash may change with a major update, and the item's own access control still binds
// it to the biometry. A state that can't be read now (a lockout) is no change.
static NSError *ANKKeyInvalidatedError(void) {
    return [ANKError errorWithCode:ANKErrorKeyInvalidated
                           message:@"@apexnative/keychain: the enrolled biometry changed since the item was written, "
                                   @"so the item was deleted. Sign the user in again."];
}

static BOOL ANKIsInvalidated(ANKItem *item) {
    ANKItemMetadata *metadata = item.metadata;
    if (!ANKAccessControlIsCurrentSet(item.accessControl) || metadata.osVersion == 0 ||
        metadata.osVersion != ANKDevice.majorOSVersion) {
        return NO;
    }
    BOOL known = NO;
    NSData *state = [ANKDevice biometryStateKnown:&known];
    return known && !(state == metadata.domainState || [state isEqualToData:metadata.domainState]);
}

// KEY_INVALIDATED, once the item is deleted, when it's bound to biometry that changed since its write; else nil.
static NSError *ANKInvalidation(ANKItem *item, ANKKeychainStore *keychain) {
    if (!ANKIsInvalidated(item)) return nil;
    [keychain removeItemForKey:item.key error:NULL];
    return ANKKeyInvalidatedError();
}

static double ANKMilliseconds(NSDate *date) {
    return floor(date.timeIntervalSince1970 * 1000);
}

// `Item`: the value in the encoding asked for, and the label.
static NSDictionary *ANKItemOf(ANKItem *item, ANKEncoding encoding, NSError **error) {
    NSString *value = ANKValueOfData(item.data ?: [NSData data], encoding, error);
    if (value == nil) return nil;
    return item.label != nil ? @{@"value" : value, @"label" : item.label} : @{@"value" : value};
}

// `ItemInfo`, which 1.0.0 doesn't use: `getItemInfo` stays in the native contract for 1.1.0.
static NSDictionary *ANKItemInfoOf(ANKItem *item) {
    NSMutableDictionary *info = [@{
        @"key" : item.key,
        @"accessible" : ANKAccessibleName(item.accessible),
        @"accessControl" : ANKAccessControlName(item.accessControl),
        @"synchronizable" : @(item.synchronizable),
        @"createdAt" : @(ANKMilliseconds(item.createdAt)),
        @"modifiedAt" : @(ANKMilliseconds(item.modifiedAt)),
    } mutableCopy];
    if (item.label != nil) info[@"label"] = item.label;
    return info;
}

@implementation ANKKeychainModule

+ (NSString *)moduleName {
    return @"ApexKeychain";
}

+ (BOOL)requiresMainQueueSetup {
    return NO;
}

// Marks the queue, so a block knows it runs on it.
static void *const ANKQueueKey = (void *)&ANKQueueKey;

// The queue of every Keychain call: React Native calls the asynchronous methods on it, the synchronous
// ones run their Keychain calls on it, so calls keep their order. Serial, and one for every instance of the module.
// It never waits for a user: a prompt (M2) is shown off it.
- (dispatch_queue_t)methodQueue {
    static dispatch_queue_t queue;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
      queue = dispatch_queue_create(
          "dev.apexnative.keychain",
          dispatch_queue_attr_make_with_qos_class(DISPATCH_QUEUE_SERIAL, QOS_CLASS_USER_INITIATED, 0));
      dispatch_queue_set_specific(queue, ANKQueueKey, ANKQueueKey, NULL);
      // Whether the device is locked tells a protected item from one the lock keeps: UIKit says it on the main thread.
      [ANKDevice followProtectedData];
    });
    return queue;
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
    return std::make_shared<facebook::react::NativeApexKeychainSpecJSI>(params);
}

// Runs a synchronous method's Keychain calls on the queue, after the calls before it, and answers what they answer.
- (NSDictionary *)onQueue:(NSDictionary * (^)(void))body {
    dispatch_queue_t queue = self.methodQueue;
    if (dispatch_get_specific(ANKQueueKey) == ANKQueueKey) return body();
    __block NSDictionary *result;
    dispatch_sync(queue, ^{
      result = body();
    });
    return result;
}

#pragma mark - Storage

// `setItem` and `setItemSync`: the arguments, then the write.
static BOOL ANKSetItem(ANKKeychainStore *keychain,
                       NSString *key,
                       NSString *value,
                       ANKEncoding encoding,
                       ANKWriteOptions *options,
                       NSError **error) {
    NSData *data = ANKDataOfValue(value, encoding, error);
    if (data == nil) return NO;
    return [keychain setData:data forKey:key encoding:encoding options:options error:error];
}

- (void)setItem:(JS::NativeApexKeychain::Store &)store
            key:(NSString *)key
          value:(NSString *)value
       encoding:(NSString *)encoding
        options:(JS::NativeApexKeychain::WriteOptions &)options
        resolve:(RCTPromiseResolveBlock)resolve
         reject:(RCTPromiseRejectBlock)reject {
    NSError *error = nil;
    ANKKeychainStore *keychain = ANKStoreOf(store, &error);
    ANKEncoding valueEncoding;
    ANKWriteOptions *writeOptions = nil;
    if (keychain == nil || !ANKCheckKey(key, &error) || !ANKEncodingOf(encoding, &valueEncoding, &error) ||
        (writeOptions = ANKWriteOptionsOf(options, &error)) == nil ||
        !ANKSetItem(keychain, key, value, valueEncoding, writeOptions, &error)) {
        [ANKError reject:reject error:error];
        return;
    }
    resolve(nil);
}

- (void)getItem:(JS::NativeApexKeychain::Store &)store
            key:(NSString *)key
       encoding:(NSString *)encoding
         prompt:(JS::NativeApexKeychain::Prompt &)prompt
        resolve:(RCTPromiseResolveBlock)resolve
         reject:(RCTPromiseRejectBlock)reject {
    NSError *error = nil;
    ANKKeychainStore *keychain = ANKStoreOf(store, &error);
    ANKEncoding valueEncoding;
    if (keychain == nil || !ANKCheckKey(key, &error) || !ANKEncodingOf(encoding, &valueEncoding, &error)) {
        [ANKError reject:reject error:error];
        return;
    }
    // Without a prompt first: an item without access control is read at once, and a protected one answers
    // AUTH_REQUIRED without the Keychain showing anything.
    ANKItem *item = [keychain itemForKey:key context:nil error:&error];
    if (item == nil && error == nil) {
        resolve(nil);
        return;
    }
    if ([[ANKError codeOfError:error] isEqualToString:ANKErrorAuthRequired]) {
        [self readProtectedKey:key
                      keychain:keychain
                      encoding:valueEncoding
                        prompt:ANKPromptOf(prompt)
                       resolve:resolve
                        reject:reject];
        return;
    }
    NSDictionary *result = item != nil ? ANKItemOf(item, valueEncoding, &error) : nil;
    if (result == nil) {
        [ANKError reject:reject error:error];
        return;
    }
    resolve(result);
}

// A read of an item with access control: one prompt, the Keychain's, during the read itself, which waits for the user
// off the queue (ANKAuthenticator); then back on the queue. An item bound to biometry that changed is deleted
// (KEY_INVALIDATED): the metadata that tells it comes with the value, or the Keychain refuses the item.
- (void)readProtectedKey:(NSString *)key
                keychain:(ANKKeychainStore *)keychain
                encoding:(ANKEncoding)encoding
                  prompt:(ANKPrompt *)prompt
                 resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject {
#if TARGET_OS_SIMULATOR
    // The simulator's Keychain gives the item without authentication, so the checks come before the prompt there; a
    // device makes them once its prompt gave the item, or answers them from the Keychain's refusal.
    NSError *peekError = nil;
    ANKItem *peek = [keychain itemForKey:key context:ANKSilentContext() error:&peekError];
    NSError *failure = peek == nil ? peekError
                                   : ANKInvalidation(peek, keychain)
                                         ?: [ANKDevice usageDescriptionErrorForAccessControl:peek.accessControl];
    if (failure != nil || peek == nil) {
        failure != nil ? [ANKError reject:reject error:failure] : resolve(nil);
        return;
    }
#endif
    dispatch_queue_t queue = self.methodQueue;
    [ANKAuthenticator.shared readItemForKey:key
                                   keychain:keychain
                                     prompt:prompt
                                 completion:^(ANKItem *item, NSError *readError) {
                                   dispatch_async(queue, ^{
                                     NSError *error = item != nil ? ANKInvalidation(item, keychain) : readError;
                                     // The Keychain refused a bound item: it can't be opened any more.
                                     if (item == nil &&
                                         [[ANKError codeOfError:error] isEqualToString:ANKErrorKeyInvalidated]) {
                                         [keychain removeItemForKey:key error:NULL];
                                     }
                                     NSDictionary *result =
                                         item != nil && error == nil ? ANKItemOf(item, encoding, &error) : nil;
                                     if (result != nil) {
                                         resolve(result);
                                     } else if (error != nil) {
                                         [ANKError reject:reject error:error];
                                     } else {
                                         resolve(nil);
                                     }
                                   });
                                 }];
}

- (void)removeItem:(JS::NativeApexKeychain::Store &)store
               key:(NSString *)key
           resolve:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject {
    NSError *error = nil;
    ANKKeychainStore *keychain = ANKStoreOf(store, &error);
    if (keychain == nil || !ANKCheckKey(key, &error) || ![keychain removeItemForKey:key error:&error]) {
        [ANKError reject:reject error:error];
        return;
    }
    resolve(nil);
}

- (void)hasItem:(JS::NativeApexKeychain::Store &)store
            key:(NSString *)key
        resolve:(RCTPromiseResolveBlock)resolve
         reject:(RCTPromiseRejectBlock)reject {
    NSError *error = nil;
    ANKKeychainStore *keychain = ANKStoreOf(store, &error);
    NSNumber *has = keychain != nil && ANKCheckKey(key, &error) ? [keychain hasItemForKey:key error:&error] : nil;
    if (has == nil) {
        [ANKError reject:reject error:error];
        return;
    }
    resolve(has);
}

- (void)getItemInfo:(JS::NativeApexKeychain::Store &)store
                key:(NSString *)key
            resolve:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject {
    // Never a prompt: a protected item answers AUTH_REQUIRED, as its attributes need the user's authentication.
    NSError *error = nil;
    ANKKeychainStore *keychain = ANKStoreOf(store, &error);
    ANKItem *item = keychain != nil && ANKCheckKey(key, &error) ? [keychain attributesForKey:key error:&error] : nil;
    if (error != nil) {
        [ANKError reject:reject error:error];
        return;
    }
    resolve(item != nil ? ANKItemInfoOf(item) : nil);
}

- (void)getAllKeys:(JS::NativeApexKeychain::Store &)store
           resolve:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject {
    // The keys of the items without access control: a protected item can't be listed without a prompt.
    NSError *error = nil;
    ANKKeychainStore *keychain = ANKStoreOf(store, &error);
    NSArray<NSString *> *keys = keychain != nil ? [keychain allKeysWithError:&error] : nil;
    if (keys == nil) {
        [ANKError reject:reject error:error];
        return;
    }
    resolve(keys);
}

- (void)clear:(JS::NativeApexKeychain::Store &)store
      resolve:(RCTPromiseResolveBlock)resolve
       reject:(RCTPromiseRejectBlock)reject {
    NSError *error = nil;
    ANKKeychainStore *keychain = ANKStoreOf(store, &error);
    if (keychain == nil || ![keychain clearWithError:&error]) {
        [ANKError reject:reject error:error];
        return;
    }
    resolve(nil);
}

#pragma mark - Storage, synchronous

- (NSDictionary *)getItemSync:(JS::NativeApexKeychain::Store &)store key:(NSString *)key {
    NSError *error = nil;
    ANKKeychainStore *keychain = ANKStoreOf(store, &error);
    if (keychain == nil || !ANKCheckKey(key, &error)) return [ANKError failureWithError:error];
    return [self onQueue:^NSDictionary * {
      NSError *error = nil;
      // No context: an item with access control answers AUTH_REQUIRED.
      ANKItem *item = [keychain itemForKey:key context:nil error:&error];
      if (item == nil) return error != nil ? [ANKError failureWithError:error] : @{};
      NSDictionary *result = ANKItemOf(item, ANKEncodingUTF8, &error);
      return result != nil ? @{@"value" : result[@"value"]} : [ANKError failureWithError:error];
    }];
}

- (NSDictionary *)setItemSync:(JS::NativeApexKeychain::Store &)store
                          key:(NSString *)key
                        value:(NSString *)value
                      options:(JS::NativeApexKeychain::WriteOptions &)options {
    NSError *error = nil;
    ANKKeychainStore *keychain = ANKStoreOf(store, &error);
    ANKWriteOptions *writeOptions = nil;
    if (keychain == nil || !ANKCheckKey(key, &error) || (writeOptions = ANKWriteOptionsOf(options, &error)) == nil) {
        return [ANKError failureWithError:error];
    }
    return [self onQueue:^NSDictionary * {
      NSError *error = nil;
      if (!ANKSetItem(keychain, key, value, ANKEncodingUTF8, writeOptions, &error)) {
          return [ANKError failureWithError:error];
      }
      return @{};
    }];
}

- (NSDictionary *)hasItemSync:(JS::NativeApexKeychain::Store &)store key:(NSString *)key {
    NSError *error = nil;
    ANKKeychainStore *keychain = ANKStoreOf(store, &error);
    if (keychain == nil || !ANKCheckKey(key, &error)) return [ANKError failureWithError:error];
    return [self onQueue:^NSDictionary * {
      NSError *error = nil;
      NSNumber *has = [keychain hasItemForKey:key error:&error];
      return has != nil ? @{@"value" : has} : [ANKError failureWithError:error];
    }];
}

- (NSDictionary *)removeItemSync:(JS::NativeApexKeychain::Store &)store key:(NSString *)key {
    NSError *error = nil;
    ANKKeychainStore *keychain = ANKStoreOf(store, &error);
    if (keychain == nil || !ANKCheckKey(key, &error)) return [ANKError failureWithError:error];
    return [self onQueue:^NSDictionary * {
      NSError *error = nil;
      return [keychain removeItemForKey:key error:&error] ? @{} : [ANKError failureWithError:error];
    }];
}

- (NSString *)getDefaultService {
    return NSBundle.mainBundle.bundleIdentifier ?: @"";
}

#pragma mark - The device

- (void)getBiometryTypes:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    resolve(ANKDevice.biometryTypes);
}

- (void)canUseAccessControl:(NSString *)accessControl
                    resolve:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject {
    NSError *error = nil;
    ANKAccessControl value;
    if (!ANKAccessControlOf(accessControl, &value, &error)) {
        [ANKError reject:reject error:error];
        return;
    }
    // A missing NSFaceIDUsageDescription is the app's mistake, not the device's: an error, as a write gives.
    NSError *usage = [ANKDevice usageDescriptionErrorForAccessControl:value];
    if (usage != nil) {
        [ANKError reject:reject error:usage];
        return;
    }
    NSString *reason = [ANKDevice unavailableReasonForAccessControl:value];
    resolve(reason != nil ? @{@"available" : @NO, @"reason" : reason} : @{@"available" : @YES});
}

- (void)isPasscodeSet:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    resolve(@(ANKDevice.isPasscodeSet));
}

- (void)getBiometryState:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
    // An opaque token: the state hash in Base64. Null without biometry, or when it can't be read now.
    BOOL known = NO;
    NSData *state = [ANKDevice biometryStateKnown:&known];
    resolve(known && state != nil ? [state base64EncodedStringWithOptions:0] : nil);
}

- (void)getHardwareSecurityLevel:(RCTPromiseResolveBlock)resolve
                          reject:(RCTPromiseRejectBlock)reject {
    // Android only: iOS has no Keystore levels, and answers null for good.
    resolve(nil);
}

#pragma mark - Migration

- (void)getMigrationSources:(JS::NativeApexKeychain::MigrationQuery &)query
                    resolve:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject {
    NSError *error = nil;
    NSString *library = query.library();
    NSString *accessGroup = query.accessGroup();
    if (![@[ @"reactNativeKeychain", @"expoSecureStore" ] containsObject:library ?: @""]) {
        ANKInvalidArgument(&error, [NSString stringWithFormat:@"unknown migration library '%@'.", library]);
    } else if (accessGroup != nil && accessGroup.length == 0) {
        ANKInvalidArgument(&error, @"the access group is empty.");
    }
    NSArray<NSString *> *services = error == nil ? ANKNamesOf(query.services(), @"service", &error) : nil;
    NSArray<NSString *> *servers = services != nil ? ANKNamesOf(query.servers(), @"server", &error) : nil;
    NSArray<ANKMigrationSource *> *sources = servers != nil ? [ANKMigration sourcesOfLibrary:library
                                                                                    services:services
                                                                                     servers:servers
                                                                                 accessGroup:accessGroup
                                                                                       error:&error]
                                                            : nil;
    if (sources == nil) {
        [ANKError reject:reject error:error];
        return;
    }
    resolve([sources valueForKey:@"dictionary"]);
}

- (void)readMigrationSource:(JS::NativeApexKeychain::MigrationSource &)source
                     prompt:(JS::NativeApexKeychain::Prompt &)prompt
                    resolve:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject {
    NSError *error = nil;
    ANKMigrationSource *item = ANKMigrationSourceOf(source, &error);
    NSData *data = item != nil ? [ANKMigration dataOfSource:item context:nil error:&error] : nil;
    if ([[ANKError codeOfError:error] isEqualToString:ANKErrorAuthRequired]) {
        [self readSource:item prompt:ANKPromptOf(prompt) resolve:resolve reject:reject];
        return;
    }
    ANKAnswerSource(data, error, resolve, reject);
}

// A read of a source that needs a prompt: the Keychain's, for the item's own access control, during the read, which
// waits for the user off the queue (ANKAuthenticator); then back on the queue.
- (void)readSource:(ANKMigrationSource *)source
            prompt:(ANKPrompt *)prompt
           resolve:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject {
    dispatch_queue_t queue = self.methodQueue;
    // The simulator can't tell another library's flags: biometry or the passcode shows a prompt for any.
    [ANKAuthenticator.shared readWithPrompt:prompt
                                     policy:LAPolicyDeviceOwnerAuthentication
                                       read:^id(LAContext *context, NSError **error) {
                                         return [ANKMigration dataOfSource:source context:context error:error];
                                       }
                                 completion:^(id data, NSError *error) {
                                   dispatch_async(queue, ^{
                                     ANKAnswerSource(data, error, resolve, reject);
                                   });
                                 }];
}

- (void)finishMigrationSource:(JS::NativeApexKeychain::MigrationSource &)source
                 removeSource:(BOOL)removeSource
                      resolve:(RCTPromiseResolveBlock)resolve
                       reject:(RCTPromiseRejectBlock)reject {
    NSError *error = nil;
    ANKMigrationSource *item = ANKMigrationSourceOf(source, &error);
    if (item == nil || ![ANKMigration finishSource:item removeSource:removeSource error:&error]) {
        [ANKError reject:reject error:error];
        return;
    }
    resolve(nil);
}

@end
