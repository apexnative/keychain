import { AccessControl } from '@apexnative/keychain';
import type { Scenario } from '../harness/types';

export const prompt: Scenario = {
  id: 'm2-prompt',
  milestone: 'M2',
  manual: true,
  title: 'Prompt and protected read',
  description:
    'A protected item is written without a prompt and read with one. The prompt shows the texts given in the store, and the texts of the call replace them.',
  async run(t) {
    const store = await t.store('m2-prompt', {
      accessControl: AccessControl.BiometryAny,
      prompt: {
        title: 'Example: unlock the item',
        subtitle: 'Subtitle (Android)',
        description: 'Description (Android)',
        cancel: 'Not now',
      },
    });
    await t.expect('a write shows no prompt', true, async () => {
      await store.setItem('secret', 'behind the lock', { label: 'Locked' });
      return store.hasItem('secret');
    });
    t.note('A prompt appears now: authenticate. Its title is "Example: unlock the item".');
    await t.expect('a read after authenticating', 'behind the lock', () => store.getItem('secret'));
    t.note('The prompt appears again: its title is "Second read", the cancel button "Not now".');
    await t.expect('a read with the texts of the call', 'behind the lock', () =>
      store.getItem('secret', { prompt: { title: 'Second read' } })
    );
    await t.expect('getBytes asks too', Uint8Array.from([1, 2, 3]), async () => {
      await store.setBytes('bytes', Uint8Array.from([1, 2, 3]));
      t.note('A third prompt: authenticate.');
      return store.getBytes('bytes');
    });
    t.info('prompt texts', 'title, cancel button and (Android) subtitle as given', 'what you saw');
  },
};
