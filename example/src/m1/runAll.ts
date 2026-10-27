import { UNEXPECTED } from '../harness/runner';
import type { Run, Scenario } from '../harness/types';

const LABEL: Record<Run['state'], string> = {
  running: 'running',
  passed: 'passed',
  failed: 'failed',
  skipped: 'skipped',
  review: 'needs a look',
};

/** What a run came to, in a few words: the checks it made, or why it stopped. */
function summarize(run: Run): string {
  const checks = run.rows.filter((row) => row.status === 'pass' || row.status === 'fail');
  const failed = run.rows.filter((row) => row.status === 'fail');
  if (run.state === 'skipped') {
    return `skipped · ${run.notes[run.notes.length - 1] ?? 'no checks made'}`;
  }
  if (failed.some((row) => row.name === UNEXPECTED)) return 'failed · stopped by an error';
  if (failed.length > 0) return `failed · ${failed.length} of ${checks.length} checks failed`;
  return `${LABEL[run.state]} · ${checks.length} checks`;
}

/** Why a run failed: the error that stopped it, or the first check that did not pass. */
function reason(run: Run): string | undefined {
  const stopped = run.rows.find((row) => row.name === UNEXPECTED);
  if (stopped) return stopped.detail;
  const first = run.rows.find((row) => row.status === 'fail');
  if (!first) return undefined;
  return `${first.name}: expected ${first.expected}, got ${first.got}`;
}

/**
 * The scenario that runs the others: every scenario that needs no person, one after the other, with a row each and
 * the verdict at the end. The cards of the scenarios fill in as it goes.
 */
export function createRunAll(list: () => Scenario[]): Scenario {
  return {
    id: 'run-all',
    milestone: 'M1',
    title: 'Run all',
    description:
      'Runs every scenario that needs no person, in turn, and shows pass or fail for each. The ones that need you (M2: a prompt to answer) are not run.',
    async run(t) {
      const chosen = list().filter(
        (scenario) => !scenario.manual && !scenario.pending && scenario.id !== 'run-all'
      );
      const tally = { passed: 0, failed: 0, skipped: 0, review: 0 };
      for (const scenario of chosen) {
        const run = await t.run(scenario);
        if (run.state !== 'running') tally[run.state]++;
        const status = run.state === 'failed' ? 'fail' : run.state === 'skipped' ? 'skip' : 'pass';
        t.record(scenario.title, 'passed', summarize(run), status, reason(run));
      }
      t.note(
        `${chosen.length} scenarios: ${tally.passed} passed, ${tally.failed} failed, ${tally.skipped} skipped` +
          (tally.review ? `, ${tally.review} need a look` : '') +
          '.'
      );
    },
  };
}
