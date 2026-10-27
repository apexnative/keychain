# The CocoaPods spec of @apexnative/keychain: the Objective-C++ TurboModule `ApexKeychain` under ios/, next to the code
# React Native's codegen makes from src/native/NativeApexKeychain.ts (ApexKeychainSpec).
require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "ApexKeychain"
  s.module_name  = "ApexKeychain"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/apexnative/keychain.git", :tag => "v#{s.version}" }

  s.source_files  = "ios/**/*.{h,m,mm}"
  s.exclude_files = ["ios/build/**/*", "ios/Tests/**/*", "ios/TestHost/**/*"]
  # The Keychain, LocalAuthentication for the prompts (LAContext), UIKit for the app going to the background.
  s.frameworks    = "Foundation", "Security", "LocalAuthentication", "UIKit"
  s.requires_arc  = true

  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
  }

  # React Native's dependencies of a New Architecture library: React-Core, the codegen of src/native
  # (ApexKeychainSpec), the TurboModule headers and the header search paths they need.
  install_modules_dependencies(s)

  # XCTest of the store and the module, in an app: the Keychain needs one. The example's Podfile adds
  # both to the Pods project; the scheme ApexKeychain-Unit-Tests runs them.
  s.test_spec "Tests" do |test|
    test.source_files      = "ios/Tests/**/*.{h,m,mm}"
    test.frameworks        = "XCTest"
    test.requires_app_host = true
    test.app_host_name     = "ApexKeychain/TestHost"
    test.dependency "ApexKeychain/TestHost"
    # The tests read the codegen's structs, whose accessors live in React Native: with its prebuilt core, a framework
    # the app host loads, which a test bundle has to link itself.
    if ENV["RCT_USE_PREBUILT_RNCORE"] == "1"
      test.pod_target_xcconfig = { "OTHER_LDFLAGS" => "$(inherited) -framework React" }
    end
  end

  # The app the tests run in: the scene life cycle, which iOS 27 requires and CocoaPods' own app host lacks, and a
  # second Keychain access group, which the tests of clearOnReinstall share.
  s.app_spec "TestHost" do |app|
    app.source_files = "ios/TestHost/**/*.{h,m,mm}"
    app.pod_target_xcconfig = {
      "CODE_SIGN_ENTITLEMENTS" => "${PODS_TARGET_SRCROOT}/ios/TestHost/TestHost.entitlements",
    }
    app.info_plist   = {
      "UIApplicationSceneManifest" => { "UIApplicationSupportsMultipleScenes" => false },
      "UILaunchScreen" => {},
      "NSFaceIDUsageDescription" => "The tests of @apexnative/keychain unlock items with Face ID.",
    }
  end
end
