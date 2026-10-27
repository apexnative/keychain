#import <UIKit/UIKit.h>

// The app the pod's XCTest runs in (the app spec TestHost): the Keychain needs an app, and iOS 27 starts only an app
// with the scene life cycle, which the app host CocoaPods makes doesn't have. One empty window, nothing else.

@interface ANKTestHostSceneDelegate : UIResponder <UIWindowSceneDelegate>
@property (nonatomic, strong) UIWindow *window;
@end

@implementation ANKTestHostSceneDelegate

- (void)scene:(UIScene *)scene
    willConnectToSession:(UISceneSession *)session
                 options:(UISceneConnectionOptions *)connectionOptions {
    if (![scene isKindOfClass:UIWindowScene.class]) return;
    self.window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
    self.window.rootViewController = [[UIViewController alloc] init];
    [self.window makeKeyAndVisible];
}

@end

@interface ANKTestHostAppDelegate : UIResponder <UIApplicationDelegate>
@end

@implementation ANKTestHostAppDelegate

- (UISceneConfiguration *)application:(UIApplication *)application
    configurationForConnectingSceneSession:(UISceneSession *)connectingSceneSession
                                   options:(UISceneConnectionOptions *)options {
    UISceneConfiguration *configuration = [[UISceneConfiguration alloc] initWithName:@"Default"
                                                                         sessionRole:connectingSceneSession.role];
    configuration.delegateClass = ANKTestHostSceneDelegate.class;
    return configuration;
}

@end

int main(int argc, char *argv[]) {
    @autoreleasepool {
        return UIApplicationMain(argc, argv, nil, NSStringFromClass(ANKTestHostAppDelegate.class));
    }
}
