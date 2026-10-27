#import "ANKOptions.h"
#import "ANKError.h"

#import <Security/Security.h>

#include <vector>

// The names of each enum, in the order of its values.
static NSArray<NSString *> *ANKAccessibleNames(void) {
    static NSArray<NSString *> *const names = @[
        @"afterFirstUnlock", @"afterFirstUnlockThisDeviceOnly", @"whenUnlocked", @"whenUnlockedThisDeviceOnly",
        @"whenPasscodeSetThisDeviceOnly"
    ];
    return names;
}

static NSArray<NSString *> *ANKAccessControlNames(void) {
    static NSArray<NSString *> *const names = @[
        @"none", @"biometryAny", @"biometryCurrentSet", @"biometryAnyOrPasscode", @"biometryCurrentSetOrPasscode",
        @"passcode"
    ];
    return names;
}

static NSArray<NSString *> *ANKEncodingNames(void) {
    static NSArray<NSString *> *const names = @[ @"utf8", @"base64" ];
    return names;
}

// The index of `name` in `names`, or -1.
static NSInteger ANKIndexOfName(NSArray<NSString *> *names, NSString *name) {
    NSUInteger index = name != nil ? [names indexOfObject:name] : NSNotFound;
    return index == NSNotFound ? -1 : (NSInteger)index;
}

BOOL ANKAccessibleOfName(NSString *name, ANKAccessible *accessible) {
    NSInteger index = ANKIndexOfName(ANKAccessibleNames(), name);
    if (index < 0) return NO;
    *accessible = (ANKAccessible)index;
    return YES;
}

NSString *ANKAccessibleName(ANKAccessible accessible) {
    return ANKAccessibleNames()[accessible];
}

CFStringRef ANKAccessibleAttribute(ANKAccessible accessible) {
    switch (accessible) {
        case ANKAccessibleAfterFirstUnlock:
            return kSecAttrAccessibleAfterFirstUnlock;
        case ANKAccessibleAfterFirstUnlockThisDeviceOnly:
            return kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
        case ANKAccessibleWhenUnlocked:
            return kSecAttrAccessibleWhenUnlocked;
        case ANKAccessibleWhenUnlockedThisDeviceOnly:
            return kSecAttrAccessibleWhenUnlockedThisDeviceOnly;
        case ANKAccessibleWhenPasscodeSetThisDeviceOnly:
            return kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly;
    }
}

BOOL ANKAccessibleOfAttribute(id attribute, ANKAccessible *accessible) {
    if (![attribute isKindOfClass:NSString.class]) return NO;
    for (NSInteger index = ANKAccessibleAfterFirstUnlock; index <= ANKAccessibleWhenPasscodeSetThisDeviceOnly;
         index++) {
        if (CFEqual((__bridge CFStringRef)attribute, ANKAccessibleAttribute((ANKAccessible)index))) {
            *accessible = (ANKAccessible)index;
            return YES;
        }
    }
    return NO;
}

BOOL ANKAccessibleIsThisDeviceOnly(ANKAccessible accessible) {
    return accessible == ANKAccessibleAfterFirstUnlockThisDeviceOnly ||
           accessible == ANKAccessibleWhenUnlockedThisDeviceOnly ||
           accessible == ANKAccessibleWhenPasscodeSetThisDeviceOnly;
}

BOOL ANKAccessControlOfName(NSString *name, ANKAccessControl *accessControl) {
    NSInteger index = ANKIndexOfName(ANKAccessControlNames(), name);
    if (index < 0) return NO;
    *accessControl = (ANKAccessControl)index;
    return YES;
}

NSString *ANKAccessControlName(ANKAccessControl accessControl) {
    return ANKAccessControlNames()[accessControl];
}

SecAccessControlCreateFlags ANKAccessControlFlags(ANKAccessControl accessControl) {
    switch (accessControl) {
        case ANKAccessControlNone:
            return 0;
        case ANKAccessControlBiometryAny:
            return kSecAccessControlBiometryAny;
        case ANKAccessControlBiometryCurrentSet:
            return kSecAccessControlBiometryCurrentSet;
        case ANKAccessControlBiometryAnyOrPasscode:
            return kSecAccessControlUserPresence;
        case ANKAccessControlBiometryCurrentSetOrPasscode:
            return kSecAccessControlBiometryCurrentSet | kSecAccessControlOr | kSecAccessControlDevicePasscode;
        case ANKAccessControlPasscode:
            return kSecAccessControlDevicePasscode;
    }
}

BOOL ANKAccessControlUsesBiometry(ANKAccessControl accessControl) {
    return accessControl != ANKAccessControlNone && accessControl != ANKAccessControlPasscode;
}

BOOL ANKAccessControlIsCurrentSet(ANKAccessControl accessControl) {
    return accessControl == ANKAccessControlBiometryCurrentSet ||
           accessControl == ANKAccessControlBiometryCurrentSetOrPasscode;
}

