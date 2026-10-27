---
name: api
description: A change of the public API — rename, remove or reshape an option, a method, an error code or a type, in the package or an entry point (/compat, /migrate, /jest, the config plugin) — shown as before/after, then code review, implementation on every layer and the docs.
disable-model-invocation: true
argument-hint: <what to change> [flags]
---

# A change of the API

Follow `.claude/skills/task-flow/SKILL.md` with these stages:

1. **Before and after:** for each change, the API as it is and as it will be, with a short example of each; what it
   means for apps (stored items included: an item written before must still read); the layers it touches (TS types and
   checks, the codegen spec, iOS, Android, the Jest mock, `/compat`, the example, docs). Platform facts only when the
   change depends on them. ⏸
2. **Decision** into the task file.
3. **Code review**, always. ⏸
4. **Implementation** in parallel. JSDoc, the reference page in `docs/reference/` and `docs/sections.json` change with
   the code; `docs-writer` updates every page that shows the old API.
5. **Review:** `reviewer` checks the platforms and the mock agree and no use of the old name is left (search the whole
   repository); `scripts/check.sh` and `scripts/docs.sh build` pass.
6. **Report.**

The change: $ARGUMENTS
