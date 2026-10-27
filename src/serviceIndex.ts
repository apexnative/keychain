// The list of the services whose credentials the compatibility layer (src/compat) and `migrate` wrote. A generic
// password of react-native-keychain is the credentials of a store of its own service, and the package
// can't list the stores there are: `getAllGenericPasswordServices` reads this list instead. It is an item of a store
// of its own, so that the default store lists nothing the app didn't write.
import type { Api } from './api';

/** The service of the store that keeps the list. */
export const SERVICE_INDEX_SERVICE = 'apexnative.keychain.compat';
const SERVICE_INDEX_KEY = 'generic-services';

export type ServiceIndex = {
  /** The services listed, sorted. */
  list(): Promise<string[]>;
  add(service: string): Promise<void>;
  remove(service: string): Promise<void>;
};

function parse(text: string | null): string[] {
  if (text === null) return [];
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

/** The list over the API: changes go one after another, so that two at once don't lose one of them. */
export function createServiceIndex(api: Pick<Api, 'createKeychain'>): ServiceIndex {
  const store = api.createKeychain({ service: SERVICE_INDEX_SERVICE });
  let queue: Promise<unknown> = Promise.resolve();

  const change = (update: (services: Set<string>) => void): Promise<void> => {
    const result = queue.then(async () => {
      const services = new Set(parse(await store.getItem(SERVICE_INDEX_KEY)));
      const before = [...services].sort().join('\0');
      update(services);
      const after = [...services].sort();
      if (after.join('\0') === before) return;
      if (after.length === 0) await store.removeItem(SERVICE_INDEX_KEY);
      else await store.setItem(SERVICE_INDEX_KEY, JSON.stringify(after));
    });
    queue = result.catch(() => undefined);
    return result;
  };

  return {
    list: async () => {
      await queue;
      return parse(await store.getItem(SERVICE_INDEX_KEY)).sort();
    },
    add: (service) => change((services) => void services.add(service)),
    remove: (service) => change((services) => void services.delete(service)),
  };
}
