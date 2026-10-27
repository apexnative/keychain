// The config plugin of @apexnative/keychain: what an Expo app needs in its iOS project for the package, written by
// `expo prebuild`. It has three options and does nothing on Android (the Keystore needs no setup).
//
//   plugins: [['@apexnative/keychain', { faceIDPermission: 'Unlock the vault with Face ID', clearOnReinstall: true }]]
import {
  withEntitlementsPlist,
  withInfoPlist,
  type ConfigPlugin,
  type ExportedConfig,
} from 'expo/config-plugins';

/** The options of the plugin. */
export type ApexKeychainPluginProps = {
  /**
   * The text `NSFaceIDUsageDescription` shows when the app first asks for Face ID. Without it the text of
   * `ios.infoPlist.NSFaceIDUsageDescription` of the app config, then {@link DEFAULT_FACE_ID_PERMISSION}. `false` adds
   * nothing: for an app that never protects an item with the biometry, or that sets the key some other way.
   */
  faceIDPermission?: string | false;
  /**
   * Delete the package's items when the app is installed again (the iOS Keychain outlives the app): sets
   * `ApexKeychainClearOnReinstall` in Info.plist. Default `false`.
   */
  clearOnReinstall?: boolean;
  /**
   * The keychain access groups the app shares items in: the `keychain-access-groups` entitlement. Each is the group
   * without the team prefix, which `$(AppIdentifierPrefix)` adds (a value that starts with `$(` is kept as it is). The
   * app's own group, `<bundle id>`, is put first so that the items it already has stay reachable.
   */
  accessGroups?: string[];
};

export const DEFAULT_FACE_ID_PERMISSION =
  'Allow $(PRODUCT_NAME) to use Face ID to unlock the secrets it keeps in the Keychain.';

const PREFIX = '@apexnative/keychain config plugin:';
const OPTIONS = ['faceIDPermission', 'clearOnReinstall', 'accessGroups'] as const;
const TEAM_PREFIX = '$(AppIdentifierPrefix)';

type PlistValue = string | boolean | number | string[] | Record<string, unknown> | undefined;
type Plist = Record<string, PlistValue>;

/** The options, checked: an unknown one is an error, as a typo would leave the app without what it asked for. */
export function checkProps(props: unknown): ApexKeychainPluginProps {
  if (props === undefined || props === null) return {};
  if (typeof props !== 'object' || Array.isArray(props)) {
    throw new Error(`${PREFIX} the options must be an object.`);
  }
  const options = props as Record<string, unknown>;
  for (const name of Object.keys(options)) {
    if (!(OPTIONS as readonly string[]).includes(name)) {
      throw new Error(`${PREFIX} unknown option '${name}'. The options are ${OPTIONS.join(', ')}.`);
    }
  }
  const { faceIDPermission, clearOnReinstall, accessGroups } = options;
  if (
    faceIDPermission !== undefined &&
    faceIDPermission !== false &&
    (typeof faceIDPermission !== 'string' || faceIDPermission === '')
  ) {
    throw new Error(`${PREFIX} faceIDPermission must be a non-empty string, or false.`);
  }
  if (clearOnReinstall !== undefined && typeof clearOnReinstall !== 'boolean') {
    throw new Error(`${PREFIX} clearOnReinstall must be a boolean.`);
  }
  if (
    accessGroups !== undefined &&
    (!Array.isArray(accessGroups) ||
      accessGroups.some((group) => typeof group !== 'string' || group.trim() === ''))
  ) {
    throw new Error(`${PREFIX} accessGroups must be an array of non-empty strings.`);
  }
  return options as ApexKeychainPluginProps;
}

/** Info.plist with what the options ask for added; what is there already is kept. */
export function applyInfoPlist(
  infoPlist: Plist,
  props: ApexKeychainPluginProps,
  /** `ios.infoPlist.NSFaceIDUsageDescription` of the app config. */
  configured?: string
): Plist {
  const result = { ...infoPlist };
  if (props.faceIDPermission !== false) {
    result.NSFaceIDUsageDescription =
      props.faceIDPermission ??
      (typeof result.NSFaceIDUsageDescription === 'string'
        ? result.NSFaceIDUsageDescription
        : (configured ?? DEFAULT_FACE_ID_PERMISSION));
  }
  if (props.clearOnReinstall) result.ApexKeychainClearOnReinstall = true;
  return result;
}

/**
 * The entitlements with the keychain access groups added after those that are there; the app's own group first when
 * there were none, so that the default group doesn't change.
 */
export function applyEntitlements(
  entitlements: Plist,
  props: ApexKeychainPluginProps,
  bundleIdentifier?: string
): Plist {
  const groups = props.accessGroups ?? [];
  if (groups.length === 0) return entitlements;
  const existing = entitlements['keychain-access-groups'];
  // The first group is where items without an access group go: the app's own, unless the app has chosen one already.
  const merged = [
    ...(Array.isArray(existing) ? existing : []),
    ...(bundleIdentifier ? [`${TEAM_PREFIX}${bundleIdentifier}`] : []),
    ...groups.map((group) => (group.startsWith('$(') ? group : `${TEAM_PREFIX}${group}`)),
  ];
  return { ...entitlements, 'keychain-access-groups': [...new Set(merged)] };
}

export const withApexKeychain: ConfigPlugin<ApexKeychainPluginProps | void> = (
  config: ExportedConfig,
  props
) => {
  const options = checkProps(props);
  config = withInfoPlist(config, (modConfig) => {
    modConfig.modResults = applyInfoPlist(
      modConfig.modResults as Plist,
      options,
      modConfig.ios?.infoPlist?.NSFaceIDUsageDescription
    ) as typeof modConfig.modResults;
    return modConfig;
  });
  if (options.accessGroups?.length) {
    config = withEntitlementsPlist(config, (modConfig) => {
      modConfig.modResults = applyEntitlements(
        modConfig.modResults as Plist,
        options,
        modConfig.ios?.bundleIdentifier
      ) as typeof modConfig.modResults;
      return modConfig;
    });
  }
  return config;
};
