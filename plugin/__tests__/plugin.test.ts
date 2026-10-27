// The config plugin: what `expo prebuild` writes into the iOS project for each option, and that Android is left alone.
import { compileModsAsync, type ExportedConfig } from 'expo/config-plugins';
import plugin, { DEFAULT_FACE_ID_PERMISSION } from '../src';
import {
  applyEntitlements,
  applyInfoPlist,
  checkProps,
  withApexKeychain,
  type ApexKeychainPluginProps,
} from '../src/withApexKeychain';

/** What the plugin makes of an app config: the Info.plist and the entitlements `expo prebuild` would write. */
async function prebuild(
  config: Record<string, unknown>,
  props?: ApexKeychainPluginProps,
  apply: (
    config: ExportedConfig,
    props?: ApexKeychainPluginProps
  ) => ExportedConfig = withApexKeychain as never
) {
  const exported = apply({ name: 'app', slug: 'app', ...config } as never, props);
  const compiled = await compileModsAsync(exported, {
    projectRoot: process.cwd(),
    introspect: true,
    platforms: ['ios', 'android'],
    assertMissingModProviders: false,
  });
  const results = (
    compiled as { _internal?: { modResults?: Record<string, Record<string, unknown>> } }
  )._internal?.modResults;
  return {
    infoPlist: results?.ios?.infoPlist as Record<string, unknown> | undefined,
    entitlements: results?.ios?.entitlements as Record<string, unknown> | undefined,
    android: results?.android,
    mods: compiled.mods,
  };
}

describe('the options', () => {
  it('may be left out', () => {
    expect(checkProps(undefined)).toEqual({});
    expect(checkProps(null)).toEqual({});
    expect(checkProps({})).toEqual({});
  });

  it.each([
    ['an unknown option', { faceIdPermission: 'x' }, "unknown option 'faceIdPermission'"],
    ['a text that is empty', { faceIDPermission: '' }, 'faceIDPermission'],
    ['a text that is true', { faceIDPermission: true }, 'faceIDPermission'],
    ['a clearOnReinstall that is a string', { clearOnReinstall: 'yes' }, 'clearOnReinstall'],
    ['accessGroups that is a string', { accessGroups: 'group' }, 'accessGroups'],
    ['an access group that is empty', { accessGroups: ['a', ' '] }, 'accessGroups'],
    ['options that are not an object', 'options', 'must be an object'],
  ])('reject %s', (_, props, message) => {
    expect(() => checkProps(props)).toThrow(message);
  });
});

describe('Info.plist', () => {
  it('gets a Face ID text by default', () => {
    expect(applyInfoPlist({}, {})).toEqual({
      NSFaceIDUsageDescription: DEFAULT_FACE_ID_PERMISSION,
    });
    expect(DEFAULT_FACE_ID_PERMISSION).toContain('Face ID');
  });

  it('takes the text of the option, then the app config, then the default', () => {
    expect(applyInfoPlist({}, { faceIDPermission: 'Unlock' }).NSFaceIDUsageDescription).toBe(
      'Unlock'
    );
    expect(
      applyInfoPlist({ NSFaceIDUsageDescription: 'Existing' }, { faceIDPermission: 'Unlock' })
        .NSFaceIDUsageDescription
    ).toBe('Unlock');
    expect(
      applyInfoPlist({ NSFaceIDUsageDescription: 'Existing' }, {}).NSFaceIDUsageDescription
    ).toBe('Existing');
    expect(applyInfoPlist({}, {}, 'Configured').NSFaceIDUsageDescription).toBe('Configured');
  });

  it('gets no Face ID text when the option is false, and keeps what is there', () => {
    expect(applyInfoPlist({}, { faceIDPermission: false })).toEqual({});
    expect(
      applyInfoPlist({ NSFaceIDUsageDescription: 'Mine' }, { faceIDPermission: false })
    ).toEqual({
      NSFaceIDUsageDescription: 'Mine',
    });
  });

  it('gets ApexKeychainClearOnReinstall only when asked, and keeps the other keys', () => {
    const plist = { CFBundleName: 'App' };
    expect(applyInfoPlist(plist, { faceIDPermission: false })).toEqual(plist);
    expect(applyInfoPlist(plist, { faceIDPermission: false, clearOnReinstall: false })).toEqual(
      plist
    );
    expect(applyInfoPlist(plist, { faceIDPermission: false, clearOnReinstall: true })).toEqual({
      CFBundleName: 'App',
      ApexKeychainClearOnReinstall: true,
    });
    expect(plist).toEqual({ CFBundleName: 'App' });
  });
});

