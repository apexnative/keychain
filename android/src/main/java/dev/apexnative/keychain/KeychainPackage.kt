package dev.apexnative.keychain

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * The library's React Native package, which autolinking adds to the app: the TurboModule `ApexKeychain`, made when
 * JavaScript first asks for it. Making it does no work.
 */
class KeychainPackage : BaseReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        if (name == NativeApexKeychainSpec.NAME) KeychainModule(reactContext) else null

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
        mapOf(
            NativeApexKeychainSpec.NAME to ReactModuleInfo(
                name = NativeApexKeychainSpec.NAME,
                className = KeychainModule::class.java.name,
                canOverrideExistingModule = false,
                needsEagerInit = false,
                isCxxModule = false,
                isTurboModule = true,
            ),
        )
    }
}
