---
name: docs
description: Everything about this project's documentation — the Docusaurus site in docs/ (the pages, the hand-written API reference, sections.json), the CLAUDE.md map and the README — how it is organized, how a page is written so a reader learns from it quickly, how a page is audited, and how it is checked. Use when writing, updating or auditing documentation, and after a change of the public API.
argument-hint: <what to write or update> | audit <page or group>
---

# Documentation

## What lives where

- **The site:** `docs/content/<group>/<section>.mdx`. Groups: `start`, `fundamentals`, `guides`, `migration`,
  `security`, `help`.
- **The API reference,** written by hand: `docs/reference/<section>/<Page>.mdx`, a page per export (or per group of
  methods, `storage/methods.mdx`) and a `types.mdx` per section. Its components are in `docs/src/components/Api`:
  `ApiHeader` (the kind, the name, the import), `Facts` (what it returns, whether it prompts, what it throws),
  `Params`, `SeeAlso`.
- **`docs/sections.json`:** `groups` → sections of the docs and the guides (`id`, `title`); `api` → groups → sections
  of the reference (`id`, `title`, `status`: `draft`, `review` or `stable`, `guide`: the page that explains it,
  `docs`: its pages, `labels`: their names in the sidebar). Every export of `src/index.ts` and of the entry points
  (`/compat`, `/migrate`, `/jest`) and the config plugin has its page there.
- **Errors:** `docs/content/fundamentals/errors.mdx` explains them, `docs/content/help/error-codes.mdx` lists every
  code of `src/errors.ts` with what to do about it.
- **Maps and the front page:** `CLAUDE.md` (loaded by Claude Code: keep it short), `README.md`, `CONTRIBUTING.md`.
- **Site code:** components in `docs/src/components/` (`Api`, `Intro`, `PackageInstall`, `Search`), theme overrides in
  `docs/src/theme/`, styles and tokens in `docs/src/css/custom.css`.

## Writing a page

`writing.md` next to this file, modeled on the docs of React Native and Expo: the reader, **Think first**
(the situation, what breaks, the security model, the platforms, time, the what-ifs, other libraries), the kinds of
pages (tutorial, concept, guide, explanation, reference), code. Read it before writing or changing a page. A page is
thought through, not filled from a template.

- Look: the site's own components and tokens; no new colors or fonts.
- Every claim about behavior is checked in the code (`src/`, `ios/`, `android/`) or the tests, never assumed. What only
  a real device shows says so.

## Auditing

`audit <page or group>`: follow `audit.md` next to this file. It reports findings and changes nothing; the fixes come
after the user's answers.

## After a code change

List what the change makes wrong: JSDoc, the reference pages, `sections.json`, the pages that show the changed API or
behavior, `error-codes.mdx` for an error, `README.md`. Update them in the same task.

## Versions and the banner

- The docs describe the version of the root `package.json`: `docs/docusaurus.config.ts` reads it for the navbar and
  for both docs instances (the docs and the API reference). While it is a pre-release (`-alpha`, `-beta`, `-rc`),
  every page carries the banner of `docs/src/theme/DocVersionBanner`: the stage, what it promises (`STAGES`) and the
  install command with its npm tag. A stable version has no banner. Nothing to do by hand when the version changes.
- A new major after a stable release: before the version in `package.json` changes, keep the released docs with
  `yarn --cwd docs docusaurus docs:version <x.y.z>` and `docs:version:api <x.y.z>`, and set `lastVersion` of both
  instances to it. The new pre-release then moves to `/docs/next` and `/api/next`.

## Check

`scripts/docs.sh typecheck`, and `scripts/docs.sh build` after a page changed: it fails on a broken link or anchor. A
pull request builds the site the same way (`docs.yml`); a merge into `main` publishes it at keychain.apexnative.dev.

## The result

The files changed, what changed in each, the checks' lines.
