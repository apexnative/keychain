// What the device check has found so far, kept in the keychain itself so that it survives a restart of the app, and
// the report a person sends back when it is done.
import { createKeychain } from '@apexnative/keychain';
import type { Run } from '../harness/types';
import type { Step } from './plan';

/** How a step ended, once a person has judged what the scenario left to them. */
export type Verdict = 'passed' | 'failed' | 'skipped';

/** The result of one step. */
export type Result = {
  verdict: Verdict;
  /** The checks that failed, one line each. */
  failures: string[];
  /** The person's answer to the step's question, when it had one. */
  answer?: 'yes' | 'no';
  /** When the step ended, in milliseconds since the Unix epoch. */
  at: number;
};

/** The results of the steps, by the step's id. */
export type Progress = Record<string, Result>;

// Not under `apexnative.example.`: no scenario's cleanup may reach it.
const store = createKeychain({ service: 'apexnative.device-check' });
const KEY = 'progress';

/** The results saved before, or none. */
export async function loadProgress(): Promise<Progress> {
  try {
    const saved = await store.getItem(KEY);
    return saved ? (JSON.parse(saved) as Progress) : {};
  } catch {
    return {};
  }
}

/** Saves the results; a failure only loses them at the next start. */
export async function saveProgress(progress: Progress): Promise<void> {
  try {
    await store.setItem(KEY, JSON.stringify(progress));
  } catch {}
}

/** The checks of a run that failed, one line each. */
export function failuresOf(run: Run): string[] {
  return run.rows
    .filter((row) => row.status === 'fail')
    .map(
      (row) =>
        `${row.name}: expected ${row.expected}, got ${row.got}` +
        (row.detail ? ` (${row.detail})` : '')
    );
}

const MARKS: Record<Verdict, string> = { passed: '✓', failed: '✗', skipped: '–' };

/** The whole check as text: the device, then a line for every step and the failures under it. */
export function reportOf(steps: Step[], progress: Progress, device: string): string {
  const lines = [`Device check · ${device} · ${new Date().toISOString().slice(0, 16)}`];
  for (const step of steps) {
    const result = progress[step.id];
    if (!result) {
      lines.push(`· ${step.title}: not run`);
      continue;
    }
    const answer = result.answer ? ` (person: ${result.answer})` : '';
    lines.push(`${MARKS[result.verdict]} ${step.title}: ${result.verdict}${answer}`);
    for (const failure of result.failures) lines.push(`    ${failure}`);
  }
  return lines.join('\n');
}
