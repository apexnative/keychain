// The scenarios of the example app (example/src/scenarios.ts), run in Jest. On the in-memory module every scenario
// that needs no person must pass, and those that do need one pass when the mock plays the person (a canceled prompt, a
// new finger): they are what iOS and Android are held to on a device, and the mock is the reference they must agree
// with. On the stubs of M0 (every call UNSUPPORTED) they must fail, and say so, instead of passing by accident.
import type { MemoryKeychain } from '../jest/MemoryKeychain';
import type * as Native from '../native/NativeApexKeychain';

// The example is not part of this project's TypeScript: what the test needs of it is described here, and it is loaded
// with `require`.
type Row = { name: string; expected: string; got: string; status: string; detail?: string };
type Run = { state: string; rows: Row[]; notes: string[] };
type Scenario = {
  id: string;
  milestone: string;
  title: string;
  manual?: boolean;
  pending?: boolean;
};
type Harness = {
  scenarios: Scenario[];
  runScenario(scenario: Scenario, observer?: (scenario: Scenario, run: Run) => void): Promise<Run>;
  /** The module the scenarios run over. */
  native: Native.Spec;
  /** `Platform` of the scenarios' own `react-native`. */
  platform: { OS: string; Version: string | number };
};

/** Loads the scenarios over a native module: the example's package import becomes the API over it. */
function load(makeNative: () => Native.Spec): Harness {
  jest.resetModules();
  const native = makeNative();
  const { TurboModuleRegistry } = require('react-native') as typeof import('react-native');
  jest.spyOn(TurboModuleRegistry, 'get').mockReturnValue(native as never);
  const { createApi } = require('../api') as typeof import('../api');
  const errors = require('../errors') as typeof import('../errors');
  const constants = require('../constants') as typeof import('../constants');
  const api = createApi(() => native);
  jest.doMock('@apexnative/keychain', () => ({ ...api, ...constants, ...errors }), {
    virtual: true,
  });
  const { createMigrate } =
    require('../migrate/createMigrate') as typeof import('../migrate/createMigrate');
  jest.doMock('@apexnative/keychain/migrate', () => createMigrate(() => native, api), {
    virtual: true,
  });
  // The old libraries that plant items on a device: here the memory plants them, and a module that is no memory plants
  // nothing, so that a scenario that moves them fails on what the module answers.
  jest.doMock('../../example/src/m4/legacy', () => legacyOver(native));
  const { createCompat } =
    require('../compat/createCompat') as typeof import('../compat/createCompat');
  const compatEnums = require('../compat/enums') as typeof import('../compat/enums');
  jest.doMock('@apexnative/keychain/compat', () => ({ ...createCompat(api), ...compatEnums }), {
    virtual: true,
  });
  const { Platform } = require('react-native') as typeof import('react-native');
  return {
    ...(require('../../example/src/scenarios') as { scenarios: Harness['scenarios'] }),
    ...(require('../../example/src/harness/runner') as { runScenario: Harness['runScenario'] }),
    native,
    platform: Platform,
  };
}

/** The `legacy` of the example (example/src/m4/legacy.ts) over a native module. */
function legacyOver(native: Native.Spec) {
  const controls = (native as Partial<MemoryKeychain>).controls;
  const sources = () => controls?.migrationSources() ?? [];
  const has = (kind: string, service: string) =>
    Promise.resolve(sources().some((item) => item.kind === kind && item.service === service));
  return {
    MISSING: 'No old libraries.',
    legacy: {
      reactNativeKeychain: {
        plantGeneric: async (
          service: string,
          username: string,
          password: string,
          requiresAuth = false
        ) =>
          controls?.addMigrationSource({
            library: 'reactNativeKeychain',
            service,
            username,
            password,
            requiresAuth,
          }),
        plantInternet: async (server: string, username: string, password: string) =>
          controls?.addMigrationSource({
            library: 'reactNativeKeychain',
            server,
            username,
            password,
          }),
        hasGeneric: (service: string) => has('genericPassword', service),
        hasInternet: (server: string) => has('internetPassword', server),
        clean: async () => {},
      },
      expoSecureStore: {
        plant: async (key: string, value: string, keychainService: string, requiresAuth = false) =>
          controls?.addMigrationSource({
            library: 'expoSecureStore',
            key,
            value,
            keychainService,
            requiresAuth,
          }),
        has: (key: string, keychainService: string) =>
          Promise.resolve(
            sources().some(
              (item) =>
                item.kind === 'secureStore' &&
                item.service === keychainService &&
                item.account === key
            )
          ),
        clean: async () => {},
      },
    },
  };
}

