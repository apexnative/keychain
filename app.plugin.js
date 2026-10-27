// The entry point `expo prebuild` finds for the config plugin of this package (docs: Expo "config plugins").
// The plugin is written in TypeScript in plugin/src and compiled to plugin/build by `yarn prepare`.
module.exports = require('./plugin/build').default;
