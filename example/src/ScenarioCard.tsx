import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Row, Run, Scenario } from './harness/types';
import { ROW_MARKS, STATE_COLORS, STATE_LABELS, type Theme } from './theme';

/** One check of a run: its name, what was expected and what came, and the detail of a failure. */
export function Expectation({ row, theme }: { row: Row; theme: Theme }) {
  return (
    <View
      style={[
        styles.row,
        { borderTopColor: theme.line },
        row.status === 'fail' && { backgroundColor: theme.failTint },
      ]}
    >
      <Text style={[styles.rowName, { color: theme.text }]}>
        <Text style={{ color: ROW_MARKS[row.status].color }}>{ROW_MARKS[row.status].mark} </Text>
        {row.name}
      </Text>
      <View style={styles.pair}>
        <View style={styles.side}>
          <Text style={[styles.sideLabel, { color: theme.secondary }]}>expected</Text>
          <Text style={[styles.value, { color: theme.text }]} selectable>
            {row.expected}
          </Text>
        </View>
        <View style={styles.side}>
          <Text style={[styles.sideLabel, { color: theme.secondary }]}>got</Text>
          <Text
            style={[
              styles.value,
              { color: row.status === 'fail' ? STATE_COLORS.failed : theme.text },
            ]}
            selectable
          >
            {row.got}
          </Text>
        </View>
      </View>
      {row.detail ? (
        <Text style={[styles.detail, { color: theme.secondary }]} selectable>
          {row.detail}
        </Text>
      ) : null}
    </View>
  );
}

type Props = {
  scenario: Scenario;
  run: Run | undefined;
  busy: boolean;
  theme: Theme;
  onRun: () => void;
};

/** A scenario: what it checks, a button to run it, and under it the table of what it saw. */
export function ScenarioCard({ scenario, run, busy, theme, onRun }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const running = run?.state === 'running';
  const runnable = !scenario.pending;
  return (
    <View style={[styles.card, { backgroundColor: theme.card }]} testID={`card-${scenario.id}`}>
      <View style={styles.head}>
        <Text style={[styles.badge, scenario.milestone === 'M2' && styles.badgeLater]}>
          {scenario.milestone}
          {scenario.manual ? ' · you' : ''}
          {scenario.realDevice ? ' · device' : ''}
        </Text>
        <Text style={[styles.title, { color: theme.text }]}>{scenario.title}</Text>
        {run ? (
          <Text testID={`outcome-${scenario.id}`} style={{ color: STATE_COLORS[run.state] }}>
            {STATE_LABELS[run.state]}
          </Text>
        ) : null}
      </View>
      <Text style={{ color: theme.secondary }}>{scenario.description}</Text>
      {runnable ? (
        <View style={styles.actions}>
          <Pressable
            testID={`scenario-${scenario.id}`}
            accessibilityRole="button"
            disabled={busy}
            onPress={onRun}
            style={[styles.button, busy && styles.buttonOff]}
          >
            <Text style={styles.buttonText}>
              {running ? 'Running…' : run ? 'Run again' : 'Run'}
            </Text>
          </Pressable>
          {run && run.rows.length > 0 ? (
            <Pressable accessibilityRole="button" onPress={() => setCollapsed(!collapsed)}>
              <Text style={{ color: theme.secondary }}>
                {collapsed ? `Show ${run.rows.length} checks` : 'Hide checks'}
              </Text>
            </Pressable>
          ) : null}
          {run?.ms !== undefined ? (
            <Text style={{ color: theme.secondary }}>{(run.ms / 1000).toFixed(1)} s</Text>
          ) : null}
        </View>
      ) : (
        <Text style={[styles.draft, { color: theme.secondary }]}>
          Draft: written against the contract, not run on a device yet. Remove `pending` in its file
          to enable it.
        </Text>
      )}
      {run?.notes.map((note, index) => (
        <Text key={index} style={[styles.note, { color: theme.text }]}>
          {note}
        </Text>
      ))}
      {run && !collapsed ? (
        <View>
          {run.rows.map((row, index) => (
            <Expectation key={index} row={row} theme={theme} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: 12, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: {
    overflow: 'hidden',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
    backgroundColor: '#2E8B57',
  },
  badgeLater: { backgroundColor: '#8A8F98' },
  title: { flex: 1, fontSize: 16, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  button: {
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#457B9D',
  },
  buttonOff: { opacity: 0.4 },
  buttonText: { color: '#FFFFFF', fontWeight: '600' },
  draft: { fontStyle: 'italic' },
  note: { fontSize: 13 },
  row: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
    paddingHorizontal: 4,
    gap: 2,
  },
  rowName: { fontSize: 13, fontWeight: '500' },
  pair: { flexDirection: 'row', gap: 8 },
  side: { flex: 1, gap: 1 },
  sideLabel: { fontSize: 10, textTransform: 'uppercase' },
  value: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 11 },
  detail: { fontSize: 11 },
});
