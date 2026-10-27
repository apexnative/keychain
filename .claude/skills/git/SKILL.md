---
name: git
description: Commits, branches and pull requests of this repository, and what to do when GitHub Actions fails — conventional commits under commitlint, one behavior per commit, the pre-commit checks, the pull request text, the rules of main. Use before any commit, branch, push or pull request, and when CI fails.
argument-hint: [commit | pr | ci <run, or PR number>]
---

# Git and GitHub

Every commit, push and pull request waits for the user's word (`git commit` and `git push` ask, `.claude/settings.json`).
Never `--no-verify`, never force-push `main`, never rewrite history that was pushed.

## Commits

- **Conventional commits**, checked by commitlint (`@commitlint/config-conventional`) in the commit-msg hook: `feat`,
  `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`; `!` after the type or a `BREAKING CHANGE:`
  footer for a breaking change. release-please builds the changelog and the next version from them, so the type says
  what an app sees: a change only to the example apps, the docs, the tests, `scripts/` or `.claude/` is never `feat`
  or `fix`. An optional scope names the area: `ios`, `android`, `plugin`, `docs`, `example`, or an entry point
  (`compat`, `migrate`, `jest`).
- **Subject:** imperative, lowercase, no period, under 100 characters. **Body:** why, wrapped at 100 columns.
- **One behavior change per commit.** A fix and the refactor it needed are two commits; the iOS and Android halves of
  one behavior are one.
- **Stage by name** (`git add <paths>`), never `git add -A`: the tree may hold other work in progress and local files.
  Read `git status` and `git diff --staged` before committing.
- **The pre-commit hook** (lefthook) runs ESLint on the staged files, `tsc` and the header check. When it fails, fix the
  cause and commit again.
- No attribution lines (`attribution` in `.claude/settings.json`).

## Branches and pull requests

- `main` takes changes only through pull requests, squashed, once the required checks pass (the ruleset `main`: the
  jobs of `ci.yml` — `lint`, `test`, `test-android`, `build-library`, `build-android`, `build-ios`, `build-expo-ios`,
  `build-expo-android` — and `pr-title`; a job that `changes` skips counts as passed). There is no merge queue: the
  maintainer merges a green pull request. A branch is `<type>/<short-slug>`: `fix/locked-device-error`.
- A pull request is one change, titled like a commit subject: it is squashed into one commit named by its title, and
  that title is its line in the changelog (`pr-title.yml` checks it with commitlint). Its body: what changes for an
  app, why, the platforms, how it was checked (the scripts, the native tests, the device checks), what is not done;
  `Fixes #123` for an issue.
- After the pull request is open, CI is watched through the app, not by polling.

## When CI fails

- Give the run to the `ci-doctor` agent (its URL or id, or the pull request's number). It reads the log and returns the
  failing job, the error, the likely cause and the command that reproduces it. A whole CI log never goes into the main
  session.
- Reproduce with the matching script before fixing: lint and types → `scripts/check.sh`; Jest → `scripts/test-js.sh`;
  the JVM tests → `scripts/test-android.sh`; the Android example → `scripts/build-android.sh`; the iOS example →
  `scripts/build-ios.sh`. The Expo jobs have no local script: their steps are in `example-expo/README.md`.
- Fix the cause in the code; change a workflow only when the workflow is what is wrong (`.claude/rules/ci.md`).

## Releases

A release is the release pull request that `release.yml` keeps open: `/release` (`.claude/skills/release/SKILL.md`).
Merging it and approving the npm publication stay the maintainer's.
