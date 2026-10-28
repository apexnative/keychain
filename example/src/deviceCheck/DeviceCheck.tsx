import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { getBiometryTypes, getHardwareSecurityLevel } from '@apexnative/keychain';
import { runScenario } from '../harness/runner';
import type { Run } from '../harness/types';
import { Expectation } from '../ScenarioCard';
import { scenarios } from '../scenarios';
import { STATE_COLORS, STATE_LABELS, type Theme } from '../theme';
import { forPlatform, questionOf, steps, type Step } from './plan';
import {
  failuresOf,
  loadProgress,
  reportOf,
  saveProgress,
  type Progress,
  type Result,
  type Verdict,
} from './progress';

const BIOMETRY_NAMES: Record<string, string> = {
  faceID: 'Face ID',
  touchID: 'Touch ID',
  opticID: 'Optic ID',
  fingerprint: 'fingerprint',
  face: 'face',
  iris: 'iris',
};

const VERDICT_COLORS: Record<Verdict, string> = {
  passed: STATE_COLORS.passed,
  failed: STATE_COLORS.failed,
  skipped: STATE_COLORS.skipped,
};

/** The phone in a line: the OS and its version, the model on Android, the biometrics and where keys live. */
async function describeDevice(): Promise<string> {
  const parts: string[] = [];
  if (Platform.OS === 'android') {
    const constants = Platform.constants as { Brand?: string; Model?: string; Release?: string };
    parts.push(
      `${constants.Brand ?? ''} ${constants.Model ?? ''}`.trim(),
      `Android ${constants.Release ?? '?'} (API ${Platform.Version})`
    );
  } else {
    parts.push(`iOS ${Platform.Version}`);
  }
  try {
    const types = await getBiometryTypes();
    parts.push(
      types.length > 0
        ? types.map((type) => BIOMETRY_NAMES[type] ?? type).join(' + ')
        : 'no biometrics'
    );
  } catch {}
  try {
    const level = await getHardwareSecurityLevel();
    if (level) parts.push(`keys in ${level}`);
  } catch {}
  return parts.join(' · ');
}

function verdictOf(run: Run): Verdict {
  if (run.state === 'failed') return 'failed';
  if (run.state === 'skipped') return 'skipped';
  return 'passed';
}

function Instructions({ title, lines, theme }: { title: string; lines: string[]; theme: Theme }) {
  if (lines.length === 0) return null;
  return (
    <View style={[styles.box, { backgroundColor: theme.card }]}>
      <Text style={[styles.boxTitle, { color: theme.secondary }]}>{title}</Text>
      {lines.map((line, index) => (
        <View key={index} style={styles.instruction}>
          <Text style={[styles.instructionNumber, { color: theme.secondary }]}>{index + 1}.</Text>
          <Text style={[styles.instructionText, { color: theme.text }]}>{line}</Text>
        </View>
      ))}
    </View>
  );
}

type Props = {
  theme: Theme;
  onExit: () => void;
};

/**
 * The guided check of a real phone: one step at a time, what to do before it, what to do now while it runs, and a
 * report to send back at the end. The results are kept in the keychain, so the check goes on after a restart.
 */
