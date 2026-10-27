// The key of the credentials of `setCredentials`: `credentials`, or `credentials:<server>`. One place for the core and
// for the compatibility layer (src/compat), which reads and lists them by key.
import { invalidArgument } from './errors';
import { checkName } from './options';

/** The key of the app's own credentials; the key of a server's is this, `:` and the server. */
export const CREDENTIALS_KEY = 'credentials';

/** The key of the credentials of a server, or of the app's own when there is no server. */
export function credentialsKey(server: unknown): string {
  if (server === undefined) return CREDENTIALS_KEY;
  if (typeof server !== 'string' || server === '') {
    throw invalidArgument(`Invalid server: expected a non-empty string, got ${String(server)}.`);
  }
  return checkName(`${CREDENTIALS_KEY}:${server}`, 'credentials key');
}

/** The server a key of credentials belongs to: `undefined` for the app's own, `null` when the key isn't of credentials. */
export function serverOfCredentialsKey(key: string): string | undefined | null {
  if (key === CREDENTIALS_KEY) return undefined;
  return key.startsWith(`${CREDENTIALS_KEY}:`) ? key.slice(CREDENTIALS_KEY.length + 1) : null;
}
