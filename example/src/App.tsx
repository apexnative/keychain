import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { keychain } from '@apexnative/keychain';
import { runScenario } from './harness/runner';
import type { Run, Scenario } from './harness/types';
import { DeviceCheck } from './deviceCheck/DeviceCheck';
import { describeError } from './harness/values';
import { ScenarioCard } from './ScenarioCard';
import { scenarios } from './scenarios';
import { DARK, LIGHT } from './theme';

// An item no scenario writes: the module check only asks whether it is there.
const PROBE_KEY = 'apexnative.example.probe';

/**
 * Whether the native module answers, one line per path: its default service (a synchronous value), an asynchronous
 * call and a synchronous one, each with its answer or its error code.
 */
async function moduleStatus(): Promise<string[]> {
  const line = async (name: string, call: () => unknown) => {
    try {
      return `${name}: ${String(await call())}`;
    } catch (error) {
      return `${name}: ${describeError(error)}`;
    }
  };
  return [
    await line('service', () => keychain.service),
    await line('hasItem', () => keychain.hasItem(PROBE_KEY)),
    await line('hasItemSync', () => keychain.hasItemSync(PROBE_KEY)),
  ];
}

const SECTIONS: Array<{ milestone: Scenario['milestone']; title: string }> = [
  { milestone: 'M2', title: 'M2: authentication' },
  { milestone: 'M4', title: 'M4: compatibility with react-native-keychain' },
];

/** A finished run as plain lines, for the log of the device: `[scenario] <id>: <outcome>`, then each failed row. */
function report(scenario: Scenario, run: Run): string {
  const lines = [`[scenario] ${scenario.id}: ${run.state} (${run.rows.length} rows)`];
  for (const row of run.rows.filter((item) => item.status === 'info')) {
    lines.push(`[scenario]   • ${row.name} | ${row.got}`);
  }
  for (const row of run.rows.filter((item) => item.status === 'fail')) {
    lines.push(`[scenario]   ✗ ${row.name} | expected ${row.expected} | got ${row.got}`);
    if (row.detail) lines.push(`[scenario]     ${row.detail}`);
  }
  for (const note of run.notes) lines.push(`[scenario]   note: ${note}`);
  return lines.join('\n');
}

export function App() {
  const dark = useColorScheme() === 'dark';
  const theme = dark ? DARK : LIGHT;
  const [status, setStatus] = useState<string[]>([]);
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const offsets = useRef<Record<string, number>>({});

  useEffect(() => {
    moduleStatus().then(setStatus);
  }, []);

  const run = useCallback(async (scenario: Scenario) => {
    setBusy(true);
    try {
      await runScenario(scenario, (changed, progress) => {
        setRuns((current) => ({ ...current, [changed.id]: progress }));
        if (progress.state !== 'running') console.log(report(changed, progress));
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const card = (scenario: Scenario) => (
    <ScenarioCard
      key={scenario.id}
      scenario={scenario}
      run={runs[scenario.id]}
      busy={busy}
      theme={theme}
      onRun={() => run(scenario)}
    />
  );
  const sections = SECTIONS.map((section) => ({
    ...section,
    cards: scenarios.filter((scenario) => scenario.milestone === section.milestone),
  })).filter((section) => section.cards.length > 0);
  return (
    <SafeAreaProvider>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
        {checking ? (
          <DeviceCheck theme={theme} onExit={() => setChecking(false)} />
        ) : (
          <ScrollView ref={scroll} contentContainerStyle={styles.content}>
            <Text style={[styles.title, { color: theme.text }]}>@apexnative/keychain</Text>
            <Pressable
              testID="open-device-check"
              accessibilityRole="button"
              disabled={busy}
              onPress={() => setChecking(true)}
              style={[styles.deviceCheck, busy && styles.off]}
            >
              <Text style={styles.deviceCheckTitle}>Device check →</Text>
              <Text style={styles.deviceCheckText}>
                Step by step through what a real phone has to prove: prompts, cancel, lockout.
              </Text>
            </Pressable>
            <View testID="module-status">
              {status.map((line) => (
                <Text key={line} style={[styles.status, { color: theme.secondary }]}>
                  {line}
                </Text>
              ))}
            </View>
            <View style={styles.jumps}>
              {sections.map((section) => (
                <Pressable
                  key={section.milestone}
                  testID={`jump-to-${section.milestone.toLowerCase()}`}
                  accessibilityRole="button"
                  onPress={() =>
                    scroll.current?.scrollTo({
                      y: offsets.current[section.milestone] ?? 0,
                      animated: false,
                    })
                  }
                >
                  <Text style={[styles.jump, { color: theme.secondary }]}>
                    Jump to {section.milestone} ↓
                  </Text>
                </Pressable>
              ))}
            </View>
            {scenarios.filter((scenario) => scenario.milestone === 'M1').map(card)}
            {sections.map((section) => {
              const drafts = section.cards.filter((scenario) => scenario.pending).length;
              return (
                <Fragment key={section.milestone}>
                  <Text
                    style={[styles.section, { color: theme.text }]}
                    onLayout={(event) => {
                      offsets.current[section.milestone] = event.nativeEvent.layout.y;
                    }}
                  >
                    {section.title}
                    {drafts > 0 ? ` (${drafts} drafts)` : ''}
                  </Text>
                  {section.cards.map(card)}
                </Fragment>
              );
            })}
          </ScrollView>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '600' },
  status: { fontSize: 13 },
  section: { marginTop: 12, fontSize: 18, fontWeight: '600' },
  jumps: { flexDirection: 'row', gap: 16 },
  jump: { fontSize: 13, textDecorationLine: 'underline' },
  deviceCheck: { borderRadius: 12, padding: 14, gap: 4, backgroundColor: '#457B9D' },
  deviceCheckTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  deviceCheckText: { color: '#FFFFFF', fontSize: 13, opacity: 0.9 },
  off: { opacity: 0.4 },
});
