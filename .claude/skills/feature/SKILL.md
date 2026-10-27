---
name: feature
description: A new feature from discussion to report — facts, options, decision, code review, implementation on iOS, Android and JS, tests, device check, review, docs.
disable-model-invocation: true
argument-hint: <what the feature should do> [flags]
---

# A new feature

Follow `.claude/skills/task-flow/SKILL.md` with all its stages and all three stops.

1. **Facts:** what the Keychain, LocalAuthentication, the Keystore and BiometricPrompt offer for this, what the library
   already has, what it means for the security of an item. Separate questions go to `researcher` agents in parallel.
2. **Options:** the API with a short usage example, the behavior and the errors on each platform, а/б with a
   recommendation, what changes on each layer (TS types and checks, the codegen spec, iOS, Android, the Jest mock,
   the example's scenario, docs). ⏸
3. **Decision** into the task file. ⏸
4. **Code review:** the TS contract (types, JSDoc, the codegen spec) and the JS; the native drafts with `--code`. ⏸
5. **Implementation:** `ios-dev`, `android-dev`, the main session (JS, the mock and a scenario in `example/src/`),
   `docs-writer`, in parallel. Native tests with the native code.
6. **Device check** by `qa` on both platforms, from the new scenario.
7. **Review** by `reviewer`, fixes, then the report.

The feature: $ARGUMENTS
