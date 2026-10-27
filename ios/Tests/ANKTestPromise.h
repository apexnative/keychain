#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

NS_ASSUME_NONNULL_BEGIN

/// What a promise of the module was settled with. Atomic: a read with a prompt settles it on the module's queue while
/// the test waits on the main thread.
@interface ANKPromise : NSObject
@property (nonatomic, readonly) RCTPromiseResolveBlock resolve;
@property (nonatomic, readonly) RCTPromiseRejectBlock reject;
@property (atomic) BOOL resolved;
@property (atomic, nullable) id value;
@property (atomic, nullable) NSString *code;
@property (atomic, nullable) NSString *message;
@property (atomic, nullable) NSError *error;
/// Resolved or rejected.
@property (atomic, readonly) BOOL settled;
@end

NS_ASSUME_NONNULL_END