describe('the entitlements', () => {
  it('stay as they are without access groups', () => {
    const entitlements = { 'aps-environment': 'development' };
    expect(applyEntitlements(entitlements, {}, 'dev.example.app')).toBe(entitlements);
    expect(applyEntitlements(entitlements, { accessGroups: [] }, 'dev.example.app')).toBe(
      entitlements
    );
  });

  it("get the groups under the team prefix, the app's own group first", () => {
    expect(
      applyEntitlements(
        {},
        { accessGroups: ['dev.example.shared', '$(AppIdentifierPrefix)other'] },
        'dev.example.app'
      )
    ).toEqual({
      'keychain-access-groups': [
        '$(AppIdentifierPrefix)dev.example.app',
        '$(AppIdentifierPrefix)dev.example.shared',
        '$(AppIdentifierPrefix)other',
      ],
    });
  });

  it('keep the groups that are there first, without doubling any', () => {
    // The first group is the default one: the app's choice stays.
    const result = applyEntitlements(
      { 'keychain-access-groups': ['$(AppIdentifierPrefix)dev.example.shared'], other: true },
      { accessGroups: ['dev.example.shared', 'dev.example.more'] },
      'dev.example.app'
    );
    expect(result).toEqual({
      'keychain-access-groups': [
        '$(AppIdentifierPrefix)dev.example.shared',
        '$(AppIdentifierPrefix)dev.example.app',
        '$(AppIdentifierPrefix)dev.example.more',
      ],
      other: true,
    });
  });

  it('are given the groups without the own one when the bundle id is not known', () => {
    expect(applyEntitlements({}, { accessGroups: ['shared'] })).toEqual({
      'keychain-access-groups': ['$(AppIdentifierPrefix)shared'],
    });
  });
});

describe('the plugin on an app config', () => {
  const app = {
    ios: { bundleIdentifier: 'dev.example.app' },
    android: { package: 'dev.example.app' },
  };

  it('writes the Face ID text and nothing else with no options', async () => {
    const { infoPlist, entitlements } = await prebuild(app);
    expect(infoPlist).toMatchObject({ NSFaceIDUsageDescription: DEFAULT_FACE_ID_PERMISSION });
    expect(infoPlist).not.toHaveProperty('ApexKeychainClearOnReinstall');
    expect(entitlements).not.toHaveProperty('keychain-access-groups');
  });

  it('writes what each option asks for', async () => {
    const { infoPlist, entitlements } = await prebuild(app, {
      faceIDPermission: 'Unlock the vault',
      clearOnReinstall: true,
      accessGroups: ['dev.example.shared'],
    });
    expect(infoPlist).toMatchObject({
      NSFaceIDUsageDescription: 'Unlock the vault',
      ApexKeychainClearOnReinstall: true,
    });
    expect(entitlements).toMatchObject({
      'keychain-access-groups': [
        '$(AppIdentifierPrefix)dev.example.app',
        '$(AppIdentifierPrefix)dev.example.shared',
      ],
    });
  });

  it('takes the Face ID text of the app config over the default', async () => {
    const { infoPlist } = await prebuild({
      ...app,
      ios: { ...app.ios, infoPlist: { NSFaceIDUsageDescription: 'From the config' } },
    });
    expect(infoPlist).toMatchObject({ NSFaceIDUsageDescription: 'From the config' });
  });

  it('changes nothing for Android', async () => {
    const without = await prebuild(app, undefined, (config) => config);
    const withAll = await prebuild(app, {
      faceIDPermission: 'x',
      clearOnReinstall: true,
      accessGroups: ['g'],
    });
    expect(withAll.android).toEqual(without.android);
    expect(Object.keys(withAll.mods?.android ?? {})).toEqual(
      Object.keys(without.mods?.android ?? {})
    );
  });

  it('leaves the entitlements as they are without access groups', async () => {
    const without = await prebuild(app, undefined, (config) => config);
    const withOptions = await prebuild(app, { clearOnReinstall: true });
    expect(withOptions.entitlements).toEqual(without.entitlements);
  });

  it('rejects options it does not know, before anything is written', () => {
    expect(() =>
      withApexKeychain({ name: 'app', slug: 'app' }, { cleanOnReinstall: true } as never)
    ).toThrow("unknown option 'cleanOnReinstall'");
  });
});

describe('the entry point', () => {
  it('runs once however many times it is listed', async () => {
    const { infoPlist } = await prebuild(
      { ios: { bundleIdentifier: 'dev.example.app' } },
      { faceIDPermission: 'Once' },
      (config, props) => plugin(plugin(config as never, props), props)
    );
    expect(infoPlist).toMatchObject({ NSFaceIDUsageDescription: 'Once' });
  });

  it('is what app.plugin.js exports, named after the package', () => {
    const pkg = require('../../package.json') as { name: string };
    expect(pkg.name).toBe('@apexnative/keychain');
    expect(typeof plugin).toBe('function');
  });
});

describe('the package', () => {
  const pkg = require('../../package.json') as {
    files: string[];
    exports: Record<string, unknown>;
    peerDependencies: Record<string, string>;
    peerDependenciesMeta: Record<string, { optional?: boolean }>;
  };

  it('ships the plugin and says where Expo finds it', () => {
    expect(pkg.files).toEqual(expect.arrayContaining(['app.plugin.js', 'plugin']));
    expect(pkg.exports['./app.plugin.js']).toBe('./app.plugin.js');
    const entry = require('fs').readFileSync(`${__dirname}/../../app.plugin.js`, 'utf8') as string;
    expect(entry).toContain("require('./plugin/build')");
  });

  it('needs expo only for the plugin, so expo is an optional peer', () => {
    expect(pkg.peerDependencies.expo).toBeDefined();
    expect(pkg.peerDependenciesMeta.expo).toEqual({ optional: true });
  });
});
