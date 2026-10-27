#!/usr/bin/env node
// Runs an iOS build and fails when the compiler warned about the library's own sources (ios/ of this repository):
// warnings in React Native's headers and in other pods don't count. The build's output passes through as it is.
// Usage: node scripts/ios-warnings.mjs <build command> [args...]
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCES = join(dirname(dirname(fileURLToPath(import.meta.url))), 'ios') + '/';
// A warning of clang or swiftc: `/path/File.mm:12:5: warning: text [-Wflag]`.
const WARNING = /^(\/[^:\n]+):(\d+):(\d+): warning: (.*)$/gm;

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node scripts/ios-warnings.mjs <build command> [args...]');
  process.exit(1);
}

let output = '';
const build = spawn(command, args, { stdio: ['inherit', 'pipe', 'pipe'] });
for (const [from, to] of [
  [build.stdout, process.stdout],
  [build.stderr, process.stderr],
]) {
  from.on('data', (chunk) => {
    output += chunk;
    to.write(chunk);
  });
}
build.on('error', (error) => {
  console.error(`${command}: ${error.message}`);
  process.exit(1);
});
build.on('close', (code) => {
  if (code !== 0) process.exit(code ?? 1);
  // Each warning once: a header's warning comes again in every file that imports it.
  const warnings = new Set();
  for (const [, file, line, , text] of output.matchAll(WARNING)) {
    if (file.startsWith(SOURCES))
      warnings.add(`ios/${file.slice(SOURCES.length)}:${line}: ${text}`);
  }
  if (warnings.size === 0) return;
  console.error(`\n${warnings.size} compiler warning(s) in the library's iOS sources:`);
  for (const warning of [...warnings].sort()) console.error(`  ${warning}`);
  process.exit(1);
});
