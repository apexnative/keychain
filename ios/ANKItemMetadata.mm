#import "ANKItemMetadata.h"

// The keys of the property list: short, every item carries them.
static NSString *const ANKVersionKey = @"v";
static NSString *const ANKEncodingKey = @"e";
static NSString *const ANKAccessControlKey = @"ac";
static NSString *const ANKAuthValidityKey = @"av";
static NSString *const ANKHasLabelKey = @"l";
static NSString *const ANKOSVersionKey = @"os";
static NSString *const ANKDomainStateKey = @"ds";

@implementation ANKItemMetadata

+ (NSInteger)currentVersion {
    return 1;
}

- (instancetype)initWithEncoding:(ANKEncoding)encoding
                   accessControl:(ANKAccessControl)accessControl
                    authValidity:(NSInteger)authValidity
                        hasLabel:(BOOL)hasLabel
                       osVersion:(NSInteger)osVersion
                     domainState:(NSData *)domainState {
    if (self = [super init]) {
        _encoding = encoding;
        _accessControl = accessControl;
        _authValidity = authValidity;
        _hasLabel = hasLabel;
        _osVersion = osVersion;
        _domainState = [domainState copy];
    }
    return self;
}

+ (instancetype)metadataWithAttribute:(id)attribute {
    if (![attribute isKindOfClass:NSData.class]) return nil;
    NSDictionary *plist = [NSPropertyListSerialization propertyListWithData:attribute
                                                                    options:NSPropertyListImmutable
                                                                     format:NULL
                                                                      error:NULL];
    if (![plist isKindOfClass:NSDictionary.class]) return nil;
    // Another version is another format: an item of a newer package reads as one the package didn't write.
    NSNumber *version = plist[ANKVersionKey];
    if (![version isKindOfClass:NSNumber.class] || version.integerValue != self.currentVersion) return nil;

    NSString *encodingName = plist[ANKEncodingKey];
    NSString *accessControlName = plist[ANKAccessControlKey];
    NSNumber *hasLabel = plist[ANKHasLabelKey];
    // Optional: absent in an item without them.
    NSNumber *authValidity = plist[ANKAuthValidityKey] ?: @0;
    NSNumber *osVersion = plist[ANKOSVersionKey] ?: @0;
    NSData *domainState = plist[ANKDomainStateKey];
    ANKEncoding encoding;
    ANKAccessControl accessControl;
    if (![encodingName isKindOfClass:NSString.class] || !ANKEncodingOfName(encodingName, &encoding) ||
        ![accessControlName isKindOfClass:NSString.class] ||
        !ANKAccessControlOfName(accessControlName, &accessControl) || ![hasLabel isKindOfClass:NSNumber.class] ||
        ![authValidity isKindOfClass:NSNumber.class] || ![osVersion isKindOfClass:NSNumber.class] ||
        (domainState != nil && ![domainState isKindOfClass:NSData.class])) {
        return nil;
    }
    return [[self alloc] initWithEncoding:encoding
                            accessControl:accessControl
                             authValidity:authValidity.integerValue
                                 hasLabel:hasLabel.boolValue
                                osVersion:osVersion.integerValue
                              domainState:domainState];
}

- (NSData *)attribute {
    NSMutableDictionary *plist = [@{
        ANKVersionKey : @(ANKItemMetadata.currentVersion),
        ANKEncodingKey : ANKEncodingName(_encoding),
        ANKAccessControlKey : ANKAccessControlName(_accessControl),
        ANKHasLabelKey : @(_hasLabel),
    } mutableCopy];
    if (_authValidity != 0) plist[ANKAuthValidityKey] = @(_authValidity);
    if (_osVersion != 0) plist[ANKOSVersionKey] = @(_osVersion);
    if (_domainState != nil) plist[ANKDomainStateKey] = _domainState;
    // A dictionary of strings, numbers and data always serializes.
    return [NSPropertyListSerialization dataWithPropertyList:plist
                                                      format:NSPropertyListBinaryFormat_v1_0
                                                     options:0
                                                       error:NULL];
}

@end