function memoryNative(): Native.Spec {
  const { MemoryKeychain } =
    require('../jest/MemoryKeychain') as typeof import('../jest/MemoryKeychain');
  const memory = new MemoryKeychain();
  // The example app's id, which the "services" scenario expects of the default service.
  memory.controls.setDevice({ defaultService: 'dev.apexnative.keychain.example' });
  return memory;
}

/** The module of milestone M0: every call is UNSUPPORTED, except the default service. */
function stubNative(): Native.Spec {
  const message = "@apexnative/keychain: this isn't implemented on this platform yet.";
  const unsupported = () =>
    Promise.reject(Object.assign(new Error(message), { code: 'UNSUPPORTED' }));
  const failure = () => ({ error: { code: 'UNSUPPORTED' as const, message } });
  return {
    setItem: unsupported,
    getItem: unsupported,
    removeItem: unsupported,
    hasItem: unsupported,
    getItemInfo: unsupported,
    getAllKeys: unsupported,
    clear: unsupported,
    getItemSync: failure,
    setItemSync: failure,
    hasItemSync: failure,
    removeItemSync: failure,
    getDefaultService: () => 'dev.apexnative.keychain.example',
    getBiometryTypes: unsupported,
    canUseAccessControl: unsupported,
    isPasscodeSet: unsupported,
    getBiometryState: unsupported,
    getHardwareSecurityLevel: () => Promise.resolve(null),
    getMigrationSources: unsupported,
    readMigrationSource: unsupported,
    finishMigrationSource: unsupported,
  } as unknown as Native.Spec;
}

const find = (harness: Harness, id: string) => {
  const scenario = harness.scenarios.find((item) => item.id === id);
  if (!scenario) throw new Error(`No scenario ${id}.`);
  return scenario;
};
const controls = (harness: Harness) => (harness.native as MemoryKeychain).controls;
const failures = (run: Run) => run.rows.filter((row) => row.status === 'fail');

/** Scenarios that need no person, which is what "run all" runs. */
const automatic = (harness: Harness) =>
  harness.scenarios.filter(
    (scenario) => !scenario.manual && !scenario.pending && scenario.id !== 'run-all'
  );

describe('the scenarios on the in-memory module', () => {
  it('lists the scenarios, "run all" first, and none of them as a draft', () => {
    const harness = load(memoryNative);
    const ids = harness.scenarios.map((scenario) => scenario.id);
    expect(ids[0]).toBe('run-all');
    expect(new Set(ids).size).toBe(ids.length);
    expect(harness.scenarios.filter((scenario) => scenario.milestone === 'M1').length).toBe(16);
    expect(harness.scenarios.filter((scenario) => scenario.milestone === 'M2').length).toBe(10);
    expect(
      harness.scenarios
        .filter((scenario) => scenario.milestone === 'M4')
        .map((scenario) => scenario.id)
    ).toEqual(['compat', 'compat-auth', 'migrate-empty', 'migrate-legacy', 'migrate-protected']);
    expect(harness.scenarios.filter((scenario) => scenario.pending)).toEqual([]);
    expect(
      harness.scenarios.filter((scenario) => scenario.manual).map((scenario) => scenario.id)
    ).toEqual(expect.arrayContaining(['m2-prompt', 'm2-cancel', 'm2-invalidation']));
  });

  it('pass, every one that needs no person', async () => {
    const harness = load(memoryNative);
    for (const scenario of automatic(harness)) {
      const run = await harness.runScenario(scenario);
      // `review` is a run whose checks passed and that has rows left for a person to judge.
      expect([scenario.id, ['passed', 'review'].includes(run.state), failures(run)]).toEqual([
        scenario.id,
        true,
        [],
      ]);
      expect(run.rows.length).toBeGreaterThan(0);
    }
  });

  it('are summed up by "run all", row by row', async () => {
    const harness = load(memoryNative);
    const seen = new Set<string>();
    const run = await harness.runScenario(harness.scenarios[0]!, (scenario, progress) => {
      if (progress.state === 'passed' || progress.state === 'review') seen.add(scenario.id);
    });
    const chosen = automatic(harness);
    expect(run.state).toBe('passed');
    expect(run.rows.map((row) => row.name)).toEqual(chosen.map((scenario) => scenario.title));
    expect(run.rows.every((row) => row.status === 'pass' && row.expected === 'passed')).toBe(true);
    expect(chosen.every((scenario) => seen.has(scenario.id))).toBe(true);
    expect(run.notes[run.notes.length - 1]).toMatch(
      new RegExp(
        `^${chosen.length} scenarios: \\d+ passed, 0 failed, 0 skipped(, \\d+ need a look)?\\.$`
      )
    );
  });

  it('leave nothing behind', async () => {
    const harness = load(memoryNative);
    await harness.runScenario(harness.scenarios[0]!);
    const { createKeychain, keychain } =
      require('@apexnative/keychain') as typeof import('../index');
    await expect(keychain.getAllKeys()).resolves.toEqual([]);
    const leftovers = await Promise.all(
      [
        'strings',
        'bytes',
        'overwrite',
        'info',
        'services.vault',
        'credentials',
        'm2-availability',
      ].map((name) => createKeychain({ service: `apexnative.example.${name}` }).getAllKeys())
    );
    expect(leftovers).toEqual(leftovers.map(() => []));
  });

  it('show a bug of an implementation as a failed row, not a crash', async () => {
    const harness = load(() => {
      const memory = memoryNative();
      // An implementation that forgets to keep the label when a value is overwritten.
      const original = memory.getItemInfo.bind(memory);
      memory.getItemInfo = async (...args) => {
        const info = await original(...args);
        return info && { ...info, label: info.label === undefined ? 'surprise' : info.label };
      };
      return memory;
    });
    const run = await harness.runScenario(find(harness, 'info'));
    expect(run.state).toBe('failed');
    const failed = failures(run);
    expect(failed.map((row) => row.name)).toContain('the label is removed by a write without one');
    expect(failed[0]).toMatchObject({ expected: 'undefined', got: '"surprise"' });
  });
});

