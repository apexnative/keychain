// The in-memory module called as the native side is, past the checks of the wrapper: what it does with a value it
// doesn't know. The contract (src/native/NativeApexKeychain.ts) says it rejects with INVALID_ARGUMENT and guesses
// nothing; the example's "native-validation" scenario checks the real modules for the same.
import { MemoryKeychain } from '../jest/MemoryKeychain';
import type * as Native from '../native/NativeApexKeychain';

const store: Native.Store = { service: 'raw' };
const options: Native.WriteOptions = {
  accessible: 'afterFirstUnlock',
  accessControl: 'none',
  authValidity: 0,
  synchronizable: false,
  keyStorage: 'tee',
};
const prompt: Native.Prompt = { confirmationRequired: true };

describe('the raw module', () => {
  it.each([
    ['accessible', { accessible: 'always' }],
    ['accessControl', { accessControl: 'faceID' }],
    ['keyStorage', { keyStorage: 'hsm' }],
  ])('rejects an unknown %s and stores nothing', async (_, bad) => {
    const memory = new MemoryKeychain();
    const write = { ...options, ...bad } as unknown as Native.WriteOptions;
    await expect(memory.setItem(store, 'k', 'v', 'utf8', write)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    expect(memory.setItemSync(store, 'k', 'v', write).error?.code).toBe('INVALID_ARGUMENT');
    await expect(memory.getAllKeys(store)).resolves.toEqual([]);
  });

  it('rejects an unknown encoding, on a write and on a read', async () => {
    const memory = new MemoryKeychain();
    await expect(
      memory.setItem(store, 'k', 'v', 'hex' as Native.Encoding, options)
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      memory.getItem(store, 'missing', 'hex' as Native.Encoding, prompt)
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects Base64 that is not Base64', async () => {
    const memory = new MemoryKeychain();
    await expect(memory.setItem(store, 'k', '***', 'base64', options)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(memory.hasItem(store, 'k')).resolves.toBe(false);
  });
});
