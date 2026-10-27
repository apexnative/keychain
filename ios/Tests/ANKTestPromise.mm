#import "ANKTestPromise.h"

@implementation ANKPromise

- (instancetype)init {
    if (self = [super init]) {
        __weak ANKPromise *weakSelf = self;
        _resolve = ^(id value) {
          weakSelf.value = value;
          weakSelf.resolved = YES;
        };
        _reject = ^(NSString *code, NSString *message, NSError *error) {
          weakSelf.message = message;
          weakSelf.error = error;
          weakSelf.code = code;
        };
    }
    return self;
}

- (BOOL)settled {
    return self.resolved || self.code != nil;
}

@end
