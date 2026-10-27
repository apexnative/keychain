import { AccessControl } from '@apexnative/keychain';
import type { Scenario } from '../harness/types';

export const parallelReads: Scenario = {
  id: 'm2-parallel-reads',
  milestone: 'M2',
  manual: true,
  title: 'Reads while a prompt is open',
  description:
    'Three protected reads started at once: the prompts queue up, one at a time, and each read gets its own value.',
  async run(t) {
    const store = await t.store('m2-parallel-reads', { accessControl: AccessControl.BiometryAny });
    const names = ['one', 'two', 'three'];
    for (const name of names) await store.setItem(name, `value ${name}`);
    t.note('Prompts appear one after another: authenticate each (iOS may show one for all).');
    await t.expect(
      'three reads at once',
      names.map((name) => `value ${name}`),
      () => Promise.all(names.map((name) => store.getItem(name)))
    );
    await t.expect('unprotected reads are not queued behind a prompt', 'plain', async () => {
      await store.setItem('plain', 'plain', { accessControl: AccessControl.None });
      return store.getItem('plain');
    });
  },
};