describe('the scenarios of a device, on a device that is not the default', () => {
  it('"what the device can protect" agrees with a device that has no biometry, or none enrolled', async () => {
    for (const device of [
      { biometryEnrolled: false },
      { biometryTypes: [], biometryEnrolled: false },
      { biometryEnrolled: false, passcodeSet: false },
    ]) {
      const harness = load(memoryNative);
      controls(harness).setDevice(device);
      const run = await harness.runScenario(find(harness, 'm2-availability'));
      expect([JSON.stringify(device), run.state, failures(run)]).toEqual([
        JSON.stringify(device),
        'passed',
        [],
      ]);
    }
  });

  it('"what the device can protect" agrees with an Android device before 11', async () => {
    for (const api of [29, 30]) {
      const harness = load(memoryNative);
      harness.platform.OS = 'android';
      jest.spyOn(harness.platform as { Version: number }, 'Version', 'get').mockReturnValue(api);
      controls(harness).setDevice({ androidApi: api, biometryTypes: ['fingerprint'] });
      const run = await harness.runScenario(find(harness, 'm2-availability'));
      expect([api, run.state, failures(run)]).toEqual([api, 'passed', []]);
      expect(run.notes[0]).toContain(api === 29 ? 'Android before 11' : 'fingerprint');
    }
  });

  it('"what the device can protect" fails where the device lacks the Face ID description', async () => {
    const harness = load(memoryNative);
    controls(harness).setDevice({ faceIDUsageDescription: false });
    const run = await harness.runScenario(find(harness, 'm2-availability'));
    expect(run.state).toBe('failed');
    expect(run.rows.some((row) => row.got.includes('MISSING_USAGE_DESCRIPTION'))).toBe(true);
  });

  it('"key storage" follows the hardware of an Android device', async () => {
    for (const level of ['strongbox', 'tee', 'software']) {
      const harness = load(memoryNative);
      harness.platform.OS = 'android';
      controls(harness).setDevice({ hardwareSecurityLevel: level as never });
      const run = await harness.runScenario(find(harness, 'm2-strongbox'));
      expect([level, run.state, failures(run)]).toEqual([level, 'review', []]);
    }
  });
});

