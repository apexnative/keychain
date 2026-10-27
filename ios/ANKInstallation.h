#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// The key of Info.plist that turns `clearOnReinstall` on: a Boolean.
extern NSString *const ANKClearOnReinstallKey;

/// The key of `UserDefaults` that marks the installation.
extern NSString *const ANKInstallationMarkerKey;

/// `clearOnReinstall`. The Keychain keeps an app's items when the app is deleted, its `UserDefaults` go
/// with it: a marker there tells a new installation from the one before. With `ApexKeychainClearOnReinstall` YES in
/// Info.plist, the first Keychain call of a new installation deletes the items the package wrote before, in every
/// service of the app's default access group, and no call reaches one of them before that. Items in iCloud Keychain
/// stay: deleting one deletes it on every device of the account, the devices that keep the app too. So do items in an
/// access group shared with other apps: those apps may still use them.
@interface ANKInstallation : NSObject

/// Before every Keychain call of a store, serialized with them (`ANKKeychainStore`). The first call checks the
/// installation and, when it is new, deletes the items; the later ones return at once. The marker is set without the
/// key too, so an update that turns the key on deletes nothing. NO with the error when the items couldn't be deleted,
/// and when the device hasn't been unlocked since it started: `UserDefaults` read empty then, so with the key the call
/// fails with INTERACTION_NOT_ALLOWED (it could read no item anyway). The next call checks again.
+ (BOOL)checkWithError:(NSError **)error;

/// For the tests: the next call checks again.
+ (void)reset;

@end

NS_ASSUME_NONNULL_END
