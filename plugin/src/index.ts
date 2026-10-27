import { createRunOncePlugin } from 'expo/config-plugins';
import { withApexKeychain } from './withApexKeychain';

// The package's own name and version, which `expo prebuild` uses to run the plugin once however many times it is listed.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('../../package.json') as { name: string; version: string };

export type { ApexKeychainPluginProps } from './withApexKeychain';
export { DEFAULT_FACE_ID_PERMISSION } from './withApexKeychain';

export default createRunOncePlugin(withApexKeychain, pkg.name, pkg.version);