describe("the scenarios that need a person, with the mock in the person's place", () => {
  it('"prompt and protected read" shows its three prompts, with the texts', async () => {
    const harness = load(memoryNative);
    const run = await harness.runScenario(find(harness, 'm2-prompt'));
    expect([run.state, failures(run)]).toEqual(['review', []]);
    const prompts = controls(harness).prompts();
    expect(prompts.map((prompt) => prompt.title)).toEqual([
      'Example: unlock the item',
      'Second read',
      'Example: unlock the item',
    ]);
    expect(prompts[1]).toMatchObject({ cancel: 'Not now', subtitle: 'Subtitle (Android)' });
  });

  it('"canceled prompt" passes when the prompt is canceled once', async () => {
    const harness = load(memoryNative);
    controls(harness).failNextAuthentication('USER_CANCELED');
    const run = await harness.runScenario(find(harness, 'm2-cancel'));
    expect([run.state, failures(run)]).toEqual(['passed', []]);
    const left = await harness.runScenario(find(harness, 'm2-cancel'));
    expect(left.state).toBe('failed');
    expect(left.rows[0]).toMatchObject({
      expected: 'throws USER_CANCELED',
      got: expect.any(String),
    });
  });

  it('"fallback button" passes on a tapped fallback, and is for iOS only', async () => {
    const harness = load(memoryNative);
    controls(harness).failNextAuthentication('USER_FALLBACK');
    const run = await harness.runScenario(find(harness, 'm2-fallback'));
    expect([run.state, failures(run)]).toEqual(['passed', []]);
    expect(
      controls(harness)
        .prompts()
        .map((prompt) => prompt.fallback)
    ).toEqual(['Other way', '']);

    const android = load(memoryNative);
    android.platform.OS = 'android';
    const skipped = await android.runScenario(find(android, 'm2-fallback'));
    expect([skipped.state, skipped.rows]).toEqual(['skipped', []]);
    expect(controls(android).prompts()).toEqual([]);
  });

  it('"lockout" passes when the biometry locks', async () => {
    const harness = load(memoryNative);
    controls(harness).failNextAuthentication('LOCKOUT');
    const run = await harness.runScenario(find(harness, 'm2-lockout'));
    expect([run.state, failures(run)]).toEqual(['passed', []]);
  });

  it('"reads while a prompt is open" gives each read its own value', async () => {
    const harness = load(memoryNative);
    const run = await harness.runScenario(find(harness, 'm2-parallel-reads'));
    expect([run.state, failures(run)]).toEqual(['passed', []]);
    expect(controls(harness).prompts()).toHaveLength(3);
  });

  it('"authValidity" waits out the window, and is UNSUPPORTED before Android 11', async () => {
    jest.useFakeTimers();
    try {
      const harness = load(memoryNative);
      const pending = harness.runScenario(find(harness, 'm2-auth-validity'));
      await jest.advanceTimersByTimeAsync(30_000);
      const run = await pending;
      expect([run.state, failures(run)]).toEqual(['review', []]);

      const old = load(memoryNative);
      old.platform.OS = 'android';
      jest.spyOn(old.platform as { Version: number }, 'Version', 'get').mockReturnValue(29);
      controls(old).setDevice({ androidApi: 29 });
      const refused = await old.runScenario(find(old, 'm2-auth-validity'));
      expect([refused.state, failures(refused)]).toEqual(['skipped', []]);
      expect(refused.rows[0]).toMatchObject({ status: 'pass', expected: 'throws UNSUPPORTED' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('"new biometry" writes the first time, and finds the item invalid the second', async () => {
    const harness = load(memoryNative);
    const first = await harness.runScenario(find(harness, 'm2-invalidation'));
    expect(first.state).toBe('skipped');
    expect(first.notes.join(' ')).toContain('enroll another finger or face');
    controls(harness).changeBiometry();
    const second = await harness.runScenario(find(harness, 'm2-invalidation'));
    expect([second.state, failures(second)]).toEqual(['passed', []]);
    const again = await harness.runScenario(find(harness, 'm2-invalidation'));
    expect(again.state).toBe('skipped');
  });

  it('"new biometry" fails when the biometry did not change', async () => {
    const harness = load(memoryNative);
    await harness.runScenario(find(harness, 'm2-invalidation'));
    const run = await harness.runScenario(find(harness, 'm2-invalidation'));
    expect(run.state).toBe('failed');
  });

  it('is marked as passing on a real device only', () => {
    const harness = load(memoryNative);
    expect(find(harness, 'm2-invalidation')).toMatchObject({ realDevice: true, manual: true });
  });
});

describe('the scenarios on the stubs of M0', () => {
  it('fail with UNSUPPORTED, every one that needs no person', async () => {
    const harness = load(stubNative);
    for (const scenario of automatic(harness)) {
      const run = await harness.runScenario(scenario);
      expect([scenario.id, run.state]).toEqual([scenario.id, 'failed']);
      expect(failures(run).length).toBeGreaterThan(0);
      expect(failures(run).some((row) => row.got.includes('UNSUPPORTED'))).toBe(true);
    }
  });

  it('are reported failed by "run all", each with the reason', async () => {
    const harness = load(stubNative);
    const run = await harness.runScenario(harness.scenarios[0]!);
    expect(run.state).toBe('failed');
    expect(run.rows.length).toBeGreaterThan(10);
    for (const row of run.rows) {
      expect(row).toMatchObject({ status: 'fail', expected: 'passed' });
      expect(row.got).toMatch(/^failed/);
      expect(row.detail).toContain('UNSUPPORTED');
    }
  });
});