export function DeviceCheck({ theme, onExit }: Props) {
  const [device, setDevice] = useState('');
  const [progress, setProgress] = useState<Progress>({});
  const [index, setIndex] = useState(0);
  const [run, setRun] = useState<Run>();
  const [live, setLive] = useState<string>();
  const [secondRun, setSecondRun] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    describeDevice().then(setDevice);
    loadProgress().then((saved) => {
      setProgress(saved);
      const next = steps.findIndex((item) => !saved[item.id]);
      setIndex(next === -1 ? steps.length : next);
    });
  }, []);

  const step: Step | undefined = steps[index];
  const result = step ? progress[step.id] : undefined;

  const record = useCallback(
    (id: string, outcome: Result) => {
      const next = { ...progress, [id]: outcome };
      setProgress(next);
      saveProgress(next);
      console.log(
        `[device-check] ${id}: ${outcome.verdict}` +
          outcome.failures.map((failure) => `\n[device-check]   ${failure}`).join('')
      );
    },
    [progress]
  );

  const open = (target: number) => {
    setIndex(target);
    setRun(undefined);
    setLive(undefined);
    setSecondRun(false);
    setAsking(false);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };

  const start = async () => {
    const scenario = step && scenarios.find((item) => item.id === step.scenario);
    if (!step || !scenario) return;
    setBusy(true);
    setRun(undefined);
    setAsking(false);
    setLive(undefined);
    const finished = await runScenario(scenario, (changed, update) => {
      if (changed.id === scenario.id) {
        setRun(update);
        const note = update.notes[update.notes.length - 1];
        if (note && update.state === 'running') setLive(note);
      } else if (update.state === 'running') {
        setLive(`Running: ${changed.title}`);
      }
    });
    setBusy(false);
    setLive(undefined);
    setRun(finished);
    if (step.between && !secondRun && finished.state === 'skipped') {
      setSecondRun(true);
      return;
    }
    setSecondRun(false);
    if (questionOf(step) && finished.state === 'review') {
      setAsking(true);
      return;
    }
    record(step.id, {
      verdict: verdictOf(finished),
      failures: failuresOf(finished),
      at: Date.now(),
    });
  };

  const answer = (value: 'yes' | 'no') => {
    if (!step || !run) return;
    const failures = failuresOf(run);
    if (value === 'no') failures.push(`${questionOf(step)} No.`);
    setAsking(false);
    record(step.id, {
      verdict: value === 'yes' ? 'passed' : 'failed',
      failures,
      answer: value,
      at: Date.now(),
    });
  };

  const skip = () => {
    if (!step) return;
    record(step.id, { verdict: 'skipped', failures: [], at: Date.now() });
    open(index + 1);
  };

  const report = reportOf(steps, progress, device);
  const share = () => {
    console.log(report);
    Share.share({ message: report });
  };

  const startOver = () => {
    setProgress({});
    saveProgress({});
    open(0);
  };

  const done = result !== undefined && !busy && !asking && !secondRun;
  const lastStep = index === steps.length - 1;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" disabled={busy} onPress={onExit}>
          <Text style={[styles.back, { color: theme.secondary }, busy && styles.off]}>
            ‹ All scenarios
          </Text>
        </Pressable>
        <Text style={[styles.title, { color: theme.text }]}>Device check</Text>
        <Text style={[styles.device, { color: theme.secondary }]}>{device}</Text>
        <View style={styles.strip}>
          {steps.map((item, position) => {
            const verdict = progress[item.id]?.verdict;
            const current = position === index;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Step ${position + 1}: ${item.title}`}
                disabled={busy}
                onPress={() => open(position)}
                style={[
                  styles.dot,
                  { borderColor: current ? theme.text : theme.line },
                  verdict && {
                    backgroundColor: VERDICT_COLORS[verdict],
                    borderColor: current ? theme.text : VERDICT_COLORS[verdict],
                  },
                ]}
              >
                <Text style={[styles.dotText, { color: verdict ? '#FFFFFF' : theme.text }]}>
                  {position + 1}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => open(steps.length)}
            style={[
              styles.reportPill,
              { borderColor: index === steps.length ? theme.text : theme.line },
            ]}
          >
            <Text style={[styles.dotText, { color: theme.text }]}>Report</Text>
          </Pressable>
        </View>
      </View>

      {busy ? (
        <View style={styles.live}>
          <Text style={styles.liveLabel}>NOW</Text>
          <Text style={styles.liveText}>{live ?? 'Running…'}</Text>
        </View>
      ) : null}

      <ScrollView ref={scroll} contentContainerStyle={styles.content}>
        {step ? (
          <>
            <View style={styles.stepHead}>
              <Text style={[styles.counter, { color: theme.secondary }]}>
                Step {index + 1} of {steps.length}
                {step.optional ? ' · optional' : ''}
              </Text>
              <Text style={[styles.stepTitle, { color: theme.text }]}>{step.title}</Text>
              <Text style={[styles.why, { color: theme.secondary }]}>{step.why}</Text>
            </View>

            {secondRun ? (
              <Instructions
                title="Between the runs"
                lines={forPlatform(step.between)}
                theme={theme}
              />
            ) : (
              <Instructions
                title="Before you start"
                lines={forPlatform(step.before)}
                theme={theme}
              />
            )}

            <Pressable
              accessibilityRole="button"
              testID="device-check-start"
              disabled={busy}
              onPress={start}
              style={[styles.start, busy && styles.off]}
            >
              <Text style={styles.startText}>
                {busy
                  ? 'Running…'
                  : secondRun
                    ? 'Start run 2'
                    : run || result
                      ? 'Run again'
                      : 'Start'}
              </Text>
            </Pressable>

            {asking && questionOf(step) ? (
              <View style={[styles.box, { backgroundColor: theme.card }]}>
                <Text style={[styles.question, { color: theme.text }]}>{questionOf(step)}</Text>
                <View style={styles.answers}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => answer('yes')}
                    style={[styles.answer, { backgroundColor: STATE_COLORS.passed }]}
                  >
                    <Text style={styles.startText}>Yes</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => answer('no')}
                    style={[styles.answer, { backgroundColor: STATE_COLORS.failed }]}
                  >
                    <Text style={styles.startText}>No</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {done && result ? (
              <>
                <Text style={[styles.verdict, { color: VERDICT_COLORS[result.verdict] }]}>
                  {result.verdict === 'passed'
                    ? '✓ Passed'
                    : result.verdict === 'failed'
                      ? '✗ Failed'
                      : '– Skipped'}
                </Text>
                <Instructions title="Afterwards" lines={forPlatform(step.after)} theme={theme} />
              </>
            ) : null}

            <View style={styles.nav}>
              {!done && !busy ? (
                <Pressable accessibilityRole="button" onPress={skip}>
                  <Text style={[styles.link, { color: theme.secondary }]}>
                    {step.optional ? 'Skip this optional step' : 'Skip'}
                  </Text>
                </Pressable>
              ) : null}
              {done ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => open(index + 1)}
                  style={styles.next}
                >
                  <Text style={styles.startText}>
                    {lastStep ? 'See the report →' : 'Next step →'}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {run && run.state !== 'running' ? (
              <Text style={{ color: STATE_COLORS[run.state] }}>
                {STATE_LABELS[run.state]}
                {run.ms !== undefined ? ` · ${(run.ms / 1000).toFixed(1)} s` : ''}
              </Text>
            ) : null}
            {run?.notes.map((note, position) => (
              <Text key={position} style={[styles.note, { color: theme.text }]}>
                {note}
              </Text>
            ))}
            {run && run.rows.length > 0 ? (
              <View style={[styles.rows, { backgroundColor: theme.card }]}>
                {run.rows.map((row, position) => (
                  <Expectation key={position} row={row} theme={theme} />
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <>
            <Text style={[styles.stepTitle, { color: theme.text }]}>Report</Text>
            <Text style={[styles.why, { color: theme.secondary }]}>
              Tap Share, choose Copy, and paste the report into the chat.
            </Text>
            <View style={[styles.box, { backgroundColor: theme.card }]}>
              <Text selectable style={[styles.report, { color: theme.text }]}>
                {report}
              </Text>
            </View>
            <Pressable accessibilityRole="button" onPress={share} style={styles.start}>
              <Text style={styles.startText}>Share the report</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={startOver}>
              <Text style={[styles.link, { color: theme.secondary }]}>Start over</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 4 },
  back: { fontSize: 14 },
  off: { opacity: 0.4 },
  title: { fontSize: 22, fontWeight: '700' },
  device: { fontSize: 13 },
  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  dot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotText: { fontSize: 12, fontWeight: '600' },
  reportPill: {
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  live: {
    backgroundColor: STATE_COLORS.running,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 2,
  },
  liveLabel: { color: '#FFFFFF', fontSize: 11, fontWeight: '700', opacity: 0.8 },
  liveText: { color: '#FFFFFF', fontSize: 19, fontWeight: '600' },
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  stepHead: { gap: 4 },
  counter: { fontSize: 13, fontWeight: '600' },
  stepTitle: { fontSize: 24, fontWeight: '700' },
  why: { fontSize: 15, lineHeight: 21 },
  box: { borderRadius: 12, padding: 14, gap: 10 },
  boxTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  instruction: { flexDirection: 'row', gap: 8 },
  instructionNumber: { fontSize: 16, fontWeight: '600', width: 18 },
  instructionText: { flex: 1, fontSize: 16, lineHeight: 23 },
  start: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: '#457B9D',
  },
  startText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  question: { fontSize: 16, fontWeight: '600', lineHeight: 22 },
  answers: { flexDirection: 'row', gap: 12 },
  answer: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  verdict: { fontSize: 20, fontWeight: '700' },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  link: { fontSize: 15, textDecorationLine: 'underline' },
  next: {
    marginLeft: 'auto',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
    backgroundColor: STATE_COLORS.passed,
  },
  note: { fontSize: 13 },
  rows: { borderRadius: 12, paddingHorizontal: 8 },
  report: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 12,
    lineHeight: 18,
  },
});
