import type { Keychain, KeychainOptions } from '@apexnative/keychain';

/** The milestone whose native code a scenario checks. */
export type Milestone = 'M1' | 'M2' | 'M4';

/**
 * One line of a scenario's table, the answer next to the one expected: `pass` and `fail` compare them, `info` is for a
 * person to judge (a prompt's text, how long a call took), `skip` is a check that can't be made on this device.
 */
export type Row = {
  name: string;
  expected: string;
  got: string;
  status: 'pass' | 'fail' | 'info' | 'skip';
  /** More about a failure, such as the message of the error. */
  detail?: string;
};

/**
 * How a scenario ended: `passed` — every check passed; `failed` — a check failed or a call threw; `skipped` — the
 * device can't do what the scenario checks; `review` — the checks that can be made passed, the rest is for a person.
 */
export type Outcome = 'passed' | 'failed' | 'skipped' | 'review';

/** A scenario's run, as far as it has got. */
export type Run = {
  state: 'running' | Outcome;
  rows: Row[];
  notes: string[];
  /** Milliseconds the run took, once it ended. */
  ms?: number;
};

/** Told of every change of a run: the scenario it belongs to and the run so far. */
export type Observer = (scenario: Scenario, run: Run) => void;

/** What a scenario's `run` is given: the checks to make, and a store of its own to make them on. */
export interface Checks {
  /** Records a row: `got` should equal `expected`, deeply (bytes and objects included). */
  equal(name: string, expected: unknown, got: unknown): void;
  /** Records a row: the result of `work` should equal `expected`. A call that throws is a row that failed, not a crash. */
  expect(name: string, expected: unknown, work: () => unknown): Promise<void>;
  /** Records a row: `work` should throw (or reject with) the error code. */
  fails(name: string, code: string, work: () => unknown): Promise<void>;
  /** Records a row: the number should be from `low` to `high`. */
  within(name: string, low: number, high: number, got: number): void;
  /** Records a row: the value should be one of `expected`. */
  oneOf(name: string, expected: readonly unknown[], got: unknown): void;
  /** Records a row for a person to judge: what the device did, and what it should have done. */
  info(name: string, got: unknown, hint?: string): void;
  /** Records a check that can't be made on this device, and why. */
  skip(name: string, reason: string): void;
  /** Records a row as it is: for a scenario that has its own way to judge. */
  record(name: string, expected: string, got: string, status: Row['status'], detail?: string): void;
  /** Adds a line under the table: an instruction, or what the scenario did. */
  note(line: string): void;
  /** Ends the scenario as skipped: the device can't do what it checks. */
  abort(reason: string): never;
  /** A store of its own (`apexnative.example.<name>`), empty, cleared again when the scenario ends. */
  store(name: string, options?: KeychainOptions): Promise<Keychain>;
  /** Work to do when the scenario ends, however it ends. */
  cleanup(work: () => unknown): void;
  /** Runs another scenario, its card updating as it goes; the "run all" scenario uses it. */
  run(scenario: Scenario): Promise<Run>;
  sleep(ms: number): Promise<void>;
}

/** A scenario of the example app: one feature, run on a device, with what it saw in a table under it. */
export type Scenario = {
  /** A stable id, for end-to-end tests. */
  id: string;
  milestone: Milestone;
  title: string;
  /** What the scenario checks, in a sentence. */
  description: string;
  /** The scenario needs a person: to authenticate, to cancel a prompt, to change the biometry. */
  manual?: boolean;
  /** The scenario passes on a real device only, not on a simulator or an emulator. */
  realDevice?: boolean;
  /** A draft, written against the contract and not yet run on a device: it is listed, but not run. Enable it by removing this. */
  pending?: boolean;
  /** Runs the scenario. Throwing fails it; rows are recorded through `t`. */
  run(t: Checks): Promise<void>;
};
