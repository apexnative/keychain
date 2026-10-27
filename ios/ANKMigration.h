#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>

NS_ASSUME_NONNULL_BEGIN

/// What a source item becomes (`MigrationSource.kind`).
typedef NS_ENUM(NSInteger, ANKMigrationKind) {
    /// A generic password of react-native-keychain: credentials.
    ANKMigrationKindGenericPassword,
    /// An internet password of react-native-keychain: credentials with a server.
    ANKMigrationKindInternetPassword,
    /// An item of expo-secure-store.
    ANKMigrationKindSecureStore,
};

/// The kind of a name of the contract; NO for an unknown one.
BOOL ANKMigrationKindOfName(NSString *_Nullable name, ANKMigrationKind *kind);

/// An item of another library (`MigrationSource` of the contract).
@interface ANKMigrationSource : NSObject

@property (nonatomic, readonly) ANKMigrationKind kind;
/// react-native-keychain: the service or the server; expo-secure-store: the `keychainService`, without a suffix.
@property (nonatomic, readonly, copy) NSString *service;
/// react-native-keychain: the username; expo-secure-store: the key.
@property (nonatomic, readonly, copy) NSString *account;
@property (nonatomic, readonly, copy, nullable) NSString *accessGroup;
@property (nonatomic, readonly) BOOL requiresAuth;
@property (nonatomic, readonly) BOOL migrated;

- (instancetype)initWithKind:(ANKMigrationKind)kind
                     service:(NSString *)service
                     account:(NSString *)account
                 accessGroup:(nullable NSString *)accessGroup
                requiresAuth:(BOOL)requiresAuth
                    migrated:(BOOL)migrated NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

/// `MigrationSource` for JavaScript.
- (NSDictionary *)dictionary;

@end

/// The items of react-native-keychain and expo-secure-store as they write them: read straight from the
/// Keychain of the app, the package's own items left out. Synchronous, without a prompt, serialized on the module's
/// queue as `ANKKeychainStore`. A failure returns NO or nil and sets an `ANKErrorDomain` error; a missing item is no
/// failure.
///
/// - react-native-keychain: a generic password of `kSecAttrService` = the service (default: the bundle identifier),
///   `kSecAttrAccount` = the username; an internet password of `kSecAttrServer` = the server. It keeps one item per
///   service or server, the value is the password's UTF-8.
/// - expo-secure-store: `kSecAttrService` = `<keychainService>:no-auth`, `:auth` (with `.biometryCurrentSet`) or, in
///   its first versions, `<keychainService>` (default 'app'); `kSecAttrAccount` and `kSecAttrGeneric` = the key's UTF-8
///   bytes. A key in several of them is the one its `getItemAsync` reads: no-auth, auth, the first versions'.
///
/// "Migrated" marks live in `UserDefaults`: a run that keeps a source (`removeSource` false) doesn't read it again.
@interface ANKMigration : NSObject

/// The sources of the library ('reactNativeKeychain', 'expoSecureStore') in the services and servers named: none of
/// them, the library's default. Their `requiresAuth` is the Keychain's answer to a read without a prompt (the
/// simulator, which protects nothing, tells it from the item's access control).
+ (nullable NSArray<ANKMigrationSource *> *)sourcesOfLibrary:(NSString *)library
                                                    services:(NSArray<NSString *> *)services
                                                     servers:(NSArray<NSString *> *)servers
                                                 accessGroup:(nullable NSString *)accessGroup
                                                       error:(NSError **)error;

/// The value of the source; nil without an error when the item is gone. `context` is one a prompt authenticated: nil —
/// an item that needs a prompt fails with AUTH_REQUIRED.
+ (nullable NSData *)dataOfSource:(ANKMigrationSource *)source
                          context:(nullable LAContext *)context
                            error:(NSError **)error;

/// The item's `kSecAttrAccessControl`, which a prompt evaluates; NULL when the item is gone or has none.
+ (nullable SecAccessControlRef)copyAccessControlOfSource:(ANKMigrationSource *)source
                                                    error:(NSError **)error CF_RETURNS_RETAINED;

/// Deletes the source, every variant of an expo-secure-store key, when `removeSource`; else marks it migrated.
+ (BOOL)finishSource:(ANKMigrationSource *)source removeSource:(BOOL)removeSource error:(NSError **)error;

/// For the tests: forgets every "migrated" mark.
+ (void)forgetMarks;

@end

NS_ASSUME_NONNULL_END
