#import <ApexKeychainSpec/ApexKeychainSpec.h>

NS_ASSUME_NONNULL_BEGIN

/// The TurboModule `ApexKeychain` (src/native/NativeApexKeychain.ts), registered through `codegenConfig.ios.
/// modulesProvider` in package.json.
@interface ANKKeychainModule : NSObject <NativeApexKeychainSpec>
@end

NS_ASSUME_NONNULL_END
