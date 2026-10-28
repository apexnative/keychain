import { KeychainErrorCode } from '@apexnative/keychain';
import type { Scenario } from '../harness/types';

export const credentials: Scenario = {
  id: 'credentials',
  milestone: 'M1',
  title: 'Credentials',
  description:
    'A user name and a password are one item: the key is credentials (or credentials:<server>), the password the value, the user name kept with it.',
  async run(t) {
    const store = await t.store('credentials');

    await t.expect('missing credentials read null', null, () => store.getCredentials());
    await t.expect('removeCredentials of nothing is no error', undefined, () =>
      store.removeCredentials()
    );

    await t.expect('setCredentials resolves with nothing', undefined, () =>
      store.setCredentials({ username: 'ivan@example.com', password: 's3cret' })
    );
    await t.expect(
      'credentials, read back',
      { username: 'ivan@example.com', password: 's3cret' },
      () => store.getCredentials()
    );
    await t.expect('the key is credentials', true, () => store.hasItem('credentials'));
    await t.expect('the password is the value', 's3cret', () => store.getItem('credentials'));

    await t.expect('overwritten credentials', { username: 'petr', password: 'new' }, async () => {
      await store.setCredentials({ username: 'petr', password: 'new' });
      return store.getCredentials();
    });

    const server = 'api.example.com';
    await store.setCredentials({ username: 'anna', password: 'pw' }, { server });
    await t.expect('credentials of a server', { username: 'anna', password: 'pw' }, () =>
      store.getCredentials({ server })
    );
    await t.expect('the key of a server', [true, true], () =>
      Promise.all([store.hasItem('credentials'), store.hasItem(`credentials:${server}`)])
    );
    await t.expect(
      "the app credentials are not the server's",
      { username: 'petr', password: 'new' },
      () => store.getCredentials()
    );
    await t.expect('another server has none', null, () =>
      store.getCredentials({ server: 'other.example.com' })
    );

    await t.expect(
      'Unicode and an empty password',
      { username: 'иван 🔑', password: '' },
      async () => {
        await store.setCredentials({ username: 'иван 🔑', password: '' }, { server: 'юникод' });
        return store.getCredentials({ server: 'юникод' });
      }
    );

    await store.removeCredentials({ server });
    await t.expect('removed credentials of a server', null, () => store.getCredentials({ server }));
    await t.expect(
      'the app credentials stay',
      'petr',
      async () => (await store.getCredentials())?.username
    );
    await t.expect('removeCredentials resolves with nothing', undefined, () =>
      store.removeCredentials()
    );
    await t.expect('removed credentials', null, () => store.getCredentials());
    await t.expect('and their item', false, () => store.hasItem('credentials'));

    await store.setItem('credentials', 'a password with no user name');
    await t.fails(
      'an item that setCredentials did not write is no credentials',
      KeychainErrorCode.InvalidArgument,
      () => store.getCredentials()
    );
  },
};
