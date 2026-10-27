import { Platform } from 'react-native';
import {
  AccessControl,
  Accessible,
  HardwareSecurityLevel,
  KeychainErrorCode,
} from '@apexnative/keychain';
import type { Scenario } from '../harness/types';
import { codeOf } from '../harness/values';

const ACCESSIBLE = [
  Accessible.AfterFirstUnlock,
  Accessible.AfterFirstUnlockThisDeviceOnly,
  Accessible.WhenUnlocked,
  Accessible.WhenUnlockedThisDeviceOnly,
];

export const info: Scenario = {
  id: 'info',
  milestone: 'M1',
  title: 'Label and getItemInfo',
  description:
    'getItemInfo says what an item is without reading it: key, label, protection, dates. The label can be set, replaced and removed.',
  async run(t) {
    const store = await t.store('info');

    const before = Date.now();
    await store.setItem('account', 'secret value', { label: 'Work account' });
    const after = Date.now();
    const item = await store.getItemInfo('account');

    t.equal('key', 'account', item?.key);
    t.equal('label', 'Work account', item?.label);
    t.equal('accessible, by default', Accessible.AfterFirstUnlock, item?.accessible);
    t.equal('accessControl, by default', AccessControl.None, item?.accessControl);
    t.equal('synchronizable', false, item?.synchronizable);
    t.within('createdAt is now', before - 5000, after + 5000, item?.createdAt ?? NaN);
    t.within(
      'modifiedAt is createdAt or later',
      item?.createdAt ?? NaN,
      after + 5000,
      item?.modifiedAt ?? NaN
    );
    if (Platform.OS === 'android') {
      t.oneOf(
        'android.securityLevel',
        [
          HardwareSecurityLevel.Tee,
          HardwareSecurityLevel.Strongbox,
          HardwareSecurityLevel.Software,
        ],
        item?.android?.securityLevel
      );
    } else {
      t.equal('android, absent on iOS', undefined, item?.android);
    }
    await t.expect('the value is not part of the info', 'secret value', () =>
      store.getItem('account')
    );
    await t.expect('a missing item has no info', null, () => store.getItemInfo('missing'));

    await t.expect('a Unicode label', 'Рабочий аккаунт 🔑', async () => {
      await store.setItem('account', 'v', { label: 'Рабочий аккаунт 🔑' });
      return (await store.getItemInfo('account'))?.label;
    });
    await t.expect('the label is replaced', 'Personal', async () => {
      await store.setItem('account', 'v', { label: 'Personal' });
      return (await store.getItemInfo('account'))?.label;
    });
    await t.expect('the empty label is a label', '', async () => {
      await store.setItem('account', 'v', { label: '' });
      return (await store.getItemInfo('account'))?.label;
    });
    await t.expect('the label is removed by a write without one', undefined, async () => {
      await store.setItem('account', 'v');
      return (await store.getItemInfo('account'))?.label;
    });
    await t.expect('a label on bytes', 'Key', async () => {
      await store.setBytes('blob', Uint8Array.from([1, 2, 3]), { label: 'Key' });
      return (await store.getItemInfo('blob'))?.label;
    });
    await t.expect('info of a Unicode key', 'ключ 🔑', async () => {
      await store.setItem('ключ 🔑', 'v');
      return (await store.getItemInfo('ключ 🔑'))?.key;
    });

    for (const accessible of ACCESSIBLE) {
      await t.expect(`accessible '${accessible}'`, accessible, async () => {
        await store.setItem('protected', 'v', { accessible });
        return (await store.getItemInfo('protected'))?.accessible;
      });
    }
    const passcode = Accessible.WhenPasscodeSetThisDeviceOnly;
    try {
      await store.setItem('protected', 'v', { accessible: passcode });
      t.equal(
        `accessible '${passcode}'`,
        passcode,
        (await store.getItemInfo('protected'))?.accessible
      );
    } catch (error) {
      if (codeOf(error) === KeychainErrorCode.PasscodeNotSet) {
        t.skip(`accessible '${passcode}'`, 'the device has no passcode');
      } else {
        t.equal(`accessible '${passcode}'`, passcode, `throws ${codeOf(error)}`);
      }
    }
  },
};
