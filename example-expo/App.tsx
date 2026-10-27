import { isKeychainError, keychain } from '@apexnative/keychain';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

const KEY = 'expo.example.secret';

/** An error as one line: its code and what it says. In Expo Go that is UNSUPPORTED and what to do about it. */
const describe = (error: unknown) =>
  isKeychainError(error) ? `${error.code}: ${error.message}` : String(error);

export default function App() {
  const colors = COLORS;
  const [service, setService] = useState('…');
  const [value, setValue] = useState('a secret that is kept in the Keychain');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    try {
      setService(keychain.service);
    } catch (error) {
      setService(describe(error));
    }
  }, []);

  const run = async () => {
    try {
      await keychain.setItem(KEY, value);
      const read = await keychain.getItem(KEY);
      setResult({
        ok: read === value,
        text: read === value ? `Read back: "${read}"` : `Read "${read}" instead of "${value}"`,
      });
    } catch (error) {
      setResult({ ok: false, text: describe(error) });
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>@apexnative/keychain</Text>
      <Text style={[styles.note, { color: colors.secondary }]}>
        An Expo app with the config plugin. Expo Go has no native module for it: use a development
        build (npx expo run:ios, npx expo run:android).
      </Text>
      <Text style={[styles.note, { color: colors.secondary }]} testID="service">
        service: {service}
      </Text>
      <TextInput
        testID="value"
        style={[styles.input, { color: colors.text, borderColor: colors.secondary }]}
        value={value}
        onChangeText={setValue}
        autoCapitalize="none"
      />
      <Pressable testID="run" accessibilityRole="button" style={styles.button} onPress={run}>
        <Text style={styles.buttonText}>setItem, then getItem</Text>
      </Pressable>
      {result ? (
        <Text
          testID="result"
          style={{ color: result.ok ? '#2E8B57' : '#C0392B', fontSize: 15 }}
          selectable
        >
          {result.text}
        </Text>
      ) : null}
      <StatusBar style="auto" />
    </View>
  );
}

const COLORS = { background: '#F3F5F8', text: '#1E2A44', secondary: '#5B6B82' };

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, paddingTop: 80, gap: 14 },
  title: { fontSize: 22, fontWeight: '600' },
  note: { fontSize: 13 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 15 },
  button: { backgroundColor: '#457B9D', borderRadius: 8, padding: 12, alignItems: 'center' },
  buttonText: { color: '#FFFFFF', fontWeight: '600' },
});
