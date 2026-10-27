#!/usr/bin/env node
// Guards the copyright headers recorded in scripts/license-headers.json.
//
//   node scripts/check-license-headers.mjs                      check (CI, pre-commit)
//   node scripts/check-license-headers.mjs record <path>...     record third-party files
//   node scripts/check-license-headers.mjs record --allow-changes <file>...
//
// For every recorded file the check requires that
//   - each recorded copyright line is still present, unchanged;
//   - a file whose content differs from the recorded original carries a "Modified by" line
//     (files recorded with --allow-changes, such as LICENSE, may change freely otherwise).
// A deleted file needs no header: the check only reminds you to drop its entry.
// The manifest stores hashes only, never the header text.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const manifestPath = join(root, 'scripts', 'license-headers.json');
const HEADER_LINES = 60;
const COPYRIGHT = /copyright/i;
const MODIFIED = /Modified by/;
const SKIP_DIRS = new Set(['node_modules', 'build', '.git', '.gradle', 'Pods', 'lib']);

const sha = (text) => createHash('sha256').update(text).digest('hex');
const headerLines = (text) =>
  text
    .split('\n')
    .slice(0, HEADER_LINES)
    .map((line) => line.trim());
const copyrightHashes = (text) =>
  headerLines(text)
    .filter((l) => COPYRIGHT.test(l))
    .map(sha);

function readManifest() {
  return existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
}

function* walk(path) {
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (!SKIP_DIRS.has(entry)) yield* walk(join(path, entry));
    }
  } else {
    yield path;
  }
}

function record(args) {
  const allowChanges = args.includes('--allow-changes');
  const paths = args.filter((arg) => arg !== '--allow-changes');
  const manifest = readManifest();
  let added = 0;
  for (const path of paths) {
    for (const file of walk(join(root, path))) {
      const text = readFileSync(file, 'utf8');
      const copyright = copyrightHashes(text);
      if (copyright.length === 0) continue;
      manifest[relative(root, file)] = allowChanges
        ? { copyright }
        : { copyright, original: sha(text) };
      added++;
    }
  }
  const sorted = Object.fromEntries(
    Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b))
  );
  writeFileSync(manifestPath, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`Recorded ${added} file(s); ${Object.keys(sorted).length} in the manifest.`);
}

function check() {
  const manifest = readManifest();
  const errors = [];
  const stale = [];
  for (const [file, entry] of Object.entries(manifest)) {
    const path = join(root, file);
    if (!existsSync(path)) {
      stale.push(file);
      continue;
    }
    const text = readFileSync(path, 'utf8');
    const present = new Set(copyrightHashes(text));
    const missing = entry.copyright.filter((hash) => !present.has(hash)).length;
    if (missing > 0) {
      errors.push(`${file}: ${missing} copyright line(s) removed or changed`);
    }
    if (
      entry.original &&
      sha(text) !== entry.original &&
      !headerLines(text).some((l) => MODIFIED.test(l))
    ) {
      errors.push(`${file}: modified without a "Modified by" line in the header`);
    }
  }
  for (const file of stale) {
    console.warn(`! ${file}: file removed — drop its entry from scripts/license-headers.json`);
  }
  if (errors.length > 0) {
    console.error(errors.map((error) => `✗ ${error}`).join('\n'));
    console.error(
      '\nThird-party copyright headers must stay unchanged; modified files need a "Modified by" line.'
    );
    process.exit(1);
  }
  console.log(`✓ License headers: ${Object.keys(manifest).length - stale.length} file(s) checked.`);
}

const [command, ...args] = process.argv.slice(2);
if (command === 'record') record(args);
else check();
