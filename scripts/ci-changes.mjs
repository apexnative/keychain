#!/usr/bin/env node
// Which jobs of ci.yml a change needs, from the files it changes. `code` (lint, types, headers, Jest, the package
// build): any file but the docs. `native` (the Android and iOS builds of the example app and of the Expo app, the JVM
// tests): the native code, the codegen spec, the config plugin, the native projects of the example, the Expo app, the
// dependencies and the build setup. A change of the docs alone needs neither, nor does a release (the version in
// package.json, the changelog). Without a base to compare to, everything runs. Prints `code=…` and `native=…` for
// $GITHUB_OUTPUT, and the files that count to stderr.
//
// Usage: node scripts/ci-changes.mjs <base> <head>

import { execFileSync } from 'node:child_process';

// The docs and the repository's own setup: nothing the checks or the builds read. The docs site has docs.yml.
const DOCS = [
  /\.md$/,
  /^docs\//,
  /^\.claude\//,
  /^\.github\/(assets|ISSUE_TEMPLATE)\//,
  /^\.github\/workflows\/(docs|pr-title|release|rn-watch)\.yml$/,
  /^(\.release-please-manifest\.json|release-please-config\.json|LICENSE|\.gitignore)$/,
];

// What the native builds compile or are set up by. The Expo builds run the config plugin in `expo prebuild`.
const NATIVE = [
  /^(ios|android|plugin|example-expo)\//,
  /^src\/native\/Native[^/]*\.ts$/,
  /^example\/(ios|android)\//,
  /^example\/(package\.json|Gemfile|Gemfile\.lock)$/,
  /^(package\.json|yarn\.lock|turbo\.json|app\.plugin\.js|[^/]+\.podspec)$/,
  /^scripts\/(ios-warnings\.mjs|android-env\.sh)$/,
  /^\.github\/(workflows\/ci\.yml|actions\/)/,
];

const [base, head] = process.argv.slice(2);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

function changedFiles() {
  if (!base || !head || /^0+$/.test(base)) return null;
  try {
    return git('diff', '--name-only', `${base}...${head}`).split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

// A release changes only the version of package.json.
function versionOnly(file) {
  const lines = git('diff', '--unified=0', `${base}...${head}`, '--', file)
    .split('\n')
    .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line));
  return lines.length > 0 && lines.every((line) => /^[+-]\s*"version":/.test(line));
}

const files = changedFiles();
const counted =
  files &&
  files.filter(
    (file) =>
      !DOCS.some((rule) => rule.test(file)) && !(file === 'package.json' && versionOnly(file))
  );

const code = !counted || counted.length > 0;
const native = !counted || counted.some((file) => NATIVE.some((rule) => rule.test(file)));

console.error(
  counted
    ? `Files that count: ${counted.join(', ') || 'none'}`
    : 'No base to compare to: everything runs'
);
console.log(`code=${code}\nnative=${native}`);
