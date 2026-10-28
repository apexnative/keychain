#import <Foundation/Foundation.h>
#import <Security/Security.h>

NS_ASSUME_NONNULL_BEGIN

// The options of the contract (src/native/NativeApexKeychain.ts) as native values, and the strings they cross as.
// A name the package doesn't know is no value: the module rejects it with INVALID_ARGUMENT instead of guessing.

/// When an item can be read: `Accessible`, `kSecAttrAccessible…`.
typedef NS_ENUM(NSInteger, ANKAccessible) {
    ANKAccessibleAfterFirstUnlock,
    ANKAccessibleAfterFirstUnlockThisDeviceOnly,
    ANKAccessibleWhenUnlocked,
    ANKAccessibleWhenUnlockedThisDeviceOnly,
    ANKAccessibleWhenPasscodeSetThisDeviceOnly,
};

/// What unlocks an item: `AccessControl`, `SecAccessControlCreateFlags`.
typedef NS_ENUM(NSInteger, ANKAccessControl) {
    ANKAccessControlNone,
    ANKAccessControlBiometryAny,
    ANKAccessControlBiometryCurrentSet,
    ANKAccessControlBiometryAnyOrPasscode,
    ANKAccessControlBiometryCurrentSetOrPasscode,
    ANKAccessControlPasscode,
};

/// How a value crosses as a string: `Encoding`.
typedef NS_ENUM(NSInteger, ANKEncoding) {
    /// The string is the text; the item holds its UTF-8 bytes.
    ANKEncodingUTF8,
    /// The string is the standard Base64 of the item's bytes.
    ANKEncodingBase64,
};

/// The value of a name of `Accessible`; NO for a name the package doesn't know.
BOOL ANKAccessibleOfName(NSString *name, ANKAccessible *accessible);
NSString *ANKAccessibleName(ANKAccessible accessible);
/// The `kSecAttrAccessible` value of an item that is written.
CFStringRef ANKAccessibleAttribute(ANKAccessible accessible);
/// The value of an item's `kSecAttrAccessible`; NO for one the package doesn't write (the deprecated `…Always`).
BOOL ANKAccessibleOfAttribute(id _Nullable attribute, ANKAccessible *accessible);

/// Whether an item can't leave the device: `…ThisDeviceOnly`, which iCloud Keychain doesn't take.
BOOL ANKAccessibleIsThisDeviceOnly(ANKAccessible accessible);

BOOL ANKAccessControlOfName(NSString *name, ANKAccessControl *accessControl);
NSString *ANKAccessControlName(ANKAccessControl accessControl);
/// The flags of `SecAccessControlCreateWithFlags`; none for `ANKAccessControlNone`.
SecAccessControlCreateFlags ANKAccessControlFlags(ANKAccessControl accessControl);
/// Whether biometry can unlock the item: every access control but 'none' and 'passcode'.
BOOL ANKAccessControlUsesBiometry(ANKAccessControl accessControl);
/// Whether the item is bound to the biometry enrolled when it was written: `biometryCurrentSet*`.
BOOL ANKAccessControlIsCurrentSet(ANKAccessControl accessControl);
/// Whether the passcode alone unlocks the item: `*OrPasscode` and 'passcode'.
BOOL ANKAccessControlAcceptsPasscode(ANKAccessControl accessControl);

BOOL ANKEncodingOfName(NSString *name, ANKEncoding *encoding);
NSString *ANKEncodingName(ANKEncoding encoding);

/// The bytes a value that crossed as a string stands for; nil and INVALID_ARGUMENT when it isn't Base64, or isn't a
/// string UTF-8 can hold.
NSData *_Nullable ANKDataOfValue(NSString *value, ANKEncoding encoding, NSError **error);
/// The string bytes cross as; nil and INVALID_ARGUMENT for 'utf8' when they aren't valid UTF-8.
NSString *_Nullable ANKValueOfData(NSData *data, ANKEncoding encoding, NSError **error);

/// How an item is written: `WriteOptions` without what iOS ignores (`keyStorage`).
@interface ANKWriteOptions : NSObject

@property (nonatomic, readonly) ANKAccessible accessible;
@property (nonatomic, readonly) ANKAccessControl accessControl;
/// Seconds one authentication unlocks the item for; 0 — every access, and always with `ANKAccessControlNone`.
@property (nonatomic, readonly) NSInteger authValidity;
@property (nonatomic, readonly) BOOL synchronizable;
/// Nil: the item has no label. An empty label is a label.
@property (nonatomic, readonly, copy, nullable) NSString *label;

- (instancetype)initWithAccessible:(ANKAccessible)accessible
                     accessControl:(ANKAccessControl)accessControl
                      authValidity:(NSInteger)authValidity
                    synchronizable:(BOOL)synchronizable
                             label:(nullable NSString *)label NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

@end

/// The texts of the prompt a protected read shows (`Prompt`, without what iOS ignores).
@interface ANKPrompt : NSObject

/// `LAContext.localizedReason`; nil — the package's default.
@property (nonatomic, readonly, copy, nullable) NSString *title;
/// `localizedCancelTitle`; nil — the system's.
@property (nonatomic, readonly, copy, nullable) NSString *cancel;

- (instancetype)initWithTitle:(nullable NSString *)title cancel:(nullable NSString *)cancel NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

@end

NS_ASSUME_NONNULL_END