BOOL ANKAccessControlAcceptsPasscode(ANKAccessControl accessControl) {
    return accessControl == ANKAccessControlBiometryAnyOrPasscode ||
           accessControl == ANKAccessControlBiometryCurrentSetOrPasscode || accessControl == ANKAccessControlPasscode;
}

BOOL ANKEncodingOfName(NSString *name, ANKEncoding *encoding) {
    NSInteger index = ANKIndexOfName(ANKEncodingNames(), name);
    if (index < 0) return NO;
    *encoding = (ANKEncoding)index;
    return YES;
}

NSString *ANKEncodingName(ANKEncoding encoding) {
    return ANKEncodingNames()[encoding];
}

NSData *ANKDataOfValue(NSString *value, ANKEncoding encoding, NSError **error) {
    // Strict: Base64 with padding and without line breaks or spaces, UTF-8 without lone surrogates.
    NSData *data = encoding == ANKEncodingBase64 ? [[NSData alloc] initWithBase64EncodedString:value options:0]
                                                 : [value dataUsingEncoding:NSUTF8StringEncoding
                                                           allowLossyConversion:NO];
    if (data == nil && error != NULL) {
        *error = [ANKError errorWithCode:ANKErrorInvalidArgument
                                 message:encoding == ANKEncodingBase64
                                             ? @"@apexnative/keychain: the value isn't standard Base64."
                                             : @"@apexnative/keychain: the value isn't a string UTF-8 can hold."];
    }
    return data;
}

// The text of UTF-8 bytes, or nil when they aren't UTF-8 as RFC 3629 has it, as strict as Android's decoder is made to
// be: no overlong form, no surrogate, nothing above U+10FFFF, no sequence cut off. Decoded here because Foundation
// drops a leading byte order mark, which was part of the text.
static NSString *ANKTextOfUTF8(const uint8_t *bytes, NSUInteger length) {
    std::vector<unichar> characters;
    characters.reserve(length);
    NSUInteger index = 0;
    while (index < length) {
        uint8_t lead = bytes[index];
        if (lead < 0x80) {
            characters.push_back(lead);
            index++;
            continue;
        }
        // The bytes that follow the lead, the bits it holds, the least scalar of that length.
        NSUInteger count;
        uint32_t scalar;
        uint32_t least;
        if ((lead & 0xE0) == 0xC0) {
            count = 1;
            scalar = lead & 0x1F;
            least = 0x80;
        } else if ((lead & 0xF0) == 0xE0) {
            count = 2;
            scalar = lead & 0x0F;
            least = 0x800;
        } else if ((lead & 0xF8) == 0xF0) {
            count = 3;
            scalar = lead & 0x07;
            least = 0x10000;
        } else {
            return nil;
        }
        if (length - index <= count) return nil;
        for (NSUInteger next = 1; next <= count; next++) {
            uint8_t byte = bytes[index + next];
            if ((byte & 0xC0) != 0x80) return nil;
            scalar = (scalar << 6) | (byte & 0x3F);
        }
        if (scalar < least || scalar > 0x10FFFF || (scalar >= 0xD800 && scalar <= 0xDFFF)) return nil;
        if (scalar < 0x10000) {
            characters.push_back((unichar)scalar);
        } else {
            characters.push_back((unichar)(0xD800 + ((scalar - 0x10000) >> 10)));
            characters.push_back((unichar)(0xDC00 + ((scalar - 0x10000) & 0x3FF)));
        }
        index += count + 1;
    }
    return [[NSString alloc] initWithCharacters:characters.data() length:characters.size()];
}

NSString *ANKValueOfData(NSData *data, ANKEncoding encoding, NSError **error) {
    if (encoding == ANKEncodingBase64) return [data base64EncodedStringWithOptions:0];
    NSString *text = data.length > 0 ? ANKTextOfUTF8((const uint8_t *)data.bytes, data.length) : @"";
    if (text == nil && error != NULL) {
        *error = [ANKError errorWithCode:ANKErrorInvalidArgument
                                 message:@"@apexnative/keychain: the item holds bytes that aren't valid UTF-8: read it "
                                         @"as bytes (getBytes)."];
    }
    return text;
}

@implementation ANKWriteOptions

- (instancetype)initWithAccessible:(ANKAccessible)accessible
                     accessControl:(ANKAccessControl)accessControl
                      authValidity:(NSInteger)authValidity
                    synchronizable:(BOOL)synchronizable
                             label:(NSString *)label {
    if (self = [super init]) {
        _accessible = accessible;
        _accessControl = accessControl;
        _authValidity = authValidity;
        _synchronizable = synchronizable;
        _label = [label copy];
    }
    return self;
}

@end

@implementation ANKPrompt

- (instancetype)initWithTitle:(NSString *)title cancel:(NSString *)cancel fallback:(NSString *)fallback {
    if (self = [super init]) {
        _title = [title copy];
        _cancel = [cancel copy];
        _fallback = [fallback copy];
    }
    return self;
}

@end
