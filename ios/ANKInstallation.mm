#import "ANKInstallation.h"
#import "ANKDevice.h"
#import "ANKError.h"
#import "ANKKeychainStore.h"

#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>

NSString *const ANKClearOnReinstallKey = @"ApexKeychainClearOnReinstall";
NSString *const ANKInstallationMarkerKey = @"dev.apexnative.keychain.installed";

// Whether the installation was checked: by the first call that could, for the life of the process.
static BOOL ANKChecked;

static BOOL ANKClearsOnReinstall(void) {
    NSDictionary *info = ANKDevice.testInfoDictionary ?: NSBundle.mainBundle.infoDictionary;
    id value = info[ANKClearOnReinstallKey];
    return [value respondsToSelector:@selector(boolValue)] && [value boolValue];
}

// errSecInteractionNotAllowed when the device hasn't been unlocked since it started: an item that needs the first
// unlock can't be written then. The item is deleted at once; `accessGroup` is the group the Keychain put it in, the
// app's default one.
static OSStatus ANKCheckUnlocked(NSString **accessGroup) {
    NSDictionary *query = @{
        (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService : @"dev.apexnative.keychain.unlock-check",
        (__bridge id)kSecAttrAccount : @"",
        (__bridge id)kSecUseDataProtectionKeychain : @YES,
    };
    SecItemDelete((__bridge CFDictionaryRef)query);
    NSMutableDictionary *item = [query mutableCopy];
    item[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
    item[(__bridge id)kSecValueData] = [NSData data];
    item[(__bridge id)kSecReturnAttributes] = @YES;
    CFTypeRef result = NULL;
    OSStatus status = SecItemAdd((__bridge CFDictionaryRef)item, &result);
    NSDictionary *attributes = CFBridgingRelease(result);
    SecItemDelete((__bridge CFDictionaryRef)query);
    id group = [attributes isKindOfClass:NSDictionary.class] ? attributes[(__bridge id)kSecAttrAccessGroup] : nil;
    *accessGroup = [group isKindOfClass:NSString.class] ? group : nil;
    return status;
}

// Deletes the package's items in the app's default access group, but those in iCloud Keychain. Items in a group
// shared with other apps stay: those apps may still use them.
static OSStatus ANKDeleteItems(NSString *accessGroup) {
    LAContext *silent = [[LAContext alloc] init];
    silent.interactionNotAllowed = YES;
    NSMutableDictionary *query = [@{
        (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrCreator : @(ANKItemCreator),
        (__bridge id)kSecAttrSynchronizable : @NO,
        (__bridge id)kSecUseAuthenticationContext : silent,
        (__bridge id)kSecUseDataProtectionKeychain : @YES,
    } mutableCopy];
    if (accessGroup != nil) query[(__bridge id)kSecAttrAccessGroup] = accessGroup;
    return SecItemDelete((__bridge CFDictionaryRef)query);
}

@implementation ANKInstallation

+ (BOOL)checkWithError:(NSError **)error {
    if (ANKChecked) return YES;
    NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
    if ([defaults boolForKey:ANKInstallationMarkerKey]) {
        ANKChecked = YES;
        return YES;
    }
    // No marker: a new installation, or `UserDefaults` that can't be read before the first unlock.
    BOOL clear = ANKClearsOnReinstall();
    NSString *accessGroup = nil;
    OSStatus status = ANKCheckUnlocked(&accessGroup);
    if (status != errSecSuccess) {
        // Without the key, the marker waits for a call that can set it.
        if (!clear) return YES;
        if (error != NULL) {
            *error = status == errSecInteractionNotAllowed
                         ? [ANKError errorWithCode:ANKErrorInteractionNotAllowed
                                           message:@"@apexnative/keychain: the device hasn't been unlocked since it "
                                                   @"started, so clearOnReinstall can't tell a new installation yet."
                                        nativeCode:status
                                      nativeDomain:NSOSStatusErrorDomain]
                         : [ANKError errorWithStatus:status action:@"couldn't check the installation"];
        }
        return NO;
    }
    if (clear) {
        status = ANKDeleteItems(accessGroup);
        if (status != errSecSuccess && status != errSecItemNotFound) {
            if (error != NULL) {
                *error = [ANKError errorWithStatus:status
                                            action:@"couldn't delete the items of the app's previous installation"];
            }
            return NO;
        }
    }
    [defaults setBool:YES forKey:ANKInstallationMarkerKey];
    ANKChecked = YES;
    return YES;
}

+ (void)reset {
    ANKChecked = NO;
}

@end
