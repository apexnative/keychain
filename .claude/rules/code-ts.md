---
paths:
  - 'src/**/*.{ts,tsx}'
  - 'plugin/src/**/*.ts'
  - 'example/src/**/*.{ts,tsx}'
  - 'example-expo/**/*.{ts,tsx}'
  - 'scripts/**/*.mjs'
  - 'docs/src/**/*.{ts,tsx}'
---

# TypeScript and JavaScript

Prettier (100 columns, single quotes, semicolons, es5 trailing commas) runs after every edit; ESLint runs in
`scripts/lint.sh` and the pre-commit hook. `tsconfig` is strict, with no unused locals or parameters.

## Names

- Files: PascalCase when the main export is a class or a component (`MemoryKeychain.ts`, `ScenarioCard.tsx`),
  camelCase otherwise (`createCompat.ts`, `serviceIndex.ts`).
- Functions: `create*` make an API over its dependencies (`createKeychain`, `createApi`, `createMigrate`); `check*`
  validate one argument and throw `INVALID_ARGUMENT`; `parse*` validate options and return them resolved; `resolve*`
  merge the store's options with the call's; `is*` type guards; `to*` converters (`toKeychainError`).
- Types: no `I` prefix. A set of values is a constant object with a type of the same name (`AccessControl`,
  `Accessible`, `KeychainErrorCode`): the constant and the plain string are both accepted. No enums.
- Constants: `UPPER_SNAKE` for fixed values, camelCase for module state. Private means not exported, no `_`.

## Modules

- Named exports. A default export only where a tool or a shape needs one: the codegen spec, the config plugin
  (`plugin/src/index.ts`), `/compat` (react-native-keychain's default import).
- The public API lists its exports one by one in `src/index.ts`, types in `export type { … }`. The other entry points
  (`/compat`, `/migrate`, `/jest`) have their own `index.ts` and their line in `exports` of `package.json`; `/jest`
  offers each of them over the same memory.
- `src/api.ts` is the whole API over a native module: `src/index.ts` binds it to the TurboModule, `src/jest/` to the
  module in memory. Behavior goes there, not into one of the bindings.
- `import type` for what is used only as a type. Packages first, then relative imports.

## Types

- `type` for object shapes and unions; `interface` for an object with methods (`Keychain`, `Checks`).
- `unknown`, not `any`. Public functions take `unknown` where JavaScript callers may pass anything, and check it.
- Exported functions declare their return type. `!` and `as` rarely; narrow instead. `as const` and `satisfies` are
  fine.

## Comments

- Every export has JSDoc that starts with a noun phrase ("The default store: …"); a boolean starts with "Whether". No
  `@param` / `@returns`: the prose names the parameters. Platform notes in the prose: "(iOS)", "(Android 11+)".
- A file that is an entry point or a seam starts with a `//` paragraph: what it is and how it is used.
- `//` comments on a line of their own, in full sentences, saying why rather than what. No "we", no TODO.

## Errors

- Every failure is a `KeychainError` with its code (`src/errors.ts`); `invalidArgument(message)` for a bad argument.
  A native rejection goes through `toKeychainError`, which keeps `nativeCode` and `nativeDomain`.
- An asynchronous call rejects; it doesn't throw synchronously. A synchronous call (`*Sync`) throws.
- Messages are English sentences. A warning: `console.warn('[ApexKeychain] …')`, in development only (`__DEV__`), once.
  An error that is ignored: `catch {` without a binding.

## The example app

- A scenario is one file in `example/src/m<milestone>/`, `export const <name>: Scenario` with an `id` of the shape
  `m2-prompt`, listed in `example/src/scenarios.ts`. It checks through `t` (`Checks` in `example/src/harness/types.ts`):
  `t.expect`, `t.fails`, `t.equal` record a row each, `t.note` tells the person what to do, `t.store(name)` gives a
  store of its own that is cleared after.
- `manual: true` when a person must authenticate, cancel or change the biometry; `realDevice: true` when a simulator or
  an emulator can't pass it; `pending: true` until it has run on a device.

## Scripts

- `scripts/*.mjs`: a shebang, a header comment with the purpose and `Usage:`, ESM. `scripts/*.sh` run through
  `scripts/lib/quiet.sh` and print one line.

## Models

New code looks like these files; read the closest one before writing.

- A function of the public API: `getBiometryState` in `src/index.ts`, over `src/api.ts`.
- Option checks: `src/options.ts`. A constant with its type: `AccessControl` in `src/constants.ts`.
- An entry point: `src/migrate/index.ts` over `src/migrate/createMigrate.ts`.
- A scenario: `example/src/m2/prompt.ts`.
- A Jest test of the API: `src/__tests__/api.test.ts`.
