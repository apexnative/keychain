/**
 * The scenarios of the example app: one feature each, run on a device, with the answer next to the one expected. They
 * are how the iOS and Android implementations are checked on the real thing; the Jest suite of src/__tests__/scenarios
 * runs the M1 ones against the in-memory module, so the scenarios and the mock cannot drift apart.
 *
 * M1 is the storage, M2 the authentication, M4 the compatibility layer with react-native-keychain. A scenario that is
 * only written, not yet run on a device, is `pending`: it is listed as a draft, and removing the flag enables it.
 * More are to come (reads in the background, clearOnReinstall, backup and restore on Android).
 */
import { authRequired } from './m1/authRequired';
import { bytes } from './m1/bytes';
import { clear } from './m1/clear';
import { credentials } from './m1/credentials';
import { errors } from './m1/errors';
import { hasRemove } from './m1/hasRemove';
import { keys } from './m1/keys';
import { nativeValidation } from './m1/nativeValidation';
import { overwrite } from './m1/overwrite';
import { parallel } from './m1/parallel';
import { createRunAll } from './m1/runAll';
import { services } from './m1/services';
import { strings } from './m1/strings';
import { sync } from './m1/sync';
import type { Scenario } from './harness/types';
import { authValidity } from './m2/authValidity';
import { availability } from './m2/availability';
import { cancel } from './m2/cancel';
import { device } from './m2/device';
import { noFallback } from './m2/noFallback';
import { invalidation } from './m2/invalidation';
import { lockout } from './m2/lockout';
import { parallelReads } from './m2/parallelReads';
import { prompt } from './m2/prompt';
import { strongbox } from './m2/strongbox';
import { compat } from './m4/compat';
import { compatAuth } from './m4/compatAuth';
import { migrateEmpty, migrateLegacy, migrateProtected } from './m4/migrate';

export type { Scenario } from './harness/types';

/** Every scenario, in the order the app lists them: "run all" first, then M1, M2 and M4. */
export const scenarios: Scenario[] = [
  createRunAll(() => scenarios),
  strings,
  bytes,
  overwrite,
  hasRemove,
  keys,
  clear,
  services,
  parallel,
  sync,
  credentials,
  errors,
  authRequired,
  nativeValidation,
  device,
  availability,
  prompt,
  cancel,
  noFallback,
  authValidity,
  invalidation,
  parallelReads,
  lockout,
  strongbox,
  compat,
  compatAuth,
  migrateEmpty,
  migrateLegacy,
  migrateProtected,
];
