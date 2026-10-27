#!/usr/bin/env node
// The lines of a failed step's log that say why it failed, at most LIMIT of them, for scripts/lib/quiet.sh.
// Usage: node scripts/lib/summarize.mjs <tsc|eslint|jest|xcode|gradle|junit|tail> <log>
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const LIMIT = 30;
const [mode, log] = process.argv.slice(2);
const text = existsSync(log) ? readFileSync(log, 'utf8') : '';
const lines = text.split('\n');

const short = (file) => (file.startsWith(ROOT + '/') ? relative(ROOT, file) : file);
const firstLine = (message) => (message ?? '').trim().split('\n')[0];

// The lines that match, each once, in their order.
function matching(...patterns) {
  return [...new Set(lines.filter((line) => patterns.some((pattern) => pattern.test(line))))];
}

// A block of Gradle's report: "* What went wrong:" and the lines up to the next "* ".
function gradleReport() {
  const start = lines.findIndex((line) => line.startsWith('* What went wrong:'));
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && line.startsWith('* '));
  return lines.slice(start, end < 0 ? start + 8 : end).filter((line) => line.trim());
}

const summaries = {
  tsc: () => matching(/error TS\d+/),

  eslint: () => {
    const start = text.indexOf('[');
    if (start < 0) return summaries.tail();
    const problems = [];
    for (const result of JSON.parse(text.slice(start))) {
      for (const message of result.messages) {
        if (message.severity < 2) continue;
        problems.push(
          `${short(result.filePath)}:${message.line}:${message.column} ${message.message} (${message.ruleId ?? 'parse'})`
        );
      }
    }
    if (problems.length <= LIMIT) return problems;
    // Too many to list: how many each file has, the most first.
    const perFile = new Map();
    for (const problem of problems) {
      const file = problem.slice(0, problem.indexOf(':'));
      perFile.set(file, (perFile.get(file) ?? 0) + 1);
    }
    return [
      `${problems.length} errors in ${perFile.size} files:`,
      ...[...perFile].sort((a, b) => b[1] - a[1]).map(([file, count]) => `${file}: ${count}`),
    ];
  },

  jest: () => {
    const results = join(dirname(log), 'jest.json');
    if (!existsSync(results)) return summaries.tail();
    const failures = [];
    for (const suite of JSON.parse(readFileSync(results, 'utf8')).testResults) {
      const failed = suite.assertionResults.filter((test) => test.status === 'failed');
      for (const test of failed) {
        failures.push(
          `${short(suite.name)} › ${test.fullName}: ${firstLine(test.failureMessages[0])}`
        );
      }
      // A file that doesn't run has no tests to fail, only its message.
      if (suite.status === 'failed' && failed.length === 0) {
        failures.push(`${short(suite.name)}: ${firstLine(suite.message)}`);
      }
    }
    return failures;
  },

  xcode: () => {
    const errors = matching(/: error: /, /^ld: /, /^Undefined symbols/, /^error: /);
    const warnings = text.includes("compiler warning(s) in the library's iOS sources")
      ? lines.slice(
          lines.findIndex((line) => line.includes("compiler warning(s) in the library's iOS"))
        )
      : [];
    const found = [...errors, ...warnings.filter((line) => line.trim())];
    return found.length > 0
      ? found
      : matching(/\*\* BUILD FAILED \*\*/, /The following build commands failed/);
  },

  gradle: () => {
    // Kotlin `e:`/`w:` (warnings are errors with apexKeychainWarningsAsErrors), javac `file:line: error:`.
    const compiler = matching(/^e: /, /^w: /, /\.java:\d+: (error|warning):/);
    return [...compiler, ...gradleReport()];
  },

  junit: () => {
    const reports = join(ROOT, 'android/build/test-results/testDebugUnitTest');
    const failures = [];
    if (existsSync(reports)) {
      for (const file of readdirSync(reports).filter((name) => name.endsWith('.xml'))) {
        const xml = readFileSync(join(reports, file), 'utf8');
        const cases = xml.matchAll(
          /<testcase name="([^"]*)" classname="([^"]*)"[^>]*>\s*<(failure|error) message="([^"]*)"/g
        );
        for (const [, name, className, , message] of cases) {
          failures.push(
            `${className.split('.').pop()} › ${name}: ${firstLine(message.replace(/&quot;/g, '"'))}`
          );
        }
      }
    }
    // Tests that don't compile fail before any report.
    return failures.length > 0 ? failures : summaries.gradle();
  },

  tail: () => lines.filter((line) => line.trim()).slice(-20),
};

const summary = (summaries[mode] ?? summaries.tail)();
const shown = summary.length > 0 ? summary : summaries.tail();
for (const line of shown.slice(0, LIMIT)) console.log(`  ${line}`);
if (shown.length > LIMIT) console.log(`  … ${shown.length - LIMIT} more`);
