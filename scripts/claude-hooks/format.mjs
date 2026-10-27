#!/usr/bin/env node
// Claude Code PostToolUse hook for Edit | MultiEdit | Write.
// Formats the file that was just changed, quietly, with Prettier: JavaScript, TypeScript and Markdown. Prettier alone
// takes a tenth of the time `eslint --fix` takes on every edit; the ESLint rules are checked by `scripts/lint.sh` and
// the pre-commit hook. Other files stay as they are.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const { tool_input: input = {} } = JSON.parse(readFileSync(0, 'utf8'));
const file = input.file_path ?? '';
const path = relative(root, file);

// Only files of this repository; Prettier skips the ones .prettierignore lists.
if (path && !path.startsWith('..') && !path.split('/').includes('node_modules')) {
  if (/\.(js|mjs|ts|tsx|md)$/.test(path)) {
    spawnSync(join(root, 'node_modules/.bin/prettier'), ['--write', '--ignore-unknown', path], {
      cwd: root,
      stdio: 'ignore',
    });
  }
}
