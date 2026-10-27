#!/usr/bin/env node
// Claude Code PreToolUse hook for Edit | MultiEdit | Write: the checks before a file changes, in one process.
// 1. Copyright headers: a change that removes or alters an existing copyright line is blocked; third-party headers
//    stay exactly as they are, and a modified file gets a separate "Modified by" line instead.
// 2. Agent folders: each agent of .claude/agents stays in its folders — ios-dev in ios/ and example/ios/, android-dev
//    in android/ and example/android/, docs-writer in docs/ and Markdown files outside .claude/; researcher, reviewer,
//    qa and ci-doctor change nothing in the repository. The main session isn't limited, and no agent writes the task
//    files in .tasks/.
import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';

// A task session works in a worktree under .claude/worktrees/<name>/ while CLAUDE_PROJECT_DIR stays the main
// checkout, so a file there is measured from its worktree: ios/… and not .claude/worktrees/<name>/ios/….
const WORKTREE = /^\.claude\/worktrees\/[^/]+\//;

const event = JSON.parse(readFileSync(0, 'utf8'));
const { tool_name: tool, agent_type: agent, tool_input: input = {} } = event;

const block = (message) => {
  console.error(message);
  process.exit(2);
};

// Headers sit at the top of a file; LICENSE files are short enough to fit as well.
const HEADER_LINES = 60;
const COPYRIGHT = /copyright/i;
const lines = (text) => (text ?? '').split('\n').map((line) => line.trim());
const copyrightLines = (text, limit) =>
  lines(text)
    .slice(0, limit)
    .filter((line) => COPYRIGHT.test(line));

const removed = [];
if (tool === 'Edit' || tool === 'MultiEdit') {
  const edits = tool === 'Edit' ? [input] : (input.edits ?? []);
  for (const { old_string: before, new_string: after } of edits) {
    const kept = new Set(lines(after));
    removed.push(...copyrightLines(before).filter((line) => !kept.has(line)));
  }
} else if (tool === 'Write' && input.file_path && existsSync(input.file_path)) {
  const kept = new Set(lines(input.content));
  const current = readFileSync(input.file_path, 'utf8');
  removed.push(...copyrightLines(current, HEADER_LINES).filter((line) => !kept.has(line)));
}
if (removed.length > 0) {
  block(
    [
      `Blocked: this change removes or alters copyright line(s) in ${input.file_path}:`,
      ...removed.map((line) => `  ${line}`),
      'Keep existing copyright headers unchanged. When you modify such a file, add a',
      '"Modified by" line below the header instead (see CLAUDE.md).',
    ].join('\n')
  );
}

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const path = input.file_path ? relative(root, input.file_path).replace(WORKTREE, '') : '';
const inRepository = path !== '' && !path.startsWith('..');
const SCOPES = {
  'ios-dev': (file) => file.startsWith('ios/') || file.startsWith('example/ios/'),
  'android-dev': (file) => file.startsWith('android/') || file.startsWith('example/android/'),
  'docs-writer': (file) =>
    file.startsWith('docs/') || (file.endsWith('.md') && !/^\.(claude|tasks)\//.test(file)),
  researcher: () => false,
  reviewer: () => false,
  qa: () => false,
  'ci-doctor': () => false,
};
const inScope = SCOPES[agent];
if (inScope && inRepository && !inScope(path)) {
  block(
    `Blocked: ${agent} doesn't change ${path}. Say in the result what this file needs; the main session changes it.`
  );
}
