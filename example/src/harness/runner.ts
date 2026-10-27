import { createKeychain, type Keychain, type KeychainOptions } from '@apexnative/keychain';
import type { Checks, Observer, Outcome, Row, Run, Scenario } from './types';
import { codeOf, describe, describeError, messageOf, same } from './values';

/** The services of the scenarios start with this, so that they never meet the app's own items. */
export const SERVICE_PREFIX = 'apexnative.example.';

/** The name of the row that records a call the scenario didn't expect to throw. */
export const UNEXPECTED = 'unexpected error';

/** Thrown by `abort`: the scenario ends as skipped, not failed. */
class Skipped extends Error {}

class Recorder implements Checks {
  readonly rows: Row[] = [];
  readonly notes: string[] = [];
  private readonly cleanups: Array<() => unknown> = [];

  constructor(
    private readonly scenario: Scenario,
    private readonly observer: Observer
  ) {}

  emit(state: Run['state'], ms?: number) {
    this.observer(this.scenario, {
      state,
      rows: [...this.rows],
      notes: [...this.notes],
      ...(ms === undefined ? {} : { ms }),
    });
  }

  private add(row: Row) {
    this.rows.push(row);
    this.emit('running');
  }

  equal(name: string, expected: unknown, got: unknown) {
    const ok = same(expected, got);
    this.add({
      name,
      expected: describe(expected),
      got: describe(got),
      status: ok ? 'pass' : 'fail',
    });
  }

  async expect(name: string, expected: unknown, work: () => unknown) {
    try {
      this.equal(name, expected, await work());
    } catch (error) {
      this.add({
        name,
        expected: describe(expected),
        got: `throws ${codeOf(error) ?? 'an error'}`,
        status: 'fail',
        detail: messageOf(error),
      });
    }
  }

  async fails(name: string, code: string, work: () => unknown) {
    const expected = `throws ${code}`;
    try {
      const result = await work();
      this.add({
        name,
        expected,
        got: `no error, returned ${describe(result)}`,
        status: 'fail',
      });
    } catch (error) {
      const got = codeOf(error);
      this.add({
        name,
        expected,
        got: `throws ${got ?? 'an error'}`,
        status: got === code ? 'pass' : 'fail',
        ...(got === code ? {} : { detail: messageOf(error) }),
      });
    }
  }

  within(name: string, low: number, high: number, got: number) {
    this.add({
      name,
      expected: `${low} … ${high}`,
      got: String(got),
      status: got >= low && got <= high ? 'pass' : 'fail',
    });
  }

  oneOf(name: string, expected: readonly unknown[], got: unknown) {
    this.add({
      name,
      expected: `one of ${expected.map(describe).join(', ')}`,
      got: describe(got),
      status: expected.some((option) => same(option, got)) ? 'pass' : 'fail',
    });
  }

  info(name: string, got: unknown, hint = 'for you to judge') {
    this.add({ name, expected: hint, got: describe(got), status: 'info' });
  }

  skip(name: string, reason: string) {
    this.add({ name, expected: '—', got: reason, status: 'skip' });
  }

  record(name: string, expected: string, got: string, status: Row['status'], detail?: string) {
    this.add({ name, expected, got, status, ...(detail === undefined ? {} : { detail }) });
  }

  note(line: string) {
    this.notes.push(line);
    this.emit('running');
  }

  abort(reason: string): never {
    throw new Skipped(reason);
  }

  async store(name: string, options: KeychainOptions = {}): Promise<Keychain> {
    const store = createKeychain({ ...options, service: `${SERVICE_PREFIX}${name}` });
    // A store that can't be cleared is not a reason to stop: the calls the scenario makes fail on their own, and say why.
    try {
      await store.clear();
    } catch (error) {
      this.note(
        `Setup: clear() of '${store.service}' failed, the store may not be empty: ${describeError(error)}`
      );
    }
    this.cleanup(() => store.clear());
    return store;
  }

  cleanup(work: () => unknown) {
    this.cleanups.push(work);
  }

  run(scenario: Scenario): Promise<Run> {
    return runScenario(scenario, this.observer);
  }

  sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  /** The unexpected: a call a scenario didn't expect to throw did. It fails the scenario with the call's error. */
  fatal(error: unknown) {
    this.add({
      name: UNEXPECTED,
      expected: 'no error',
      got: `throws ${codeOf(error) ?? 'an error'}`,
      status: 'fail',
      detail: describeError(error),
    });
  }

  /** Runs the cleanups in reverse; a cleanup that fails is a note, unless the scenario has failed already. */
  async finish(failed: boolean) {
    for (const work of this.cleanups.reverse()) {
      try {
        await work();
      } catch (error) {
        if (!failed) this.notes.push(`Cleanup failed: ${describeError(error)}`);
      }
    }
  }
}

function outcomeOf(rows: Row[], skipped: boolean): Outcome {
  if (rows.some((row) => row.status === 'fail')) return 'failed';
  if (skipped) return 'skipped';
  if (rows.some((row) => row.status === 'info')) return 'review';
  return rows.some((row) => row.status === 'pass') ? 'passed' : 'skipped';
}

/** Runs a scenario and tells the observer of every row it records. Never throws: a crash is a failed run. */
export async function runScenario(scenario: Scenario, observer: Observer = () => {}): Promise<Run> {
  const recorder = new Recorder(scenario, observer);
  const start = Date.now();
  let skipped = false;
  recorder.emit('running');
  try {
    await scenario.run(recorder);
  } catch (error) {
    if (error instanceof Skipped) {
      skipped = true;
      recorder.notes.push(error.message);
    } else {
      recorder.fatal(error);
    }
  }
  await recorder.finish(recorder.rows.some((row) => row.status === 'fail'));
  const state = outcomeOf(recorder.rows, skipped);
  const ms = Date.now() - start;
  recorder.emit(state, ms);
  return { state, rows: recorder.rows, notes: recorder.notes, ms };
}
