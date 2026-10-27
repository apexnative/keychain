#!/usr/bin/env node
// Claude Code PreToolUse hook for Bash.
// Builds, tests and checks run through the scripts in scripts/: they print one line, or the errors and the path of
// the full log, where the raw commands fill the context with their output. A command that no script covers runs
// with APEX_RAW=1 in front of it.
import { readFileSync } from 'node:fs';

const { tool_input: input = {} } = JSON.parse(readFileSync(0, 'utf8'));
const command = input.command ?? '';

// The raw command at the start of a command line, and the script that runs it instead. The first that matches wins.
const RAW = [
  // The pod's XCTest, before the builds: `xcodebuild … test` runs the tests, not a build.
  [
    /^xcodebuild\b(?=.*\s(test|test-without-building|build-for-testing)\b)/,
    'scripts/test-ios.sh [UDID]',
  ],
  // Builds, not the questions that only print (`-version`, `-showsdks`, `-list`, …).
  [
    /^xcodebuild\b(?!.*\s-(version|showsdks|list|showBuildSettings|showdestinations|help)\b)/,
    'scripts/build-ios.sh [UDID]',
  ],
  [
    /^(\S*\/)?gradlew\b/,
    'scripts/build-android.sh [--lib | SERIAL], or scripts/test-android.sh [SERIAL] for the tests',
  ],
  [/^(bundle exec )?pod install\b|^yarn example pods\b/, 'scripts/pods.sh'],
  [/^((npx|yarn) )?(\S*\/)?jest\b|^yarn (run )?test\b/, 'scripts/test-js.sh'],
  [
    /^((npx|yarn) )?(\S*\/)?tsc\b|^yarn (run )?typecheck\b|^yarn example typecheck\b/,
    'scripts/typecheck.sh',
  ],
  [/^((npx|yarn) )?(\S*\/)?eslint\b|^yarn (run )?lint\b/, 'scripts/lint.sh [files...]'],
  [/^yarn example (build:ios|ios)\b|^(npx )?react-native run-ios\b/, 'scripts/build-ios.sh [UDID]'],
  [
    /^yarn example (build:android|android)\b|^(npx )?react-native (run|build)-android\b/,
    'scripts/build-android.sh [--lib | SERIAL]',
  ],
  [/^yarn --cwd docs (typecheck|build)\b/, 'scripts/docs.sh [typecheck | build]'],
];

// Each command of the line, without `cd …`, variables set in front, and the JDK wrapper. Quoted text and the body
// of a heredoc are data, not commands.
const bare = command
  .replace(/<<-?\s*(['"]?)(\w+)\1[\s\S]*?\n\s*\2\s*(?=\n|$)/g, '')
  .replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''");
const commands = bare.split(/&&|\|\||[;|\n]/).map((part) =>
  part
    .trim()
    .replace(/^\(+\s*/, '')
    .replace(/^(\w+=\S*\s+)+/, '')
    .replace(/^(time|exec)\s+/, '')
    .replace(/^\S*android-env\.sh\s+/, '')
);

const found = command.includes('APEX_RAW=1')
  ? undefined
  : RAW.find(([pattern]) => commands.some((part) => pattern.test(part)));

if (found) {
  console.error(
    [
      `Run it through ${found[1]}: the script prints OK, or the errors and the path of the full log in .logs/.`,
      'If no script covers this command, put APEX_RAW=1 in front of it and keep its output short.',
    ].join('\n')
  );
  process.exit(2);
}
